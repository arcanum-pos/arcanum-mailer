import { emailOf, httpFailure, list, MailError, nameOf, required, type Address, type MailProvider } from './types';

// Resend's API (https://resend.com/docs/api-reference/emails/send-email):
// POST /emails with a Bearer key. The sender's domain must be verified in
// the Resend account (otherwise 403 — a refusal of this message, not of the key).
interface Settings {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

const ENDPOINT = 'https://api.resend.com/emails';

const formatted = (a: Address) => (nameOf(a) ? `${nameOf(a)} <${emailOf(a)}>` : emailOf(a));

export const resend: MailProvider<Settings> = {
  type: 'resend',
  validate: (s) => required(s, ['apiKey', 'fromAddress']),
  async send(s, m) {
    const name = m.fromName || s.fromName;
    const body = {
      from: name ? `${name} <${s.fromAddress}>` : s.fromAddress,
      to: list(m.to).map(formatted),
      ...(m.cc ? { cc: list(m.cc).map(formatted) } : {}),
      ...(m.bcc ? { bcc: list(m.bcc).map(formatted) } : {}),
      ...(m.replyTo ? { reply_to: formatted(m.replyTo) } : {}),
      subject: m.subject,
      ...(m.html ? { html: m.html } : {}),
      ...(m.text ? { text: m.text } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
    };
    let res: Response;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      throw new MailError('unreachable', "Couldn't talk to Resend", (err as Error).message);
    }
    if (!res.ok) throw await httpFailure('Resend', res, [401]);
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: data.id };
  },
};
