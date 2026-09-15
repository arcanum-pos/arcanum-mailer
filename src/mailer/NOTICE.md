# Provenance

The code in this directory is based on [zou-yu/worker-mailer](https://github.com/zou-yu/worker-mailer)
v1.1.3, MIT licensed:

```
MIT License

Copyright (c) zou-yu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Vendored (not depended on as an npm package) deliberately, so it can be
patched immediately rather than waiting on upstream — see the design
discussion in this project's history for the full reasoning. Vendored at
the pinned v1.1.3 tag.

## Why vendored instead of `npm install worker-mailer`

Two real issues found while evaluating the upstream package for this use
case, both fixed in this vendored copy:

1. **Header injection** (not filed upstream as of this writing, found
   during review): `email.ts` spliced `from`/`to`/`cc`/`bcc`/`reply` names,
   the subject, and custom header keys/values directly into raw SMTP
   header lines with no check for embedded `\r`/`\n`. A value containing a
   line break could inject arbitrary extra headers (e.g. a stray `Bcc:`).
   `email.ts` here rejects (throws on) any header-bound value containing a
   line break, rather than silently stripping it.
2. **Hardcoded EHLO/HELO hostname** — [upstream issue #55](https://github.com/zou-yu/worker-mailer/issues/55):
   the greeting was always `EHLO 127.0.0.1` / `HELO 127.0.0.1`. Some
   strict receiving mail servers silently drop mail whose HELO argument is
   a bare loopback IP — the SMTP session reports success, but the message
   never arrives (confirmed by the issue reporter; lenient providers like
   Gmail don't exhibit it, which is exactly what makes it easy to miss in
   testing). `mailer.ts` here takes a required `clientName` option
   instead — `send.ts` derives it from the configured From address's
   domain.

Also dropped CRAM-MD5 authentication (its only use upstream was
`node:crypto`'s HMAC, needing the `nodejs_compat` compatibility flag for
one legacy auth mechanism this app doesn't need — Gmail and other modern
providers support `AUTH LOGIN`/`PLAIN` over TLS, which an app password
already works with) and replaced `node:crypto`'s `randomBytes`/`randomUUID`
with the Web Crypto equivalents already global in Workers. Net effect:
this Worker needs no compatibility flags at all.

## Files

- `mailer.ts` — the SMTP client (connection, EHLO/STARTTLS/AUTH, the
  MAIL/RCPT/DATA sequence). Modified: EHLO/HELO hostname, CRAM-MD5 removed.
- `email.ts` — builds the MIME message from `EmailOptions`. Modified:
  header-value sanitization, RFC 2047 encoding for non-ASCII subjects/names,
  Web Crypto instead of `node:crypto`.
- `utils.ts`, `logger.ts` — unmodified from upstream.
