// Every service the mailer can send with. A new one: its file in this
// folder (a MailProvider: validate + send), one line here, and its fields
// in arcanum-installer (Geavanceerd → E-mail). MAIL.md.
import { brevo } from './brevo';
import { cloudflare } from './cloudflare';
import { gmailApi } from './gmail-api';
import { resend } from './resend';
import { smtp } from './smtp';
import type { MailProvider } from './types';

export const PROVIDERS: Record<string, MailProvider<any>> = Object.fromEntries([smtp, gmailApi, brevo, resend, cloudflare].map((p) => [p.type, p]));

export { MailError, type MailErrorCode, type MailProvider, type OutgoingMessage, type SendResult } from './types';
