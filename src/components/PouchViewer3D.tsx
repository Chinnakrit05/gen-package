import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useArtTexture } from './useArtTexture'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { FitViewerCamera } from './FitViewerCamera'
import { cameraPosition, pouchCameraFit } from './viewerCamera'
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
  doypackRows,
  doypackFold,
  doypackBaseLift,
  doypackBasePoint,
  doypackRimH,
  DOYPACK_RIM_T,
  spoutRows,
  spoutMarker,
  spoutBoatT,
  spoutCornerBulge,
  doypackAt,
  doypackZ,
  sectionZ,
  type DoypackRow,
  DOYPACK_FIN,
  POUCH_FIN_SEAL,
  pillowRows,
  FLAT_SEAL,
  flatZ,
  flatAt,
  TINTIE_INSET,
} from '../core/pouch'
import { drawDecoPreview, fillImageRect, type Deco, type FillImage } from '../core/artwork'
import { useFinishMaps, finishMaterialProps } from './useFinishMaps'
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
  // ช่วงที่หน้า-หลังประกบ (b บาง): จีบที่พับแบนอยู่ข้างในห่างผิวหน้าแค่เศษมม. → z-fighting เป็นรอยหยักที่ขอบ
  // จึงบีบจีบเข้าแกนกลางเร็วขึ้น (ยังต่อกับขอบพับที่ t=0/1 พอดี); ช่วงผนังเปิด และซีลก้นที่จีบไม่พับเข้า (d=0) คงรูปเดิม
  const gz = (t: number) => {
    const u = 1 - 2 * t
    return b < 1.5 && d > 1 ? Math.sign(u) * Math.abs(u) ** 24 : u
  }
  if (fX <= W) return [-a + 2 * a * (fX / W), b] // หน้า: ซ้าย→ขวา
  if (fX <= W + g) {
    const t = (fX - W) / g // จีบขวา: หน้า→หลัง พับกลางเข้า
    return [a - d * (1 - Math.abs(1 - 2 * t)), b * gz(t)]
  }
  if (fX <= 2 * W + g) return [a - 2 * a * ((fX - (W + g)) / W), -b] // หลัง: ขวา→ซ้าย
  const t = (fX - (2 * W + g)) / g // จีบซ้าย: หลัง→หน้า พับกลางเข้า
  return [-a + d * (1 - Math.abs(1 - 2 * t)), -b * gz(t)]
}

// พรีวิวถุงฟิล์มตั้งได้ (doypack): พื้นผิว loft หน้าตัดวงรีเปลี่ยนตามความสูง
// ก้นแบนตั้งได้ พุงกลางป่อง ปากบนซีลแบน — ลาย (หน้า/หลัง) map ลงผิวถุงตรงกับ dieline
// texture วาดจาก dieline ฟิล์มทั้งแผ่น แล้วใช้ UV ของ frontRect/backRect เลือกเฉพาะพื้นที่พิมพ์

// โปรไฟล์ซิปล็อกที่ปั๊มนูนบนฟิล์ม (ตามภาพถุงจริง): แถบนูนต่ำกว้าง ~5 มม. ขอบนุ่ม + สันคู่ (ร่องลิ้นซิป) ใกล้สองขอบแถบ
// ค่า 0..1 ตามระยะจากแนวซิป (มม.) — ใช้วาดแผนที่ bump ข้ามแผ่นทั้งแผ่นที่ระดับแนวซิป
export const ZIP_RELIEF_HALF = 3
export function zipReliefProfile(dy: number): number {
  const a = Math.abs(dy)
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
  }
  const plateau = 0.4 * (1 - smooth(1.9, 2.9, a))
  const ridge = 0.5 * Math.exp(-(((a - 1.3) / 0.75) ** 2))
  return Math.min(1, plateau + ridge)
}
// วาล์วกาแฟ = รอยนูนบนฟิล์มเอง (แบบถุงกาแฟจริง/ภาพอ้างอิง: ฝาวาล์วใต้ฟิล์มดันให้นูน) ไม่ใช่จานสีแยก → สี/ลายตามถุง
// ρ = ระยะจากศูนย์กลาง ÷ รัศมีวาล์ว, (u, v) = พิกัดสัมพัทธ์ (÷ รัศมี): ขอบวงแหวนนูนบาง + ร่องตื้นด้านใน +
// แผ่นกลางนูนโค้งเล็กน้อย + ปุ่ม 4 จุดเรียงกากบาท (รูระบายแก๊ส) — คืน 0..1 (0 = ผิวเรียบ)
export function valveReliefProfile(u: number, v: number): number {
  const rho = Math.hypot(u, v)
  if (rho > 1.1) return 0
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
  }
  const ring = 0.75 * Math.exp(-(((rho - 0.9) / 0.07) ** 2))
  const disc = (0.32 + 0.12 * (1 - rho * rho)) * (1 - smooth(0.66, 0.76, rho))
  let dots = 0
  for (const [cx, cy] of [[0, -0.32], [0.32, 0], [0, 0.32], [-0.32, 0]] as const) {
    dots += 0.4 * Math.exp(-((Math.hypot(u - cx, v - cy) / 0.07) ** 2))
  }
  return Math.min(1, ring + disc + dots)
}
const valveRelief = (x: number, y: number, r: number) => ({
  key: `valve:${x}:${y}:${r}`,
  draw: (ctx: CanvasRenderingContext2D, s: number) => {
    const x0 = Math.floor((x - 1.1 * r) * s)
    const y0 = Math.floor((y - 1.1 * r) * s)
    const n = Math.ceil(2.2 * r * s) + 1
    const img = ctx.getImageData(x0, y0, n, n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = valveReliefProfile(((x0 + i + 0.5) / s - x) / r, ((y0 + j + 0.5) / s - y) / r)
        if (h <= 0.002) continue
        const k = (j * n + i) * 4
        const g = Math.min(255, img.data[k] + 120 * h)
        img.data[k] = img.data[k + 1] = img.data[k + 2] = g
      }
    }
    ctx.putImageData(img, x0, y0)
  },
})
// รวมรอยนูนของตัวถุง (ซิป + วาล์ว) เป็น relief เดียวของ useFinishMaps
const pouchRelief = (pouch: Pouch) => {
  const parts = [
    ...(pouch.zipper && pouch.zipY !== undefined ? [zipRelief(pouch.zipY)] : []),
    ...(pouch.valveAt ? [valveRelief(pouch.valveAt.x, pouch.valveAt.y, pouch.valveAt.r)] : []),
  ]
  if (!parts.length) return null
  return {
    key: parts.map((p) => p.key).join('|'),
    draw: (ctx: CanvasRenderingContext2D, s: number, w: number) => parts.forEach((p) => p.draw(ctx, s, w)),
  }
}
const zipRelief = (zipY: number) => ({
  key: `zip:${zipY}`,
  draw: (ctx: CanvasRenderingContext2D, s: number, w: number) => {
    const y0 = Math.floor((zipY - ZIP_RELIEF_HALF) * s)
    const y1 = Math.ceil((zipY + ZIP_RELIEF_HALF) * s)
    for (let py = y0; py <= y1; py++) {
      const v = Math.round(128 + 120 * zipReliefProfile((py + 0.5) / s - zipY))
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(0, py, w, 1)
    }
  },
})

