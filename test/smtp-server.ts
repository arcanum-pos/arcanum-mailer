// A tiny SMTP server for the Node tests: speaks just enough (EHLO,
// STARTTLS, AUTH PLAIN, MAIL/RCPT/DATA, QUIT) to receive one message, and
// records what it saw. TLS with the test's own certificate (fixtures/).
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const CERT = readFileSync(path.join(dir, 'fixtures/localhost-cert.pem'));
const KEY = readFileSync(path.join(dir, 'fixtures/localhost-key.pem'));

export interface Received {
  ehlo: string[];
  secure: boolean;
  auth: { username: string; password: string } | null;
  from: string | null;
  to: string[];
  data: string;
}

// `implicitTls`: TLS from the first byte (port 465 style); otherwise plain
// with STARTTLS offered (587 style) — or not offered (`startTls: false`).
// `password`: the only one accepted.
export async function smtpServer(opts: { implicitTls?: boolean; startTls?: boolean; password?: string } = {}) {
  const received: Received[] = [];
  const onSocket = (socket: net.Socket, startSecure: boolean) => {
    const r: Received = { ehlo: [], secure: startSecure, auth: null, from: null, to: [], data: '' };
    received.push(r);
    let current: net.Socket = socket;
    let buffer = '';
    let inData = false;
    const say = (line: string) => current.write(`${line}\r\n`);
    const handle = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          return say('250 2.0.0 queued');
        }
        r.data += line + '\n';
        return;
      }
      const [verb] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          r.ehlo.push(line.slice(5));
          return say(['250-localhost', ...(!r.secure && opts.startTls !== false ? ['250-STARTTLS'] : []), '250 AUTH PLAIN LOGIN'].join('\r\n'));
        case 'STARTTLS': {
          say('220 2.0.0 ready for TLS');
          current.removeAllListeners('data');
          const secure = new tls.TLSSocket(socket, { isServer: true, key: KEY, cert: CERT });
          r.secure = true;
          current = secure;
          listen(secure);
          return;
        }
        case 'AUTH': {
          const [, username, password] = Buffer.from(line.split(' ')[2], 'base64').toString().split('\0');
          if (opts.password && password !== opts.password) return say('535 5.7.8 Username and Password not accepted');
          r.auth = { username, password };
          return say('235 2.7.0 Authentication successful');
        }
        case 'MAIL':
          r.from = /<(.*)>/.exec(line)![1];
          return say('250 2.1.0 OK');
        case 'RCPT':
          r.to.push(/<(.*)>/.exec(line)![1]);
          return say('250 2.1.5 OK');
        case 'DATA':
          inData = true;
          return say('354 go ahead');
        case 'QUIT':
          say('221 2.0.0 bye');
          return current.end();
        default:
          return say('502 5.5.2 not implemented');
      }
    };
    const listen = (s: net.Socket) =>
      s.on('data', (chunk) => {
        buffer += chunk.toString();
        let i: number;
        while ((i = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          handle(line);
        }
      });
    s_error(socket);
    listen(socket);
    say('220 localhost ESMTP test');
  };
  const s_error = (s: net.Socket) => s.on('error', () => {});
  const server = opts.implicitTls
    ? tls.createServer({ key: KEY, cert: CERT }, (s) => onSocket(s, true))
    : net.createServer((s) => onSocket(s, false));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
