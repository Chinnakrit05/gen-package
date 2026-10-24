import { z } from 'zod'
import { MATERIALS } from '../../../src/core/materials'
import { TEMPLATES } from '../../../src/core/templates'
import { FINISHES, type FinishKind } from '../../../src/core/finish'
import { LETTER_SPACING_RANGE, TEXT_FX_KINDS, TEXT_FX_RANGE, type TextFxKind } from '../../../src/core/textFx'
import {
  THUMBNAIL_BATCH_MAX,
  THUMBNAIL_KINDS,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
  type ThumbnailMime,
} from '../../../shared/contracts/projects'

const finite = z.number().finite()
const coordinate = finite.min(-1_000_000).max(1_000_000)
const positiveSize = finite.positive().max(1_000_000)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const paint = z.union([color, z.literal('none')])
const shortId = z.string().min(1).max(100)
const optionalTrue = z.literal(true).optional()

const baseFields = {
  id: shortId,
  x: coordinate,
  y: coordinate,
  rot: finite.min(-36_000).max(36_000),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  name: z.string().max(120).optional(),
  groupId: shortId.optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  opacity: finite.min(0).max(1).optional(),
  finish: z.enum(FINISHES.map((x) => x.id) as [FinishKind, ...FinishKind[]]).optional(),
}

const gradientSchema = z.object({
  from: color,
  to: color,
  angle: finite.min(-36_000).max(36_000),
  radial: z.boolean().optional(),
}).strict()

const imageSchema = z.object({
  ...baseFields,
  type: z.literal('image'),
  assetId: z.uuid(),
  aspect: finite.positive().max(100_000),
  w: positiveSize,
  h: positiveSize,
  fit: z.enum(['cover', 'contain', 'stretch']).optional(),
  radius: finite.min(0).max(1_000_000).optional(),
  circle: z.boolean().optional(),
  maskShape: z.enum(['triangle', 'polygon', 'star']).optional(),
  maskSides: z.number().int().min(3).max(100).optional(),
  preset: z.string().max(100).optional(),
  presetColor: color.optional(),
}).strict()

const fxRange = (key: keyof typeof TEXT_FX_RANGE) =>
  finite.min(TEXT_FX_RANGE[key][0]).max(TEXT_FX_RANGE[key][1]).optional()
const textFxSchema = z.object({
  kind: z.enum(TEXT_FX_KINDS.map((k) => k.id) as [TextFxKind, ...TextFxKind[]]),
  color: color.optional(),
  color2: color.optional(),
  dist: fxRange('dist'),
  angle: fxRange('angle'),
  blur: fxRange('blur'),
  alpha: fxRange('alpha'),
  width: fxRange('width'),
  width2: fxRange('width2'),
  pad: fxRange('pad'),
  round: fxRange('round'),
}).strict()

// ต้องตรงกับ FONTS ใน src/core/artwork.ts (validation.test ตรวจครบทุกตัว)
export const TEXT_FONT_IDS = [
  'noto', 'sarabun', 'prompt', 'kanit', 'bai-jamjuree', 'mitr', 'chakra-petch', 'mali', 'pridi', 'kodchasan',
] as const

const textSchema = z.object({
  ...baseFields,
  type: z.literal('text'),
  text: z.string().max(10_000),
  color,
  size: finite.positive().max(10_000),
  w: positiveSize,
  font: z.enum(TEXT_FONT_IDS).optional(),
  weight: z.union([z.literal(400), z.literal(700)]).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  lh: finite.min(0.5).max(5).optional(),
  strokeColor: color.optional(),
  strokeW: finite.min(0).max(1_000).optional(),
  shadow: z.boolean().optional(), // งานเก่า — งานใหม่เก็บเงาเป็น fx
  fx: textFxSchema.optional(),
  ls: finite.min(LETTER_SPACING_RANGE[0]).max(LETTER_SPACING_RANGE[1]).optional(),
  grad: gradientSchema.optional(),
  curve: finite.min(-360).max(360).optional(),
}).strict()

