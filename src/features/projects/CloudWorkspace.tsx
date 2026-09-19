import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CloudProject, ProjectSummary } from '../../../shared/contracts/projects'
import App, { type CloudProjectBridge, type ProjectStoreSnapshot } from '../../App'
import { freshProject, type Project } from '../../core/project'
import { requestCloudBoxSpec } from '../../services/api/ai'
import {
  createProject as createRemoteProject,
  deleteProject as deleteRemoteProject,
  getProject,
  importLegacyProject,
  listProjects,
  saveProject,
} from '../../services/api/projects'
import {
  IndexedDbLegacyMigrationStore,
  type LegacyMigrationJournal,
} from '../../services/drafts/legacyMigrationStore'
import { IndexedDbProjectMutationStore } from '../../services/drafts/projectMutationStore'
import {
  getCloudDraftClientId,
  IndexedDbProjectDraftStore,
  projectDraftKey,
  type PersistedProjectDraft,
} from '../../services/drafts/projectDraftStore'
import { ProjectAssetSidecar, dehydrateProject, type ProjectAssetTransfer } from '../../services/projects/cloudProjectCodec'
import { CloudProjectController } from '../../services/projects/cloudProjectController'
import { createHttpAssetTransfer } from '../../services/projects/httpAssetTransfer'
import type { ProjectSaveState } from '../../services/projects/durableSaveQueue'
import {
  executeDurableCreate,
  executeDurableDelete,
  replayDurableProjectMutations,
  type DurableProjectMutationOptions,
} from '../../services/projects/durableProjectMutations'
import { rasterizeTrustedPresets } from '../../services/projects/trustedPresetRasterizer'
import { ProjectSyncChannel } from '../../services/projects/projectSyncChannel'
import {
  discoverLegacyMigration,
  resumeLegacyMigration,
  setLegacyMigrationConsent,
} from './legacyMigration'

interface CloudWorkspaceProps {
  apiBaseUrl: string
  accessToken: string
  appUserId: string
  workspaceId: string
  onLogout(): void | Promise<void>
}

type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; initialProject: Project }

