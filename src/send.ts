import { WorkerMailer } from './mailer';
import type { EmailOptions, User } from './mailer';

// No SMTP secrets on this Worker's own env — every send carries the full
// connection details for whichever org's config resolved on the caller's
// side. Keeps this Worker a genuinely generic transport rather than tied
// to one platform-wide SMTP identity.
export interface SmtpCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  fromName?: string | null;
}

// Shared by both transports (see gmail-api.ts) — everything about the
// message itself, independent of how it actually gets sent.
export interface MailMessage {
  to: string | string[] | User | User[];
  cc?: string | string[] | User | User[];
  bcc?: string | string[] | User | User[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | User;
  // Overrides credentials.fromName for this one send (e.g. "Questo —
  // Elewijtse Pijl" for one org's invites vs. its own configured default)
  // — the underlying From address always stays credentials.fromAddress.
  fromName?: string;
  attachments?: { filename: string; content: string; mimeType?: string }[];
}

export interface SendEmailRequest extends MailMessage {
  credentials: SmtpCredentials;
}

function domainOf(email: string): string {
  const domain = email.split('@')[1];
  if (!domain) throw new Error(`Invalid email address: ${email}`);
  return domain;
}

export async function sendEmail(request: SendEmailRequest): Promise<void> {
  const { credentials } = request;

  const email: EmailOptions = {
    from: { name: request.fromName ?? credentials.fromName ?? undefined, email: credentials.fromAddress },
    to: request.to,
    cc: request.cc,
    bcc: request.bcc,
    reply: request.replyTo,
    subject: request.subject,
    text: request.text,
    html: request.html,
    attachments: request.attachments,
  };

  await WorkerMailer.send(
    {
      host: credentials.host,
      port: credentials.port,
      // 465 is always implicit TLS; everything else (587 typically) starts
      // plaintext and upgrades via STARTTLS, which is the mailer's default.
      secure: credentials.port === 465,
      credentials: { username: credentials.username, password: credentials.password },
      authType: ['login', 'plain'],
      clientName: domainOf(credentials.fromAddress),
    },
    email
  );
}
