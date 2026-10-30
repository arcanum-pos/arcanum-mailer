// Property-based tests (fast-check): whatever names, subjects and bodies a
// caller hands the mailer, the message it builds keeps its headers its own
// and its body intact, and a malformed request is refused, never a crash.
import { env } from 'cloudflare:test';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handleSend } from '../src/app';
import { Email } from '../src/mailer/email';
import { cloudflareRuntime } from '../src/platform/cloudflare';

const HEADERS = ['MIME-Version', 'Date', 'Message-ID', 'From', 'To', 'Subject', 'Content-Type'];
const oneLine = fc.string({ unit: 'grapheme' }).filter((s) => !/[\r\n]/.test(s));
const address = fc.emailAddress();

const headersOf = (raw: string) => raw.slice(0, raw.indexOf('\r\n\r\n')).split('\r\n');

// An RFC 2047 encoded-word (or plain ASCII) back to its text.
function decodeHeader(value: string): string {
  const word = value.match(/^=\?UTF-8\?B\?(.*)\?=$/);
  return word ? new TextDecoder().decode(Uint8Array.from(atob(word[1]), (c) => c.charCodeAt(0))) : value;
}

// A display name: also a quoted string.
const decodeName = (value: string) => (/^".*"$/.test(value) ? value.slice(1, -1).replace(/\\(.)/g, '$1') : decodeHeader(value));

describe('headers', () => {
  it('no name or subject adds a header line; non-ASCII ones read back as given', () => {
    fc.assert(
      fc.property(oneLine, oneLine, address, address, (name, subject, from, to) => {
        const email = new Email({ from: { name, email: from }, to, subject, text: 'x' });
        const lines = headersOf(email.getRawMessage());
        expect(lines.map((l) => l.slice(0, l.indexOf(':'))).sort()).toEqual([...HEADERS].sort());
        expect(decodeHeader(lines.find((l) => l.startsWith('Subject: '))!.slice('Subject: '.length))).toBe(subject);
        const fromLine = lines.find((l) => l.startsWith('From: '))!.slice('From: '.length);
        if (name) {
          const display = fromLine.slice(0, fromLine.lastIndexOf(' <'));
          expect(decodeName(display)).toBe(name);
          // One mailbox: no comma, < or other special outside a quoted string (RFC 5322 3.2.3).
          expect(display.replace(/"(?:[^"\\]|\\.)*"/g, '')).not.toMatch(/[()<>[\]:;@\\,"]/);
        }
      }),
    );
  });

  it('a line break anywhere in a header value is refused', () => {
    const broken = fc.tuple(fc.string(), fc.constantFrom('\r', '\n', '\r\n'), fc.string()).map(([a, br, b]) => a + br + b);
    fc.assert(
      fc.property(broken, fc.constantFrom('subject', 'name', 'to', 'reply', 'header'), (value, field) => {
        const email = new Email({
          from: { name: field === 'name' ? value : 'Org', email: 'noreply@test' },
          to: field === 'to' ? value : 'a@b.test',
          reply: field === 'reply' ? value : undefined,
          headers: field === 'header' ? { [value]: 'x' } : {},
          subject: field === 'subject' ? value : 's',
          text: 'x',
        });
        expect(() => email.getRawMessage()).toThrow(/line break/);
      }),
    );
  });
});

describe('body', () => {
  // Text with words of any length, dots at line starts included.
  const text = fc.array(fc.oneof(fc.string({ minLength: 1 }), fc.constantFrom('.', '..', '.NET', ' ', '\n', '\r\n'), fc.string({ minLength: 990, maxLength: 1100 })), { minLength: 1, maxLength: 12 }).map((p) => p.join(' '));

  it('SMTP DATA: lines of at most 998, ends only at its own final ".", and every word of the text arrives', () => {
    fc.assert(
      fc.property(text, (body) => {
        fc.pre(/\S/.test(body));
        const data = new Email({ from: 'noreply@test', to: 'a@b.test', subject: 's', text: body }).getEmailData();
        const lines = data.split('\r\n');
        expect(lines.at(-1)).toBe('');
        expect(lines.at(-2)).toBe('.');
        // What a server reads: up to the first lone ".", leading dots unstuffed (RFC 5321 4.5.2).
        const received = lines.slice(0, lines.indexOf('.'));
        expect(received.length).toBe(lines.length - 2);
        const plain = received.map((l) => (l.startsWith('.') ? l.slice(1) : l));
        for (const line of plain) expect(line.length).toBeLessThanOrEqual(998);
        const start = plain.indexOf('Content-Type: text/plain; charset="UTF-8"') + 2;
        const end = plain.findIndex((l, i) => i >= start && l.startsWith('--alternative_'));
        expect(plain.slice(start, end).join(' ').split(/\s+/).filter(Boolean).join('')).toBe(body.split(/\s+/).join(''));
      }),
    );
  });
});

describe('POST /send', () => {
  const KEY = { Authorization: 'Bearer test-mailer-key', 'Content-Type': 'application/json' };
  const send = (body: string) => handleSend(new Request('https://mailer/send', { method: 'POST', headers: KEY, body }), cloudflareRuntime(env));
  // Any service name but the real ones (those would try to send).
  const type = fc.oneof(fc.string(), fc.constantFrom('constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf')).filter((t) => !['smtp', 'gmail_api', 'brevo', 'resend', 'cloudflare'].includes(t));

  it('an unknown service, or a malformed body: 400 invalid_config, never a crash', async () => {
    const message = fc.record({ to: fc.oneof(address, fc.anything()), subject: fc.anything(), text: fc.anything() }, { requiredKeys: [] });
    const body = fc.oneof(
      fc.record({ message, provider: fc.record({ type }) }).map((b) => JSON.stringify(b)),
      fc.record({ to: address, subject: fc.string({ minLength: 1 }), text: fc.string({ minLength: 1 }), provider: type }).map((b) => JSON.stringify(b)),
      fc.json(),
      fc.string(),
    );
    await fc.assert(
      fc.asyncProperty(body, async (text) => {
        const res = await send(text);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ ok: false, code: 'invalid_config' });
      }),
    );
  });
});
