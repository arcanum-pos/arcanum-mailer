// The mailer self-hosted (SELF_HOSTING.md): the shared contract with the
// Node runtime, and SMTP's real conversation — plain, STARTTLS and TLS
// from the first byte — against a small SMTP server (smtp-server.ts),
// through Node's net/tls socket (platform/node.ts).
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { WorkerMailer } from '../src/mailer';
import { LogLevel } from '../src/mailer/logger';
import { nodeConnectWith, nodeRuntime } from '../src/platform/node';
import { KEY, mailerContract } from './contract';
import { CERT, smtpServer } from './smtp-server';

mailerContract('on Node', () => nodeRuntime({ MAILER_INTERNAL_KEY: 'test-mailer-key' }));

const app = () => createApp({ ...nodeRuntime({ MAILER_INTERNAL_KEY: 'test-mailer-key' }), connect: nodeConnectWith({ ca: CERT }) });
const send = (port: number, extra: Record<string, unknown> = {}) =>
  app().fetch(
    new Request('https://mailer/send', {
      method: 'POST',
      headers: KEY,
      body: JSON.stringify({
        message: { to: ['jan@example.test', 'an@example.test'], subject: 'Uitnodiging', text: 'Welkom', fromName: 'Scouts Elewijt' },
        provider: { type: 'smtp', host: 'localhost', port, username: 'kassa@scouts.test', password: 'geheim', fromAddress: 'kassa@scouts.test', ...extra },
      }),
    })
  );

describe('SMTP on Node', () => {
  it('a plain connection upgraded with STARTTLS (587): signed in and delivered over TLS', async () => {
    const server = await smtpServer();
    try {
      const res = await send(server.port);
      expect(await res.json()).toEqual({ ok: true });
      const [r] = server.received;
      expect(r).toMatchObject({ secure: true, auth: { username: 'kassa@scouts.test', password: 'geheim' }, from: 'kassa@scouts.test', to: ['jan@example.test', 'an@example.test'] });
      // EHLO again after STARTTLS (RFC 3207), with the sender's domain.
      expect(r.ehlo).toEqual(['scouts.test', 'scouts.test']);
      expect(r.data).toContain('Subject: Uitnodiging');
      expect(r.data).toContain('Welkom');
    } finally {
      await server.close();
    }
  });

  it('TLS from the first byte (465)', async () => {
    const server = await smtpServer({ implicitTls: true });
    try {
      // The port says 465 in real life; here the client is told to go secure through it.
      const res = await createApp({ ...nodeRuntime({ MAILER_INTERNAL_KEY: 'test-mailer-key' }), connect: (address, options) => nodeConnectWith({ ca: CERT })(address, { ...options, secureTransport: 'on' }) }).fetch(
        new Request('https://mailer/send', {
          method: 'POST',
          headers: KEY,
          body: JSON.stringify({ message: { to: 'jan@example.test', subject: 'Code', text: '123456' }, provider: { type: 'smtp', host: 'localhost', port: server.port, username: 'u', password: 'p', fromAddress: 'noreply@scouts.test' } }),
        })
      );
      expect(await res.json()).toEqual({ ok: true });
      expect(server.received[0]).toMatchObject({ secure: true, to: ['jan@example.test'] });
    } finally {
      await server.close();
    }
  });

  it('a wrong password: auth_failed, nothing delivered', async () => {
    const server = await smtpServer({ password: 'het-juiste' });
    try {
      const res = await send(server.port);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ ok: false, code: 'auth_failed' });
      expect(server.received[0].from).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('even at the debug log level, the credentials never reach the log (AUTH PLAIN and LOGIN)', async () => {
    for (const authType of ['plain', 'login'] as const) {
      const server = await smtpServer();
      const logged: string[] = [];
      const debug = vi.spyOn(console, 'debug').mockImplementation((...args) => void logged.push(args.join(' ')));
      try {
        await WorkerMailer.send(
          {
            host: 'localhost',
            port: server.port,
            secure: false,
            credentials: { username: 'kassa@scouts.test', password: 'geheim' },
            authType: [authType],
            clientName: 'scouts.test',
            connect: nodeConnectWith({ ca: CERT }),
            logLevel: LogLevel.DEBUG,
          },
          { from: { email: 'kassa@scouts.test' }, to: 'jan@example.test', subject: 'Test', text: 'Hallo' }
        );
        expect(server.received[0].auth, authType).toEqual({ username: 'kassa@scouts.test', password: 'geheim' });
        const log = logged.join('\n');
        expect(log, authType).toContain('Write to socket');
        expect(log, authType).toContain('[credentials hidden]');
        for (const secret of ['geheim', btoa('geheim'), btoa('\0kassa@scouts.test\0geheim')]) expect(log, `${authType} ${secret}`).not.toContain(secret);
      } finally {
        debug.mockRestore();
        await server.close();
      }
    }
  });

  it('nobody listening: unreachable', async () => {
    const server = await smtpServer();
    const port = server.port;
    await server.close();
    expect(await (await send(port)).json()).toMatchObject({ ok: false, code: 'unreachable' });
  });

  it("a certificate it can't trust: not sent (no TLS without checking who's on the other end)", async () => {
    const server = await smtpServer();
    try {
      const untrusting = createApp(nodeRuntime({ MAILER_INTERNAL_KEY: 'test-mailer-key' }));
      const res = await untrusting.fetch(
        new Request('https://mailer/send', {
          method: 'POST',
          headers: KEY,
          body: JSON.stringify({ message: { to: 'jan@example.test', subject: 's', text: 't' }, provider: { type: 'smtp', host: 'localhost', port: server.port, username: 'u', password: 'p', fromAddress: 'a@scouts.test' } }),
        })
      );
      expect((await res.json()).ok).toBe(false);
      expect(server.received[0].auth).toBeNull();
    } finally {
      await server.close();
    }
  });
});
