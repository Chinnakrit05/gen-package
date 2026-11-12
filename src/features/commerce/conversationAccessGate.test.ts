import { describe, expect, it, vi } from 'vitest'
import { createConversationAccessGate } from './conversationAccessGate'
function setup() {
  const pending: { resolve(value: string): void; reject(error: unknown): void; signal: AbortSignal }[] = []
  const onState = vi.fn(), onVerified = vi.fn(), onDenied = vi.fn()
  const gate = createConversationAccessGate({ verify: (signal) => new Promise<string>((resolve,reject) => pending.push({resolve,reject,signal})), isDenied: e => e === 'denied', onState, onVerified, onDenied })
  return { gate, pending, onState, onVerified, onDenied }
}
describe('conversation foreground privacy gate', () => {
  it('hides before checking and reveals only after successful current authorization', async () => { const t=setup(); const check=t.gate.resume(); expect(t.onState).toHaveBeenLastCalledWith('checking'); expect(t.onVerified).not.toHaveBeenCalled(); t.pending[0].resolve('room'); await check; expect(t.onVerified).toHaveBeenCalledWith('room'); expect(t.onState).toHaveBeenLastCalledWith('ready') })
  it('hidden/offline pause aborts pending authorization and rejects its late success', async () => { const t=setup(); const check=t.gate.resume(); t.gate.pause(); expect(t.pending[0].signal.aborted).toBe(true); t.pending[0].resolve('stale'); await check; expect(t.onVerified).not.toHaveBeenCalled(); expect(t.onState).toHaveBeenLastCalledWith('paused') })
  it('focus/reconnect checks supersede older checks and denied access never reveals cached data', async () => { const t=setup(); const old=t.gate.resume(); const current=t.gate.resume(); t.pending[0].resolve('stale'); await old; t.pending[1].reject('denied'); await current; expect(t.onVerified).not.toHaveBeenCalled(); expect(t.onDenied).toHaveBeenCalledOnce(); expect(t.onState).toHaveBeenLastCalledWith('denied') })
  it('network failure stays hidden and can retry', async () => { const t=setup(); const first=t.gate.resume(); t.pending[0].reject(new Error('offline')); await first; expect(t.onState).toHaveBeenLastCalledWith('failed'); expect(t.onDenied).not.toHaveBeenCalled(); const retry=t.gate.resume(); t.pending[1].resolve('fresh'); await retry; expect(t.onState).toHaveBeenLastCalledWith('ready') })
  it('unmount or session change prevents a late response from revealing content', async () => { const t=setup(); const check=t.gate.resume(); t.gate.dispose(); t.pending[0].resolve('old-account'); await check; expect(t.onVerified).not.toHaveBeenCalled() })
})
