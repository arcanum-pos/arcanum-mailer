// The mailer's one contract, whatever service sends (MAIL.md, "The mailer
// contract"): a message, and a provider { type, …its settings }. Each
// service is a plug-in (src/providers/<type>.ts) in the registry
// (src/providers/index.ts).
import type { User } from '../mailer';

export type Address = string | User;
// As the SMTP and Gmail code take them: one, or a list of one kind.
export type Recipients = string | string[] | User | User[];

export interface OutgoingMessage {
  to: Recipients;
  cc?: Recipients;
  bcc?: Recipients;
  subject: string;
  text?: string;
  html?: string;
  // The sender's name for this message (e.g. the organisation's); the
  // address is always the provider's own fromAddress.
  fromName?: string;
  replyTo?: Address;
  attachments?: { filename: string; content: string; mimeType?: string }[];
}

// invalid_config: settings missing or malformed (caught before sending);
// auth_failed: the service refused the credentials; rejected: it refused
// this message (recipient, unverified sender…); unreachable: couldn't talk
// to it (network, timeout, 5xx, rate limit).
export type MailErrorCode = 'invalid_config' | 'auth_failed' | 'rejected' | 'unreachable';

export class MailError extends Error {
  constructor(
    readonly code: MailErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
  }
}

export interface SendResult {
  id?: string;
}

export interface MailProvider<Settings = Record<string, unknown>> {
  type: string;
  // What's missing or wrong in these settings; [] = fine.
  validate(settings: Record<string, unknown>): string[];
  send(settings: Settings, message: OutgoingMessage, env: unknown): Promise<SendResult>;
}

// Helpers shared by the HTTP-API providers.
export const emailOf = (a: Address) => (typeof a === 'string' ? a : a.email);
export const nameOf = (a: Address) => (typeof a === 'string' ? undefined : a.name || undefined);
export const list = (a: Recipients | Address | undefined): Address[] => (a === undefined ? [] : Array.isArray(a) ? a : [a]);

export function required(settings: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((f) => typeof settings[f] !== 'string' || !(settings[f] as string).trim()).map((f) => `${f} is required`);
}

// An HTTP API's answer to an error: 401/403 → the key, 4xx → this message, 5xx/429 → try again later.
export async function httpFailure(service: string, res: Response, authStatuses = [401, 403]): Promise<MailError> {
  const detail = (await res.text().catch(() => '')).slice(0, 500);
  if (authStatuses.includes(res.status)) return new MailError('auth_failed', `${service} refused the API key (${res.status})`, detail);
  if (res.status === 429 || res.status >= 500) return new MailError('unreachable', `${service} is unavailable (${res.status})`, detail);
  return new MailError('rejected', `${service} refused the message (${res.status})`, detail);
}