function usePouchTexture(
  pouch: Pouch,
  decos: Deco[],
  fillColor: string | null | undefined,
  fillImage: FillImage | null | undefined,
  watermark: string | null | undefined,
) {
  const { width, height } = pouch.label
  return useArtTexture({
    sheetW: width,
    sheetH: height,
    decos,
    fillImage,
    enabled: true,
    watermark,
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
      for (const e of decos) drawDecoPreview(ctx, e, s, imgOf)
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
        // brick แบบถุงกาแฟซิปล็อก: หน้าเต็มกว้างถึงขอบบน จีบข้างเปิดเต็มที่ก้นแล้วเรียวปิดขึ้นไปหาปาก (ข้างเป็นหัวกระสุน)
        const s = brickShape(pouch)
        // มุมมนซีลบน: หดครึ่งกว้างเฉพาะแถวในรัศมีมุม (ซีลบนสุด ~6 มม.) — ผิวเรียบไม่มีจุดซ้อน ลายบีบแค่ขอบซีล
        rows = brickRows(s, st).map((r) => ({ ...r, a: s.a - (r.cut ?? 0) }))
        // คอลัมน์ลงตรงสันพับ/รอยจีบพอดี → ขอบแท่งคม ไม่ถูกตัดมุมระหว่างจุด
        us = []
        // สันข้าง (หน้า↔จีบ, จีบ↔หลัง) = รอยพับจริง: เริ่มช่วงใหม่ด้วยจุดซ้ำ (คอลัมน์กว้างศูนย์) ให้ normal ไม่เฉลี่ยข้ามสัน
        // ไม่งั้นช่วงซีลบนที่จีบพับแบนกลับเข้าข้างใน normal ที่สันเฉลี่ยกลับทิศ เห็นเป็นเงาดำที่ขอบ
        const seg = (x0: number, x1: number, n: number, sharp = false) => {
          for (let i = us.length && !sharp ? 1 : 0; i <= n; i++) us.push(x0 + ((x1 - x0) * i) / n)
        }
        seg(0, W, 16)
        seg(W, W + g / 2, 6, true)
        seg(W + g / 2, W + g, 6)
        seg(W + g, 2 * W + g, 16, true)
        seg(2 * W + g, 2 * W + 1.5 * g, 6, true)
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
          const [x, z] = boxSectionPt(fX, W, g, r.a, r.b, Math.min(r.d, r.a))
          pos.push(x, r.y, z)
          uv.push(fX / dw, r.dly / dh)
        }
      }
      // คอลัมน์ซ้ำที่สันพับ (ตำแหน่ง fX เดียวกัน) = รอยต่อเฉย ๆ ไม่สร้างสามเหลี่ยมกว้างศูนย์ระหว่างกัน
      const seam = (iu: number) => us[iu + 1] === us[iu]
      for (let iv = 0; iv < rows.length - 1; iv++) {
        for (let iu = 0; iu < cols - 1; iu++) {
          if (seam(iu)) continue
          const p = iv * cols + iu
          idx.push(p, p + cols, p + 1, p + 1, p + cols, p + cols + 1)
        }
      }
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
            // ก้นแบน = ฟิล์มปลายล่างของแผง (baseL) พับเข้าใต้ถุง — ลายต่อเนื่องจากผนังลงไปจนถึงแนวซีลก้น
            uv.push(fX / dw, (st + H - s.baseL * (1 - t)) / dh)
          }
          for (let iu = 0; iu < cols - 1; iu++) {
            if (seam(iu)) continue
            idx.push(previous + iu, previous + iu + 1, start + iu,
              previous + iu + 1, start + iu + 1, start + iu)
          }
          previous = start
        }
        // ซีลก้นพับแนบใต้ฐานไปทางหลัง — ฐานแคบกว่าความยาวซีล (จีบข้างแคบ) ส่วนที่เกินพับขึ้นแนบผนังหลังด้านนอก
        // (เดิมยื่นเลยฐานออกไปเป็นแผ่นแบนนอกถุง)
        const flatRun = Math.max(1, Math.min(sealLength, rootZ + s.b0 - 0.8))
        const backZ = -s.b0 - 0.6
        const lengths = [...new Set([flatRun, ...[1, 2, 3, 4].map((i) => (i / 4) * sealLength)])]
          .filter((l) => l <= sealLength + 1e-9)
          .sort((p, q) => p - q)
        let sealEnd = { y: rootY, z: rootZ }
        for (const length of lengths) {
          const start = pos.length / 3
          const up = Math.max(0, length - flatRun)
          for (const fX of us) {
            const [x, z] = boxSectionPt(fX, W, g, s.a, s.finHalf, 0)
            if (up > 0) pos.push(x, rootY + up, backZ + z)
            else pos.push(x, rootY - z, rootZ - length)
            uv.push(fX / dw, (st + H + length) / dh)
          }
          sealEnd = up > 0 ? { y: rootY + up, z: backZ } : { y: rootY, z: rootZ - length }
          for (let iu = 0; iu < cols - 1; iu++) {
            if (seam(iu)) continue
            idx.push(previous + iu, previous + iu + 1, start + iu,
              previous + iu + 1, start + iu + 1, start + iu)
          }
          previous = start
        }
        bottomSeal = { end: previous, y: sealEnd.y, z: sealEnd.z }
      }
      const sideIdxCount = idx.length
      // ปิดปลายครีบ/ก้น (fan) = material 1 สีพื้น (เลี่ยงลายยืดที่ปลายเรียว/ก้นแบน)
      const capRow = (rowY: number, rowBase: number, flip: boolean, rowZ = 0) => {
        const center = pos.length / 3
        pos.push(0, rowY, rowZ)
        uv.push((frontRect.x + W / 2) / dw, 0)
        for (let iu = 0; iu < cols - 1; iu++) {
          if (seam(iu)) continue
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

    // ───────── doypack (stand/spout): แผงหน้า-หลังแยก ซีลข้าง/ซีลบนแบน + ช่วงพองหน้าตัดเลนส์ ─────────
    // แต่ละแผงแม็พทั้งแผงของ dieline (รวมแถบซีล) → ลายบนซีลก็ขึ้น; ความกว้างช่วงพองแก้ให้ความยาวโค้ง = ฟิล์มจริง
    if (style === 'stand' || style === 'kseal' || style === 'spout') {
      // จุกกลาง: ไหล่รวบเข้าหาเรือ (spoutRows); จุกมุม: ทรง doypack ปกติ + ฟิล์มนูนคลุมเรือที่มุมเฉียง
      const rows =
        style === 'spout' && !pouch.spoutCorner
          ? spoutRows(pouch)
          : doypackRows(pouch, pouch.spoutCorner ? DOYPACK_CORNER_ROWS : undefined)
      const ss = pouch.sideSeal
      const Wi = W - 2 * ss
      // จุกมุม: ตารางละเอียดขึ้นให้ฟิล์มนูนคลุมเรือโค้งเรียบ (ไม่เป็นขั้น)
      const NI = pouch.spoutCorner ? 96 : 40
      // คอลัมน์ตามพิกัดฟิล์มของแผง (0..W): ขอบ, แนวซีลข้าง, ช่วงพองแบ่งเท่าตามความยาวฟิล์ม
      const us = [0, ...Array.from({ length: NI + 1 }, (_, k) => ss + (Wi * k) / NI), W]
      const M = 160
      // x ของผิวหน้าที่พิกัดฟิล์ม u (ซ้าย→ขวาเมื่อมองจากหน้า) — ช่วงพองกลับค่าจากความยาวโค้งเลนส์
      const xsOf = (r: DoypackRow) => {
        const d = r.b - DOYPACK_FIN
        const px: number[] = []
        const cum = [0]
        for (let i = 0; i <= M; i++) {
          const x = -r.ai + (2 * r.ai * i) / M
          px.push(x)
          if (i) cum.push(cum[i - 1] + Math.hypot(x - px[i - 1], d * (sectionZ(r, x / r.ai) - sectionZ(r, px[i - 1] / r.ai))))
        }
        const L = cum[M] || 1
        const flat = r.flat ?? 0
        const inner = r.ai + flat
        let j = 0
        return us.map((u0) => {
          if (r.cut !== undefined) {
            // ถุงมีจุก: ฟิล์มแม็พ 1:1 — ขอบที่มุมมนตัดทิ้ง (u < cut), ฟิล์มแบนรอบช่วงพอง (ไหล่รวบเข้าหาเรือ)
            const u = Math.min(W - r.cut, Math.max(r.cut, u0))
            if (u <= ss) return -(inner + ss - u)
            if (u >= W - ss) return inner + (u - (W - ss))
            const sf = u - ss
            if (sf <= flat) return -inner + sf
            if (sf >= Wi - flat) return r.ai + (sf - (Wi - flat))
            const tg = ((sf - flat) / (Wi - 2 * flat)) * L
            while (j < M - 1 && cum[j + 1] < tg) j++
            const tt = cum[j + 1] > cum[j] ? Math.min(1, (tg - cum[j]) / (cum[j + 1] - cum[j])) : 0
            return px[j] + (px[j + 1] - px[j]) * tt
          }
          const u = u0
          if (u <= ss) return -r.a + u * ((r.a - r.ai) / ss)
          if (u >= W - ss) return r.ai + (u - (W - ss)) * ((r.a - r.ai) / ss)
          const target = ((u - ss) / Wi) * L
          while (j < M - 1 && cum[j + 1] < target) j++
          const t = cum[j + 1] > cum[j] ? Math.min(1, (target - cum[j]) / (cum[j + 1] - cum[j])) : 0
          return px[j] + (px[j + 1] - px[j]) * t
        })
      }
      const cols = us.length
      const xRows = rows.map(xsOf)
      // ผิว z ของแผง side ที่แถว iv คอลัมน์ k — จุกมุมดันฟิล์มนูนคลุมเรือ (uf = ระยะจากขอบด้านจุก มองจากหน้า;
      // หลังมองจากด้านหลัง → คอลัมน์กลับด้าน)
      const sc = pouch.spoutCorner
      const zAt = (side: number, iv: number, k: number) => {
        const z = doypackZ(rows[iv], xRows[iv][k])
        if (!sc) return z
        const fromLeft = side > 0 ? us[k] : W - us[k]
        const uf = sc.side === 'left' ? fromLeft : W - fromLeft
        return Math.max(z, DOYPACK_FIN + spoutCornerBulge(W, frontRect.y, sc.c, uf, rows[iv].dly))
      }
      // side +1 = หน้า (ฟิล์ม x 0..W), −1 = หลัง (ฟิล์ม x W..2W มองจากด้านหลัง → กลับซ้าย-ขวา)
      const starts: number[] = []
      for (const side of [1, -1]) {
        starts.push(pos.length / 3)
        rows.forEach((r, iv) => {
          xRows[iv].forEach((x0, k) => {
            const x = side * x0
            pos.push(x, r.y, side * zAt(side, iv, k))
            uv.push((side > 0 ? us[k] : W + us[k]) / dw, r.dly / dh)
          })
        })
        for (let iv = 0; iv < rows.length - 1; iv++) {
          for (let k = 0; k < cols - 1; k++) {
            const q = starts[starts.length - 1] + iv * cols + k
            // เส้นทแยงของสี่เหลี่ยมสะท้อนกันซ้าย-ขวา (ครึ่งซ้ายทแยงทางหนึ่ง ครึ่งขวาอีกทาง) → แสงเงาสองข้างเท่ากัน
            if (k < (cols - 1) / 2) idx.push(q, q + 1, q + cols, q + 1, q + cols + 1, q + cols)
            else idx.push(q, q + cols + 1, q + cols, q, q + 1, q + cols + 1)
          }
        }
      }
      // ถุงตั้ง/ก้น K: ฐานเลนส์พิมพ์ลายของครึ่งก้น (dieline ใต้แนวพับก้น → แนวพับกลางก้น) แผงหน้า = ครึ่งหน้า, หลัง = ครึ่งหลัง
      const baseFold = doypackFold(pouch)
      const printedBase = baseFold < dh - 1e-6
      if (printedBase) {
        const NB = 12
        const lift = doypackBaseLift(pouch.gusset)
        const rim = doypackRimH(pouch.gusset)
        // จุดแบ่งฟิล์มฐาน: แถบซีลก้น (ห้อยถึงพื้นพอดีที่ DOYPACK_RIM_T) แล้วโดม NB ช่วง
        const ts = rim > 0
          ? [0, DOYPACK_RIM_T / 2, ...Array.from({ length: NB + 1 }, (_, j) => DOYPACK_RIM_T + ((1 - DOYPACK_RIM_T) * j) / NB)]
          : Array.from({ length: NB + 1 }, (_, j) => j / NB)
        for (const side of [1, -1]) {
          const start = pos.length / 3
          for (const t of ts) {
            xRows[0].forEach((x0, k) => {
              const q = doypackBasePoint(side * x0, side * doypackZ(rows[0], x0), t, lift, rim)
              pos.push(q.x, q.y, q.z)
              uv.push((side > 0 ? us[k] : W + us[k]) / dw, (baseFold + t * (dh - baseFold)) / dh)
            })
          }
          for (let j = 0; j < ts.length - 1; j++) {
            for (let k = 0; k < cols - 1; k++) {
              const q = start + j * cols + k
              idx.push(q, q + cols, q + 1, q + 1, q + cols, q + cols + 1)
            }
          }
        }
      }
      const sideCount = idx.length
      const P = (side: number, iv: number, k: number): [number, number, number] => {
        const x0 = xRows[iv][k]
        return [side * x0, rows[iv].y, side * zAt(side, iv, k)]
      }
      // ขอบซีล (หนา 2·FIN) ข้างซ้าย/ขวา/บน — จุดแยก ไม่เกลี่ย normal กับผิวพิมพ์
      // uvU/dl0/dl1: พิกัดแผ่นคลี่ของขอบ (a,b ที่แถว dl0; c,d ที่แถว dl1) — ขอบข้างต้องโดน mask รอยบากฉีกด้วย
      // ไม่งั้นแถบขอบหนา 2·FIN ยังขวางปากรอยบากเป็นเส้นบาง; ขอบบนใช้มุมแผ่น (0,0) ที่ไม่มีรอยบาก
      const quad = (a: number[], b: number[], c: number[], d: number[], uvU = 0, dl0 = 0, dl1 = 0) => {
        const i0 = pos.length / 3
        pos.push(...a, ...b, ...c, ...d)
        uv.push(uvU / dw, dl0 / dh, uvU / dw, dl0 / dh, uvU / dw, dl1 / dh, uvU / dw, dl1 / dh)
        idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
      }
      const last = rows.length - 1
      // จุดกลางขอบข้าง (z = 0 ระหว่างฟิล์มหน้า-หลังที่ซีลประกบกัน)
      const mid = (side: number, iv: number): [number, number, number] => [side * rows[iv].a, rows[iv].y, 0]
      for (let iv = 0; iv < last; iv++) {
        // ซ้าย: หน้า col 0 → กลาง → หลัง col สุดท้าย (x=−a ทั้งคู่); ขวา: หน้า col สุดท้าย → กลาง → หลัง col 0
        const d0 = rows[iv].dly
        const d1 = rows[iv + 1].dly
        quad(P(1, iv, 0), mid(-1, iv), mid(-1, iv + 1), P(1, iv + 1, 0), 0, d0, d1)
        quad(mid(-1, iv), P(-1, iv, cols - 1), P(-1, iv + 1, cols - 1), mid(-1, iv + 1), 0, d0, d1)
        quad(P(-1, iv, 0), mid(1, iv), mid(1, iv + 1), P(-1, iv + 1, 0), W, d0, d1)
        quad(mid(1, iv), P(1, iv, cols - 1), P(1, iv + 1, cols - 1), mid(1, iv + 1), W, d0, d1)
      }
      for (let k = 0; k < cols - 1; k++) {
        // ขอบบนแม็พตามขอบบนแผ่นคลี่จริง → มุมที่ไดคัททิ้ง (จุกมุม) ถูก mask ตัดตามแผ่น
        quad(P(1, last, k), P(1, last, k + 1), P(-1, last, cols - 2 - k), P(-1, last, cols - 1 - k), (us[k] + us[k + 1]) / 2)
      }
      // ฐาน (เลนส์บนพื้น) ไม่พิมพ์ลาย (ถุงมีจุก): พัดจากกลาง ไปรอบแถวล่างหน้า (−a→+a) แล้วหลัง (+a→−a)
      if (!printedBase) {
        const center = pos.length / 3
        pos.push(0, 0, 0)
        uv.push(0, 0)
        const ring = [
          ...Array.from({ length: cols }, (_, k) => P(1, 0, k)),
          mid(1, 0),
          ...Array.from({ length: cols }, (_, k) => P(-1, 0, k)),
          mid(-1, 0),
        ]
        for (const v of ring) {
          pos.push(...v)
          uv.push(0, 0)
        }
        for (let k = 0; k < ring.length; k++) {
          const p0 = center + 1 + k
          const p1 = center + 1 + ((k + 1) % ring.length)
          idx.push(center, p1, p0)
        }
      }
      const geoD = new THREE.BufferGeometry()
      geoD.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geoD.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geoD.setIndex(idx)
      geoD.addGroup(0, sideCount, 0)
      geoD.addGroup(sideCount, idx.length - sideCount, 1)
      geoD.computeVertexNormals()
      return geoD
    }

    // ───────── ซองแบน 3 ด้าน: แผงหน้า/หลังแยก ซีลแบนรอบ 4 ด้าน ตรงกลางพองบาง (flatZ) ─────────
    if (style === 'flat') {
      const PH = label.height
      const st = frontRect.y
      const sb = PH - st - H
      const NI = 40
      const us = [0, FLAT_SEAL, ...Array.from({ length: NI - 1 }, (_, k) => FLAT_SEAL + ((W - 2 * FLAT_SEAL) * (k + 1)) / NI), W - FLAT_SEAL, W]
      const NJ = 60
      const vs = [0, st, ...Array.from({ length: NJ - 1 }, (_, k) => st + (H * (k + 1)) / NJ), PH - sb, PH]
      const cols = us.length
      const P = (side: number, j: number, k: number): [number, number, number] => [
        side * (us[k] - W / 2),
        PH - vs[j],
        side * flatZ(pouch, us[k], vs[j]),
      ]
      for (const side of [1, -1]) {
        const start = pos.length / 3
        vs.forEach((v, j) => {
          us.forEach((u, k) => {
            pos.push(...P(side, j, k))
            uv.push((side > 0 ? u : W + u) / dw, v / dh)
          })
        })
        for (let j = 0; j < vs.length - 1; j++) {
          for (let k = 0; k < cols - 1; k++) {
            const q = start + j * cols + k
            idx.push(q, q + cols, q + 1, q + 1, q + cols, q + cols + 1)
          }
        }
      }
      const sideCount = idx.length
      // ขอบซีลรอบ 4 ด้าน (หนา 2·FIN) — หน้า col k คู่กับหลัง col (cols−1−k) ที่ x เดียวกัน
      const quad = (a: number[], b: number[], c: number[], d: number[]) => {
        const i0 = pos.length / 3
        pos.push(...a, ...b, ...c, ...d)
        for (let k = 0; k < 4; k++) uv.push(0, 0)
        idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3)
      }
      const lastJ = vs.length - 1
      for (let j = 0; j < lastJ; j++) {
        quad(P(1, j, 0), P(-1, j, cols - 1), P(-1, j + 1, cols - 1), P(1, j + 1, 0))
        quad(P(1, j, cols - 1), P(-1, j, 0), P(-1, j + 1, 0), P(1, j + 1, cols - 1))
      }
      for (let k = 0; k < cols - 1; k++) {
        for (const j of [0, lastJ]) quad(P(1, j, k), P(1, j, k + 1), P(-1, j, cols - 2 - k), P(-1, j, cols - 1 - k))
      }
      const geoF = new THREE.BufferGeometry()
      geoF.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geoF.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geoF.setIndex(idx)
      geoF.addGroup(0, sideCount, 0)
      geoF.addGroup(sideCount, idx.length - sideCount, 1)
      geoF.computeVertexNormals()
      return geoF
    }

    // ───────── ซองหลังกลาง (pillow): หน้าตัดวงรีเส้นรอบรูปคงที่ + ซีลบน/ล่างแบน + ครีบซีลแนบหลัง ─────────
    if (style === 'pillow') {
      const rows = pillowRows(pouch)
      const pf = POUCH_FIN_SEAL
      const fx = frontRect.x
      const M = 360
      // จุดบนวงรีที่ระยะฟิล์ม s (0 = สันพับขวา → หน้า → สันพับซ้าย (W) → หลัง → กลางหลัง (1.5W) → สันขวา (2W))
      const ringAt = (r: DoypackRow) => {
        const th: number[] = [0]
        const cum = [0]
        for (let i = 1; i <= M; i++) {
          const t0 = (2 * Math.PI * (i - 1)) / M
          const t1 = (2 * Math.PI * i) / M
          th.push(t1)
          cum.push(cum[i - 1] + Math.hypot(r.a * (Math.cos(t1) - Math.cos(t0)), r.b * (Math.sin(t1) - Math.sin(t0))))
        }
        const k = (2 * W) / cum[M]
        let j = 0
        return (sFilm: number): [number, number] => {
          const target = sFilm / k
          if (target < cum[j]) j = 0
          while (j < M - 1 && cum[j + 1] < target) j++
          const t = cum[j + 1] > cum[j] ? Math.min(1, (target - cum[j]) / (cum[j + 1] - cum[j])) : 0
          const a = th[j] + (th[j + 1] - th[j]) * t
          return [r.a * Math.cos(a), r.b * Math.sin(a)]
        }
      }
      const rings = rows.map(ringAt)
      // สองแถบ: [สันขวา → หน้า → หลังซ้ายถึงกลางหลัง] และ [กลางหลัง → หลังขวา → สันขวา] (UV กระโดดที่รอยต่อกลางหลัง)
      const strips = [
        { s0: 0, s1: 1.5 * W, n: 72, dl: (sf: number) => (sf <= W ? fx + W - sf : fx - (sf - W)) },
        { s0: 1.5 * W, s1: 2 * W, n: 24, dl: (sf: number) => pf + 2 * W - (sf - 1.5 * W) },
      ]
      const ringPts: [number, number, number][][] = rows.map(() => [])
      for (const st of strips) {
        const start = pos.length / 3
        const cols = st.n + 1
        rows.forEach((r, iv) => {
          for (let k = 0; k <= st.n; k++) {
            const sf = st.s0 + ((st.s1 - st.s0) * k) / st.n
            const [x, z] = rings[iv](sf)
            pos.push(x, r.y, z)
            uv.push(st.dl(sf) / dw, r.dly / dh)
            if (k < st.n || st === strips[strips.length - 1]) ringPts[iv].push([x, r.y, z])
          }
        })
        for (let iv = 0; iv < rows.length - 1; iv++) {
          for (let k = 0; k < st.n; k++) {
            const q = start + iv * cols + k
            idx.push(q, q + cols, q + 1, q + 1, q + cols, q + cols + 1)
          }
        }
      }
      // ครีบซีล: ลิ้นขวา [pf+2W, 2W+2pf] ต่อจากกลางหลัง พับแนบหลังไปทางซ้าย (มองจากหลัง) ลอยจากผิว 0.3 มม.
      const finStart = pos.length / 3
      rows.forEach((r) => {
        for (const [x, dl] of [
          [0, pf + 2 * W],
          [-pf, 2 * W + 2 * pf],
        ] as const) {
          const zx = r.b * Math.sqrt(Math.max(0, 1 - (x / r.a) ** 2))
          // โคนครีบชิดผิว ปลายครีบยกเล็กน้อย (ฟิล์มสองชั้นพับทับ) → เห็นขอบครีบรับแสงแบบของจริง
          pos.push(x, r.y, -zx - (x === 0 ? 0.3 : 1.2))
          uv.push(dl / dw, r.dly / dh)
        }
      })
      for (let iv = 0; iv < rows.length - 1; iv++) {
        const q = finStart + iv * 2
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2)
      }
      const sideCount = idx.length
      // ปิดขอบซีลบน/ล่าง (หนา 2·FIN)
      for (const [iv, flip] of [
        [0, false],
        [rows.length - 1, true],
      ] as const) {
        const center = pos.length / 3
        pos.push(0, rows[iv].y, 0)
        uv.push(0, 0)
        for (const v of ringPts[iv]) {
          pos.push(...v)
          uv.push(0, 0)
        }
        const nR = ringPts[iv].length
        for (let k = 0; k < nR - 1; k++) {
          const p0 = center + 1 + k
          if (flip) idx.push(center, p0 + 1, p0)
          else idx.push(center, p0, p0 + 1)
        }
      }
      const geoP = new THREE.BufferGeometry()
      geoP.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geoP.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geoP.setIndex(idx)
      geoP.addGroup(0, sideCount, 0)
      geoP.addGroup(sideCount, idx.length - sideCount, 1)
      geoP.computeVertexNormals()
      return geoP
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

// alpha mask ส่วนที่เจาะทะลุฟิล์ม: รอยบากฉีก + รูแขวน (พิกัดแผ่นคลี่ ขาว = ผิว, ดำ = เจาะ) — alphaMap + alphaTest ของทั้งสองวัสดุถุง
// flipY ต้องตรงกับ texture ลาย (false); ไม่มีอะไรเจาะ = null (ไม่เพิ่ม texture)
export function pouchCutMaskCanvas(pouch: Pouch, pxPerMm = 6): HTMLCanvasElement | null {
  if (!pouch.tearNotches.length && !pouch.hangHoles.length && !pouch.trims.length) return null
  const { width, height } = pouch.label
  const s = Math.min(pxPerMm, 2048 / Math.max(width, height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width * s))
  c.height = Math.max(1, Math.round(height * s))
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#000000'
  for (const tri of [...pouch.tearNotches, ...pouch.trims]) {
    ctx.beginPath()
    tri.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)))
    ctx.closePath()
    ctx.fill()
  }
  for (const h of pouch.hangHoles) {
    ctx.beginPath()
    ctx.arc(h.x * s, h.y * s, h.r * s, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

function usePouchCutMask(pouch: Pouch): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    const c = pouchCutMaskCanvas(pouch)
    if (!c) return null
    const t = new THREE.CanvasTexture(c)
    t.flipY = false
    t.colorSpace = THREE.NoColorSpace
    t.generateMipmaps = false // ขอบรอยบากคมตอนย่อ (mipmap เกลี่ยดำ-ขาวจนเจาะไม่ถึงปลาย V)
    t.minFilter = THREE.LinearFilter
    return t
  }, [pouch])
  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

