import { describe, expect, it } from 'vitest'
import { cloudProjectDocumentSchema, createProjectInputSchema, legacyImportInputSchema } from './validation'
import { FONTS } from '../../../src/core/artwork'
import { TEXT_FX_KINDS } from '../../../src/core/textFx'

const validDocument = () => ({
  live: {
    template: 'tuck-end',
    materialId: 'carton-300',
    W: 80,
    D: 50,
    H: 120,
    handle: false,
  },
  qty: 500,
  fillColor: null,
  decos: [],
  history: [],
  histIdx: -1,
})

describe('cloud project validation', () => {
  it('accepts a strict minimal document without repairing values', () => {
    expect(cloudProjectDocumentSchema.parse(validDocument())).toEqual(validDocument())
  })

  it('rejects unknown fields, unsupported registry values, and out-of-range dimensions', () => {
    expect(cloudProjectDocumentSchema.safeParse({ ...validDocument(), hiddenPayload: true }).success).toBe(false)
    expect(cloudProjectDocumentSchema.safeParse({
      ...validDocument(),
      live: { ...validDocument().live, template: 'unknown-template' },
    }).success).toBe(false)
    expect(cloudProjectDocumentSchema.safeParse({
      ...validDocument(),
      live: { ...validDocument().live, W: 999 },
    }).success).toBe(false)
  })

  it('accepts sticker cut/sheet settings, small stickers and pouch zipper positions the editor saves', () => {
    const sticker = {
      ...validDocument(),
      live: { ...validDocument().live, template: 'sticker', materialId: 'sticker-pp', W: 12, H: 12 },
      stickerCut: { shape: 'contour', border: 'white', offset: 2, sheet: 'custom', perSheet: 24, sheetW: 320, sheetH: 450, sheetMargin: 3 },
    }
    expect(cloudProjectDocumentSchema.safeParse(sticker).success).toBe(true)
    expect(cloudProjectDocumentSchema.safeParse({
      ...validDocument(),
      live: { ...validDocument().live, W: 12 },
    }).success).toBe(false) // กล่องยังขั้นต่ำ 30
    expect(cloudProjectDocumentSchema.safeParse({
      ...sticker,
      stickerCut: { ...sticker.stickerCut, hidden: true },
    }).success).toBe(false)
    expect(cloudProjectDocumentSchema.safeParse({
      ...validDocument(),
      zipper: true,
      pouchAddons: { valve: true, zipAt: 40, tearAt: 22 },
    }).success).toBe(true)
  })

  it('accepts every editor font and text effects, rejects unknown effects', () => {
    const text = (over: Record<string, unknown>) => ({
      ...validDocument(),
      decos: [{ id: 't1', type: 'text', text: 'สวัสดี', color: '#222222', size: 10, w: 30, x: 0, y: 0, rot: 0, ...over }],
    })
    for (const f of FONTS) expect(cloudProjectDocumentSchema.safeParse(text({ font: f.id })).success, f.id).toBe(true)
    for (const k of TEXT_FX_KINDS) expect(cloudProjectDocumentSchema.safeParse(text({ fx: { kind: k.id } })).success, k.id).toBe(true)
    expect(cloudProjectDocumentSchema.safeParse(text({
      fx: { kind: 'double', color: '#ffffff', color2: '#000000', width: 8, width2: 4 }, ls: -5, grad: { from: '#111111', to: '#222222', angle: 10 },
    })).success).toBe(true)
    expect(cloudProjectDocumentSchema.safeParse(text({ fx: { kind: 'neon' } })).success).toBe(false)
    expect(cloudProjectDocumentSchema.safeParse(text({ fx: { kind: 'drop', blur: 999 } })).success).toBe(false)
    expect(cloudProjectDocumentSchema.safeParse(text({ fx: { kind: 'drop', extra: 1 } })).success).toBe(false)
  })

  it('requires immutable asset IDs instead of browser image URLs', () => {
    expect(cloudProjectDocumentSchema.safeParse({
      ...validDocument(),
      decos: [{
        id: 'image-1',
        type: 'image',
        src: 'data:image/png;base64,AAAA',
        aspect: 1,
        x: 0,
        y: 0,
        rot: 0,
        w: 20,
        h: 20,
      }],
    }).success).toBe(false)
  })

  it('rejects history indexes and operation envelopes that are not exact', () => {
    expect(cloudProjectDocumentSchema.safeParse({ ...validDocument(), histIdx: 0 }).success).toBe(false)
    expect(createProjectInputSchema.safeParse({
      workspaceId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: 'งานทดสอบ',
      documentSchemaVersion: 1,
      document: validDocument(),
      actorUserId: crypto.randomUUID(),
    }).success).toBe(false)
  })

  it('requires stable, bounded legacy source identity and a SHA-256 hash', () => {
    const input = {
      workspaceId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      sourceInstallationId: crypto.randomUUID(),
      sourceProjectKey: 'projects:0',
      sourceHash: 'a'.repeat(64),
      name: 'งานเดิม',
      documentSchemaVersion: 1,
      document: validDocument(),
    }
    expect(legacyImportInputSchema.safeParse(input).success).toBe(true)
    expect(legacyImportInputSchema.safeParse({ ...input, sourceHash: 'not-a-hash' }).success).toBe(false)
    expect(legacyImportInputSchema.safeParse({ ...input, sourceProjectKey: '' }).success).toBe(false)
  })
})
