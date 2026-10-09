// The mailer's contract (MAIL.md): one request shape whatever the service,
// the same answers, services as plug-ins — and the request shape from
// before still accepted. The HTTP services (Brevo, Resend) are stubbed on
// the global fetch; SMTP can't be (raw sockets), so its plug-in is tested
// for its settings and error sorting.
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSend, readRequest } from '../src/index';
import { MailError, PROVIDERS, type MailProvider } from '../src/providers';
import { classify } from '../src/providers/smtp';

const KEY = { Authorization: 'Bearer test-mailer-key', 'Content-Type': 'application/json' };
const MESSAGE = { to: 'jan@example.test', subject: 'Uitnodiging', text: 'Welkom', html: '<p>Welkom</p>', fromName: 'Scouts Elewijt' };

const send = (body: unknown, headers: Record<string, string> = KEY) => SELF.fetch('https://mailer/send', { method: 'POST', headers, body: JSON.stringify(body) });

let outbound: { url: string; headers: Record<string, string>; body: any }[];
let reply: (url: string) => Response;

beforeEach(() => {
  outbound = [];
  reply = (url) => (url.includes('brevo') ? Response.json({ messageId: '<m1@brevo>' }, { status: 201 }) : Response.json({ id: 'r-1' }));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const request = new Request(input, init);
    outbound.push({ url: request.url, headers: Object.fromEntries(request.headers), body: await request.clone().json().catch(() => null) });
    return reply(request.url);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('the contract', () => {
  it('only with the internal key', async () => {
    expect((await send({ message: MESSAGE, provider: { type: 'brevo', apiKey: 'k', fromAddress: 'a@b.test' } }, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect(outbound).toEqual([]);
  });

  it('an unknown service, missing settings or an incomplete message: invalid_config, nothing sent', async () => {
    const unknown = await send({ message: MESSAGE, provider: { type: 'pigeon' } });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ ok: false, code: 'invalid_config', error: 'Unknown mail service "pigeon"' });

    const incomplete = await send({ message: MESSAGE, provider: { type: 'resend', fromAddress: 'a@b.test' } });
    expect(await incomplete.json()).toMatchObject({ ok: false, code: 'invalid_config', detail: 'apiKey is required' });

    const noBody = await send({ message: { to: 'jan@example.test', subject: 'x' }, provider: { type: 'resend', apiKey: 'k', fromAddress: 'a@b.test' } });
    expect(await noBody.json()).toMatchObject({ code: 'invalid_config' });
    expect(outbound).toEqual([]);
  });

  it('every service is a plug-in: SMTP, Gmail API, Brevo, Resend and Cloudflare Email Service are registered', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['brevo', 'cloudflare', 'gmail_api', 'resend', 'smtp'])
  });

  it('a plug-in that throws something unexpected: unreachable, with what it said', async () => {
    const broken: MailProvider = { type: 'broken', validate: () => [], send: async () => { throw new Error('boom') } };
    const res = await handleSend(new Request('https://mailer/send', { method: 'POST', headers: KEY, body: JSON.stringify({ message: MESSAGE, provider: { type: 'broken' } }) }), env, { broken });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: 'unreachable', detail: 'boom' });
  });
});

describe('the request shape from before the contract', () => {
  it('message fields at the top, credentials apart, no provider = SMTP', () => {
    expect(readRequest({ to: 'a@b.test', subject: 's', text: 't', credentials: { host: 'h', port: 587 } })).toEqual({
      message: { to: 'a@b.test', subject: 's', text: 't' },
      provider: { type: 'smtp', host: 'h', port: 587 },
    });
    expect(readRequest({ provider: 'gmail_api', to: 'a@b.test', subject: 's', text: 't', credentials: { clientEmail: 'c' } }).provider).toEqual({ type: 'gmail_api', clientEmail: 'c' });
  });
});

