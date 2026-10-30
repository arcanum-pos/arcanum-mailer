// arcanum-mailer: outbound e-mail only. Not publicly reachable — on
// Cloudflare only through a service binding (an installation's
// arcanum-backend, or arcanum-auth for the platform's copy,
// arcanum-platform-mailer); self-hosted only inside the cluster. Every call
// is gated by MAILER_INTERNAL_KEY. Holds no mail account of its own: every
// request names the service and carries its settings (MAIL.md, "The mailer
// contract"):
//
//   POST /send  { message: { to, subject, text?, html?, fromName?, replyTo?, cc?, bcc?, attachments? },
//                 provider: { type: 'smtp' | 'gmail_api' | 'brevo' | 'resend' | 'cloudflare', …its settings } }
//   → 200 { ok: true, id? }
//   → 400 { ok: false, code: 'invalid_config', error, detail? }   (also for a malformed message)
//   → 502 { ok: false, code: 'auth_failed' | 'rejected' | 'unreachable', error, detail? }
//   GET  /health → 200 { status: 'healthy' }
//
// Services are plug-ins: src/providers. The request shape from before this
// contract ({ provider?: 'smtp' | 'gmail_api', credentials, to, subject, … })
// is still accepted, so an installation mid-update keeps sending.
//
// The same app runs on Cloudflare (index.ts) and self-hosted on Node
// (node.ts): what differs is only the Runtime (platform/).
import { Hono } from 'hono';
import { MailError, PROVIDERS, type MailProvider, type OutgoingMessage } from './providers';
import type { Runtime } from './platform/types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function requireInternalKey(request: Request, runtime: Runtime): boolean {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return Boolean(runtime.internalKey) && token === runtime.internalKey;
}

const failure = (err: MailError) =>
  json({ ok: false, code: err.code, error: err.message, ...(err.detail ? { detail: err.detail } : {}) }, err.code === 'invalid_config' ? 400 : 502);

type Body = Record<string, any>;

// Either shape → { message, provider settings with their type }.
export function readRequest(body: Body): { message: OutgoingMessage; provider: Record<string, unknown> & { type: string } } {
  if (body.message && body.provider && typeof body.provider === 'object') {
    return { message: body.message, provider: body.provider };
  }
  // Before the contract: the message's fields at the top, credentials apart, no provider = SMTP.
  const { provider, credentials, ...message } = body;
  return { message: message as OutgoingMessage, provider: { ...(credentials ?? {}), type: typeof provider === 'string' ? provider : 'smtp' } };
}

export async function handleSend(request: Request, runtime: Runtime, providers: Record<string, MailProvider<any>> = PROVIDERS): Promise<Response> {
  if (!requireInternalKey(request, runtime)) return json({ ok: false, error: 'Unauthorized' }, 401);
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return failure(new MailError('invalid_config', 'A JSON body is required'));

  const { message, provider: settings } = readRequest(body);
  if (!message?.to || (Array.isArray(message.to) && message.to.length === 0) || !message.subject || (!message.text && !message.html)) {
    return failure(new MailError('invalid_config', 'to, subject, and at least one of text/html are required'));
  }
  const provider = Object.hasOwn(providers, settings.type) ? providers[settings.type] : undefined;
  if (!provider) return failure(new MailError('invalid_config', `Unknown mail service "${settings.type}"`));
  const problems = provider.validate(settings);
  if (problems.length) return failure(new MailError('invalid_config', `The ${settings.type} settings are incomplete`, problems.join('; ')));

  try {
    const result = await provider.send(settings, message, runtime);
    return json({ ok: true, ...(result.id ? { id: result.id } : {}) });
  } catch (err) {
    // The caller decides whether a failure is best-effort (an invite is
    // still made) or shown (a test mail) — either way it learns what happened.
    return failure(err instanceof MailError ? err : new MailError('unreachable', 'Sending failed', (err as Error).message));
  }
}

export function createApp(runtime: Runtime): Hono {
  const app = new Hono();
  app.get('/health', () => json({ status: 'healthy' }));
  app.post('/send', (c) => handleSend(c.req.raw, runtime));
  app.notFound(() => json({ error: 'Not found' }, 404));
  app.onError((err) => json({ ok: false, code: 'unreachable', error: 'Unexpected arcanum-mailer error', detail: err.message }, 502));
  return app;
}
