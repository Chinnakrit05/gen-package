import { describe, expect, it, vi } from 'vitest'
import type { ReadyAssetMetadata } from '../../../shared/contracts/assets'
import type { CloudProject } from '../../../shared/contracts/projects'
import type { Project } from '../../core/project'
import { parseProjectFile } from '../../core/projectFile'
import {
  CloudProjectCodecError,
  ProjectAssetSidecar,
  bytesToDataUrl,
  dehydrateProject,
  hydrateProject,
  serializeCloudProjectPortable,
  sha256Hex,
  type CodecAssetDownload,
  type CodecAssetUploadInput,
  type ProjectAssetTransfer,
} from './cloudProjectCodec'

const PNG_BYTES = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
), (character) => character.charCodeAt(0))
const PNG_DATA_URL = bytesToDataUrl(PNG_BYTES, 'image/png')

function fullProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: 'แพ็กเกจครบทุกฟิลด์',
    updatedAt: 1_750_000_000_000,
    live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: true },
    qty: 1250,
    fillColor: '#123456',
    fillImage: {
      src: PNG_DATA_URL,
      aspect: 1,
      fit: 'contain',
      zoom: 2,
      ox: 0.25,
      oy: -0.25,
      rot: 15,
      opacity: 0.8,
    },
    labelStyle: 'band',
    pouchStyle: 'gusset',
    zipper: true,
    pouchAddons: { hangHole: true, valve: true, tinTie: true },
    decos: [
      {
        id: 'image-1', type: 'image', src: PNG_DATA_URL, aspect: 1, w: 42, h: 31,
        fit: 'contain', radius: 2, circle: true, maskShape: 'star', maskSides: 7,
        preset: 'dots', presetColor: '#abcdef', x: 1, y: 2, rot: 3, hidden: true,
        locked: true, name: 'ภาพ', groupId: 'group-1', flipX: true, flipY: true, opacity: 0.75,
      },
      {
        id: 'text-1', type: 'text', text: 'ข้อความ\nสองบรรทัด', color: '#112233', size: 12, w: 44,
        font: 'sarabun', weight: 700, align: 'center', lh: 1.5, strokeColor: '#ffffff', strokeW: 1,
        shadow: true, curve: 30, x: 3, y: 4, rot: 5,
      },
      {
        id: 'shape-1', type: 'shape', shape: 'polygon', w: 20, h: 21, fill: '#445566',
        stroke: '#778899', strokeW: 2, grad: { from: '#111111', to: '#eeeeee', angle: 45, radial: true },
        sides: 6, dash: true, x: 5, y: 6, rot: 7,
      },
      {
        id: 'nutrition-1', type: 'nutrition', w: 70, serving: '1 กล่อง', servings: '2', energy: '120',
        energyFat: '20', rows: [{ label: 'ไขมัน', value: '2 ก.', rdi: '3', indent: true, bold: true }],
        vitamins: [{ label: 'วิตามินซี', value: '', rdi: '10' }], footnote: 'หมายเหตุ', ink: '#000000',
        paper: false, scale: 1.2, x: 7, y: 8, rot: 9,
      },
      {
        id: 'path-1', type: 'path', anchors: [
          { nx: 0, ny: 0, ox: 0.1, oy: 0.2 },
          { nx: 1, ny: 1, ix: 0.8, iy: 0.9 },
        ], closed: true, w: 30, h: 31, fill: '#101010', stroke: '#202020', strokeW: 1,
        grad: { from: '#303030', to: '#404040', angle: 90 }, dash: true, x: 9, y: 10, rot: 11,
      },
    ],
    history: [{
      label: 'แบบแรก',
      spec: { template: 'mailer', materialId: 'kraft-350', W: 90, D: 60, H: 100, handle: false },
      ai: { assumptions: ['สมมติฐาน'], layoutNote: 'วางแนวนอน', reasoning: 'ประหยัดกระดาษ' },
    }],
    histIdx: 0,
  }
}

class FakeTransfer implements ProjectAssetTransfer {
  readonly upload = vi.fn(async (input: CodecAssetUploadInput): Promise<ReadyAssetMetadata> => {
    const asset: ReadyAssetMetadata = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      state: 'ready',
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      sha256: await sha256Hex(input.bytes),
      width: 1,
      height: 1,
      createdAt: '2026-09-18T00:00:00.000Z',
    }
    this.objects.set(asset.id, { asset, bytes: input.bytes.slice() })
    return asset
  })

  readonly download = vi.fn(async (assetIds: string[]): Promise<CodecAssetDownload[]> =>
    assetIds.map((id) => {
      const object = this.objects.get(id)
      if (!object) throw new Error(`missing fake object ${id}`)
      return { asset: object.asset, bytes: object.bytes.slice() }
    }))

  readonly objects = new Map<string, CodecAssetDownload>()
}

function cloudProject(
  project: Project,
  dehydrated: Awaited<ReturnType<typeof dehydrateProject>>,
  workspaceId: string,
): CloudProject {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    name: dehydrated.name,
    documentSchemaVersion: 1,
    document: dehydrated.document,
    revision: 1,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: new Date(project.updatedAt).toISOString(),
    assets: dehydrated.assets,
  }
}

