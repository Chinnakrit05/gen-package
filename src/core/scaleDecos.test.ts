import { describe, expect, it } from 'vitest'
import { elH, scaleDecos, type Deco } from './artwork'

describe('scaleDecos', () => {
  const decos: Deco[] = [
    { id: 'i', type: 'image', src: 'x', aspect: 2, w: 20, h: 10, x: 4, y: 6, rot: 15, radius: 2 },
    { id: 't', type: 'text', text: 'ก', color: '#000', size: 8, w: 12, x: 10, y: 20, rot: 0, strokeW: 0.5, strokeColor: '#fff' },
    { id: 's', type: 'shape', shape: 'rect', w: 10, h: 4, fill: '#f00', stroke: '#000', strokeW: 0.4, x: 0, y: 0, rot: 30 },
  ]

  it('ตำแหน่ง/ขนาด/ตัวอักษร/เส้นขอบ คูณตามกัน มุมหมุนคงเดิม', () => {
    const [i, t, s] = scaleDecos(decos, 0.5)
    expect([i.x, i.y, i.w, elH(i)]).toEqual([2, 3, 10, 5])
    expect(i.type === 'image' && i.radius).toBe(1)
    expect(i.rot).toBe(15)
    expect(t.type === 'text' && [t.size, t.w, t.strokeW]).toEqual([4, 6, 0.25])
    expect(s.type === 'shape' && [s.w, s.h, s.strokeW]).toEqual([5, 2, 0.2])
  })

  it('ไม่แก้ object เดิม และ k=1 คืนค่าเท่าเดิม', () => {
    const copy = JSON.parse(JSON.stringify(decos))
    expect(scaleDecos(decos, 1)).toEqual(decos)
    scaleDecos(decos, 3)
    expect(decos).toEqual(copy)
  })
})