export function CloudWorkspace(props: CloudWorkspaceProps) {
  const tokenRef = useRef(props.accessToken)
  tokenRef.current = props.accessToken
  const [workspace, setWorkspace] = useState<WorkspaceState>({ status: 'loading' })
  const [items, setItems] = useState<ProjectSummary[]>([])
  const [saveState, setSaveState] = useState<ProjectSaveState>('loading')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [migration, setMigration] = useState<LegacyMigrationJournal | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationError, setMigrationError] = useState<string | null>(null)
  const initialCreateOperationId = useRef(crypto.randomUUID())
  const scope = useMemo(() => ({ appUserId: props.appUserId, workspaceId: props.workspaceId }), [props.appUserId, props.workspaceId])
  const clientId = useMemo(() => getCloudDraftClientId(), [])
  const store = useMemo(() => new IndexedDbProjectDraftStore(), [])
  const migrationStore = useMemo(() => new IndexedDbLegacyMigrationStore(), [])
  const mutationStore = useMemo(() => new IndexedDbProjectMutationStore(), [])
  const sync = useMemo(() => new ProjectSyncChannel(scope, clientId), [clientId, scope])
  const syncMounts = useRef(0)
  const remoteProjectListeners = useRef(new Set<(project: Project) => void>())

  const transfer = useMemo<ProjectAssetTransfer>(() => ({
    upload: (input) => createHttpAssetTransfer({
      apiBaseUrl: props.apiBaseUrl,
      accessToken: tokenRef.current,
    }).upload(input),
    download: (assetIds, signal) => createHttpAssetTransfer({
      apiBaseUrl: props.apiBaseUrl,
      accessToken: tokenRef.current,
    }).download(assetIds, signal),
  }), [props.apiBaseUrl])

  const controller = useMemo(() => new CloudProjectController({
    scope,
    clientId,
    store,
    transfer,
    isOnline: () => navigator.onLine,
    save: (input, signal) => saveProject(props.apiBaseUrl, tokenRef.current, input, signal),
    onSaved: (receipt) => sync.publish({
      kind: 'saved',
      projectId: receipt.projectId,
      revision: receipt.revision,
    }),
  }), [clientId, props.apiBaseUrl, scope, store, sync, transfer])

  const mutations = useMemo<DurableProjectMutationOptions>(() => ({
    scope,
    store: mutationStore,
    create: async (input) => {
      const project = await createRemoteProject(props.apiBaseUrl, tokenRef.current, input)
      sync.publish({ kind: 'created', projectId: project.id, revision: project.revision })
      return project
    },
    remove: async (input) => {
      const receipt = await deleteRemoteProject(props.apiBaseUrl, tokenRef.current, input)
      sync.publish({ kind: 'deleted', projectId: receipt.projectId, revision: receipt.revision })
      return receipt
    },
  }), [mutationStore, props.apiBaseUrl, scope, sync])

  const refreshItems = useCallback(async (signal?: AbortSignal) => {
    const all: ProjectSummary[] = []
    let cursor: string | undefined
    do {
      const page = await listProjects(props.apiBaseUrl, tokenRef.current, {
        workspaceId: props.workspaceId,
        cursor,
        limit: 100,
      }, signal)
      all.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    setItems(all)
    return all
  }, [props.apiBaseUrl, props.workspaceId])

  const createFromEditor = useCallback(async (
    project: Project,
    operationId = crypto.randomUUID(),
    signal?: AbortSignal,
  ) => {
    const sidecar = new ProjectAssetSidecar(scope)
    const prepared = await rasterizeTrustedPresets(project)
    const dehydrated = await dehydrateProject({
      project: prepared.project,
      workspaceId: props.workspaceId,
      sidecar,
      transfer,
      signal,
    })
    return executeDurableCreate(mutations, {
      workspaceId: props.workspaceId,
      operationId,
      name: dehydrated.name,
      documentSchemaVersion: 1,
      document: dehydrated.document,
    })
  }, [mutations, props.workspaceId, scope, transfer])

  const subscribeRemoteProject = useCallback((listener: (project: Project) => void) => {
    remoteProjectListeners.current.add(listener)
    return () => remoteProjectListeners.current.delete(listener)
  }, [])

  const openCloudAndNotify = useCallback(async (cloud: CloudProject) => {
    const project = await controller.open(cloud)
    for (const listener of remoteProjectListeners.current) listener(structuredClone(project))
    return project
  }, [controller])

  useEffect(() => {
    let active = true
    let work = Promise.resolve()
    const unsubscribe = sync.subscribe((event) => {
      work = work.then(async () => {
        if (!active) return
        const summaries = await refreshItems()
        const state = controller.getState()
        if (state.status !== 'ready' || state.project.id !== event.projectId) return
        if (state.save.state !== 'clean') {
          controller.markRemoteConflict(event.kind === 'deleted'
            ? 'งานนี้ถูกลบจากอีกแท็บ กรุณาสร้างสำเนาหรือเลือกงานอื่น'
            : 'งานนี้ถูกแก้ไขจากอีกแท็บ กรุณาโหลดเวอร์ชันล่าสุดหรือสร้างสำเนา')
          return
        }

        let nextCloud: CloudProject
        if (event.kind === 'deleted') {
          if (summaries.length === 0) nextCloud = await createFromEditor(freshProject(1))
          else nextCloud = await getProject(props.apiBaseUrl, tokenRef.current, summaries[0].id)
        } else {
          if (event.revision <= state.save.baseRevision) return
          nextCloud = await getProject(props.apiBaseUrl, tokenRef.current, event.projectId)
        }
        if (active) await openCloudAndNotify(nextCloud)
      }).catch(() => {
        // A later sync event or ordinary project action retries from server state.
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [controller, createFromEditor, openCloudAndNotify, props.apiBaseUrl, refreshItems, sync])

  useEffect(() => {
    syncMounts.current += 1
    return () => {
      syncMounts.current -= 1
      queueMicrotask(() => {
        if (syncMounts.current === 0) sync.close()
      })
    }
  }, [sync])

  const executeMigration = useCallback(async (journal: LegacyMigrationJournal) => {
    setMigrationBusy(true)
    setMigrationError(null)
    try {
      const completed = await resumeLegacyMigration({
        journal,
        store: migrationStore,
        transfer,
        importProject: (input) => importLegacyProject(props.apiBaseUrl, tokenRef.current, input),
        getProject: (projectId) => getProject(props.apiBaseUrl, tokenRef.current, projectId),
        onProgress: setMigration,
      })
      setMigration(completed)
      await refreshItems()
    } catch (error) {
      setMigrationError(error instanceof Error ? error.message : 'ย้ายข้อมูลงานเดิมไม่สำเร็จ')
    } finally {
      setMigrationBusy(false)
    }
  }, [migrationStore, props.apiBaseUrl, refreshItems, transfer])

  useEffect(() => {
    let active = true
    void discoverLegacyMigration(scope, migrationStore)
      .then((journal) => {
        if (!active || !journal) return
        const resumable = journal.consent === 'accepted'
          && journal.items.some((item) => ['pending', 'uploading', 'importing', 'error'].includes(item.status))
        const shouldShow = journal.consent === 'pending'
          || resumable
          || journal.items.some((item) => item.status === 'conflict')
        if (shouldShow) setMigration(journal)
        if (resumable) void executeMigration(journal)
      })
      .catch((error: unknown) => {
        if (active) setMigrationError(error instanceof Error ? error.message : 'ตรวจข้อมูลงานเดิมไม่สำเร็จ')
      })
    return () => { active = false }
  }, [executeMigration, migrationStore, scope])

  useEffect(() => {
    const abortController = new AbortController()
    let active = true
    const unsubscribe = controller.subscribe((state) => {
      if (!active || state.status !== 'ready') return
      setSaveState(state.save.state)
      setItems((current) => current.map((item) => item.id === state.project.id
        ? { ...item, name: state.project.name, revision: state.save.baseRevision }
        : item))
    })
    void (async () => {
      try {
        if (navigator.onLine) await replayDurableProjectMutations(mutations)
        let summaries = await refreshItems(abortController.signal)
        let cloud
        if (summaries.length === 0) {
          const starter = freshProject(1)
          cloud = await createFromEditor(starter, initialCreateOperationId.current, abortController.signal)
          summaries = await refreshItems(abortController.signal)
        } else {
          cloud = await getProject(props.apiBaseUrl, tokenRef.current, summaries[0].id, abortController.signal)
        }
        const project = await controller.open(cloud)
        if (active) setWorkspace({ status: 'ready', initialProject: project })
      } catch (error) {
        if (active && !abortController.signal.aborted && !navigator.onLine) {
          const drafts = (await store.list(scope))
            .filter((record) => record.clientId === clientId)
            .sort((left, right) => right.updatedAt - left.updatedAt)
          if (drafts.length) {
            setItems(drafts.map((record) => ({
              id: record.projectId,
              workspaceId: scope.workspaceId,
              name: record.latestDraft.project.name,
              revision: record.baseRevision,
              updatedAt: new Date(record.updatedAt).toISOString(),
            })))
            const project = await controller.open(cloudShellFromDraft(drafts[0]))
            if (active) setWorkspace({ status: 'ready', initialProject: project })
            return
          }
        }
        if (active && !abortController.signal.aborted) {
          setWorkspace({ status: 'error', message: error instanceof Error ? error.message : 'เปิดพื้นที่งานไม่สำเร็จ' })
        }
      }
    })()
    return () => {
      active = false
      abortController.abort()
      unsubscribe()
      controller.dispose()
    }
  }, [controller, createFromEditor, mutations, props.apiBaseUrl, refreshItems])

  useEffect(() => {
    const update = () => {
      const next = navigator.onLine
      setOnline(next)
      controller.setOnline(next)
      if (next) {
        void (async () => {
          const replayed = await replayDurableProjectMutations(mutations)
          const summaries = await refreshItems()
          const state = controller.getState()
          if (state.status !== 'ready' || state.save.state !== 'clean') return
          const replayedCreate = replayed.created.at(-1)
          if (replayedCreate) {
            await openCloudAndNotify(replayedCreate)
            return
          }
          if (!summaries.some((item) => item.id === state.project.id)) {
            const cloud = summaries.length
              ? await getProject(props.apiBaseUrl, tokenRef.current, summaries[0].id)
              : await createFromEditor(freshProject(1))
            await openCloudAndNotify(cloud)
          }
        })().catch(() => {
          // Journal remains durable and is replayed on the next reconnect/reload.
        })
      }
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [controller, createFromEditor, mutations, openCloudAndNotify, props.apiBaseUrl, refreshItems])

  useEffect(() => {
    controller.setOnline(navigator.onLine)
  }, [controller, props.accessToken])

  const bridge = useMemo<CloudProjectBridge>(() => ({
    items,
    online,
    saveState,
    onProjectChange: async (project) => {
      setItems((current) => current.map((item) => item.id === project.id
        ? { ...item, name: project.name, updatedAt: new Date(project.updatedAt).toISOString() }
        : item))
      await controller.capture(project)
    },
    switchProject: async (current, targetId) => {
      if (!online) {
        const draft = await store.get(projectDraftKey(scope, targetId, clientId))
        if (!draft) throw new Error('งานนี้ยังไม่ได้เก็บไว้สำหรับเปิดแบบออฟไลน์')
        return controller.switchProject(current, cloudShellFromDraft(draft))
      }
      const cloud = await getProject(props.apiBaseUrl, tokenRef.current, targetId)
      return controller.switchProject(current, cloud)
    },
    createProject: async (current, name) => {
      await controller.capture(current)
      const fresh = freshProject(items.length + 1)
      fresh.name = name.slice(0, 60) || fresh.name
      const cloud = await createFromEditor(fresh)
      const opened = await controller.open(cloud)
      await refreshItems()
      return opened
    },
    deleteProject: async (current, targetId) => {
      const target = items.find((item) => item.id === targetId)
      if (!target) throw new Error('ไม่พบงานที่จะลบ')
      if (targetId === current.id) {
        await controller.capture(current)
        await controller.flush()
        const state = controller.getState()
        if (state.status !== 'ready' || !['clean', 'offline'].includes(state.save.state)) {
          throw new Error('ยังลบงานไม่ได้จนกว่าจะจัดการ draft/conflict ที่ค้างอยู่')
        }
        if (state.save.state === 'offline') throw new Error('ต้องออนไลน์ก่อนลบงาน')
        await executeDurableDelete(mutations, {
          projectId: targetId,
          operationId: crypto.randomUUID(),
          expectedRevision: state.save.baseRevision,
        })
        let remaining = await refreshItems()
        let nextCloud
        if (remaining.length === 0) {
          nextCloud = await createFromEditor(freshProject(1))
          remaining = await refreshItems()
        } else {
          nextCloud = await getProject(props.apiBaseUrl, tokenRef.current, remaining[0].id)
        }
        return controller.open(nextCloud)
      }
      await executeDurableDelete(mutations, {
        projectId: targetId,
        operationId: crypto.randomUUID(),
        expectedRevision: target.revision,
      })
      await refreshItems()
      return current
    },
    importProject: async (current, imported) => {
      await controller.capture(current)
      const cloud = await createFromEditor(imported)
      const opened = await controller.open(cloud)
      await refreshItems()
      return opened
    },
    beforeLogout: async (current) => {
      await controller.capture(current)
      await controller.flush()
    },
    resolveConflict: async (current, action) => {
      if (action === 'copy') {
        const copy = { ...current, id: crypto.randomUUID(), name: `${current.name} (สำเนา)`, updatedAt: Date.now() }
        const cloud = await createFromEditor(copy)
        const opened = await controller.open(cloud)
        await refreshItems()
        return opened
      }
      await controller.discardDraft()
      const cloud = await getProject(props.apiBaseUrl, tokenRef.current, current.id)
      const opened = await controller.open(cloud)
      await refreshItems()
      return opened
    },
    retrySave: () => controller.retry(),
    subscribeRemoteProject,
    requestAiSpec: (prompt, current, imageBase64, apiKey) => {
      if (!apiKey) throw new Error('กรุณาใส่ Anthropic API key')
      return requestCloudBoxSpec(
        props.apiBaseUrl,
        tokenRef.current,
        apiKey,
        prompt,
        current,
        imageBase64,
      )
    },
  }), [clientId, controller, createFromEditor, items, mutations, online, props.apiBaseUrl, refreshItems, saveState, scope, store, subscribeRemoteProject])

  if (workspace.status === 'loading') {
    return <WorkspaceStatus title="กำลังเปิดงาน" message="กำลังโหลดโปรเจกต์และ draft ล่าสุด…" />
  }
  if (workspace.status === 'error') {
    return <WorkspaceStatus title="เปิดงานไม่ได้" message={workspace.message} />
  }

  const initialStore: ProjectStoreSnapshot = {
    projects: [workspace.initialProject],
    activeId: workspace.initialProject.id,
    showDims: true,
  }
  return (
    <>
      <App
        onLogout={props.onLogout}
        migrateLegacy={false}
        initialStore={initialStore}
        cloud={bridge}
      />
      {migration && migration.consent !== 'declined' && (
        <LegacyMigrationModal
          journal={migration}
          busy={migrationBusy}
          error={migrationError}
          onAccept={() => void (async () => {
            const accepted = await setLegacyMigrationConsent(migration, migrationStore, true)
            setMigration(accepted)
            await executeMigration(accepted)
          })()}
          onDecline={() => void setLegacyMigrationConsent(migration, migrationStore, false).then(() => setMigration(null))}
          onRetry={() => void executeMigration(migration)}
          onClose={() => setMigration(null)}
        />
      )}
    </>
  )
}

function LegacyMigrationModal({
  journal,
  busy,
  error,
  onAccept,
  onDecline,
  onRetry,
  onClose,
}: {
  journal: LegacyMigrationJournal
  busy: boolean
  error: string | null
  onAccept(): void
  onDecline(): void
  onRetry(): void
  onClose(): void
}) {
  const migratable = journal.items.filter((item) => item.project).length
  const complete = journal.items.filter((item) => item.status === 'complete').length
  const failed = journal.items.filter((item) => item.status === 'error').length
  const skipped = journal.items.filter((item) => item.status === 'skipped').length
  const conflicts = journal.items.filter((item) => item.status === 'conflict').length
  const terminal = journal.items.every((item) => ['complete', 'skipped', 'conflict'].includes(item.status))
  return (
    <div className="modal-overlay">
      <div className="modal migration-modal" role="dialog" aria-label="ย้ายงานเดิมขึ้น Cloud">
        <h3>พบงานเดิมในเครื่องนี้</h3>
        {journal.consent === 'pending' ? (
          <>
            <p>พบงานที่ย้ายได้ {migratable} งาน ต้องการคัดลอกขึ้นพื้นที่ Cloud ของบัญชีนี้หรือไม่?</p>
            <p className="migration-note">
              ระบบเก็บ raw backup ไว้ก่อนอ่านข้อมูลและจะไม่ลบ localStorage เดิม ลาย preset ภายในจะถูกแปลงเป็น PNG 2048px;
              SVG อื่นจะถูกข้ามเพื่อความปลอดภัย
            </p>
            {journal.items.flatMap((item) => item.warnings).map((warning, index) => (
              <div className="migration-warning" key={`${warning}-${index}`}>{warning}</div>
            ))}
            {error && <div className="login-error">{error}</div>}
            <div className="modal-actions">
              <button onClick={onDecline}>ยังไม่ย้าย</button>
              <button className="primary" disabled={!migratable || busy} onClick={onAccept}>ย้ายขึ้น Cloud</button>
            </div>
          </>
        ) : (
          <>
            <p>{busy ? 'กำลังย้ายและตรวจสอบงาน…' : `ย้ายสำเร็จ ${complete} งาน`}</p>
            {(skipped > 0 || conflicts > 0 || failed > 0) && (
              <p className="migration-note">ข้าม {skipped} · ข้อมูลเปลี่ยน {conflicts} · ลองใหม่ได้ {failed}</p>
            )}
            {journal.items.map((item) => (
              <div className={`migration-item migration-${item.status}`} key={item.sourceProjectKey}>
                <span>{item.project?.name ?? item.sourceProjectKey}</span>
                <span>{migrationStatusLabel(item.status)}</span>
                {item.error && <small>{item.error}</small>}
              </div>
            ))}
            {error && <div className="login-error">{error}</div>}
            <div className="modal-actions">
              {failed > 0 && <button disabled={busy} onClick={onRetry}>ลองใหม่</button>}
              <button className="primary" disabled={busy || (!terminal && failed === 0)} onClick={onClose}>ปิด</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function migrationStatusLabel(status: LegacyMigrationJournal['items'][number]['status']): string {
  switch (status) {
    case 'pending': return 'รอ'
    case 'uploading': return 'กำลังอัปโหลดรูป'
    case 'importing': return 'กำลังสร้างงาน'
    case 'complete': return 'สำเร็จ'
    case 'skipped': return 'ข้าม'
    case 'conflict': return 'ต้นทางเปลี่ยน'
    case 'error': return 'ไม่สำเร็จ'
  }
}

function WorkspaceStatus({ title, message }: { title: string; message: string }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">{title}</h1>
        <p className="login-sub">{message}</p>
      </div>
    </div>
  )
}

function cloudShellFromDraft(record: PersistedProjectDraft): CloudProject {
  const project = record.latestDraft.project
  return {
    id: record.projectId,
    workspaceId: record.scope.workspaceId,
    name: project.name,
    documentSchemaVersion: 1,
    document: {
      live: project.live,
      qty: project.qty,
      fillColor: project.fillColor,
      decos: [],
      history: [],
      histIdx: -1,
    },
    revision: record.baseRevision,
    createdAt: new Date(record.updatedAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    assets: [],
  }
}
