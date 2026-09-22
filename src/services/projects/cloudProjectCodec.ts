import type { ReadyAssetMetadata, AssetMime, AssetPurpose } from '../../../shared/contracts/assets'
import type { CloudProject, CloudProjectDocumentV1 } from '../../../shared/contracts/projects'
import type { FillImage, ImageEl } from '../../core/artwork'
import { parseProject, type Project } from '../../core/project'
import { serializeProject } from '../../core/projectFile'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export type CloudProjectCodecErrorCode =
  | 'INVALID_EDITOR_PROJECT'
  | 'INVALID_CLOUD_PROJECT'
  | 'INVALID_IMAGE_DATA'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'MISSING_ASSET'
  | 'ASSET_INTEGRITY_FAILED'

export class CloudProjectCodecError extends Error {
  constructor(
    readonly code: CloudProjectCodecErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CloudProjectCodecError'
  }
}

export interface AssetSidecarScope {
  appUserId: string
  workspaceId: string
}

export interface AssetSidecarEntry {
  sourceSha256: string
  purpose: AssetPurpose
  asset: ReadyAssetMetadata
}

export interface AssetSidecarSnapshot {
  version: 1
  scope: AssetSidecarScope
  entries: AssetSidecarEntry[]
}

/**
 * Cache hint only. The project save RPC remains responsible for checking that
 * every referenced asset is still ready and belongs to the workspace.
 */
export class ProjectAssetSidecar {
  private readonly entries = new Map<string, AssetSidecarEntry>()

  constructor(
    readonly scope: AssetSidecarScope,
    snapshot?: AssetSidecarSnapshot,
  ) {
    if (!scope.appUserId || !scope.workspaceId) {
      throw new CloudProjectCodecError('INVALID_EDITOR_PROJECT', 'asset sidecar scope ไม่ครบ')
    }
    if (!snapshot) return
    if (
      snapshot.version !== 1
      || snapshot.scope.appUserId !== scope.appUserId
      || snapshot.scope.workspaceId !== scope.workspaceId
    ) {
      throw new CloudProjectCodecError('INVALID_EDITOR_PROJECT', 'asset sidecar อยู่คนละบัญชีหรือ workspace')
    }
    for (const entry of snapshot.entries) this.remember(entry)
  }

  find(sourceSha256: string, purpose: AssetPurpose): ReadyAssetMetadata | undefined {
    return this.entries.get(sidecarKey(sourceSha256, purpose))?.asset
  }

  remember(entry: AssetSidecarEntry): void {
    if (entry.asset.workspaceId !== this.scope.workspaceId || entry.asset.purpose !== entry.purpose) {
      throw new CloudProjectCodecError('INVALID_EDITOR_PROJECT', 'asset sidecar ไม่ตรงกับ workspace หรือ purpose')
    }
    this.entries.set(sidecarKey(entry.sourceSha256, entry.purpose), structuredClone(entry))
  }

  snapshot(): AssetSidecarSnapshot {
    return {
      version: 1,
      scope: { ...this.scope },
      entries: [...this.entries.values()].map((entry) => structuredClone(entry)),
    }
  }
}

export interface CodecAssetUploadInput {
  workspaceId: string
  purpose: AssetPurpose
  mimeType: AssetMime
  bytes: Uint8Array
  sourceSha256: string
  signal?: AbortSignal
}

export interface CodecAssetDownload {
  asset: ReadyAssetMetadata
  bytes: Uint8Array
}

export interface ProjectAssetTransfer {
  upload(input: CodecAssetUploadInput): Promise<ReadyAssetMetadata>
  download(assetIds: string[], signal?: AbortSignal): Promise<CodecAssetDownload[]>
}

export interface DehydrateProjectInput {
  project: Project
  workspaceId: string
  sidecar: ProjectAssetSidecar
  transfer: ProjectAssetTransfer
  signal?: AbortSignal
}