const shapeSchema = z.object({
  ...baseFields,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line', 'triangle', 'polygon', 'star']),
  w: positiveSize,
  h: positiveSize,
  fill: paint,
  stroke: paint,
  strokeW: finite.min(0).max(1_000),
  grad: gradientSchema.optional(),
  sides: z.number().int().min(3).max(100).optional(),
  dash: z.boolean().optional(),
}).strict()

const nutritionRowSchema = z.object({
  label: z.string().max(1_000),
  value: z.string().max(1_000),
  rdi: z.string().max(100).optional(),
  indent: z.boolean().optional(),
  bold: z.boolean().optional(),
}).strict()

const nutritionSchema = z.object({
  ...baseFields,
  type: z.literal('nutrition'),
  w: positiveSize,
  serving: z.string().max(1_000),
  servings: z.string().max(1_000),
  energy: z.string().max(1_000),
  energyFat: z.string().max(1_000).optional(),
  rows: z.array(nutritionRowSchema).max(100),
  vitamins: z.array(nutritionRowSchema).max(100),
  footnote: z.string().max(10_000),
  ink: color.optional(),
  paper: z.boolean().optional(),
  scale: finite.min(0.5).max(3).optional(),
}).strict()

const anchorSchema = z.object({
  nx: finite.min(-10).max(10),
  ny: finite.min(-10).max(10),
  ox: finite.min(-10).max(10).optional(),
  oy: finite.min(-10).max(10).optional(),
  ix: finite.min(-10).max(10).optional(),
  iy: finite.min(-10).max(10).optional(),
}).strict().superRefine((anchor, context) => {
  if ((anchor.ox === undefined) !== (anchor.oy === undefined)) {
    context.addIssue({ code: 'custom', message: 'outgoing control point ต้องมีทั้ง x/y' })
  }
  if ((anchor.ix === undefined) !== (anchor.iy === undefined)) {
    context.addIssue({ code: 'custom', message: 'incoming control point ต้องมีทั้ง x/y' })
  }
})

const pathSchema = z.object({
  ...baseFields,
  type: z.literal('path'),
  anchors: z.array(anchorSchema).min(2).max(20_000),
  closed: z.boolean(),
  w: positiveSize,
  h: positiveSize,
  fill: paint,
  stroke: paint,
  strokeW: finite.min(0).max(1_000),
  grad: gradientSchema.optional(),
  dash: z.boolean().optional(),
}).strict()

const decoSchema = z.discriminatedUnion('type', [
  imageSchema,
  textSchema,
  shapeSchema,
  nutritionSchema,
  pathSchema,
])

const currentSpecSchema = z.object({
  template: z.string().refine((value) => TEMPLATES.some((template) => template.id === value), 'unknown template'),
  materialId: z.string().refine((value) => MATERIALS.some((material) => material.id === value), 'unknown material'),
  // สติกเกอร์เล็กได้ถึง 10 มม. (แผ่นหลายดวง) — งานอื่นขั้นต่ำ 30 (ตรงกับ parseSpec ฝั่ง client)
  W: finite.min(10).max(250),
  D: finite.min(20).max(150),
  H: finite.min(10).max(300),
  handle: z.boolean(),
}).strict().superRefine((spec, context) => {
  if (spec.template === 'sticker') return
  for (const key of ['W', 'H'] as const) {
    if (spec[key] < 30) context.addIssue({ code: 'custom', path: [key], message: `${key} ต้องไม่น้อยกว่า 30` })
  }
})

const aiInfoSchema = z.object({
  assumptions: z.array(z.string().max(300)).max(50),
  layoutNote: z.string().max(200),
  reasoning: z.string().max(600),
}).strict()

const historySchema = z.object({
  label: z.string().min(1).max(120),
  spec: currentSpecSchema,
  ai: aiInfoSchema.optional(),
}).strict()

const fillImageSchema = z.object({
  assetId: z.uuid(),
  aspect: finite.positive().max(100_000),
  fit: z.enum(['cover', 'contain', 'stretch']).optional(),
  zoom: finite.min(1).max(5).optional(),
  ox: finite.min(-1).max(1).optional(),
  oy: finite.min(-1).max(1).optional(),
  rot: finite.min(-180).max(180).optional(),
  opacity: finite.min(0).max(1).optional(),
}).strict()