const DOYPACK_CORNER_ROWS = 160 // แถวโปรไฟล์ของถุงจุกมุม (ค่าปกติ 56)

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
  watermark,
}: {
  pouch: Pouch
  mat: Material
  decos: Deco[]
  fillColor: string | null | undefined
  fillImage: FillImage | null | undefined
  dims?: Dim3D[]
  imperial?: boolean
  dimVariant?: 'lines' | 'badge'
  watermark?: string | null
}) {
  const tex = usePouchTexture(pouch, decos, fillColor, fillImage, watermark)
  const maps = useFinishMaps({
    sheetW: pouch.label.width,
    sheetH: pouch.label.height,
    decos,
    baseRough: mat.roughness ?? 0.6,
    baseMetal: mat.metalness ?? 0,
    configure: (t) => {
      t.flipY = false // ต้องตรงกับ texture ลายของถุง
    },
    // ซิปล็อก/วาล์วกาแฟ = รอยนูนบนฟิล์มเองตามตำแหน่งบน dieline (ไม่ใช่ชิ้นสีแยก) → สี/ลาย/texture เดียวกับถุงเสมอ
    relief: pouchRelief(pouch),
  })
  const geo = usePouchGeometry(pouch)
  useEffect(() => () => geo.dispose(), [geo])
  const notchMask = usePouchCutMask(pouch)

  // three คอมไพล์ shader ตาม define ตอนสร้าง — map เปลี่ยน null → texture ต้อง needsUpdate ให้ recompile
  const matRef = useRef<THREE.MeshStandardMaterial>(null!)
  const mat1Ref = useRef<THREE.MeshStandardMaterial>(null!)
  const hasTex = !!tex
  const hasNotch = !!notchMask
  useLayoutEffect(() => {
    if (matRef.current) matRef.current.needsUpdate = true
    if (mat1Ref.current) mat1Ref.current.needsUpdate = true
  }, [hasTex, !!maps.orm, !!maps.bump, hasNotch])

  // brick: ทรงตามความยาวฟิล์ม (ไหล่เอียง) → ซิป/วาล์ว/tin-tie วางตามระยะบน dieline ผ่าน brickAt
  const brick = useMemo(() => (pouch.style === 'gusset' ? brickShape(pouch) : null), [pouch])
  // doypack: แถวโปรไฟล์ชุดเดียวกับผิว → ซิป/วาล์ว/tin-tie วางตามพิกัด dieline ผ่าน doypackAt
  const doy = useMemo(
    () =>
      pouch.style === 'spout' && !pouch.spoutCorner
        ? spoutRows(pouch)
        : pouch.style === 'stand' || pouch.style === 'kseal' || pouch.style === 'spout'
          ? doypackRows(pouch, pouch.spoutCorner ? DOYPACK_CORNER_ROWS : undefined)
          : null,
    [pouch],
  )
  const pil = useMemo(() => (pouch.style === 'pillow' ? pillowRows(pouch) : null), [pouch])
  const isFlat = pouch.style === 'flat'
  const topY = brick
    ? brick.topY
    : doy
      ? doy[doy.length - 1].y
      : pil
        ? pil[pil.length - 1].y
        : isFlat
          ? pouch.label.height
          : pouch.H
  // จุก + ฝาเกลียว ที่ปากบน (spout pouch): คอสั้นมีเกลียว → ปีกรอง (flange) → ฝาหยักกันลื่น — ขนาดตาม marker บน dieline
  const spoutR = spoutMarker(pouch.W, pouch.frontRect.y).r
  const neckH = spoutR * 0.9
  const capH = spoutR * 2
  const capR = spoutR * 1.35
  const knurls = 30
  const spoutLen = neckH + spoutR * 0.24 + capH
  // จุกมุม: โคนจุกที่กลางขอบเฉียง (ฟิล์ม c/2, c/2) — ตำแหน่งจากแถวโปรไฟล์ชุดเดียวกับผิว แล้วเอียงออก 45°
  const cornerSpout = useMemo(() => {
    const sc = pouch.spoutCorner
    if (!sc || !doy) return null
    const at = doypackAt(doy, sc.c / 2)
    const ss = pouch.sideSeal
    const u = sc.c / 2
    const x = u <= ss ? -at.a + u * ((at.a - at.ai) / ss) : -at.ai + (u - ss) * ((2 * at.ai) / (pouch.W - 2 * ss))
    const left = sc.side === 'left'
    return { x: left ? x : -x, y: at.y, rot: left ? Math.PI / 4 : -Math.PI / 4 }
  }, [pouch, doy])
  const modelTop = !pouch.spout
    ? topY
    : cornerSpout
      ? Math.max(topY, cornerSpout.y + spoutLen * Math.SQRT1_2)
      : topY + spoutLen

  // ที่รัดปาก: แถบบางพาดขวางหน้าใกล้ปาก
  const ttV = Math.min(0.97, Math.max(0.03, 1 - (TINTIE_INSET + 3) / pouch.H))
  const ttZ = pouch.depth3D * pouchDepthFactor(ttV, pouch.style)
  const ttW = pouch.W * pouchWidthFactor(ttV, pouch.style) * 0.9
  // brick: จุดบนหน้า (y, ผิว z, มุมเอียงไหล่) ที่ระยะบน dieline เดียวกับ marker (วาล์วเป็นรอยนูนใน relief แล้ว)
  const bTie = brick
    ? brickAt(brick, TINTIE_INSET + 3)
    : doy || pil
      ? doypackAt((doy ?? pil)!, pouch.frontRect.y + TINTIE_INSET + 3)
      : isFlat
        ? flatAt(pouch, pouch.frontRect.y + TINTIE_INSET + 3)
        : null

  const modelRef = useRef<THREE.Group>(null)

  return (
    <>
    {/* จัดกึ่งกลางรวมจุก+ฝา ให้กล้องเห็นทั้งชิ้น */}
    <group ref={modelRef} position={[0, -modelTop / 2, 0]}>
      <mesh geometry={geo}>
        {/* material 0 = ผิวข้าง (พิมพ์ลาย) */}
        <meshStandardMaterial
          attach="material-0"
          ref={matRef}
          map={tex}
          color={tex ? '#ffffff' : mat.color}
          {...finishMaterialProps(maps, mat.roughness ?? 0.6, mat.metalness ?? 0)}
          // รอยบากฉีก/รูแขวน: เจาะผิวตาม alpha mask พิกัดแผ่นคลี่ (ทุกรูปแบบถุงแม็พ UV จาก dieline เดียวกัน)
          alphaMap={notchMask}
          alphaTest={notchMask ? 0.5 : 0}
          transparent={mat.opacity !== undefined}
          opacity={mat.opacity ?? 1}
          side={THREE.DoubleSide}
        />
        {/* Neutral base/caps: match the brick's print background without stretching artwork. */}
        <meshStandardMaterial
          attach="material-1"
          ref={mat1Ref}
          alphaMap={notchMask}
          alphaTest={notchMask ? 0.5 : 0}
          color={getPouchSealColor(pouch, mat, fillColor, hasTex)}
          roughness={mat.roughness ?? 0.6}
          metalness={mat.metalness ?? 0}
          transparent={mat.opacity !== undefined}
          opacity={mat.opacity ?? 1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {pouch.spout && (
        <group
          position={cornerSpout ? [cornerSpout.x, cornerSpout.y, 0] : [0, topY, 0]}
          rotation={[0, 0, cornerSpout?.rot ?? 0]}
        >
          {cornerSpout && (
            // เรือจุก (ส่วนเชื่อมหน้าตัดเลนส์) โผล่ที่ขอบเฉียงระหว่างฟิล์มสองชั้น — ตามแนวขอบ × ความหนาเรือ
            <mesh position={[0, -1.5, 0]} scale={[spoutMarker(pouch.W, pouch.frontRect.y).bw / 2, 1, spoutBoatT(pouch.W, pouch.frontRect.y) * 0.97]}>
              <cylinderGeometry args={[1, 1, 4, 48]} />
              <meshStandardMaterial color="#e4e4e4" roughness={0.4} metalness={0} />
            </mesh>
          )}
          {/* คอจุก + เกลียว 2 เส้น */}
          <mesh position={[0, neckH / 2, 0]}>
            <cylinderGeometry args={[spoutR, spoutR, neckH, 32]} />
            <meshStandardMaterial color="#e9e9e9" roughness={0.35} metalness={0} />
          </mesh>
          {[0.3, 0.65].map((f) => (
            <mesh key={f} position={[0, neckH * f, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[spoutR, spoutR * 0.07, 8, 40]} />
              <meshStandardMaterial color="#e2e2e2" roughness={0.35} metalness={0} />
            </mesh>
          ))}
          {/* ปีกรองใต้ฝา (tamper ring) */}
          <mesh position={[0, neckH + spoutR * 0.12, 0]}>
            <cylinderGeometry args={[capR * 1.04, capR * 1.04, spoutR * 0.24, 40]} />
            <meshStandardMaterial color="#f0f0f0" roughness={0.4} metalness={0} />
          </mesh>
          {/* ฝาเกลียว + ร่องหยักรอบฝา */}
          <mesh position={[0, neckH + spoutR * 0.24 + capH / 2, 0]}>
            <cylinderGeometry args={[capR, capR, capH, 48]} />
            <meshStandardMaterial color="#f5f5f5" roughness={0.4} metalness={0} />
          </mesh>
          {Array.from({ length: knurls }, (_, k) => {
            const a = (2 * Math.PI * k) / knurls
            return (
              <mesh
                key={k}
                position={[Math.cos(a) * capR, neckH + spoutR * 0.24 + capH * 0.55, Math.sin(a) * capR]}
                rotation={[0, -a, 0]}
              >
                <boxGeometry args={[spoutR * 0.12, capH * 0.8, spoutR * 0.12]} />
                <meshStandardMaterial color="#ececec" roughness={0.45} metalness={0} />
              </mesh>
            )
          })}
        </group>
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
  watermark,
  extra,
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
  watermark?: string | null
  extra?: ReactNode // ของเสริมใน <Canvas> (เช่นตัวถ่ายภาพย่อแกลเลอรี)
}) {
  // ตำแหน่งแรกจาก Canvas (ถุงตั้ง/ก้น K หน้าตรง, แบบอื่นมุมเฉียง — ดู pouchCameraFit);
  // สลับรูปแบบถุง/ขนาดต่างมากโดยไม่ถอดหน้า 3D → FitViewerCamera จัดกล้องใหม่ตามมุมของรูปแบบใหม่
  const fit = pouchCameraFit(pouch, pouch.style)
  return (
    <Canvas
      events={safeCanvasEvents}
      camera={{ position: cameraPosition(fit), fov: 36, near: 1, far: 8000 }}
      role="img"
      aria-label="มุมมอง 3 มิติของถุงพร้อมลาย"
    >
      <color attach="background" args={['#ffffff']} />
      <SceneLighting mode={lightMode ?? 'soft'} />
      <PouchModel pouch={pouch} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} dims={dims} imperial={imperial} dimVariant={dimVariant} watermark={watermark} />
      <OrbitControls makeDefault enableDamping />
      <FitViewerCamera fit={fit} />
      {extra}
    </Canvas>
  )
}