export interface DehydrateProjectResult {
  name: string
  documentSchemaVersion: 1
  document: CloudProjectDocumentV1
  assets: ReadyAssetMetadata[]
}

type CloudImageEl = Omit<ImageEl, 'src'> & { assetId: string }
type CloudFillImage = Omit<FillImage, 'src'> & { assetId: string }

export async function dehydrateProject(input: DehydrateProjectInput): Promise<DehydrateProjectResult> {
  assertSidecarWorkspace(input.sidecar, input.workspaceId)
  const project = validateEditorProject(input.project)
  const resolved = new Map<string, Promise<ReadyAssetMetadata>>()

  const resolveSource = async (src: string, purpose: AssetPurpose): Promise<ReadyAssetMetadata> => {
    const parsed = await parseImageDataUrl(src)
    const key = sidecarKey(parsed.sha256, purpose)
    let pending = resolved.get(key)
    if (!pending) {
      pending = (async () => {
        const cached = input.sidecar.find(parsed.sha256, purpose)
        if (cached) return cached
        const uploaded = await input.transfer.upload({
          workspaceId: input.workspaceId,
          purpose,
          mimeType: parsed.mimeType,
          bytes: parsed.bytes,
          sourceSha256: parsed.sha256,
          signal: input.signal,
        })
        assertReadyAsset(uploaded, input.workspaceId, purpose)
        input.sidecar.remember({ sourceSha256: parsed.sha256, purpose, asset: uploaded })
        return uploaded
      })()
      resolved.set(key, pending)
    }
    return pending
  }

  const decos = await Promise.all(project.decos.map(async (deco) => {
    if (deco.type !== 'image') return structuredClone(deco) as unknown as Record<string, unknown>
    const asset = await resolveSource(deco.src, 'project-decoration')
    const { src: _src, ...withoutSource } = deco
    const cloud: CloudImageEl = { ...withoutSource, assetId: asset.id }
    return cloud as unknown as Record<string, unknown>
  }))

  let fillImage: CloudFillImage | null | undefined
  if (project.fillImage) {
    const asset = await resolveSource(project.fillImage.src, 'project-fill')
    const { src: _src, ...withoutSource } = project.fillImage
    fillImage = { ...withoutSource, assetId: asset.id }
  } else if (project.fillImage === null) {
    fillImage = null
  }

  const document: CloudProjectDocumentV1 = {
    live: structuredClone(project.live),
    qty: project.qty,
    fillColor: project.fillColor,
    ...(fillImage !== undefined ? { fillImage: fillImage as unknown as Record<string, unknown> | null } : {}),
    ...(project.labelStyle ? { labelStyle: project.labelStyle } : {}),
    ...(project.pouchStyle ? { pouchStyle: project.pouchStyle } : {}),
    ...(project.zipper !== undefined ? { zipper: project.zipper } : {}),
    ...(project.pouchAddons
      ? { pouchAddons: structuredClone(project.pouchAddons) as unknown as Record<string, boolean> }
      : {}),
    decos,
    history: structuredClone(project.history) as unknown as Record<string, unknown>[],
    histIdx: project.histIdx,
  }

  assertCloudDocumentHasNoRuntimeSources(document)
  const assets = [...new Map(
    (await Promise.all(resolved.values())).map((asset) => [asset.id, asset]),
  ).values()]
  return { name: project.name, documentSchemaVersion: 1, document, assets }
}

export interface HydrateProjectInput {
  cloudProject: CloudProject
  sidecar: ProjectAssetSidecar
  transfer: ProjectAssetTransfer
  signal?: AbortSignal
}

