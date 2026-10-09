import { emailOf, httpFailure, list, MailError, nameOf, required, type MailProvider } from './types';

// Brevo's transactional e-mail API (https://developers.brevo.com):
// POST /v3/smtp/email with the `api-key` header. The sender (fromAddress)
// must be a verified sender or domain in the Brevo account.
interface Settings {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export const brevo: MailProvider<Settings> = {
  type: 'brevo',
  validate: (s) => required(s, ['apiKey', 'fromAddress']),
  async send(s, m) {
    const people = (a: Parameters<typeof list>[0]) => list(a).map((x) => ({ email: emailOf(x), ...(nameOf(x) ? { name: nameOf(x) } : {}) }));
    const body = {
      sender: { email: s.fromAddress, ...(m.fromName || s.fromName ? { name: m.fromName || s.fromName } : {}) },
      to: people(m.to),
      ...(m.cc ? { cc: people(m.cc) } : {}),
      ...(m.bcc ? { bcc: people(m.bcc) } : {}),
      ...(m.replyTo ? { replyTo: people(m.replyTo)[0] } : {}),
      subject: m.subject,
      ...(m.html ? { htmlContent: m.html } : {}),
      ...(m.text ? { textContent: m.text } : {}),
      ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.filename, content: a.content })) } : {}),
    };
    let res: Response;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers: { 'api-key': s.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      throw new MailError('unreachable', "Couldn't talk to Brevo", (err as Error).message);
    }
    if (!res.ok) throw await httpFailure('Brevo', res, [401]);
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { id: data.messageId };
  },
};
