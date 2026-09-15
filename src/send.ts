import { WorkerMailer } from './mailer';
import type { EmailOptions, User } from './mailer';
import type { Env } from './env';

export interface SendEmailRequest {
  to: string | string[] | User | User[];
  cc?: string | string[] | User | User[];
  bcc?: string | string[] | User | User[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | User;
  // Overrides SMTP_FROM_NAME for this one send (e.g. "Questo — Elewijtse
  // Pijl" for one org's invites vs. a generic default) — the underlying
  // From address always stays SMTP_FROM_ADDRESS.
  fromName?: string;
  attachments?: { filename: string; content: string; mimeType?: string }[];
}

function domainOf(email: string): string {
  const domain = email.split('@')[1];
  if (!domain) throw new Error(`Invalid email address: ${email}`);
  return domain;
}

export async function sendEmail(env: Env, request: SendEmailRequest): Promise<void> {
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port)) throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);

  const email: EmailOptions = {
    from: { name: request.fromName ?? env.SMTP_FROM_NAME, email: env.SMTP_FROM_ADDRESS },
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
      host: env.SMTP_HOST,
      port,
      // 465 is always implicit TLS; everything else (587 typically) starts
      // plaintext and upgrades via STARTTLS, which is the mailer's default.
      secure: port === 465,
      credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
      authType: ['login', 'plain'],
      clientName: domainOf(env.SMTP_FROM_ADDRESS),
    },
    email
  );
}
