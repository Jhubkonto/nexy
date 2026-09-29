import { deflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { extractPdfText } from '../pdf-text'

function makePdf(stream: Buffer, compressed = false): Buffer {
  const body = compressed ? deflateSync(stream) : stream
  const filter = compressed ? ' /Filter /FlateDecode' : ''
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length}${filter} >>\nstream\n${body.toString('latin1')}\nendstream\nendobj\n%%EOF\n`, 'latin1')
}

describe('extractPdfText', () => {
  it('extracts text from literal strings and TJ arrays', () => {
    const result = extractPdfText(makePdf(Buffer.from('BT\n(Hello PDF) Tj\n[( world) 20 (text)] TJ\nET\n')))
    expect(result).toEqual({ text: 'Hello PDF worldtext', truncated: false })
  })

  it('inflates compressed content streams', () => {
    const result = extractPdfText(makePdf(Buffer.from('BT\n<00480069> Tj\nET\n'), true))
    expect(result.text).toBe('Hi')
  })

  it('does not treat an invalid or image-only PDF as readable text', () => {
    expect(extractPdfText(Buffer.from('not a pdf'))).toEqual({ text: '', truncated: false })
    expect(extractPdfText(makePdf(Buffer.from('q\n100 100 cm\n')))).toEqual({ text: '', truncated: false })
  })
})
