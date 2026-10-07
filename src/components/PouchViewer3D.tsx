import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useArtTexture } from './useArtTexture'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { safeCanvasEvents } from './safeCanvasEvents'
import type { Material } from '../core/types'
import {
  type Pouch,
  brickAt,
  brickRows,
  brickShape,
  pouchDepthFactor,
  pouchWidthFactor,
  pouchSection,
  valveR,
  VALVE_V,
  TINTIE_INSET,
} from '../core/pouch'
import { drawDeco2D, fillImageRect, type Deco, type FillImage } from '../core/artwork'
import { DimBadge3D, type Dim3D } from './DimBadge3D'
import { SceneLighting, type LightMode } from './SceneLighting'

const POUCH_PRINT_BACKGROUND = '#ffffff'

export function getPouchSealColor(
  pouch: Pouch,
  mat: Material,
  fillColor: string | null | undefined,
  hasTexture: boolean,
) {
  // The folded brick base belongs to the same printed film as the body.
  return pouch.style === 'gusset' && hasTexture ? fillColor || POUCH_PRINT_BACKGROUND : mat.color
}

// จุดบนหน้าตัดทรงกล่องที่ตำแหน่งรอบรูป fX ของแผ่นฟิล์ม [หน้า W | จีบขวา g | หลัง W | จีบซ้าย g]
// a = ครึ่งกว้าง, b = ครึ่งลึก, d = รอยจีบกลางพับเข้า → คืน [x, z] (หน้าอยู่ +z)
function boxSectionPt(fX: number, W: number, g: number, a: number, b: number, d: number): [number, number] {
  if (fX <= W) return [-a + 2 * a * (fX / W), b] // หน้า: ซ้าย→ขวา
  if (fX <= W + g) {
    const t = (fX - W) / g // จีบขวา: หน้า→หลัง พับกลางเข้า
    return [a - d * (1 - Math.abs(1 - 2 * t)), b * (1 - 2 * t)]
  }
  if (fX <= 2 * W + g) return [a - 2 * a * ((fX - (W + g)) / W), -b] // หลัง: ขวา→ซ้าย
  const t = (fX - (2 * W + g)) / g // จีบซ้าย: หลัง→หน้า พับกลางเข้า
  return [-a + d * (1 - Math.abs(1 - 2 * t)), -b + 2 * b * t]
}

// พรีวิวถุงฟิล์มตั้งได้ (doypack): พื้นผิว loft หน้าตัดวงรีเปลี่ยนตามความสูง
// ก้นแบนตั้งได้ พุงกลางป่อง ปากบนซีลแบน — ลาย (หน้า/หลัง) map ลงผิวถุงตรงกับ dieline
// texture วาดจาก dieline ฟิล์มทั้งแผ่น แล้วใช้ UV ของ frontRect/backRect เลือกเฉพาะพื้นที่พิมพ์

function usePouchTexture(
  pouch: Pouch,
  decos: Deco[],
  fillColor: string | null | undefined,
  fillImage: FillImage | null | undefined,
) {
  const { width, height } = pouch.label
  return useArtTexture({
    sheetW: width,
    sheetH: height,
    decos,
    fillImage,
    enabled: true,
    deps: [fillColor, fillImage],
    configure: (t) => {
      t.flipY = false // UV คำนวณเป็นพิกัดแผ่นคลี่ตรง ๆ (y ลง) จึงไม่ต้องพลิก
    },
    draw: (ctx, s, imgOf) => {
      ctx.fillStyle = fillColor || POUCH_PRINT_BACKGROUND
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      // รูปพื้น (ถ้ามี) คลุมทั้งแผ่น (สี่เหลี่ยมเดียว ไม่ต้อง clip แผง) แล้วลายทับ
      const fimg = fillImage ? imgOf(fillImage.src) : undefined
      if (fillImage && fimg) {
        const r = fillImageRect({ x0: 0, y0: 0, x1: width, y1: height }, fillImage)
        ctx.save()
        if (fillImage.opacity !== undefined && fillImage.opacity < 1) ctx.globalAlpha = fillImage.opacity
        if (fillImage.rot) {
          const cx = (width / 2) * s
          const cy = (height / 2) * s
          ctx.translate(cx, cy)
          ctx.rotate((fillImage.rot * Math.PI) / 180)
          ctx.translate(-cx, -cy)
        }
        ctx.drawImage(fimg, r.x * s, r.y * s, r.w * s, r.h * s)
        ctx.restore()
      }
      for (const e of decos) drawDeco2D(ctx, e, s, imgOf)
    },
  })
}

