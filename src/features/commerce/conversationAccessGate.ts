export type ConversationGateState = 'paused' | 'checking' | 'ready' | 'failed' | 'denied'
/** Only the newest foreground authorization check may reveal cached content. */
export function createConversationAccessGate<T>(options: {
  verify(signal: AbortSignal): Promise<T>
  isDenied(error: unknown): boolean
  onState(state: ConversationGateState): void
  onVerified(value: T): void
  onDenied(): void
}) {
  let generation = 0
  let disposed = false
  let controller: AbortController | null = null
  const pause = () => {
    generation += 1
    controller?.abort()
    controller = null
    if (!disposed) options.onState('paused')
  }
  const resume = async () => {
    if (disposed) return
    const current = ++generation
    controller?.abort()
    const check = new AbortController()
    controller = check
    options.onState('checking')
    try {
      const value = await options.verify(check.signal)
      if (disposed || check.signal.aborted || current !== generation) return
      options.onVerified(value)
      options.onState('ready')
    } catch (error) {
      if (disposed || check.signal.aborted || current !== generation) return
      if (options.isDenied(error)) { options.onState('denied'); options.onDenied() }
      else options.onState('failed')
    }
  }
  return { pause, resume, dispose() { disposed = true; generation += 1; controller?.abort() } }
}
