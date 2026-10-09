import { sendViaGmailApi, type GmailApiCredentials } from '../gmail-api';
import { MailError, required, type MailProvider } from './types';

// A Google Workspace service account with domain-wide delegation, sending
// as `impersonatedUser` (gmail-api.ts) — no SMTP, so Google's refusal of
// SMTP sign-ins from Workers doesn't apply.
export const gmailApi: MailProvider<GmailApiCredentials> = {
  type: 'gmail_api',
  validate: (s) => required(s, ['clientEmail', 'privateKey', 'impersonatedUser']),
  async send(s, message) {
    try {
      await sendViaGmailApi(
        { ...s, fromName: message.fromName ?? s.fromName },
        { to: message.to, cc: message.cc, bcc: message.bcc, subject: message.subject, text: message.text, html: message.html, reply: message.replyTo, attachments: message.attachments }
      );
      return {};
    } catch (err) {
      const text = (err as Error).message;
      const status = Number(/: (\d{3})\b/.exec(text)?.[1] ?? 0);
      if (/access token/i.test(text) || status === 401 || status === 403) throw new MailError('auth_failed', 'Google refused the service account', text);
      if (status >= 400 && status < 500 && status !== 429) throw new MailError('rejected', 'Google refused the message', text);
      throw new MailError('unreachable', "Couldn't talk to the Gmail API", text);
    }
  },
};