// สร้าง BufferGeometry ถุง: วงแหวนวงรีตามความสูง + ฝาก้น/ปาก + UV แม็พหน้า/หลังตาม dieline
export function buildPouchGeometry(pouch: Pouch) {
    const { W, H, depth3D, style, frontRect, backRect, backSeam, label } = pouch
    const NU = 64 // รอบวง
    const NV = 48 // ตามความสูง
    const dw = label.width
    const dh = label.height
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []

    const boxy = style === 'gusset' || style === 'box'
    const gussetW = backRect.x - W // ความกว้างจีบข้าง (0 เมื่อไม่มี)
    // ครึ่งความหนาตะเข็บซีลขั้นต่ำ (ปาก/ก้นบีบแบนเหลือเท่านี้) + ระยะพับจีบกลางผนังข้าง (ลึกเข้า)
    const halfSeal = Math.max(1, depth3D * 0.12)
    const gInMax = Math.min((W / 2) * 0.14, depth3D * 0.28) // รอยพับจีบกลาง (ตื้น ไม่บีบลำตัวเข้ามาก)

    // ───────── brick/box: ลำตัว + ครีบซีลปาก เป็น loft เดียว ลายต่อเนื่อง ─────────
    // ครีบยื่นเหนือลำตัว แต่เป็นเนื้อเดียวกัน (material 0 มีลาย) ไม่ใช่ชิ้นแยก
    // UV ครีบแม็พไปที่ "แถบซีลบน" ของ dieline (y∈[0,st]) → ตกแต่งส่วนบนได้
    if (boxy) {
      const st = frontRect.y // ความสูงแถบซีลบนบน dieline
      const g = gussetW
      const wp = 2 * W + 2 * g
      // แถวตามความสูง: y, ครึ่งกว้าง a, ครึ่งลึก b, รอยจีบพับเข้า d, พิกัด dieline แนวตั้ง dly
      let rows: { y: number; a: number; b: number; d: number; dly: number }[]
      // ตำแหน่งรอบรูปบนแผ่นฟิล์ม (fX) ของแต่ละคอลัมน์
      let us: number[]
      if (style === 'gusset') {
        // brick แบบถุงกาแฟ: ลำตัวก้นแบน → ไหล่ (จีบพับเข้าเป็นสามเหลี่ยม) → ครีบซีลตั้งตรงเต็มหน้า
        const s = brickShape(pouch)
        rows = brickRows(s, st).map((r) => ({ ...r, a: s.a }))
        // คอลัมน์ลงตรงสันพับ/รอยจีบพอดี → ขอบแท่งคม ไม่ถูกตัดมุมระหว่างจุด
        us = []
        const seg = (x0: number, x1: number, n: number) => {
          for (let i = us.length ? 1 : 0; i <= n; i++) us.push(x0 + ((x1 - x0) * i) / n)
        }
        seg(0, W, 16)
        seg(W, W + g / 2, 6)
        seg(W + g / 2, W + g, 6)
        seg(W + g, 2 * W + g, 16)
        seg(2 * W + g, 2 * W + 1.5 * g, 6)
        seg(2 * W + 1.5 * g, wp, 6)
      } else {
        // box: ลำตัวแบนเต็มทั้งความสูง ก้นแบนตั้ง — การบีบซีลเกิดเฉพาะในส่วนครีบ
        const lerp = (p: number, q: number, t: number) => p + (q - p) * Math.max(0, Math.min(1, t))
        const finH = Math.min(H * 0.13, 18) // ความยาวครีบที่ยื่นออก
        const finHalf = Math.max(0.35, depth3D * 0.025) // ครึ่งความหนาครีบ = ฟิล์มบางมาก (~0.7 มม.)
        const NV = 72
        rows = []
        for (let iv = 0; iv <= NV; iv++) {
          const y = (iv / NV) * (H + finH)
          const f = (y - H) / finH // ครีบบน: ลู่จากลำตัวเต็ม→บาง, แคบลงที่ปลาย
          const b = y >= H ? lerp(depth3D, finHalf, f) : depth3D
          rows.push({
            y,
            a: (W / 2) * (y >= H ? lerp(1, 0.8, f) : 1),
            b,
            d: gInMax * (b / depth3D), // รอยพับจีบลำตัว (ลึกเข้าเล็กน้อย) จางลงที่ครีบ
            // UV แนวตั้ง: ลำตัว→แผงหน้า [st..st+H], ครีบ→แถบซีลบน [0..st]
            dly: y >= H ? st * (1 - Math.min(1, f)) : st + (1 - y / H) * H,
          })
        }
        us = Array.from({ length: NU + 1 }, (_, iu) => (iu / NU) * wp)
      }
      const cols = us.length
      for (const r of rows) {
        for (const fX of us) {
          const [x, z] = boxSectionPt(fX, W, g, r.a, r.b, r.d)
          pos.push(x, r.y, z)
          uv.push(fX / dw, r.dly / dh)
        }
      }
      for (let iv = 0; iv < rows.length - 1; iv++) {
        for (let iu = 0; iu < cols - 1; iu++) {
          const p = iv * cols + iu
          idx.push(p, p + cols, p + 1, p + 1, p + cols, p + cols + 1)
        }
      }
      const baseIndices: number[] = []
      let bottomSeal: { end: number; y: number; z: number } | null = null
      if (style === 'gusset') {
        const s = brickShape(pouch)
        const sealLength = dh - st - H
        const rootZ = Math.min(sealLength * 0.35, s.b0 * 0.35)
        const rootY = -2 * s.finHalf
        const gussetPanel = (fX: number) => (fX > W && fX < W + g) || (fX > 2 * W + g && fX < wp)
        const nBase = 8
        let previous = 0
        // Fold the existing body ring into the seal root; do not cap or duplicate that joint.
        for (let i = 1; i <= nBase; i++) {
          const t = i / nBase
          const b = s.b0 + (s.finHalf - s.b0) * t
          const d = s.creaseIn * (1 - t)
          const start = pos.length / 3
          for (const fX of us) {
            const [x, z] = boxSectionPt(fX, W, g, s.a, b, d)
            const side = z / b
            let foldedZ = side * s.b0 * (1 - t) + rootZ * t
            if (gussetPanel(fX)) {
              // Tuck the gusset above the rear base sheet, not through it.
              const rearSheetZ = -s.b0 + (rootZ + s.b0) * t * (2 + side)
              foldedZ = Math.max(foldedZ, Math.min(rootZ, rearSheetZ))
            }
            pos.push(x, rootY * t - side * s.finHalf * t,
              foldedZ)
            uv.push(fX / dw, (st + H) / dh)
          }
          for (let iu = 0; iu < cols - 1; iu++) {
            baseIndices.push(previous + iu, previous + iu + 1, start + iu,
              previous + iu + 1, start + iu + 1, start + iu)
          }
          previous = start
        }
        const nSeal = 4
        for (let i = 1; i <= nSeal; i++) {
          const length = (i / nSeal) * sealLength
          const start = pos.length / 3
          for (const fX of us) {
            const [x, z] = boxSectionPt(fX, W, g, s.a, s.finHalf, 0)
            pos.push(x, rootY - z, rootZ - length)
            uv.push(fX / dw, (st + H + length) / dh)
          }
          for (let iu = 0; iu < cols - 1; iu++) {
            idx.push(previous + iu, previous + iu + 1, start + iu,
              previous + iu + 1, start + iu + 1, start + iu)
          }
          previous = start
        }
        bottomSeal = { end: previous, y: rootY, z: rootZ - sealLength }
      }
      const sideIdxCount = idx.length
      idx.push(...baseIndices)
      // ปิดปลายครีบ/ก้น (fan) = material 1 สีพื้น (เลี่ยงลายยืดที่ปลายเรียว/ก้นแบน)
      const capRow = (rowY: number, rowBase: number, flip: boolean, rowZ = 0) => {
        const center = pos.length / 3
        pos.push(0, rowY, rowZ)
        uv.push((frontRect.x + W / 2) / dw, 0)
        for (let iu = 0; iu < cols - 1; iu++) {
          const p0 = rowBase + iu
          const p1 = rowBase + iu + 1
          if (flip) idx.push(center, p1, p0)
          else idx.push(center, p0, p1)
        }
      }
      if (!bottomSeal) capRow(rows[0].y, 0, false)
      capRow(rows[rows.length - 1].y, (rows.length - 1) * cols, true)
      if (bottomSeal) capRow(bottomSeal.y, bottomSeal.end, true, bottomSeal.z)
      const geoB = new THREE.BufferGeometry()
      geoB.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geoB.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geoB.setIndex(idx)
      geoB.addGroup(0, sideIdxCount, 0)
      geoB.addGroup(sideIdxCount, idx.length - sideIdxCount, 1)
      geoB.computeVertexNormals()
      return geoB
    }

    const ringVert = (v: number, theta: number, dly: number) => {
      // brick/box: ลำตัวทรงอิฐ (หน้า-หลังแบน) + ปากบน(และก้น brick) บีบเป็น "ตะเข็บซีลแบน (fin)"
      // ความลึกยุบตาม pouchDepthFactor → ได้ครีบซีล; กว้างคอดเล็กน้อยที่ปลายซีลตาม pouchWidthFactor
      const a = (W / 2) * pouchWidthFactor(v, style)
      const b = boxy
        ? Math.max(depth3D * pouchDepthFactor(v, style), halfSeal)
        : depth3D * pouchDepthFactor(v, style)
      const y = v * H
      let x: number
      let z: number
      let dlx: number

      if (boxy) {
        // หน้าตัดทรงกล่อง (brick): เดินตามเส้นรอบรูปสี่เหลี่ยม แม็พ filmX = ตำแหน่งรอบรูปตรง ๆ
        // ครอบทุกแผงต่อเนื่อง [หน้า | จีบขวา | หลัง | จีบซ้าย]; จีบข้างมีรอยพับกลางเข้า (gusset crease)
        // ระยะพับจางลงตามความลึก (ที่ตะเข็บซีลยุบแบน → ขอบครีบตรง ไม่มีรอยหยัก)
        const g = gussetW
        const wp = 2 * W + 2 * g
        const fX = (theta / (2 * Math.PI)) * wp
        const cr = gInMax * pouchDepthFactor(v, style)
        if (fX <= W) {
          x = -a + 2 * a * (fX / W) // หน้า: ซ้าย(-a)→ขวา(+a)
          z = b
        } else if (fX <= W + g) {
          const t = (fX - W) / g // จีบขวา: หน้า(+b)→หลัง(-b) พับกลางเข้า
          z = b * (1 - 2 * t)
          x = a - cr * (1 - Math.abs(1 - 2 * t))
        } else if (fX <= 2 * W + g) {
          x = a - 2 * a * ((fX - (W + g)) / W) // หลัง: ขวา(+a)→ซ้าย(-a)
          z = -b
        } else {
          const t = (fX - (2 * W + g)) / g // จีบซ้าย: หลัง(-b)→หน้า(+b) พับกลางเข้า
          z = -b + 2 * b * t
          x = -a + cr * (1 - Math.abs(1 - 2 * t))
        }
        dlx = fX // แผ่นฟิล์มเรียงแผงต่อเนื่อง [0..wp] อยู่แล้ว
      } else {
        const sec = pouchSection(theta, style)
        x = a * sec.cx
        z = b * sec.cz
        // UV: front (θ∈[0,π]) แม็พ frontRect ขวา→ซ้าย (ให้อ่านไม่กลับด้านเมื่อมองจาก +Z)
        if (backSeam) {
          // หน้าอยู่กลางฟิล์ม (fx..fx+W), สันพับสองข้างที่ θ=0/π, รอยต่อกาวไปรวมกลางหลัง (θ=3π/2)
          const fx = frontRect.x
          if (theta <= Math.PI) {
            dlx = fx + W * (1 - theta / Math.PI) // หน้า: ขวา(3W/2)→กลาง(W)→ซ้าย(W/2)
          } else if (theta <= 1.5 * Math.PI) {
            dlx = fx * (1 - (theta - Math.PI) / (Math.PI / 2)) // หลังซ้าย: สันพับซ้าย(W/2)→รอยต่อ(0)
          } else {
            dlx = 2 * W - (W / 2) * ((theta - 1.5 * Math.PI) / (Math.PI / 2)) // หลังขวา: รอยต่อ(2W)→สันพับขวา(3W/2)
          }
        } else {
          // ซองแบน: หน้า|หลัง ต่อเนื่องที่รอยพับข้าง (x=W) และรอยกาว (x=0/2W) — รอยต่ออยู่ข้าง
          if (theta <= Math.PI) dlx = frontRect.x + W * (1 - theta / Math.PI)
          else dlx = backRect.x + W * (1 - (theta - Math.PI) / Math.PI)
        }
      }
      pos.push(x, y, z)
      uv.push(dlx / dw, dly / dh)
    }

    // UV แนวตั้งตามความยาวส่วนโค้ง (arc length) ของโปรไฟล์หน้า (y, z=ลึก) แทนเชิงเส้น
    // → ลายกระจายตามผิวจริง ไม่ยืดตรงก้น/ปากที่ผนังคอด/พับ (pillow/flat/stand)
    const bOf = (v: number) =>
      boxy ? Math.max(depth3D * pouchDepthFactor(v, style), halfSeal) : depth3D * pouchDepthFactor(v, style)
    const cum: number[] = [0]
    let py = 0
    let pz = bOf(0)
    for (let iv = 1; iv <= NV; iv++) {
      const v = iv / NV
      const yy = v * H
      const zz = bOf(v)
      cum[iv] = cum[iv - 1] + Math.hypot(yy - py, zz - pz)
      py = yy
      pz = zz
    }
    const total = cum[NV] || 1
    const dlyOf = cum.map((c) => frontRect.y + (1 - c / total) * H)

    // กริดผิวข้าง (NV+1 แถว × NU+1 คอลัมน์ ให้มี seam ซ้ำจุดสำหรับ UV)
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV
      for (let iu = 0; iu <= NU; iu++) ringVert(v, (iu / NU) * Math.PI * 2, dlyOf[iv])
    }
    const cols = NU + 1
    for (let iv = 0; iv < NV; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        const a = iv * cols + iu
        const b = a + 1
        const c = a + cols
        const d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }

    const sideIdxCount = idx.length // ดัชนีของผิวข้าง (มีลาย) จบตรงนี้ — ฝาอยู่กลุ่มถัดไป (สีวัสดุล้วน)

    // ฝาก้น (v=0) พัดไปจุดกลาง และฝาปาก (v=1) พัดไปจุดกลาง — ปิดผิวให้ทึบ/ตั้งได้
    // UV ฝาชี้จุดเดียว (ไม่มีผล เพราะฝาใช้ material สีวัสดุล้วน) — เลี่ยงลายยืด/สเมียร์ที่ก้น-ปาก
    const cap = (v: number, flip: boolean) => {
      const center = pos.length / 3
      pos.push(0, v * H, 0)
      uv.push((frontRect.x + W / 2) / dw, (frontRect.y + (1 - v) * H) / dh)
      const base = v === 0 ? 0 : NV * cols
      for (let iu = 0; iu < NU; iu++) {
        const p0 = base + iu
        const p1 = base + iu + 1
        if (flip) idx.push(center, p1, p0)
        else idx.push(center, p0, p1)
      }
    }
    cap(0, false) // ก้น (มองจากล่าง)
    cap(1, true) // ปาก

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    // แยกกลุ่ม: ผิวข้าง = material 0 (พิมพ์ลาย), ฝาก้น/ปาก = material 1 (สีวัสดุล้วน/ซีล)
    geo.addGroup(0, sideIdxCount, 0)
    geo.addGroup(sideIdxCount, idx.length - sideIdxCount, 1)
    geo.computeVertexNormals()
    return geo
}

