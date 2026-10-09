import { emailOf, list, MailError, nameOf, required, type Address, type MailProvider } from './types';

// Cloudflare Email Service (https://developers.cloudflare.com/email-service/):
// this Worker's own `send_email` binding (EMAIL, wrangler.jsonc) — no key.
// The sender's domain must be onboarded in the same Cloudflare account
// (Compute → Email Service → Email Sending), and sending to anyone but the
// account's verified addresses needs Workers Paid. MAIL.md, phase 5.
interface Settings {
  fromAddress: string;
  fromName?: string;
}

interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailBinding {
  send(message: {
    to: EmailAddress[];
    from: EmailAddress;
    subject: string;
    html?: string;
    text?: string;
    cc?: EmailAddress[];
    bcc?: EmailAddress[];
    replyTo?: EmailAddress;
    attachments?: { content: Uint8Array; filename: string; type: string; disposition: 'attachment' }[];
  }): Promise<{ messageId: string }>;
}

const address = (a: Address): EmailAddress => ({ email: emailOf(a), ...(nameOf(a) ? { name: nameOf(a) } : {}) });

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// The binding's error codes (Workers API reference) → the contract's.
const CONFIG_ERRORS = ['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE'];
const UNAVAILABLE = ['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_INTERNAL_SERVER_ERROR', 'E_DELIVERY_FAILED'];

export function classify(err: unknown): MailError {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? ((err as { code: string }).code) : '';
  const detail = [code, (err as Error)?.message].filter(Boolean).join(': ');
  if (CONFIG_ERRORS.includes(code)) return new MailError('invalid_config', 'Cloudflare Email Service: the sender’s domain isn’t onboarded for sending in this account', detail);
  if (code === 'E_RECIPIENT_NOT_ALLOWED')
    return new MailError('rejected', 'Cloudflare Email Service refused the recipient (sending to any address needs Workers Paid)', detail);
  if (UNAVAILABLE.includes(code)) return new MailError('unreachable', 'Cloudflare Email Service is unavailable or over its limit', detail);
  if (code) return new MailError('rejected', 'Cloudflare Email Service refused the message', detail);
  return new MailError('unreachable', 'Couldn’t send through Cloudflare Email Service', detail);
}

export const cloudflare: MailProvider<Settings> = {
  type: 'cloudflare',
  validate: (s) => required(s, ['fromAddress']),
  async send(s, m, env) {
    const binding = (env as { EMAIL?: SendEmailBinding } | undefined)?.EMAIL;
    if (!binding) throw new MailError('invalid_config', 'This mailer has no Cloudflare Email Service binding (EMAIL)');
    const name = m.fromName || s.fromName;
    try {
      const result = await binding.send({
        from: { email: s.fromAddress, ...(name ? { name } : {}) },
        to: list(m.to).map(address),
        ...(m.cc ? { cc: list(m.cc).map(address) } : {}),
        ...(m.bcc ? { bcc: list(m.bcc).map(address) } : {}),
        ...(m.replyTo ? { replyTo: address(m.replyTo) } : {}),
        subject: m.subject,
        ...(m.html ? { html: m.html } : {}),
        ...(m.text ? { text: m.text } : {}),
        ...(m.attachments?.length
          ? { attachments: m.attachments.map((a) => ({ content: fromBase64(a.content), filename: a.filename, type: a.mimeType || 'application/octet-stream', disposition: 'attachment' as const })) }
          : {}),
      });
      return { id: result?.messageId };
    } catch (err) {
      throw classify(err);
    }
  },
};
