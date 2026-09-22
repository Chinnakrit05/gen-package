import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestBoxSpec } from './ai'

const response = {
  template: 'rsc',
  materialId: 'kraft-350',
  W: 120,
  D: 80,
  H: 60,
  handle: false,
  assumptions: [],
  layoutNote: '-',
  reasoning: 'test',
  mock: false,
}

afterEach(() => vi.unstubAllGlobals())

describe('requestBoxSpec', () => {
  it('sends a user API key only when explicitly provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await requestBoxSpec('กล่องของขวัญ', undefined, undefined, 'sk-ant-test-only')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-packit-anthropic-api-key': 'sk-ant-test-only',
    })
    expect(JSON.stringify(init.body)).not.toContain('sk-ant-test-only')
  })

  it('does not add the secret header when the field is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await requestBoxSpec('กล่องของขวัญ')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
  })
})
