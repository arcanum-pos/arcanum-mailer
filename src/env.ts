export interface Env {
  // Authorizes worker's calls to this Worker's /send route — a separate
  // secret from worker's own INTERNAL_API_KEY (devicehub) and
  // BFF_INTERNAL_KEY (bff→worker); same "one secret per pairwise
  // relationship" reasoning. This is the only secret this Worker holds —
  // it carries no SMTP credentials of its own. Every /send request carries
  // the full connection details for whichever org's SMTP config resolved
  // on the caller's side (see worker/src/organizations/smtp-credentials.ts),
  // so each org can genuinely bring its own SMTP account rather than
  // everything going out under one platform-wide identity baked into this
  // Worker's own deployment.
  MAILER_INTERNAL_KEY: string;
}
