// The mailer self-hosted (SELF_HOSTING.md): a Node process. Its socket is
// built on Node's net/tls, shaped like Cloudflare's (platform/types.ts):
// web streams, `opened`, and STARTTLS by wrapping the same TCP connection in
// TLS. No Cloudflare Email Service here — SMTP and the API services work.
import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import type { Connect, Runtime, TcpSocket } from './types';

// Web streams over a Node socket, detachable: on STARTTLS the plain
// socket's listeners must go before TLS takes the connection over.
function streamsOf(socket: net.Socket) {
  const listeners: [string, (...args: any[]) => void][] = [];
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const on = (event: string, fn: (...args: any[]) => void) => {
        socket.on(event, fn);
        listeners.push([event, fn]);
      };
      on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      on('end', () => {
        try {
          controller.close();
        } catch {
          // already closed or detached
        }
      });
      on('error', (err: Error) => {
        try {
          controller.error(err);
        } catch {
          // already closed or detached
        }
      });
    },
    cancel() {
      socket.destroy();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write: (chunk) => new Promise<void>((resolve, reject) => socket.write(chunk, (err) => (err ? reject(err) : resolve()))),
    close: () => new Promise<void>((resolve) => socket.end(resolve)),
  });
  const detach = () => listeners.forEach(([event, fn]) => socket.off(event, fn));
  return { readable, writable, detach };
}

// `tlsOptions`: extra TLS settings — only the tests use them (to trust
// their own certificate); a self-hoster's own CA goes in NODE_EXTRA_CA_CERTS.
function wrap(socket: net.Socket, opened: Promise<unknown>, hostname: string, tlsOptions: tls.ConnectionOptions): TcpSocket {
  const streams = streamsOf(socket);
  // Not left unhandled when nobody waits for it (the client always does).
  opened.catch(() => {});
  return {
    readable: streams.readable,
    writable: streams.writable,
    opened,
    close: () => new Promise<void>((resolve) => socket.end(resolve)),
    startTls() {
      streams.detach();
      const secure = tls.connect({ ...tlsOptions, socket, servername: hostname });
      return wrap(secure, once(secure, 'secureConnect'), hostname, tlsOptions);
    },
  };
}

export function nodeConnectWith(tlsOptions: tls.ConnectionOptions = {}): Connect {
  return ({ hostname, port }, { secureTransport }) => {
    if (secureTransport === 'on') {
      const socket = tls.connect({ ...tlsOptions, host: hostname, port, servername: hostname });
      return wrap(socket, once(socket, 'secureConnect'), hostname, tlsOptions);
    }
    const socket = net.connect({ host: hostname, port });
    return wrap(socket, once(socket, 'connect'), hostname, tlsOptions);
  };
}

export const nodeConnect = nodeConnectWith();

export function nodeRuntime(env: NodeJS.ProcessEnv): Runtime {
  if (!env.MAILER_INTERNAL_KEY) throw new Error('MAILER_INTERNAL_KEY is required');
  return { internalKey: env.MAILER_INTERNAL_KEY, connect: nodeConnect };
}