export const cloudProjectDocumentSchema = z.object({
  live: currentSpecSchema,
  qty: z.number().int().min(1).max(1_000_000),
  fillColor: color.nullable(),
  fillImage: fillImageSchema.nullable().optional(),
  labelStyle: z.enum(['body', 'full', 'band', 'neck']).optional(),
  neckH: finite.min(1).max(300).optional(),
  rectDepth: finite.min(1).max(300).optional(),
  shoulderH: finite.min(1).max(300).optional(),
  shoulderStyle: z.enum(['round', 'slope', 'flat']).optional(),
  labelBox: z.object({
    y: finite.min(0).max(2000).optional(),
    h: finite.min(0).max(2000).optional(),
    w: finite.min(0).max(2000).optional(),
    rot: finite.min(-180).max(180).optional(),
  }).strict().optional(),
  capStyle: z.enum(['none', 'screw', 'flip', 'pump', 'cork', 'foil', 'crown', 'oval']).optional(),
  capColor: color.optional(),
  pouchStyle: z.enum(['stand', 'kseal', 'flat', 'gusset', 'box', 'pillow', 'spout']).optional(),
  zipper: z.boolean().optional(),
  pouchAddons: z.object({
    hangHole: optionalTrue,
    valve: optionalTrue,
    tinTie: optionalTrue,
    zipAt: finite.min(0).max(1000).optional(),
    tearAt: finite.min(0).max(1000).optional(),
    spoutAt: z.enum(['left', 'right']).optional(),
  }).strict().optional(),
  stickerCut: z.object({
    shape: z.enum(['rect', 'square', 'ellipse', 'hexagon', 'star', 'heart', 'contour']),
    border: z.enum(['white', 'none']),
    offset: finite.min(0).max(50),
    sheet: z.enum(['a6', 'a5', 'a4', 'a3', 'custom']).optional(),
    perSheet: z.number().int().min(1).max(1000).optional(),
    sheetW: finite.min(0).max(5000).optional(),
    sheetH: finite.min(0).max(5000).optional(),
    sheetMargin: finite.min(0).max(100).optional(),
    sheetGap: finite.min(0).max(100).optional(),
  }).strict().optional(),
  decos: z.array(decoSchema).max(500),
  history: z.array(historySchema).max(30),
  histIdx: z.number().int().min(-1).max(29),
}).strict().superRefine((document, context) => {
  const pathPoints = document.decos.reduce(
    (total, deco) => total + (deco.type === 'path' ? deco.anchors.length : 0),
    0,
  )
  if (pathPoints > 20_000) {
    context.addIssue({ code: 'custom', path: ['decos'], message: 'path points รวมต้องไม่เกิน 20,000' })
  }
  if (document.histIdx >= document.history.length || (document.history.length === 0 && document.histIdx !== -1)) {
    context.addIssue({ code: 'custom', path: ['histIdx'], message: 'histIdx อยู่นอกช่วง history' })
  }
})

export const createProjectInputSchema = z.object({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  documentSchemaVersion: z.literal(1),
  document: cloudProjectDocumentSchema,
}).strict()

export const legacyImportInputSchema = z.object({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
  sourceInstallationId: z.uuid(),
  sourceProjectKey: z.string().min(1).max(200),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().trim().min(1).max(60),
  documentSchemaVersion: z.literal(1),
  document: cloudProjectDocumentSchema,
}).strict()

export const saveProjectInputSchema = z.object({
  operationId: z.uuid(),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1).max(60),
  documentSchemaVersion: z.literal(1),
  document: cloudProjectDocumentSchema,
}).strict()

