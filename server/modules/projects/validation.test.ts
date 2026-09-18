import { describe, expect, it } from 'vitest'
import { cloudProjectDocumentSchema, createProjectInputSchema } from './validation'

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
})
