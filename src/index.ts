// questo-mail: the platform's outbound email transport, kept deliberately
// separate from `worker` — a raw-TCP SMTP client is a different kind of
// thing from an HTTP request handler, and this Worker never touches
// payment/org data, only whatever content a caller hands it to send. Not
// publicly reachable (workers_dev: false); the only path in is `worker`'s
// own service binding, gated by MAILER_INTERNAL_KEY the same way `worker`
// gates its own /devices/broadcast route for questo-devicehub.
import type { Env } from './env';
import { sendEmail, type SendEmailRequest } from './send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requireInternalKey(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return Boolean(env.MAILER_INTERNAL_KEY) && token === env.MAILER_INTERNAL_KEY;
}

async function handleSend(request: Request, env: Env): Promise<Response> {
  if (!requireInternalKey(request, env)) return json({ error: 'Unauthorized' }, 401);

  const body = (await request.json().catch(() => null)) as SendEmailRequest | null;
  if (!body || !body.to || !body.subject || (!body.text && !body.html)) {
    return json({ error: 'to, subject, and at least one of text/html are required' }, 400);
  }

  try {
    await sendEmail(env, body);
    return json({ ok: true });
  } catch (err) {
    // The caller (worker) already treats this as best-effort and never
    // fails its own primary action on a send failure — but it still needs
    // to know it failed, for logging/retry decisions on its side.
    return json({ error: 'Failed to send email', details: (err as Error).message }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ status: 'healthy' });
      }

      if (request.method === 'POST' && url.pathname === '/send') {
        return await handleSend(request, env);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: 'Unexpected questo-mail error', details: (err as Error).message }, 502);
    }
  },
};