function usePouchGeometry(pouch: Pouch) {
  return useMemo(() => buildPouchGeometry(pouch), [pouch])
}

function PouchModel({
  pouch,
  mat,
  decos,
  fillColor,
  fillImage,
  dims,
  imperial,
  dimVariant,
}: {
  pouch: Pouch
  mat: Material
  decos: Deco[]
  fillColor: string | null | undefined
  fillImage: FillImage | null | undefined
  dims?: Dim3D[]
  imperial?: boolean
  dimVariant?: 'lines' | 'badge'
}) {
  const tex = usePouchTexture(pouch, decos, fillColor, fillImage)
  const geo = usePouchGeometry(pouch)
  useEffect(() => () => geo.dispose(), [geo])

  // three คอมไพล์ shader ตาม define ตอนสร้าง — map เปลี่ยน null → texture ต้อง needsUpdate ให้ recompile
  const matRef = useRef<THREE.MeshStandardMaterial>(null!)
  const hasTex = !!tex
  useLayoutEffect(() => {
    if (matRef.current) matRef.current.needsUpdate = true
  }, [hasTex])

  // brick: ทรงตามความยาวฟิล์ม (ไหล่เอียง) → ซิป/วาล์ว/tin-tie วางตามระยะบน dieline ผ่าน brickAt
  const brick = useMemo(() => (pouch.style === 'gusset' ? brickShape(pouch) : null), [pouch])
  const zipBand = useMemo(() => {
    if (!brick || !pouch.zipper || pouch.zipY === undefined) return null
    // แถบซิป = loft บาง ๆ ตามหน้าตัดจริง (โค้งตามไหล่) ดันออกจากผิว 0.6 มม.
    const dl0 = pouch.zipY - pouch.frontRect.y
    const g = pouch.backRect.x - pouch.W
    const wp = 2 * pouch.W + 2 * g
    const NU = 96
    const pos: number[] = []
    const idx: number[] = []
    const NR = 4
    for (let i = 0; i <= NR; i++) {
      const r = brickAt(brick, dl0 - 2.5 + (5 * i) / NR)
      for (let iu = 0; iu <= NU; iu++) {
        const [x, z] = boxSectionPt((iu / NU) * wp, pouch.W, g, brick.a + 0.6, r.b + 0.6, r.d)
        pos.push(x, r.y, z)
      }
    }
    for (let i = 0; i < NR; i++) {
      for (let iu = 0; iu < NU; iu++) {
        const p = i * (NU + 1) + iu
        idx.push(p, p + NU + 1, p + 1, p + 1, p + NU + 1, p + NU + 2)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
  }, [brick, pouch])
  useEffect(() => () => zipBand?.dispose(), [zipBand])

  // แถบซิปล็อก: วงรีบาง ๆ พาดรอบใกล้ปาก ที่ระดับความสูงเดียวกับแนวซิปบน dieline
  let zip: { y: number; ax: number; bz: number } | null = null
  if (!brick && pouch.zipper && pouch.zipY !== undefined) {
    const vzip = Math.min(0.98, Math.max(0.02, 1 - (pouch.zipY - pouch.frontRect.y) / pouch.H))
    zip = {
      y: vzip * pouch.H,
      ax: (pouch.W / 2) * pouchWidthFactor(vzip, pouch.style) * 1.03,
      bz: pouch.depth3D * pouchDepthFactor(vzip, pouch.style) * 1.03,
    }
  }

  // จุก + ฝาเกลียว ที่ปากบน (spout pouch)
  const spoutR = Math.min(pouch.W, 90) * 0.09
  const neckH = pouch.H * 0.08
  const capH = neckH * 0.6

  // วาล์วกาแฟ: จานกลมนูนบนหน้าถุงส่วนบน (z = ผิวหน้าที่ระดับ VALVE_V)
  const valveZ = pouch.depth3D * pouchDepthFactor(VALVE_V, pouch.style)
  const vR = valveR(pouch.W)
  // ที่รัดปาก: แถบบางพาดขวางหน้าใกล้ปาก
  const ttV = Math.min(0.97, Math.max(0.03, 1 - (TINTIE_INSET + 3) / pouch.H))
  const ttZ = pouch.depth3D * pouchDepthFactor(ttV, pouch.style)
  const ttW = pouch.W * pouchWidthFactor(ttV, pouch.style) * 0.9
  // brick: จุดบนหน้า (y, ผิว z, มุมเอียงไหล่) ที่ระยะบน dieline เดียวกับ marker
  const bValve = brick ? brickAt(brick, (1 - VALVE_V) * pouch.H) : null
  const bTie = brick ? brickAt(brick, TINTIE_INSET + 3) : null

  const modelRef = useRef<THREE.Group>(null)

  return (
    <>
    <group ref={modelRef} position={[0, -(brick ? brick.topY : pouch.H) / 2, 0]}>
      <mesh geometry={geo}>
        {/* material 0 = ผิวข้าง (พิมพ์ลาย) */}
        <meshStandardMaterial
          attach="material-0"
          ref={matRef}
          map={tex}
          color={tex ? '#ffffff' : mat.color}
          roughness={mat.roughness ?? 0.6}
          metalness={mat.metalness ?? 0}
          transparent={mat.opacity !== undefined}
          opacity={mat.opacity ?? 1}
          side={THREE.DoubleSide}
        />
        {/* Neutral base/caps: match the brick's print background without stretching artwork. */}
        <meshStandardMaterial
          attach="material-1"
          color={getPouchSealColor(pouch, mat, fillColor, hasTex)}
          roughness={mat.roughness ?? 0.6}
          metalness={mat.metalness ?? 0}
          transparent={mat.opacity !== undefined}
          opacity={mat.opacity ?? 1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {zip && (
        <mesh position={[0, zip.y, 0]} scale={[zip.ax, 1, zip.bz]}>
          <cylinderGeometry args={[1, 1, 5, 48, 1, true]} />
          <meshStandardMaterial color="#6f685c" roughness={0.5} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}
      {zipBand && (
        <mesh geometry={zipBand}>
          <meshStandardMaterial color="#6f685c" roughness={0.5} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}
      {pouch.spout && (
        <group position={[0, pouch.H, 0]}>
          {/* คอจุก */}
          <mesh position={[0, neckH / 2, 0]}>
            <cylinderGeometry args={[spoutR, spoutR, neckH, 24]} />
            <meshStandardMaterial color="#d6cfbf" roughness={0.45} metalness={0} />
          </mesh>
          {/* ฝาเกลียว */}
          <mesh position={[0, neckH + capH / 2, 0]}>
            <cylinderGeometry args={[spoutR * 1.4, spoutR * 1.4, capH, 24]} />
            <meshStandardMaterial color="#b7ae99" roughness={0.5} metalness={0} />
          </mesh>
        </group>
      )}
      {pouch.valve && (
        // วาล์วกาแฟ: จานกลมนูนออกจากผิวหน้า (แกนตามแนวตั้งฉากผิว — บนไหล่ brick เอียงตาม)
        <mesh
          position={
            bValve
              ? [0, bValve.y + Math.sin(bValve.tilt), bValve.b + Math.cos(bValve.tilt)]
              : [0, VALVE_V * pouch.H, valveZ + 1]
          }
          rotation={[Math.PI / 2 - (bValve?.tilt ?? 0), 0, 0]}
        >
          <cylinderGeometry args={[vR, vR, 3, 24]} />
          <meshStandardMaterial color="#2f2c28" roughness={0.5} metalness={0.1} />
        </mesh>
      )}
      {pouch.tinTie && (
        // ที่รัดปาก: แถบบางพาดขวางหน้าถุงใกล้ปาก (บนไหล่ brick เอียงตามผิว)
        <mesh
          position={
            bTie
              ? [0, bTie.y + Math.sin(bTie.tilt), bTie.b + Math.cos(bTie.tilt)]
              : [0, ttV * pouch.H, ttZ + 1]
          }
          rotation={[-(bTie?.tilt ?? 0), 0, 0]}
        >
          <boxGeometry args={[bTie ? pouch.W * 0.9 : ttW, 6, 2]} />
          <meshStandardMaterial color="#a89a7a" roughness={0.6} metalness={0.2} />
        </mesh>
      )}
    </group>
    {dims && dims.length > 0 && <DimBadge3D targetRef={modelRef} dims={dims} imperial={!!imperial} variant={dimVariant} />}
    </>
  )
}

export function PouchViewer3D({
  pouch,
  mat,
  decos,
  fillColor,
  fillImage,
  dims,
  imperial,
  dimVariant,
  lightMode,
}: {
  pouch: Pouch
  mat: Material
  decos: Deco[]
  fillColor?: string | null
  fillImage?: FillImage | null
  dims?: Dim3D[]
  imperial?: boolean
  dimVariant?: 'lines' | 'badge'
  lightMode?: LightMode
}) {
  const dist = Math.max(pouch.H, pouch.W) * 2.6
  return (
    <Canvas
      events={safeCanvasEvents}
      camera={{ position: [dist * 0.35, dist * 0.25, dist], fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label="มุมมอง 3 มิติของถุงพร้อมลาย"
    >
      <color attach="background" args={['#ffffff']} />
      <SceneLighting mode={lightMode ?? 'soft'} />
      <PouchModel pouch={pouch} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} dims={dims} imperial={imperial} dimVariant={dimVariant} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  )
}
