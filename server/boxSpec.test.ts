import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { readRequestApiKey } from './boxSpec'

function request(value?: string | string[]): Pick<IncomingMessage, 'headers'> {
  return { headers: value === undefined ? {} : { 'x-packit-anthropic-api-key': value } }
}

describe('readRequestApiKey', () => {
  it('accepts one bounded, whitespace-free key', () => {
    expect(readRequestApiKey(request('  sk-ant-test-only  '))).toBe('sk-ant-test-only')
  })

  it('distinguishes an absent key from malformed values', () => {
    expect(readRequestApiKey(request())).toBeUndefined()
    expect(readRequestApiKey(request('short'))).toBeNull()
    expect(readRequestApiKey(request('sk-ant-has whitespace'))).toBeNull()
    expect(readRequestApiKey(request(['sk-ant-one', 'sk-ant-two']))).toBeNull()
  })
})
