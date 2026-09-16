// Sends via the Gmail API using a domain-wide-delegated service account,
// instead of opening a raw SMTP connection. Exists because Google's abuse
// detection rejects SMTP AUTH logins that originate from Cloudflare
// Workers' shared egress IPs (535-5.7.8, confirmed against both
// smtp.gmail.com and the Workspace SMTP relay, with an otherwise-valid app
// password) — this path never opens a socket at all, so that check never
// applies. It also needs no SPF/DKIM/DMARC DNS changes: Google already
// authorizes its own first-party sending path for the domain (the existing
// `google._domainkey` record covers it).
import { Email, type EmailOptions } from './mailer/email';

export interface GmailApiCredentials {
  clientEmail: string;
  privateKey: string;
  // The Workspace user being sent "as" — domain-wide delegation lets the
  // service account impersonate this one address. Not part of the
  // service-account JSON itself; configured separately per org.
  impersonatedUser: string;
  fromName?: string | null;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

// The service-account JSON's private_key is PEM (PKCS#8): a base64 DER blob
// between "-----BEGIN/END PRIVATE KEY-----" markers. Web Crypto's `importKey`
// wants the raw DER bytes, not the PEM text.
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(der), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// A short-lived (10 min) JWT-bearer assertion, per Google's service-account
// OAuth2 flow — signed proof of "this service account, impersonating this
// user, wants this scope," exchanged for a real access token below.
async function buildSignedJwt(credentials: GmailApiCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: credentials.clientEmail,
    sub: credentials.impersonatedUser,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 600,
  };

  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;
  const key = await importPrivateKey(credentials.privateKey);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

async function fetchAccessToken(credentials: GmailApiCredentials): Promise<string> {
  const assertion = await buildSignedJwt(credentials);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to obtain Gmail API access token: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Gmail API token response had no access_token');
  return data.access_token;
}

export async function sendViaGmailApi(credentials: GmailApiCredentials, options: Omit<EmailOptions, 'from'>): Promise<void> {
  const accessToken = await fetchAccessToken(credentials);

  // The Gmail API sends as whichever mailbox the access token impersonates
  // — the From address is always that account, never caller-supplied.
  const email = new Email({
    ...options,
    from: { name: credentials.fromName ?? undefined, email: credentials.impersonatedUser },
  });
  const raw = base64UrlFromString(email.getRawMessage());

  const res = await fetch(SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail API send failed: ${res.status} ${body}`);
  }
}
