export interface Env {
  // Outbound SMTP account this whole deployment sends from — a deployment-
  // level resource (one email account for the instance), not per-org, same
  // reasoning as the identity-provider work's DEFAULT_IDP_* secrets. A
  // personal Gmail account + app password works fine (smtp.gmail.com:587).
  SMTP_HOST: string;
  // Kept as a string (wrangler vars/secrets are always strings) and parsed
  // where used — 465 means implicit TLS, anything else (587 typically)
  // means STARTTLS.
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  // The technical From address — generally must match (or be a verified
  // send-as alias of) SMTP_USER, or receiving servers may flag it as
  // spoofing. The display name is freely overridable per send.
  SMTP_FROM_ADDRESS: string;
  SMTP_FROM_NAME?: string;
  // Authorizes worker's calls to this Worker's /send route — a separate
  // secret from worker's own INTERNAL_API_KEY (devicehub) and
  // BFF_INTERNAL_KEY (bff→worker); same "one secret per pairwise
  // relationship" reasoning as those.
  MAILER_INTERNAL_KEY: string;
}
