// Based on zou-yu/worker-mailer v1.1.3 (MIT) — see NOTICE.md for the
// original license and exactly what changed and why. Two real gaps found
// in the upstream version while evaluating it for use here, both fixed
// below:
//
// 1. No header-value sanitization at all — from/to/cc/bcc/reply names,
//    subject, and custom header keys/values were spliced directly into
//    raw header lines with no check for embedded CR/LF. Any caller
//    passing a value containing a newline could inject arbitrary extra
//    SMTP headers (classic header-injection — e.g. sneaking in a Bcc).
//    assertNoHeaderInjection() below closes this: any header-bound value
//    containing \r or \n is rejected outright, not silently stripped.
// 2. No RFC 2047 encoding for non-ASCII header values (subject, display
//    names) — this app is Dutch-language, so names/subjects routinely
//    contain characters like é/ë/ï. encodeHeaderText() below encodes any
//    non-ASCII value as a UTF-8 base64 encoded-word.
//
// Also: upstream used node:crypto (randomBytes/randomUUID) purely for
// MIME boundaries and Message-ID — replaced with the Web Crypto
// equivalents already global in Workers, so this file needs no
// nodejs_compat flag at all.

export type User = { name?: string; email: string }

export type EmailOptions = {
  from: string | User
  to: string | string[] | User | User[]
  reply?: string | User
  cc?: string | string[] | User | User[]
  bcc?: string | string[] | User | User[]
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
  attachments?: { filename: string; content: string; mimeType?: string }[]
  dsnOverride?: {
    envelopeId?: string
    RET?: {
      HEADERS?: boolean
      FULL?: boolean
    }
    NOTIFY?: {
      DELAY?: boolean
      FAILURE?: boolean
      SUCCESS?: boolean
    }
  }
}

function assertNoHeaderInjection(value: string, fieldName: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(
      `Invalid ${fieldName}: contains a line break, which could be used to inject extra email headers`,
    )
  }
  return value
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// RFC 2047 encoded-word for any header value containing non-ASCII
// characters; left as-is (after the injection check) if it's already
// plain ASCII. Doesn't attempt to split long values into multiple
// encoded-words (RFC 2047's 75-char-per-word limit) — fine for the short
// names/subjects this app actually sends, not fine for arbitrarily long
// ones.
function encodeHeaderText(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value
  return `=?UTF-8?B?${toBase64Utf8(value)}?=`
}

function formatAddress(user: User, fieldName: string): string {
  assertNoHeaderInjection(user.email, `${fieldName} email`)
  if (user.name) {
    assertNoHeaderInjection(user.name, `${fieldName} name`)
    return `${encodeHeaderText(user.name)} <${user.email}>`
  }
  return user.email
}

export class Email {
  public readonly from: User
  public readonly to: User[]
  public readonly reply?: User
  public readonly cc?: User[]
  public readonly bcc?: User[]

  public readonly subject: string
  public readonly text?: string
  public readonly html?: string
  public readonly dsnOverride?: {
    envelopeId?: string
    RET?: {
      HEADERS?: boolean
      FULL?: boolean
    }
    NOTIFY?: {
      DELAY?: boolean
      FAILURE?: boolean
      SUCCESS?: boolean
    }
  }

  public readonly attachments?: {
    filename: string
    content: string
    mimeType?: string
  }[]

  public readonly headers: Record<string, string>

  public setSent!: () => void
  public setSentError!: (e: unknown) => void
  public sent = new Promise<void>((resolve, reject) => {
    this.setSent = resolve
    this.setSentError = reject
  })

  constructor(options: EmailOptions) {
    if (!options.text && !options.html) {
      throw new Error('At least one of text or html must be provided')
    }

    if (typeof options.from === 'string') {
      this.from = { email: options.from }
    } else {
      this.from = options.from
    }
    if (typeof options.reply === 'string') {
      this.reply = { email: options.reply }
    } else {
      this.reply = options.reply
    }
    this.to = Email.toUsers(options.to)!
    this.cc = Email.toUsers(options.cc)
    this.bcc = Email.toUsers(options.bcc)

    this.subject = options.subject
    this.text = options.text
    this.html = options.html
    this.attachments = options.attachments
    this.dsnOverride = options.dsnOverride
    this.headers = options.headers || {}
  }

  private static toUsers(
    user: string | string[] | User | User[] | undefined,
  ): User[] | undefined {
    if (!user) {
      return
    }
    if (typeof user === 'string') {
      return [{ email: user }]
    } else if (Array.isArray(user)) {
      return user.map(user => {
        if (typeof user === 'string') {
          return { email: user }
        }
        return user
      })
    } else {
      return [user]
    }
  }