describe('cloud/editor project codec', () => {
  it('round-trips every editor field and replaces runtime sources with asset IDs', async () => {
    const workspaceId = crypto.randomUUID()
    const scope = { appUserId: crypto.randomUUID(), workspaceId }
    const sidecar = new ProjectAssetSidecar(scope)
    const transfer = new FakeTransfer()
    const project = fullProject()

    const dehydrated = await dehydrateProject({ project, workspaceId, sidecar, transfer })
    expect(transfer.upload).toHaveBeenCalledTimes(2)
    expect(dehydrated.document.fillImage).toMatchObject({ assetId: expect.any(String), aspect: 1 })
    expect(dehydrated.document.fillImage).not.toHaveProperty('src')
    expect(dehydrated.document.decos[0]).toMatchObject({ type: 'image', assetId: expect.any(String) })
    expect(dehydrated.document.decos[0]).not.toHaveProperty('src')
    expect(dehydrated.document.decos.slice(1)).toEqual(project.decos.slice(1))

    const hydrated = await hydrateProject({
      cloudProject: cloudProject(project, dehydrated, workspaceId),
      sidecar: new ProjectAssetSidecar(scope),
      transfer,
    })
    expect(hydrated).toMatchObject({
      name: project.name,
      updatedAt: project.updatedAt,
      live: project.live,
      qty: project.qty,
      fillColor: project.fillColor,
      fillImage: project.fillImage,
      labelStyle: project.labelStyle,
      pouchStyle: project.pouchStyle,
      zipper: project.zipper,
      pouchAddons: project.pouchAddons,
      decos: project.decos,
      history: project.history,
      histIdx: project.histIdx,
    })
  })

  it('dedupes repeated sources and reuses a scoped sidecar snapshot', async () => {
    const workspaceId = crypto.randomUUID()
    const scope = { appUserId: crypto.randomUUID(), workspaceId }
    const sidecar = new ProjectAssetSidecar(scope)
    const transfer = new FakeTransfer()
    const project = fullProject()
    project.fillImage = null
    project.decos.push({ ...project.decos[0] as Project['decos'][number], id: 'image-duplicate' })

    const first = await dehydrateProject({ project, workspaceId, sidecar, transfer })
    expect(first.assets).toHaveLength(1)
    expect(transfer.upload).toHaveBeenCalledTimes(1)

    const restored = new ProjectAssetSidecar(scope, sidecar.snapshot())
    const second = await dehydrateProject({ project, workspaceId, sidecar: restored, transfer })
    expect(second.document).toEqual(first.document)
    expect(transfer.upload).toHaveBeenCalledTimes(1)
  })

  it('portable export embeds image bytes and does not leak asset IDs or signed URLs', async () => {
    const workspaceId = crypto.randomUUID()
    const scope = { appUserId: crypto.randomUUID(), workspaceId }
    const transfer = new FakeTransfer()
    const project = fullProject()
    const dehydrated = await dehydrateProject({
      project,
      workspaceId,
      sidecar: new ProjectAssetSidecar(scope),
      transfer,
    })
    const portable = await serializeCloudProjectPortable({
      cloudProject: cloudProject(project, dehydrated, workspaceId),
      sidecar: new ProjectAssetSidecar(scope),
      transfer,
    })

    expect(portable).toContain('data:image/png;base64,')
    expect(portable).not.toContain('assetId')
    expect(portable).not.toContain('token=')
    const imported = parseProjectFile(portable)
    expect(imported.ok).toBe(true)
    if (imported.ok) {
      expect(imported.project.fillImage?.src).toBe(PNG_DATA_URL)
      expect(imported.project.decos[0]).toMatchObject({ type: 'image', src: PNG_DATA_URL })
      expect(imported.project.decos.slice(1)).toEqual(project.decos.slice(1))
    }
  })

  it('rejects SVG before upload and preserves the original project object', async () => {
    const workspaceId = crypto.randomUUID()
    const project = fullProject()
    ;(project.decos[0] as { src: string }).src = 'data:image/svg+xml;base64,PHN2Zy8+'
    const original = structuredClone(project)
    const transfer = new FakeTransfer()

    await expect(dehydrateProject({
      project,
      workspaceId,
      sidecar: new ProjectAssetSidecar({ appUserId: crypto.randomUUID(), workspaceId }),
      transfer,
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' } satisfies Partial<CloudProjectCodecError>)
    expect(transfer.upload).not.toHaveBeenCalled()
    expect(project).toEqual(original)
  })

  it('rejects a sidecar from another account/workspace and corrupt downloads', async () => {
    const workspaceId = crypto.randomUUID()
    const transfer = new FakeTransfer()
    const project = fullProject()
    const sidecar = new ProjectAssetSidecar({ appUserId: crypto.randomUUID(), workspaceId })
    const dehydrated = await dehydrateProject({ project, workspaceId, sidecar, transfer })
    expect(() => new ProjectAssetSidecar(
      { appUserId: crypto.randomUUID(), workspaceId },
      sidecar.snapshot(),
    )).toThrowError(CloudProjectCodecError)

    const brokenTransfer: ProjectAssetTransfer = {
      upload: transfer.upload,
      download: async (ids) => {
        const downloads = await transfer.download(ids)
        return downloads.map((item, index) => index === 0 ? { ...item, bytes: new Uint8Array([1, 2, 3]) } : item)
      },
    }
    await expect(hydrateProject({
      cloudProject: cloudProject(project, dehydrated, workspaceId),
      sidecar: new ProjectAssetSidecar({ appUserId: crypto.randomUUID(), workspaceId }),
      transfer: brokenTransfer,
    })).rejects.toMatchObject({ code: 'ASSET_INTEGRITY_FAILED' } satisfies Partial<CloudProjectCodecError>)
  })
})