export async function hydrateProject(input: HydrateProjectInput): Promise<Project> {
  const { cloudProject } = input
  assertSidecarWorkspace(input.sidecar, cloudProject.workspaceId)
  const refs = collectDocumentAssetRefs(cloudProject.document)
  const metadata = new Map(cloudProject.assets.map((asset) => [asset.id, asset]))
  for (const ref of refs) {
    const asset = metadata.get(ref.assetId)
    if (!asset) throw new CloudProjectCodecError('MISSING_ASSET', `ไม่พบ metadata ของ asset ${ref.assetId}`)
    assertReadyAsset(asset, cloudProject.workspaceId, ref.purpose)
  }

  const uniqueIds = [...new Set(refs.map((ref) => ref.assetId))]
  const downloads = uniqueIds.length ? await input.transfer.download(uniqueIds, input.signal) : []
  const sourceByAssetId = new Map<string, string>()
  for (const download of downloads) {
    const expected = metadata.get(download.asset.id)
    if (!expected) throw new CloudProjectCodecError('MISSING_ASSET', `ได้รับ asset ที่ไม่ได้ร้องขอ ${download.asset.id}`)
    assertReadyAsset(download.asset, cloudProject.workspaceId, expected.purpose)
    const sha256 = await sha256Hex(download.bytes)
    if (sha256 !== expected.sha256 || download.bytes.byteLength !== expected.byteSize) {
      throw new CloudProjectCodecError('ASSET_INTEGRITY_FAILED', `checksum หรือขนาดของ asset ${expected.id} ไม่ตรง`)
    }
    const source = bytesToDataUrl(download.bytes, expected.mimeType)
    sourceByAssetId.set(expected.id, source)
    input.sidecar.remember({ sourceSha256: sha256, purpose: expected.purpose, asset: expected })
  }
  for (const id of uniqueIds) {
    if (!sourceByAssetId.has(id)) throw new CloudProjectCodecError('MISSING_ASSET', `ดาวน์โหลด asset ${id} ไม่ครบ`)
  }

  const rawDocument = structuredClone(cloudProject.document)
  const decos = rawDocument.decos.map((raw) => {
    if (raw.type !== 'image') return raw
    const assetId = typeof raw.assetId === 'string' ? raw.assetId : ''
    const src = sourceByAssetId.get(assetId)
    if (!src) throw new CloudProjectCodecError('MISSING_ASSET', `ไม่พบ bytes ของ asset ${assetId}`)
    const { assetId: _assetId, ...withoutAsset } = raw
    return { ...withoutAsset, src }
  })

  let fillImage = rawDocument.fillImage
  if (fillImage && typeof fillImage === 'object') {
    const assetId = typeof fillImage.assetId === 'string' ? fillImage.assetId : ''
    const src = sourceByAssetId.get(assetId)
    if (!src) throw new CloudProjectCodecError('MISSING_ASSET', `ไม่พบ bytes ของ asset ${assetId}`)
    const { assetId: _assetId, ...withoutAsset } = fillImage
    fillImage = { ...withoutAsset, src }
  }

  const parsed = parseProject({
    id: cloudProject.id,
    name: cloudProject.name,
    updatedAt: Date.parse(cloudProject.updatedAt),
    ...rawDocument,
    decos,
    ...(fillImage !== undefined ? { fillImage } : {}),
  }, 0)
  if (!parsed || parsed.decos.length !== rawDocument.decos.length) {
    throw new CloudProjectCodecError('INVALID_CLOUD_PROJECT', 'cloud document แปลงเป็น editor project ไม่สำเร็จ')
  }
  return parsed
}

export async function serializeCloudProjectPortable(input: HydrateProjectInput): Promise<string> {
  return serializeProject(await hydrateProject(input))
}

interface ParsedImageDataUrl {
  mimeType: AssetMime
  bytes: Uint8Array
  sha256: string
}

