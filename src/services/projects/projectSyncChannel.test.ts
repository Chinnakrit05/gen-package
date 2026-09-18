import { describe, expect, it, vi } from 'vitest'
import type { AssetSidecarScope } from './cloudProjectCodec'
import { ProjectSyncChannel, type ProjectSyncChannelFactory } from './projectSyncChannel'

const scope: AssetSidecarScope = {
  appUserId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
}

class FakeChannel {
  listeners = new Set<(event: MessageEvent<unknown>) => void>()
  posted: unknown[] = []
  postMessage(message: unknown) { this.posted.push(structuredClone(message)) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) { this.listeners.add(listener) }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) { this.listeners.delete(listener) }
  close = vi.fn()
  deliver(data: unknown) { for (const listener of this.listeners) listener({ data } as MessageEvent<unknown>) }
}

describe('project sync channel', () => {
  it('publishes scoped versioned events without project content', () => {
    const fake = new FakeChannel()
    const channel = new ProjectSyncChannel(scope, 'tab-a', (() => fake) as ProjectSyncChannelFactory)

    channel.publish({ kind: 'saved', projectId: 'project-1', revision: 2 })

    expect(fake.posted).toEqual([expect.objectContaining({
      version: 1,
      kind: 'saved',
      workspaceId: scope.workspaceId,
      senderId: 'tab-a',
      projectId: 'project-1',
      revision: 2,
      emittedAt: expect.any(Number),
    })])
    expect(JSON.stringify(fake.posted)).not.toContain('document')
  })

  it('accepts only valid events from another tab in the same workspace', () => {
    const fake = new FakeChannel()
    const channel = new ProjectSyncChannel(scope, 'tab-a', (() => fake) as ProjectSyncChannelFactory)
    const received = vi.fn()
    channel.subscribe(received)
    const valid = {
      version: 1, kind: 'saved', workspaceId: scope.workspaceId, senderId: 'tab-b',
      projectId: 'project-1', revision: 2, emittedAt: Date.now(),
    }

    fake.deliver(valid)
    fake.deliver({ ...valid, senderId: 'tab-a' })
    fake.deliver({ ...valid, workspaceId: 'other' })
    fake.deliver({ ...valid, revision: '2' })

    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(valid)
    channel.close()
    expect(fake.close).toHaveBeenCalledTimes(1)
  })
})
