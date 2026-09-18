import type { AssetSidecarScope } from './cloudProjectCodec'

export type ProjectSyncEvent =
  | ProjectSavedEvent
  | ProjectCreatedEvent
  | ProjectDeletedEvent

interface ProjectEventBase {
  version: 1
  workspaceId: string
  projectId: string
  senderId: string
  emittedAt: number
}

export interface ProjectSavedEvent extends ProjectEventBase {
  kind: 'saved'
  revision: number
}

export interface ProjectCreatedEvent extends ProjectEventBase {
  kind: 'created'
  revision: number
}

export interface ProjectDeletedEvent extends ProjectEventBase {
  kind: 'deleted'
  revision: number
}

interface ChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  close(): void
}

export type ProjectSyncChannelFactory = (name: string) => ChannelLike

export class ProjectSyncChannel {
  private readonly listeners = new Set<(event: ProjectSyncEvent) => void>()
  private readonly channel: ChannelLike | null
  private readonly receive = (message: MessageEvent<unknown>) => {
    const event = parseEvent(message.data)
    if (!event || event.workspaceId !== this.scope.workspaceId || event.senderId === this.senderId) return
    for (const listener of this.listeners) listener(structuredClone(event))
  }

  constructor(
    private readonly scope: AssetSidecarScope,
    private readonly senderId: string,
    factory: ProjectSyncChannelFactory = defaultFactory,
  ) {
    try {
      this.channel = factory(`gen-package-projects:${scope.appUserId}:${scope.workspaceId}`)
      this.channel.addEventListener('message', this.receive)
    } catch {
      this.channel = null
    }
  }

  publish(event: Omit<ProjectSyncEvent, 'version' | 'workspaceId' | 'senderId' | 'emittedAt'>): void {
    this.channel?.postMessage({
      ...event,
      version: 1,
      workspaceId: this.scope.workspaceId,
      senderId: this.senderId,
      emittedAt: Date.now(),
    })
  }

  subscribe(listener: (event: ProjectSyncEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.channel?.removeEventListener('message', this.receive)
    this.channel?.close()
    this.listeners.clear()
  }
}

function defaultFactory(name: string): ChannelLike {
  if (typeof BroadcastChannel === 'undefined') throw new Error('BroadcastChannel unavailable')
  return new BroadcastChannel(name)
}

function parseEvent(value: unknown): ProjectSyncEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Record<string, unknown>
  if (
    event.version !== 1
    || !['saved', 'created', 'deleted'].includes(String(event.kind))
    || typeof event.workspaceId !== 'string'
    || typeof event.projectId !== 'string'
    || typeof event.senderId !== 'string'
    || !Number.isSafeInteger(event.revision)
    || Number(event.revision) < 1
    || !Number.isFinite(event.emittedAt)
  ) return null
  return event as unknown as ProjectSyncEvent
}
