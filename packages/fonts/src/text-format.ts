// Reads protobuf's text format, as google/fonts writes each family's METADATA.pb: `field: value`
// pairs and `field { … }` messages, and the fields a message holds.

/** A value in protobuf's text format: a string, a number, or a message of fields. */
// eslint-disable-next-line @typescript-eslint/no-use-before-define -- the types refer to each other
export type TextValue = string | number | TextMessage
/** A message in protobuf's text format: each field's values, in the order they appear. */
export type TextMessage = Map<string, TextValue[]>
/** A piece of protobuf's text format. */
type Token = { kind: 'punctuation' | 'string' | 'word'; value: string } | { kind: 'number'; value: number }

/**
 * Reads protobuf's text format: `field: value` pairs and `field { … }` messages, `#` comments, and
 * quoted strings side by side read as one.
 */
export function parseTextFormat(text: string): TextMessage {
  const tokens = tokenize(text)
  let at = 0
  const message = (): TextMessage => {
    const fields: TextMessage = new Map()
    while (at < tokens.length && !punctuation(tokens[at], '}')) {
      const name = tokens[at++]
      if (name?.kind !== 'word') throw new Error(`a field name was expected at ${name?.value}`)
      if (punctuation(tokens[at], ':')) at++
      let value: TextValue
      const token = tokens[at++]
      if (punctuation(token, '{')) {
        value = message()
        if (!punctuation(tokens[at++], '}')) throw new Error(`${name.value} is not closed`)
      } else if (token?.kind === 'string') {
        value = token.value
        while (tokens[at]?.kind === 'string') value += tokens[at++]?.value
      } else if (token?.kind === 'number' || token?.kind === 'word') value = token.value
      else throw new Error(`${name.value} has no value`)
      fields.set(String(name.value), [...(fields.get(String(name.value)) ?? []), value])
    }
    return fields
  }
  const top = message()
  if (at !== tokens.length) throw new Error('a } closes nothing')
  return top
}

/** A field's first value when it is a string, or null. */
export function stringField(message: TextMessage, name: string): string | null {
  const value = message.get(name)?.[0]
  return typeof value === 'string' ? value : null
}

/** A field's first value when it is a number, or null. */
export function numberField(message: TextMessage, name: string): number | null {
  const value = message.get(name)?.[0]
  return typeof value === 'number' ? value : null
}

/** A field's values that are messages. */
export function messages(message: TextMessage, name: string): TextMessage[] {
  return (message.get(name) ?? []).filter((v): v is TextMessage => v instanceof Map)
}

/**
 * Splits text format into tokens: punctuation, quoted strings (their escapes read, an octal or hex
 * escape as a UTF-8 byte), numbers and bare words.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\s+|#[^\n]*|([{}:])|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([-+]?\d[\w.+-]*)|([A-Za-z_][\w.]*)/gy
  while (pattern.lastIndex < text.length) {
    const from = pattern.lastIndex
    const match = pattern.exec(text)
    if (!match) throw new Error(`METADATA.pb can't be read at ${text.slice(from, from + 20)}`)
    const [, mark, double, single, number, word] = match
    if (mark) tokens.push({ kind: 'punctuation', value: mark })
    else if (double !== undefined || single !== undefined)
      tokens.push({ kind: 'string', value: unescape(double ?? single ?? '') })
    else if (number) tokens.push({ kind: 'number', value: Number(number) })
    else if (word) tokens.push({ kind: 'word', value: word })
  }
  return tokens
}

/** Whether the token is the punctuation mark given. */
function punctuation(token: Token | undefined, mark: string): boolean {
  return token?.kind === 'punctuation' && token.value === mark
}

/** A quoted string's text, its escapes read: an octal or hex escape is one byte of UTF-8. */
function unescape(quoted: string): string {
  const bytes: number[] = []
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "'": 39, '\\': 92 }
  const encoder = new TextEncoder()
  for (let i = 0; i < quoted.length; i++) {
    const char = quoted[i] as string
    if (char !== '\\') {
      const code = quoted.codePointAt(i) as number
      bytes.push(...encoder.encode(String.fromCodePoint(code)))
      if (code > 0xffff) i++
      continue
    }
    const next = quoted[++i] ?? ''
    const octal = /^[0-7]{1,3}/.exec(quoted.slice(i))?.[0]
    const hex = next === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(quoted.slice(i + 1))?.[0] : undefined
    if (octal) {
      bytes.push(parseInt(octal, 8))
      i += octal.length - 1
    } else if (hex) {
      bytes.push(parseInt(hex, 16))
      i += hex.length
    } else bytes.push(simple[next] ?? next.charCodeAt(0))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}
