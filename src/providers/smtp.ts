import { sendEmail, type SmtpCredentials } from '../send';
import { MailError, required, type MailProvider } from './types';

// Raw SMTP over cloudflare:sockets: STARTTLS on 587, TLS from the first
// byte on 465 (send.ts). Works with e.g. iCloud+ (smtp.mail.me.com:587);
// Google refuses SMTP sign-ins from Workers' shared addresses — use the
// gmail_api provider there.
export const smtp: MailProvider<SmtpCredentials> = {
  type: 'smtp',
  validate(s) {
    const problems = required(s, ['host', 'username', 'password', 'fromAddress']);
    const port = Number(s.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) problems.push('port must be a port number');
    return problems;
  },
  async send(s, message) {
    try {
      await sendEmail({ ...message, credentials: { ...s, port: Number(s.port) } });
      return {};
    } catch (err) {
      throw classify(err as Error);
    }
  },
};

// SMTP's reply codes, as far as the error text carries them: 535/534 (and
// "auth…") = the sign-in; another 5xx = this message; anything else = the connection.
export function classify(err: Error): MailError {
  const text = err.message || String(err);
  if (/\b53[45]\b|authenticat|auth(entication)? failed/i.test(text)) return new MailError('auth_failed', 'The SMTP server refused the sign-in', text);
  if (/\b5\d\d\b/.test(text)) return new MailError('rejected', 'The SMTP server refused the message', text);
  return new MailError('unreachable', "Couldn't talk to the SMTP server", text);
}