export async function parseImageDataUrl(src: string): Promise<ParsedImageDataUrl> {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src)
  if (!match) throw new CloudProjectCodecError('INVALID_IMAGE_DATA', 'รูปต้องเป็น data URL')
  const declared = match[1].toLowerCase()
  if (declared === 'image/svg+xml') {
    throw new CloudProjectCodecError('UNSUPPORTED_IMAGE_TYPE', 'cloud mode ยังไม่รองรับ SVG กรุณาแปลงเป็น PNG/JPEG ก่อน')
  }
  if (declared !== 'image/png' && declared !== 'image/jpeg') {
    throw new CloudProjectCodecError('UNSUPPORTED_IMAGE_TYPE', `ไม่รองรับรูปชนิด ${declared}`)
  }
  if (!match[2]) throw new CloudProjectCodecError('INVALID_IMAGE_DATA', 'PNG/JPEG data URL ต้องเข้ารหัส base64')
  let binary: string
  try {
    binary = atob(match[3].replace(/\s/g, ''))
  } catch {
    throw new CloudProjectCodecError('INVALID_IMAGE_DATA', 'base64 ของรูปไม่ถูกต้อง')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new CloudProjectCodecError('INVALID_IMAGE_DATA', 'รูปต้องมีขนาด 1 byte ถึง 10 MiB')
  }
  const detected = detectImageMime(bytes)
  if (detected !== declared) {
    throw new CloudProjectCodecError('INVALID_IMAGE_DATA', 'ชนิดรูปใน data URL ไม่ตรงกับ signature ของไฟล์')
  }
  return { mimeType: detected, bytes, sha256: await sha256Hex(bytes) }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: AssetMime): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function detectImageMime(bytes: Uint8Array): AssetMime | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

function validateEditorProject(project: Project): Project {
  const parsed = parseProject(project, 0)
  if (!parsed || parsed.decos.length !== project.decos.length) {
    throw new CloudProjectCodecError('INVALID_EDITOR_PROJECT', 'editor project มีข้อมูลที่ cloud schema รองรับไม่ได้')
  }
  return parsed
}

function collectDocumentAssetRefs(document: CloudProjectDocumentV1): Array<{ assetId: string; purpose: AssetPurpose }> {
  const refs: Array<{ assetId: string; purpose: AssetPurpose }> = []
  if (document.fillImage && typeof document.fillImage === 'object') {
    const assetId = document.fillImage.assetId
    if (typeof assetId !== 'string') throw new CloudProjectCodecError('INVALID_CLOUD_PROJECT', 'fillImage ไม่มี assetId')
    refs.push({ assetId, purpose: 'project-fill' })
  }
  for (const deco of document.decos) {
    if (deco.type !== 'image') continue
    if (typeof deco.assetId !== 'string') throw new CloudProjectCodecError('INVALID_CLOUD_PROJECT', 'image deco ไม่มี assetId')
    refs.push({ assetId: deco.assetId, purpose: 'project-decoration' })
  }
  return refs
}

function assertCloudDocumentHasNoRuntimeSources(document: CloudProjectDocumentV1): void {
  if (document.fillImage && 'src' in document.fillImage) {
    throw new CloudProjectCodecError('INVALID_CLOUD_PROJECT', 'cloud fillImage ต้องไม่มี src')
  }
  if (document.decos.some((deco) => deco.type === 'image' && 'src' in deco)) {
    throw new CloudProjectCodecError('INVALID_CLOUD_PROJECT', 'cloud image deco ต้องไม่มี src')
  }
}

function assertSidecarWorkspace(sidecar: ProjectAssetSidecar, workspaceId: string): void {
  if (sidecar.scope.workspaceId !== workspaceId) {
    throw new CloudProjectCodecError('INVALID_EDITOR_PROJECT', 'asset sidecar อยู่คนละ workspace')
  }
}

function assertReadyAsset(asset: ReadyAssetMetadata, workspaceId: string, purpose: AssetPurpose): void {
  if (asset.state !== 'ready' || asset.workspaceId !== workspaceId || asset.purpose !== purpose) {
    throw new CloudProjectCodecError('MISSING_ASSET', 'asset ไม่พร้อมหรืออยู่คนละ workspace/purpose')
  }
}

function sidecarKey(sourceSha256: string, purpose: AssetPurpose): string {
  return `${purpose}:${sourceSha256}`
}