  // The full RFC 2822 message, with no SMTP-DATA framing — what the Gmail
  // API's `raw` field (and anything else that isn't talking raw SMTP)
  // wants. getEmailData() below is this plus the SMTP dot-terminator.
  public getRawMessage() {
    this.resolveHeader()

    const headersArray: string[] = ['MIME-Version: 1.0']
    for (const [key, value] of Object.entries(this.headers)) {
      headersArray.push(
        `${assertNoHeaderInjection(key, 'header name')}: ${value}`,
      )
    }
    const mixedBoundary = this.generateSafeBoundary('mixed_')
    const alternativeBoundary = this.generateSafeBoundary('alternative_')

    headersArray.push(
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    )
    const headers = headersArray.join('\r\n')

    let emailData = `${headers}\r\n\r\n`
    emailData += `--${mixedBoundary}\r\n`

    emailData += `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n`

    if (this.text) {
      emailData += `--${alternativeBoundary}\r\n`
      emailData += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`
      // maximum line length is 998 characters (see RFC 2046)
      const lines = this.wrapText(this.text, 998)
      emailData += `${lines.join('\r\n')}\r\n\r\n`
    }

    if (this.html) {
      emailData += `--${alternativeBoundary}\r\n`
      emailData += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`
      // maximum line length is 998 characters (see RFC 2046)
      const lines = this.wrapText(this.html, 998)
      emailData += `${lines.join('\r\n')}\r\n\r\n`
    }

    emailData += `--${alternativeBoundary}--\r\n`

    if (this.attachments) {
      for (const attachment of this.attachments) {
        const mimeType =
          attachment.mimeType || this.getMimeType(attachment.filename)
        const filename = assertNoHeaderInjection(
          attachment.filename,
          'attachment filename',
        )
        emailData += `--${mixedBoundary}\r\n`
        emailData += `Content-Type: ${mimeType}; name="${filename}"\r\n`
        emailData += `Content-Description: ${filename}\r\n`
        emailData += `Content-Disposition: attachment; filename="${filename}";\r\n`
        emailData += `    creation-date="${new Date().toUTCString()}";\r\n`
        emailData += `Content-Transfer-Encoding: base64\r\n\r\n`

        // split the content into multiple lines to avoid line length greater than 76 characters https://en.wikipedia.org/wiki/Base64#Variants_summary_table
        const lines = attachment.content.match(/.{1,72}/g)
        if (lines) {
          emailData += `${lines.join('\r\n')}`
        } else {
          emailData += `${attachment.content}`
        }
        emailData += '\r\n\r\n'
      }
    }
    emailData += `--${mixedBoundary}--\r\n`

    return emailData
  }

  // SMTP DATA framing needs a trailing lone "." line to signal end-of-message
  // — not part of the message itself, so getRawMessage() (used by anything
  // that isn't raw SMTP, e.g. the Gmail API) doesn't include it.
  public getEmailData() {
    return `${this.getRawMessage()}.\r\n`
  }

  private generateSafeBoundary(prefix: string): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return prefix + hex
  }

  private getMimeType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase()

    const mimeTypes: { [key: string]: string } = {
      txt: 'text/plain',
      html: 'text/html',
      csv: 'text/csv',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      zip: 'application/zip',
    }

    return mimeTypes[extension || 'txt'] || 'application/octet-stream' // Default to 'application/octet-stream'
  }

  private resolveHeader() {
    this.resolveFrom()
    this.resolveTo()
    this.resolveReply()
    this.resolveCC()
    this.resolveBCC()
    this.resolveSubject()
    this.headers['Date'] = new Date().toUTCString()
    this.headers['Message-ID'] =
      `<${crypto.randomUUID()}@${this.from.email.split('@').pop()}>`
  }

  private resolveFrom() {
    this.headers['From'] = formatAddress(this.from, 'from')
  }

  private resolveTo() {
    this.headers['To'] = this.to
      .map(user => formatAddress(user, 'to'))
      .join(', ')
  }

  private resolveSubject() {
    this.headers['Subject'] = encodeHeaderText(
      assertNoHeaderInjection(this.subject, 'subject'),
    )
  }

  private resolveReply() {
    if (this.reply) {
      this.headers['Reply-To'] = formatAddress(this.reply, 'reply-to')
    }
  }

  private resolveCC() {
    if (this.cc) {
      this.headers['CC'] = this.cc
        .map(user => formatAddress(user, 'cc'))
        .join(', ')
    }
  }

  private resolveBCC() {
    if (this.bcc) {
      this.headers['BCC'] = this.bcc
        .map(user => formatAddress(user, 'bcc'))
        .join(', ')
    }
  }

  private wrapText(text: string, maxLength = 998) {
    const lines = []
    let currentLine = ''

    const words = text.match(/\S+/g) || [] // Matches non-whitespace chunks

    for (const word of words) {
      // if the word is longer than the max length, it is forcefully split into chunks
      if (word.length > maxLength) {
        if (currentLine) {
          lines.push(currentLine)
          currentLine = ''
        }

        for (let i = 0; i < word.length; i += maxLength) {
          lines.push(word.slice(i, i + maxLength))
        }
      } else if (
        // current line + word + space + 1 (for the space) <= max length
        currentLine.length + word.length + (currentLine ? 1 : 0) <=
        maxLength
      ) {
        currentLine += (currentLine ? ' ' : '') + word
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }
}