export const projectListQuerySchema = z.object({
  workspaceId: z.uuid(),
  cursor: z.string().max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

export const projectIdSchema = z.uuid()
export const operationIdSchema = z.uuid()
export const expectedRevisionSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const safeRevisionSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^\d+$/).transform((value, context) => {
    const revision = Number(value)
    if (!Number.isSafeInteger(revision) || revision < 1) {
      context.addIssue({ code: 'custom', message: 'revision exceeds JSON safe integer range' })
      return z.NEVER
    }
    return revision
  }),
])

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp')
const readyAssetMetadataSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  purpose: z.enum(['project-decoration', 'project-fill']),
  state: z.literal('ready'),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  byteSize: safeRevisionSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: safeRevisionSchema,
  height: safeRevisionSchema,
  createdAt: timestampSchema,
}).strict()

export const cloudProjectSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string().min(1).max(60),
  documentSchemaVersion: z.literal(1),
  document: cloudProjectDocumentSchema,
  revision: safeRevisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  assets: z.array(readyAssetMetadataSchema).max(500),
}).strict()

export const saveReceiptSchema = z.object({
  projectId: z.uuid(),
  revision: safeRevisionSchema,
  updatedAt: timestampSchema,
  operationId: z.uuid(),
}).strict()

export const deleteReceiptSchema = z.object({
  projectId: z.uuid(),
  revision: safeRevisionSchema,
  deletedAt: timestampSchema,
  operationId: z.uuid(),
}).strict()

export const legacyImportReceiptSchema = z.object({
  sourceInstallationId: z.uuid(),
  sourceProjectKey: z.string().min(1).max(200),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  project: cloudProjectSchema,
  completedAt: timestampSchema,
}).strict()

export const projectListRowSchema = z.object({
  project_id: z.uuid(),
  workspace_id: z.uuid(),
  project_name: z.string().min(1).max(60),
  project_revision: safeRevisionSchema,
  project_updated_at: timestampSchema,
}).strict()

// --- ภาพย่อ 3D ของงาน (แกลเลอรี) ---
// รูปเล็กที่ client ถ่ายจากโมเดล 3D — ตรวจขนาดและ magic bytes ตรงกับชนิดที่ประกาศ (แสดงผ่าน <img> เท่านั้น ไม่ไหลเข้าไฟล์ผลิต)
const thumbnailMagic: Record<ThumbnailMime, (bytes: Buffer) => boolean> = {
  'image/webp': (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
}

export const putProjectThumbnailInputSchema = z.object({
  mimeType: z.enum(THUMBNAIL_MIME_TYPES),
  imageBase64: z.string().min(4).max(Math.ceil(THUMBNAIL_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  kind: z.enum(THUMBNAIL_KINDS),
  label: z.string().trim().min(1).max(60),
}).strict().superRefine((input, context) => {
  const bytes = Buffer.from(input.imageBase64, 'base64')
  if (bytes.length < 1 || bytes.length > THUMBNAIL_MAX_BYTES) {
    context.addIssue({ code: 'custom', path: ['imageBase64'], message: `ภาพย่อต้องไม่เกิน ${THUMBNAIL_MAX_BYTES} ไบต์` })
  } else if (!thumbnailMagic[input.mimeType](bytes)) {
    context.addIssue({ code: 'custom', path: ['imageBase64'], message: 'ไฟล์ภาพย่อไม่ตรงกับชนิดที่ระบุ' })
  }
})

export const projectThumbnailBatchSchema = z.object({
  workspaceId: z.uuid(),
  projectIds: z.array(z.uuid()).min(1).max(THUMBNAIL_BATCH_MAX)
    .refine((ids) => new Set(ids).size === ids.length, 'projectIds ต้องไม่ซ้ำ'),
}).strict()

export const projectThumbnailReceiptSchema = z.object({
  projectId: z.uuid(),
  version: timestampSchema,
}).strict()

export const projectThumbnailMetaRowSchema = z.object({
  project_id: z.uuid(),
  thumbnail_version: timestampSchema,
  kind: z.enum(THUMBNAIL_KINDS),
  label: z.string().min(1).max(60),
}).strict()

export const projectThumbnailImageRowSchema = z.object({
  project_id: z.uuid(),
  thumbnail_version: timestampSchema,
  mime_type: z.enum(THUMBNAIL_MIME_TYPES),
  image_base64: z.string().min(1),
}).strict()
