import { TextEncoder } from 'util'
import { contentHash, contentHashHex } from '../src/hash'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('contentHash', () => {
  it('is stable for the same raw bytes', () => {
    const bytes = utf8('{"a":1,"b":2}')
    expect(contentHashHex(bytes)).toBe(contentHashHex(bytes))
    expect(contentHash(bytes)).toHaveLength(32)
  })

  it('does not canonicalize JSON: key order and whitespace change the digest', () => {
    const a = utf8('{"a":1,"b":2}')
    const b = utf8('{"b":2,"a":1}')
    const c = utf8('{ "a": 1, "b": 2 }')
    expect(contentHashHex(a)).not.toBe(contentHashHex(b))
    expect(contentHashHex(a)).not.toBe(contentHashHex(c))
  })
})
