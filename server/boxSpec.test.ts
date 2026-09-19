import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { readRequestApiKey } from './modules/ai/requestApiKey'

function request(value?: string | string[]): Pick<IncomingMessage, 'headers'> {
  return { headers: value === undefined ? {} : { 'x-packit-anthropic-api-key': value } }
}

describe('readRequestApiKey', () => {
  it('accepts one bounded, whitespace-free key', () => {
    expect(readRequestApiKey(request('  sk-ant-test-only  ').headers)).toBe('sk-ant-test-only')
  })

  it('distinguishes an absent key from malformed values', () => {
    expect(readRequestApiKey(request().headers)).toBeUndefined()
    expect(readRequestApiKey(request('short').headers)).toBeNull()
    expect(readRequestApiKey(request('sk-ant-has whitespace').headers)).toBeNull()
    expect(readRequestApiKey(request(['sk-ant-one', 'sk-ant-two']).headers)).toBeNull()
  })
})
