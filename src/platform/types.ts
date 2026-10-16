// What the mailer needs from where it runs (SELF_HOSTING.md): on Cloudflare
// a Worker (platform/cloudflare.ts), self-hosted a Node process
// (platform/node.ts). The mail code itself only ever talks to this.

// A TCP connection for SMTP, shaped like Cloudflare's `connect()` socket
// (cloudflare:sockets) — web streams, `opened`, and an upgrade to TLS
// (STARTTLS) that returns the same connection, encrypted.
export interface TcpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
  startTls(): TcpSocket;
}

export type Connect = (
  address: { hostname: string; port: number },
  options: { secureTransport: 'on' | 'off' | 'starttls'; allowHalfOpen: boolean }
) => TcpSocket;

import type { SendEmailBinding } from '../providers/cloudflare';

export interface Runtime {
  // The key every /send carries (MAILER_INTERNAL_KEY).
  internalKey: string;
  connect: Connect;
  // Cloudflare Email Service's `send_email` binding: only on Cloudflare.
  email?: SendEmailBinding;
}