describe('Brevo', () => {
  it('sends through its API with the api-key header, the organisation as sender name', async () => {
    const res = await send({ message: { ...MESSAGE, replyTo: 'leiding@scouts.test' }, provider: { type: 'brevo', apiKey: 'xkeysib-1', fromAddress: 'noreply@scouts.test' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: '<m1@brevo>' });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(outbound[0].headers['api-key']).toBe('xkeysib-1');
    expect(outbound[0].body).toEqual({
      sender: { email: 'noreply@scouts.test', name: 'Scouts Elewijt' },
      to: [{ email: 'jan@example.test' }],
      replyTo: { email: 'leiding@scouts.test' },
      subject: 'Uitnodiging',
      htmlContent: '<p>Welkom</p>',
      textContent: 'Welkom',
    });
  });

  it('a wrong key: auth_failed; a refused message: rejected; Brevo down: unreachable', async () => {
    const provider = { type: 'brevo', apiKey: 'k', fromAddress: 'a@b.test' };
    for (const [status, code] of [[401, 'auth_failed'], [400, 'rejected'], [503, 'unreachable'], [429, 'unreachable']] as const) {
      reply = () => Response.json({ code: 'x', message: 'nope' }, { status });
      const res = await send({ message: MESSAGE, provider });
      expect(res.status, String(status)).toBe(502);
      expect(await res.json(), String(status)).toMatchObject({ ok: false, code, detail: '{"code":"x","message":"nope"}' });
    }
  });
});

describe('Resend', () => {
  it('sends through its API with a Bearer key, "Name <address>" as sender', async () => {
    const res = await send({ message: { ...MESSAGE, to: ['jan@example.test', { name: 'An', email: 'an@example.test' }] }, provider: { type: 'resend', apiKey: 're_1', fromAddress: 'noreply@scouts.test' } });
    expect(await res.json()).toEqual({ ok: true, id: 'r-1' });
    expect(outbound[0].url).toBe('https://api.resend.com/emails');
    expect(outbound[0].headers.authorization).toBe('Bearer re_1');
    expect(outbound[0].body).toMatchObject({ from: 'Scouts Elewijt <noreply@scouts.test>', to: ['jan@example.test', 'An <an@example.test>'], subject: 'Uitnodiging', html: '<p>Welkom</p>', text: 'Welkom' });
  });

  it("an unverified sending domain (403) is a refused message, not a wrong key", async () => {
    reply = () => Response.json({ name: 'validation_error', message: 'The scouts.test domain is not verified' }, { status: 403 });
    expect(await (await send({ message: MESSAGE, provider: { type: 'resend', apiKey: 'k', fromAddress: 'a@scouts.test' } })).json()).toMatchObject({ code: 'rejected' });
    reply = () => Response.json({ message: 'API key is invalid' }, { status: 401 });
    expect(await (await send({ message: MESSAGE, provider: { type: 'resend', apiKey: 'k', fromAddress: 'a@scouts.test' } })).json()).toMatchObject({ code: 'auth_failed' });
  });
});

describe('SMTP', () => {
  it('needs host, a port number, username, password and fromAddress', () => {
    expect(PROVIDERS.smtp.validate({ host: 'smtp.mail.me.com', port: 587, username: 'u', password: 'p', fromAddress: 'a@b.test' })).toEqual([]);
    expect(PROVIDERS.smtp.validate({ host: 'h', port: 'x', fromAddress: 'a@b.test' })).toEqual(['username is required', 'password is required', 'port must be a port number']);
  });

  it("sorts the server's answers: the sign-in, the message, the connection", () => {
    expect(classify(new Error('Failed to plain authentication: 550 5.1.1 Mailbox does not exist')).code).toBe('auth_failed');
    expect(classify(new Error('535 5.7.8 Username and Password not accepted')).code).toBe('auth_failed');
    expect(classify(new Error('550 5.1.1 recipient rejected')).code).toBe('rejected');
    expect(classify(new Error('Socket closed unexpectedly')).code).toBe('unreachable');
    expect(classify(new Error('x'))).toBeInstanceOf(MailError);
  });
});

describe('Cloudflare Email Service', () => {
  const settings = { fromAddress: 'kassa@scouts.test', fromName: 'Arcanum' };
  const binding = (send: (m: any) => Promise<{ messageId: string }>) => ({ ...env, EMAIL: { send } });

  it('sends through the send_email binding, the message mapped to its shape', async () => {
    const sent: any[] = [];
    const result = await PROVIDERS.cloudflare.send(
      settings,
      { ...MESSAGE, to: [{ email: 'jan@example.test' }, { email: 'an@example.test', name: 'An' }], replyTo: 'beheer@scouts.test', attachments: [{ filename: 'a.txt', content: btoa('hallo'), mimeType: 'text/plain' }] },
      binding(async (m) => (sent.push(m), { messageId: 'cf-1' }))
    );
    expect(result).toEqual({ id: 'cf-1' });
    expect(sent[0]).toMatchObject({
      from: { email: 'kassa@scouts.test', name: 'Scouts Elewijt' },
      to: [{ email: 'jan@example.test' }, { email: 'an@example.test', name: 'An' }],
      replyTo: { email: 'beheer@scouts.test' },
      subject: 'Uitnodiging',
      text: 'Welkom',
      html: '<p>Welkom</p>',
      attachments: [{ filename: 'a.txt', type: 'text/plain', disposition: 'attachment' }],
    });
    expect(new TextDecoder().decode(sent[0].attachments[0].content)).toBe('hallo');
    expect(outbound).toEqual([]);
  });

  it("sorts the binding's errors into the contract's codes", async () => {
    const failing = (code: string) => binding(async () => { throw Object.assign(new Error('nope'), { code }) });
    const codeOf = async (code: string) => PROVIDERS.cloudflare.send(settings, MESSAGE, failing(code)).catch((e: MailError) => e.code);
    expect(await codeOf('E_SENDER_DOMAIN_NOT_AVAILABLE')).toBe('invalid_config');
    expect(await codeOf('E_SENDER_NOT_VERIFIED')).toBe('invalid_config');
    expect(await codeOf('E_RECIPIENT_NOT_ALLOWED')).toBe('rejected');
    expect(await codeOf('E_RATE_LIMIT_EXCEEDED')).toBe('unreachable');
    expect(await codeOf('E_VALIDATION_ERROR')).toBe('rejected');
  });

  it('without the binding: invalid_config; without a sender: invalid_config, nothing tried', async () => {
    const res = await handleSend(new Request('https://mailer/send', { method: 'POST', headers: KEY, body: JSON.stringify({ message: MESSAGE, provider: { type: 'cloudflare', ...settings } }) }), { ...env, EMAIL: undefined });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'invalid_config' });
    const noFrom = await send({ message: MESSAGE, provider: { type: 'cloudflare' } });
    expect(await noFrom.json()).toMatchObject({ code: 'invalid_config', detail: 'fromAddress is required' });
  });
});
