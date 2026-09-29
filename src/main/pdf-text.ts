import { inflateSync } from 'zlib'

const PDF_TEXT_LIMIT = 200_000

type PdfStream = { dictionary: string; data: Buffer }

function decodeLiteralString(value: string): Buffer {
  const bytes: number[] = []
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index]
    if (char !== '\\') {
      bytes.push(value.charCodeAt(index) & 0xff)
      continue
    }
    const next = value[++index]
    if (next === undefined) break
    const escaped: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 }
    if (escaped[next] !== undefined) {
      bytes.push(escaped[next])
      continue
    }
    if (/[0-7]/.test(next)) {
      let octal = next
      while (octal.length < 3 && /[0-7]/.test(value[index + 1] ?? '')) octal += value[++index]
      bytes.push(parseInt(octal, 8) & 0xff)
      continue
    }
    if (next === '\r' && value[index + 1] === '\n') index += 1
    else if (next !== '\n') bytes.push(next.charCodeAt(0) & 0xff)
  }
  return Buffer.from(bytes)
}

function decodeHexString(value: string): Buffer {
  const hex = value.slice(1, -1).replace(/\s/g, '')
  return Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, 'hex')
}

function decodePdfString(value: string, cmap: Map<number, string>): string {
  const bytes = value.startsWith('(') ? decodeLiteralString(value) : decodeHexString(value)
  const looksLikeUtf16 = bytes.length >= 2 && bytes.length % 2 === 0 && bytes[0] === 0xfe && bytes[1] === 0xff
    || bytes.length >= 2 && bytes.length % 2 === 0 && bytes.every((byte, index) => index % 2 === 0 ? byte === 0 : byte >= 0x20)
  if (looksLikeUtf16) {
    const offset = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0
    const codeUnits: number[] = []
    for (let index = offset; index + 1 < bytes.length; index += 2) codeUnits.push(bytes.readUInt16BE(index))
    return String.fromCharCode(...codeUnits)
  }
  if (cmap.size > 0) return Array.from(bytes, (byte) => cmap.get(byte) ?? String.fromCharCode(byte)).join('')
  return bytes.toString('latin1')
}

function parseDestination(value: string): string {
  const match = value.match(/^<([\da-fA-F]+)>$/)
  if (!match) return value
  const hex = match[1].length % 2 === 0 ? match[1] : `${match[1]}0`
  const bytes = Buffer.from(hex, 'hex')
  if (bytes.length % 2 !== 0) return bytes.toString('latin1')
  const codeUnits: number[] = []
  for (let index = 0; index < bytes.length; index += 2) codeUnits.push(bytes.readUInt16BE(index))
  return String.fromCharCode(...codeUnits)
}

function parseToUnicodeCmap(stream: Buffer): Map<number, string> {
  const text = stream.toString('latin1')
  const cmap = new Map<number, string>()
  for (const section of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const match of section.matchAll(/<([\da-fA-F]+)>\s+(<[^>]+>)/g)) {
      cmap.set(parseInt(match[1], 16), parseDestination(match[2]))
    }
  }
  for (const section of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const match of section.matchAll(/<([\da-fA-F]+)>\s+<([\da-fA-F]+)>\s+(<[^>]+>|\[[^\]]+\])/g)) {
      const start = parseInt(match[1], 16)
      const end = parseInt(match[2], 16)
      const destination = match[3]
      const values = destination.startsWith('[') ? destination.match(/<[^>]+>/g) ?? [] : []
      for (let code = start; code <= end; code += 1) {
        if (values.length > 0) {
          const value = values[code - start]
          if (value) cmap.set(code, parseDestination(value))
        } else {
          const base = parseDestination(destination).codePointAt(0)
          if (base !== undefined) cmap.set(code, String.fromCodePoint(base + code - start))
        }
      }
    }
  }
  return cmap
}

function extractStreams(pdf: Buffer): PdfStream[] {
  const source = pdf.toString('latin1')
  const streams: PdfStream[] = []
  let cursor = 0
  while (cursor < source.length) {
    const marker = source.indexOf('stream', cursor)
    if (marker < 0) break
    const lineBreak = source[marker + 6] === '\r' && source[marker + 7] === '\n'
      ? 2
      : source[marker + 6] === '\r' || source[marker + 6] === '\n' ? 1 : 0
    if (lineBreak === 0) {
      cursor = marker + 6
      continue
    }
    const dictionaryStart = source.lastIndexOf('<<', marker)
    const dictionaryEnd = source.lastIndexOf('>>', marker)
    const endMarker = source.indexOf('endstream', marker + 6 + lineBreak)
    if (dictionaryStart < 0 || dictionaryEnd < dictionaryStart || endMarker < 0) break
    let data = pdf.subarray(marker + 6 + lineBreak, endMarker)
    if (data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 1)
    if (data[data.length - 1] === 0x0d) data = data.subarray(0, data.length - 1)
    const dictionary = source.slice(dictionaryStart, dictionaryEnd + 2)
    if (/\/FlateDecode\b/.test(dictionary)) {
      try { data = inflateSync(data) } catch { /* leave unsupported/malformed streams unreadable */ }
    }
    streams.push({ dictionary, data })
    cursor = endMarker + 9
  }
  return streams
}

function extractTextFromContent(content: Buffer, cmap: Map<number, string>): string {
  const source = content.toString('latin1')
  const textBlocks: string[] = []
  for (const block of source.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    const body = block[1]
    const events: Array<{ index: number; text: string }> = []
    for (const token of body.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const strings = token[1].match(/\([^)]*(?:\\.[^)]*)*\)|<[^>]*>/g) ?? []
      events.push({ index: token.index ?? 0, text: strings.map((item) => decodePdfString(item, cmap)).join('') })
    }
    for (const token of body.matchAll(/(\([^)]*(?:\\.[^)]*)*\)|<[^>]*>)\s*(Tj|'|")/g)) {
      events.push({ index: token.index ?? 0, text: decodePdfString(token[1], cmap) })
    }
    events.sort((left, right) => left.index - right.index)
    const parts = events.map((event) => event.text)
    const blockText = parts.join(' ').replace(/[ \t]+/g, ' ').trim()
    if (blockText) textBlocks.push(blockText)
  }
  return textBlocks.join('\n')
}

/** Extract selectable text from a PDF without requiring an OS-installed PDF utility. */
export function extractPdfText(pdf: Buffer): { text: string; truncated: boolean } {
  if (pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { text: '', truncated: false }
  const streams = extractStreams(pdf)
  const cmap = new Map<number, string>()
  for (const stream of streams) {
    if (/beginbfchar|beginbfrange/.test(stream.data.toString('latin1'))) {
      for (const [code, value] of parseToUnicodeCmap(stream.data)) cmap.set(code, value)
    }
  }
  const pages: string[] = []
  for (const stream of streams) {
    if (!/\bBT\b/.test(stream.data.toString('latin1'))) continue
    const pageText = extractTextFromContent(stream.data, cmap)
    if (pageText) pages.push(pageText)
  }
  const text = pages.join('\n\n--- PDF page/content boundary ---\n\n').trim()
  if (text.length <= PDF_TEXT_LIMIT) return { text, truncated: false }
  return { text: `${text.slice(0, PDF_TEXT_LIMIT)}\n\n...[PDF text truncated]`, truncated: true }
}
