import type { CloudProject, LegacyImportInput, LegacyImportReceipt } from '../../../shared/contracts/projects'
import {
  DEFAULT_QTY,
  clampIdx,
  parseHistory,
  parseProject,
  parseSpec,
  type Project,
} from '../../core/project'
import { ApiClientError } from '../../services/api/client'
import {
  legacyMigrationKey,
  type LegacyMigrationItem,
  type LegacyMigrationJournal,
  type LegacyMigrationStore,
  type LegacyRawBackup,
} from '../../services/drafts/legacyMigrationStore'
import {
  CloudProjectCodecError,
  ProjectAssetSidecar,
  dehydrateProject,
  sha256Hex,
  type AssetSidecarScope,
  type ProjectAssetTransfer,
} from '../../services/projects/cloudProjectCodec'
import { rasterizeTrustedPresets } from '../../services/projects/trustedPresetRasterizer'

export const LEGACY_PROJECTS_STORAGE_KEY = 'gen-package-projects-v1'
export const LEGACY_SINGLE_STORAGE_KEY = 'gen-package-design-v1'
export const LEGACY_INSTALLATION_STORAGE_KEY = 'gen-package-installation-v1'

export interface LegacyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LegacyMigrationRunOptions {
  journal: LegacyMigrationJournal
  store: LegacyMigrationStore
  transfer: ProjectAssetTransfer
  importProject(input: LegacyImportInput): Promise<LegacyImportReceipt>
  getProject(projectId: string): Promise<CloudProject>
  concurrency?: number
  onProgress?(journal: LegacyMigrationJournal): void
}

const activeMigrationRuns = new Map<string, Promise<LegacyMigrationJournal>>()

interface DiscoveredItem {
  sourceProjectKey: string
  sourceHash: string
  project: Project | null
  warnings: string[]
}

export async function discoverLegacyMigration(
  scope: AssetSidecarScope,
  store: LegacyMigrationStore,
  storage: LegacyStorage = localStorage,
): Promise<LegacyMigrationJournal | null> {
  const installationId = getOrCreateInstallationId(storage)
  const key = legacyMigrationKey(scope, installationId)
  const sources = [LEGACY_PROJECTS_STORAGE_KEY, LEGACY_SINGLE_STORAGE_KEY]
    .map((storageKey) => ({ storageKey, raw: safeGet(storage, storageKey) }))
    .filter((entry): entry is { storageKey: string; raw: string } => entry.raw !== null)
  if (!sources.length) return null

  const now = Date.now()
  let journal = await store.get(key)
  if (!journal) {
    journal = {
      version: 1,
      key,
      scope: { ...scope },
      installationId,
      consent: 'pending',
      rawBackups: [],
      items: [],
      createdAt: now,
      updatedAt: now,
    }
  }

  // The exact raw value is journaled before JSON parsing or repair.
  const backups: LegacyRawBackup[] = []
  for (const source of sources) {
    const sha256 = await textHash(source.raw)
    if (!journal.rawBackups.some((backup) => backup.storageKey === source.storageKey && backup.sha256 === sha256)) {
      backups.push({ ...source, sha256, capturedAt: now })
    }
  }
  if (backups.length) {
    journal.rawBackups.push(...backups)
    journal.updatedAt = now
    await store.put(journal)
  }

  const discovered = await discoverItems(sources)
  for (const candidate of discovered) {
    const existing = journal.items.find((item) => item.sourceProjectKey === candidate.sourceProjectKey)
    if (!existing) {
      journal.items.push({
        ...candidate,
        operationId: crypto.randomUUID(),
        status: candidate.project ? 'pending' : 'skipped',
        sidecar: null,
        error: candidate.project ? null : 'ข้อมูลต้นทางอ่านเป็นโปรเจกต์ไม่ได้',
        targetProjectId: null,
      })
    } else if (existing.sourceHash !== candidate.sourceHash) {
      existing.status = 'conflict'
      existing.error = 'ข้อมูลต้นทางเปลี่ยนหลังเริ่ม migration — ไม่เขียนทับโปรเจกต์เดิม'
    }
  }
  journal.updatedAt = Date.now()
  await store.put(journal)
  return structuredClone(journal)
}

export async function setLegacyMigrationConsent(
  journal: LegacyMigrationJournal,
  store: LegacyMigrationStore,
  accepted: boolean,
): Promise<LegacyMigrationJournal> {
  const next = structuredClone(journal)
  next.consent = accepted ? 'accepted' : 'declined'
  next.updatedAt = Date.now()
  await store.put(next)
  return next
}

