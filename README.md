# arcanum-mailer

Outbound e-mail for an Arcanum installation (and, as a copy,
arcanum-platform-mailer for login.kaboutersoft.be). Not publicly reachable:
only a service binding, with `MAILER_INTERNAL_KEY`. It holds no mail
account of its own — every request names the service and carries its
settings. Design: `MAIL.md` in the arcanum folder.

## The contract

```
POST /send   Authorization: Bearer MAILER_INTERNAL_KEY
{ "message":  { "to", "subject", "text"?, "html"?, "fromName"?, "replyTo"?, "cc"?, "bcc"?, "attachments"? },
  "provider": { "type": "smtp" | "gmail_api" | "brevo" | "resend", …its settings } }
→ 200 { ok: true, id? }
→ 400 { ok: false, code: "invalid_config", error, detail? }
→ 502 { ok: false, code: "auth_failed" | "rejected" | "unreachable", error, detail? }
```

| type | settings |
|---|---|
| `smtp` | host, port, username, password, fromAddress, fromName? |
| `gmail_api` | clientEmail, privateKey, impersonatedUser, fromName? |
| `brevo` | apiKey, fromAddress, fromName? |
| `resend` | apiKey, fromAddress, fromName? |

The request shape from before (`{ provider?: "smtp" | "gmail_api",
credentials, to, subject, … }`) is still accepted.

## Adding a service

1. `src/providers/<type>.ts`: a `MailProvider` — `validate(settings)`
   (what's missing, `[]` = fine) and `send(settings, message, env)`, throwing
   a `MailError` with one of the four codes.
2. Its line in `src/providers/index.ts`.
3. Its fields in arcanum-installer (Geavanceerd → E-mail).
4. Tests in `test/mailer.test.ts`; copy `src/` to arcanum-platform-mailer.

## License

Copyright (C) 2026 kaboutersoft.be

Arcanum is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. It is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

In short: free to use, self-host, modify, host for others and charge for
hosting or support — but if you run a modified version for users over a
network, you must offer those users its source code (AGPL §13). The app's
"Broncode" link (the `SOURCE_URL` setting of arcanum-bff) is how an
installation points its users to that source.