export async function reopenLegacyMigrationConsent(
  journal: LegacyMigrationJournal,
  store: LegacyMigrationStore,
): Promise<LegacyMigrationJournal> {
  const next = structuredClone(journal)
  next.consent = 'pending'
  next.updatedAt = Date.now()
  await store.put(next)
  return next
}

export async function runLegacyMigration(options: LegacyMigrationRunOptions): Promise<LegacyMigrationJournal> {
  if (options.journal.consent !== 'accepted') throw new Error('ต้องได้รับความยินยอมก่อนย้ายข้อมูล')
  const journal = structuredClone(options.journal)
  const queue = journal.items.filter((item) => item.project && ['pending', 'uploading', 'importing', 'error'].includes(item.status))
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 2))
  let cursor = 0
  let commitChain = Promise.resolve()

  const commit = (item: LegacyMigrationItem, patch: Partial<LegacyMigrationItem>) => {
    commitChain = commitChain.then(async () => {
      Object.assign(item, patch)
      journal.updatedAt = Date.now()
      await options.store.put(journal)
      options.onProgress?.(structuredClone(journal))
    })
    return commitChain
  }

  const worker = async () => {
    while (cursor < queue.length) {
      const item = queue[cursor++]
      if (!item.project) continue
      try {
        await commit(item, { status: 'uploading', error: null })
        const prepared = await rasterizeTrustedPresets(item.project)
        const sidecar = new ProjectAssetSidecar(journal.scope, item.sidecar ?? undefined)
        const resumableTransfer: ProjectAssetTransfer = {
          download: (assetIds, signal) => options.transfer.download(assetIds, signal),
          upload: async (input) => {
            const asset = await options.transfer.upload(input)
            sidecar.remember({ sourceSha256: input.sourceSha256, purpose: input.purpose, asset })
            await commit(item, { sidecar: sidecar.snapshot() })
            return asset
          },
        }
        const dehydrated = await dehydrateProject({
          project: prepared.project,
          workspaceId: journal.scope.workspaceId,
          sidecar,
          transfer: resumableTransfer,
        })
        const rasterWarning = `แปลง preset ภายใน ${prepared.rasterizedCount} ชิ้นเป็น PNG 2048px`
        await commit(item, {
          status: 'importing',
          sidecar: sidecar.snapshot(),
          warnings: prepared.rasterizedCount && !item.warnings.includes(rasterWarning)
            ? [...item.warnings, rasterWarning]
            : item.warnings,
        })
        const receipt = await options.importProject({
          workspaceId: journal.scope.workspaceId,
          operationId: item.operationId,
          sourceInstallationId: journal.installationId,
          sourceProjectKey: item.sourceProjectKey,
          sourceHash: item.sourceHash,
          name: dehydrated.name,
          documentSchemaVersion: 1,
          document: dehydrated.document,
        })
        const verified = await options.getProject(receipt.project.id)
        const expectedAssetIds = dehydrated.assets.map((asset) => asset.id).sort()
        const verifiedAssetIds = verified.assets.map((asset) => asset.id).sort()
        if (
          verified.id !== receipt.project.id
          || verified.name !== dehydrated.name
          || canonicalJson(verified.document) !== canonicalJson(dehydrated.document)
          || canonicalJson(verifiedAssetIds) !== canonicalJson(expectedAssetIds)
        ) throw new Error('ตรวจสอบโปรเจกต์หลัง migration ไม่ผ่าน')
        await commit(item, { status: 'complete', targetProjectId: verified.id, error: null })
      } catch (error) {
        const isUnsupportedSvg = error instanceof CloudProjectCodecError && error.code === 'UNSUPPORTED_IMAGE_TYPE'
        const isSourceConflict = error instanceof ApiClientError && error.code === 'LEGACY_SOURCE_CHANGED'
        await commit(item, {
          status: isUnsupportedSvg ? 'skipped' : isSourceConflict ? 'conflict' : 'error',
          error: error instanceof Error ? error.message : 'ย้ายโปรเจกต์ไม่สำเร็จ',
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
  await commitChain
  return structuredClone(journal)
}

export function resumeLegacyMigration(options: LegacyMigrationRunOptions): Promise<LegacyMigrationJournal> {
  const existing = activeMigrationRuns.get(options.journal.key)
  if (existing) return existing
  const execute = async () => {
    const latest = await options.store.get(options.journal.key) ?? options.journal
    return runLegacyMigration({ ...options, journal: latest })
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const pending = locks
    ? locks.request(`gen-package:${options.journal.key}`, execute)
    : execute()
  activeMigrationRuns.set(options.journal.key, pending)
  void pending.finally(() => {
    if (activeMigrationRuns.get(options.journal.key) === pending) activeMigrationRuns.delete(options.journal.key)
  }).catch(() => undefined)
  return pending
}

function getOrCreateInstallationId(storage: LegacyStorage): string {
  const existing = safeGet(storage, LEGACY_INSTALLATION_STORAGE_KEY)
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing
  const created = crypto.randomUUID()
  storage.setItem(LEGACY_INSTALLATION_STORAGE_KEY, created)
  return created
}

function safeGet(storage: LegacyStorage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

async function discoverItems(sources: Array<{ storageKey: string; raw: string }>): Promise<DiscoveredItem[]> {
  const found: DiscoveredItem[] = []
  for (const source of sources) {
    if (source.storageKey === LEGACY_PROJECTS_STORAGE_KEY) {
      try {
        const parsed = JSON.parse(source.raw) as Record<string, unknown>
        const projects = Array.isArray(parsed.projects) ? parsed.projects : []
        const ids = new Set<string>()
        for (let index = 0; index < projects.length; index += 1) {
          const rawProject = projects[index]
          const rawId = typeof rawProject === 'object' && rawProject !== null
            && typeof (rawProject as Record<string, unknown>).id === 'string'
            ? String((rawProject as Record<string, unknown>).id)
            : ''
          const stableId = rawId && !ids.has(rawId) ? `id:${rawId}` : `index:${index}`
          if (rawId) ids.add(rawId)
          found.push(await discoveredProject(`projects:${stableId}`, rawProject, index))
        }
      } catch {
        found.push({
          sourceProjectKey: 'projects:store',
          sourceHash: await textHash(source.raw),
          project: null,
          warnings: ['JSON ของคลังโปรเจกต์เดิมเสียหาย; เก็บ raw backup ไว้แล้ว'],
        })
      }
    } else {
      found.push(await discoverSingleLegacy(source.raw))
    }
  }
  return found
}

async function discoveredProject(sourceProjectKey: string, raw: unknown, index: number): Promise<DiscoveredItem> {
  const serialized = JSON.stringify(raw)
  const project = parseProject(raw, index)
  return {
    sourceProjectKey,
    sourceHash: await textHash(serialized),
    project,
    warnings: project ? repairWarnings(raw, project) : ['ข้อมูลงานไม่ครบหรืออ้างรูปแบบ/วัสดุที่ไม่รู้จัก'],
  }
}

async function discoverSingleLegacy(raw: string): Promise<DiscoveredItem> {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const live = parseSpec(data.live)
    if (!live) throw new Error('invalid legacy spec')
    const history = parseHistory(data.history)
    const project = parseProject({
      id: crypto.randomUUID(),
      name: 'งานเดิม',
      updatedAt: Date.now(),
      live,
      qty: DEFAULT_QTY,
      fillColor: null,
      decos: [],
      history,
      histIdx: clampIdx(data.histIdx, history.length),
    }, 0)
    return {
      sourceProjectKey: 'legacy-single',
      sourceHash: await textHash(raw),
      project,
      warnings: ['แปลงข้อมูลรูปแบบงานเดี่ยวรุ่นเก่าเป็นรูปแบบปัจจุบันแล้ว'],
    }
  } catch {
    return {
      sourceProjectKey: 'legacy-single',
      sourceHash: await textHash(raw),
      project: null,
      warnings: ['ข้อมูลรุ่นงานเดี่ยวเสียหาย; เก็บ raw backup ไว้แล้ว'],
    }
  }
}

function repairWarnings(raw: unknown, project: Project): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const source = raw as Record<string, unknown>
  const sourceSpec = (source.live ?? {}) as Record<string, unknown>
  const clamped = (['W', 'D', 'H'] as const).filter(
    (key) => Number.isFinite(Number(sourceSpec[key])) && Number(sourceSpec[key]) !== project.live[key],
  )
  const warnings: string[] = []
  if (clamped.length) warnings.push(`ปรับขนาด ${clamped.join('/')} ให้อยู่ในช่วงที่รองรับ`)
  if (Array.isArray(source.history) && source.history.length > project.history.length) {
    warnings.push(`ตัดประวัติเหลือ ${project.history.length} เวอร์ชันล่าสุด`)
  }
  return warnings
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function textHash(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value))
}
