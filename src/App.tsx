import { useEffect, useMemo, useRef, useState } from 'react'
import { MATERIALS, getMaterial } from './core/materials'
import { TEMPLATES, getTemplate } from './core/templates'
import type { Dieline } from './core/types'
import type { AiBoxSpec, CurrentSpec } from './core/ai'
import { dielineDXFString } from './core/dxf'
import { Viewer3D } from './components/Viewer3D'
import { DielineSVG } from './components/DielineSVG'
import { PromptBar } from './components/PromptBar'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface DimFieldProps {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}

function DimField({ label, value, min, max, disabled, onChange }: DimFieldProps) {
  const commit = (v: number) => onChange(clamp(Number.isFinite(v) ? v : min, min, max))
  return (
    <div className="field">
      <span className="field-head">
        {label}
        <span className="field-num">
          <input
            type="number"
            min={min}
            max={max}
            step={0.5}
            value={value}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => commit(Number(e.target.value))}
          />
          มม.
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => commit(Number(e.target.value))}
      />
    </div>
  )
}

function dielineSVGString(d: Dieline, withDims: boolean): string {
  const paths = d.segments
    .map((s) =>
      s.kind === 'cut'
        ? `  <path d="${s.d}" fill="none" stroke="#e30613" stroke-width="0.35"/>`
        : `  <path d="${s.d}" fill="none" stroke="#009640" stroke-width="0.35" stroke-dasharray="4 2.5"/>`,
    )
    .join('\n')

  let dimLayer = ''
  let pad = 5
  if (withDims) {
    pad = 26
    const marks = d.dims
      .map((m) => {
        const vert = Math.abs(m.a.x - m.b.x) < 0.001
        const mx = (m.a.x + m.b.x) / 2
        const my = (m.a.y + m.b.y) / 2
        const ticks = vert
          ? `<line x1="${m.a.x - 2.5}" y1="${m.a.y}" x2="${m.a.x + 2.5}" y2="${m.a.y}"/><line x1="${m.b.x - 2.5}" y1="${m.b.y}" x2="${m.b.x + 2.5}" y2="${m.b.y}"/>`
          : `<line x1="${m.a.x}" y1="${m.a.y - 2.5}" x2="${m.a.x}" y2="${m.a.y + 2.5}"/><line x1="${m.b.x}" y1="${m.b.y - 2.5}" x2="${m.b.x}" y2="${m.b.y + 2.5}"/>`
        const label = vert
          ? `<text x="${mx}" y="${my}" transform="rotate(-90 ${mx} ${my})" dy="-2" text-anchor="middle" fill="#1b6ea8" font-size="6" stroke="none">${m.label}</text>`
          : `<text x="${mx}" y="${my - 2}" text-anchor="middle" fill="#1b6ea8" font-size="6" stroke="none">${m.label}</text>`
        return `    <line x1="${m.a.x}" y1="${m.a.y}" x2="${m.b.x}" y2="${m.b.y}"/>${ticks}${label}`
      })
      .join('\n')
    dimLayer = `  <g stroke="#1b6ea8" stroke-width="0.25" font-family="sans-serif">\n${marks}\n  </g>\n`
  }

  const w = d.width + pad * 2
  const h = d.height + pad * 2
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${-pad} ${-pad} ${w} ${h}">\n` +
    `<!-- สเกลจริง 1:1 หน่วย mm | เส้นแดงทึบ = ตัด (cut) | เส้นเขียวประ = พับ (crease) | เส้นน้ำเงิน = ขนาด (ไม่ใช้ผลิต) -->\n` +
    `${paths}\n${dimLayer}</svg>\n`
  )
}

interface DesignVersion {
  label: string
  spec: CurrentSpec
}

const sameSpec = (a: CurrentSpec, b: CurrentSpec) =>
  a.template === b.template &&
  a.materialId === b.materialId &&
  a.W === b.W &&
  a.D === b.D &&
  a.H === b.H &&
  a.handle === b.handle

// --- บันทึกหลายงาน (project) + ประวัติเวอร์ชันของแต่ละงานลง localStorage ---

const STORAGE_KEY = 'gen-package-projects-v1'
const LEGACY_KEY = 'gen-package-design-v1'
const MAX_HISTORY = 30

interface Project {
  id: string
  name: string
  updatedAt: number
  live: CurrentSpec
  history: DesignVersion[]
  histIdx: number
}

interface Store {
  projects: Project[]
  activeId: string
  showDims: boolean
}

const DEFAULT_SPEC: CurrentSpec = {
  template: 'tuck-end',
  materialId: 'carton-300',
  W: 80,
  D: 50,
  H: 120,
  handle: false,
}

function freshProject(n: number): Project {
  return {
    id: crypto.randomUUID(),
    name: `งาน ${n}`,
    updatedAt: Date.now(),
    live: { ...DEFAULT_SPEC },
    history: [],
    histIdx: -1,
  }
}

function parseSpec(s: unknown): CurrentSpec | null {
  if (typeof s !== 'object' || s === null) return null
  const o = s as Record<string, unknown>
  const template = TEMPLATES.some((t) => t.id === o.template) ? (o.template as string) : null
  const materialId = MATERIALS.some((m) => m.id === o.materialId) ? (o.materialId as string) : null
  const W = Number(o.W)
  const D = Number(o.D)
  const H = Number(o.H)
  if (!template || !materialId || !Number.isFinite(W) || !Number.isFinite(D) || !Number.isFinite(H)) {
    return null
  }
  return {
    template,
    materialId,
    W: clamp(W, 30, 250),
    D: clamp(D, 20, 150),
    H: clamp(H, 30, 300),
    handle: o.handle === true,
  }
}

function parseHistory(v: unknown): DesignVersion[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item: unknown): DesignVersion | null => {
      const o = item as Record<string, unknown> | null
      const spec = parseSpec(o?.spec)
      if (!spec) return null
      return { label: String(o?.label ?? 'เวอร์ชัน').slice(0, 120), spec }
    })
    .filter((item): item is DesignVersion => item !== null)
    .slice(-MAX_HISTORY)
}

function clampIdx(raw: unknown, len: number): number {
  const n = Number(raw)
  return Math.min(Math.max(-1, Number.isInteger(n) ? n : len - 1), len - 1)
}

function parseProject(v: unknown, idx: number): Project | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const live = parseSpec(o.live)
  if (!live) return null
  const history = parseHistory(o.history)
  return {
    id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
    name: String(o.name ?? `งาน ${idx + 1}`).slice(0, 60) || `งาน ${idx + 1}`,
    updatedAt: Number(o.updatedAt) || Date.now(),
    live,
    history,
    histIdx: clampIdx(o.histIdx, history.length),
  }
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as Record<string, unknown>
      const projects = Array.isArray(d.projects)
        ? d.projects
            .map((p: unknown, i: number) => parseProject(p, i))
            .filter((p): p is Project => p !== null)
        : []
      if (projects.length > 0) {
        const activeId = projects.some((p) => p.id === d.activeId)
          ? (d.activeId as string)
          : projects[0].id
        return { projects, activeId, showDims: d.showDims !== false }
      }
    }
  } catch {
    // ตกไปเช็คข้อมูลรุ่นเก่า
  }

  // ย้ายข้อมูลรุ่นเก่า (งานเดียว) เข้าระบบหลายงาน
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const d = JSON.parse(legacy) as Record<string, unknown>
      const live = parseSpec(d.live)
      if (live) {
        const history = parseHistory(d.history)
        const p: Project = {
          id: crypto.randomUUID(),
          name: 'งาน 1',
          updatedAt: Date.now(),
          live,
          history,
          histIdx: clampIdx(d.histIdx, history.length),
        }
        localStorage.removeItem(LEGACY_KEY)
        return { projects: [p], activeId: p.id, showDims: d.showDims !== false }
      }
    }
  } catch {
    // ใช้ค่าเริ่มต้น
  }

  const p = freshProject(1)
  return { projects: [p], activeId: p.id, showDims: true }
}

const store0 = loadStore()
const active0 = store0.projects.find((p) => p.id === store0.activeId) ?? store0.projects[0]

export default function App() {
  const [projects, setProjects] = useState<Project[]>(store0.projects)
  const [activeId, setActiveId] = useState(active0.id)
  const [templateId, setTemplateId] = useState(active0.live.template)
  const [materialId, setMaterialId] = useState(active0.live.materialId)
  const [W, setW] = useState(active0.live.W)
  const [D, setD] = useState(active0.live.D)
  const [H, setH] = useState(active0.live.H)
  const [handle, setHandle] = useState(active0.live.handle)
  const [fold, setFold] = useState(1)
  const [showDims, setShowDims] = useState(store0.showDims)
  const [aiBusy, setAiBusy] = useState(false)
  const [history, setHistory] = useState<DesignVersion[]>(active0.history)
  const [histIdx, setHistIdx] = useState(active0.histIdx)
  const raf = useRef(0)

  const template = getTemplate(templateId)
  const mat = getMaterial(materialId)
  const dieline = useMemo(
    () => (mat.foldable ? template.generate({ W, D, H, handle }, mat) : null),
    [W, D, H, handle, mat, template],
  )

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // sync สถานะปัจจุบันเข้างานที่เปิดอยู่ (หน่วงสั้นๆ กันเขียนถี่ตอนลาก slider)
  useEffect(() => {
    const t = setTimeout(() => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeId
            ? {
                ...p,
                live: { template: templateId, materialId, W, D, H, handle },
                history,
                histIdx,
                updatedAt: Date.now(),
              }
            : p,
        ),
      )
    }, 300)
    return () => clearTimeout(t)
  }, [history, histIdx, templateId, materialId, W, D, H, handle, activeId])

  // save ทุกงานลง localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, activeId, showDims }))
    } catch {
      // storage เต็มหรือถูกปิดไว้ — ข้ามการ save เงียบๆ
    }
  }, [projects, activeId, showDims])

  const play = () => {
    cancelAnimationFrame(raf.current)
    const t0 = performance.now()
    const dur = 3000
    const step = (now: number) => {
      const u = clamp((now - t0) / dur, 0, 1)
      setFold(u)
      if (u < 1) raf.current = requestAnimationFrame(step)
    }
    setFold(0)
    raf.current = requestAnimationFrame(step)
  }

  const liveSpec = (): CurrentSpec => ({ template: templateId, materialId, W, D, H, handle })

  const setSpec = (spec: CurrentSpec) => {
    setTemplateId(spec.template)
    setMaterialId(spec.materialId)
    setW(clamp(spec.W, 30, 250))
    setD(clamp(spec.D, 20, 150))
    setH(clamp(spec.H, 30, 300))
    setHandle(spec.handle && getTemplate(spec.template).supportsHandle)
  }

  const applySpec = (spec: AiBoxSpec, label: string) => {
    const applied: CurrentSpec = {
      template: spec.template,
      materialId: spec.materialId,
      W: clamp(spec.W, 30, 250),
      D: clamp(spec.D, 20, 150),
      H: clamp(spec.H, 30, 300),
      handle: spec.handle && getTemplate(spec.template).supportsHandle,
    }
    // เก็บเวอร์ชัน: ตัด redo tail, เก็บสถานะก่อนหน้า (ตั้งต้น/ปรับเอง) ถ้ายังไม่ถูกเก็บ
    const live = liveSpec()
    const h = history.slice(0, histIdx + 1)
    if (h.length === 0) h.push({ label: 'แบบตั้งต้น', spec: live })
    else if (!sameSpec(h[h.length - 1].spec, live)) h.push({ label: 'ปรับเองด้วยมือ', spec: live })
    h.push({ label, spec: applied })
    if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY)
    setHistory(h)
    setHistIdx(h.length - 1)

    // งานที่ยังใช้ชื่ออัตโนมัติ ("งาน N") ตั้งชื่อตาม prompt แรกให้เลย
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeId && /^งาน \d+$/.test(p.name) && label
          ? { ...p, name: label.slice(0, 40) }
          : p,
      ),
    )

    setSpec(applied)
    if (getMaterial(applied.materialId).foldable) play()
    else setFold(1)
  }

  const restoreVersion = (i: number) => {
    const v = history[i]
    if (!v || aiBusy) return
    cancelAnimationFrame(raf.current)
    setHistIdx(i)
    setSpec(v.spec)
    setFold(1)
  }

  const clearHistory = () => {
    if (aiBusy) return
    if (!window.confirm('ลบประวัติเวอร์ชันทั้งหมด? (แบบปัจจุบันยังอยู่)')) return
    setHistory([])
    setHistIdx(-1)
  }

  // --- จัดการหลายงาน (navbar) ---

  const flushInto = (list: Project[]): Project[] =>
    list.map((p) =>
      p.id === activeId
        ? { ...p, live: liveSpec(), history, histIdx, updatedAt: Date.now() }
        : p,
    )

  const openProject = (p: Project) => {
    cancelAnimationFrame(raf.current)
    setActiveId(p.id)
    setSpec(p.live)
    setHistory(p.history)
    setHistIdx(p.histIdx)
    setFold(1)
  }

  const switchProject = (id: string) => {
    if (id === activeId || aiBusy) return
    const target = projects.find((p) => p.id === id)
    if (!target) return
    setProjects((prev) => flushInto(prev))
    openProject(target)
  }

  const newProject = () => {
    if (aiBusy) return
    const p = freshProject(projects.length + 1)
    setProjects((prev) => [...flushInto(prev), p])
    openProject(p)
  }

  const deleteProject = (id: string) => {
    if (aiBusy) return
    const victim = projects.find((p) => p.id === id)
    if (!victim) return
    if (!window.confirm(`ลบงาน "${victim.name}" ทั้งงานรวมประวัติ?`)) return
    let rest = projects.filter((p) => p.id !== id)
    if (rest.length === 0) rest = [freshProject(1)]
    setProjects(rest)
    if (id === activeId) openProject(rest[rest.length - 1])
  }

  const renameProject = () => {
    if (aiBusy) return
    const cur = projects.find((p) => p.id === activeId)
    const name = window.prompt('ตั้งชื่องาน', cur?.name ?? '')?.trim()
    if (!name) return
    setProjects((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, name: name.slice(0, 60) } : p)),
    )
  }

  const changeTemplate = (id: string) => {
    cancelAnimationFrame(raf.current)
    setTemplateId(id)
    const tp = getTemplate(id)
    setW(tp.defaults.W)
    setD(tp.defaults.D)
    setH(tp.defaults.H)
    if (!tp.supportsHandle) setHandle(false)
    if (mat.foldable) play()
  }

  const changeMaterial = (id: string) => {
    cancelAnimationFrame(raf.current)
    setMaterialId(id)
    if (!getMaterial(id).foldable) setFold(1)
  }

  const saveFile = (text: string, mime: string, ext: string) => {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${templateId}_${W}x${D}x${H}_${mat.id}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadSVG = () => {
    if (!dieline) return
    saveFile(dielineSVGString(dieline, showDims), 'image/svg+xml', 'svg')
  }

  // DXF คือไฟล์ที่โรงทำมีดไดคัทใช้จริง — มีแต่เลเยอร์ CUT/CREASE ไม่มีเส้นบอกขนาด
  const downloadDXF = () => {
    if (!dieline) return
    saveFile(dielineDXFString(dieline), 'application/dxf', 'dxf')
  }

  return (
    <div className="app">
      <header>
        <h1>gen-package</h1>
        <nav className="projects" aria-label="งานที่บันทึกไว้">
          {projects.map((p) => (
            <div key={p.id} className={`proj-tab${p.id === activeId ? ' active' : ''}`}>
              <button
                className="proj-name"
                title={`${p.name} · แก้ล่าสุด ${new Date(p.updatedAt).toLocaleString('th-TH')}`}
                aria-current={p.id === activeId ? 'true' : undefined}
                aria-disabled={aiBusy}
                onClick={() => switchProject(p.id)}
              >
                {p.name}
              </button>
              {p.id === activeId && (
                <button
                  className="proj-act"
                  aria-label="ตั้งชื่องานนี้"
                  title="ตั้งชื่องาน"
                  onClick={renameProject}
                >
                  ✎
                </button>
              )}
              <button
                className="proj-act"
                aria-label={`ลบงาน ${p.name}`}
                title="ลบงานนี้"
                onClick={() => deleteProject(p.id)}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="proj-new" aria-disabled={aiBusy} onClick={newProject}>
            + งานใหม่
          </button>
        </nav>
      </header>
      <div className="body">
        <aside>
          <section>
            <h2>รูปแบบบรรจุภัณฑ์</h2>
            <select
              value={templateId}
              disabled={aiBusy}
              aria-label="รูปแบบบรรจุภัณฑ์"
              onChange={(e) => changeTemplate(e.target.value)}
            >
              {TEMPLATES.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.nameTh}
                </option>
              ))}
            </select>
            <p className="hint">{template.detail}</p>
          </section>

          <section>
            <h2>วัสดุ</h2>
            <select
              value={materialId}
              disabled={aiBusy}
              aria-label="เลือกวัสดุ"
              onChange={(e) => changeMaterial(e.target.value)}
            >
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nameTh}
                  {m.foldable ? '' : ' — พับไม่ได้'}
                </option>
              ))}
            </select>
            <div className="mat-info">
              <div>{mat.detail}</div>
              <div>
                ความหนา {mat.thickness} มม. · {mat.process}
              </div>
              {mat.foldable ? (
                <div className="ok">พับได้ — dieline เผื่อระยะตามความหนาให้อัตโนมัติ</div>
              ) : (
                <div className="warn">{mat.note}</div>
              )}
            </div>
          </section>

          {mat.foldable && dieline && (
            <>
              <section>
                <h2>ขนาดกล่อง (ด้านใน)</h2>
                <DimField label="กว้าง W" value={W} min={30} max={250} disabled={aiBusy} onChange={setW} />
                <DimField label="ลึก D" value={D} min={20} max={150} disabled={aiBusy} onChange={setD} />
                <DimField label="สูง H" value={H} min={30} max={300} disabled={aiBusy} onChange={setH} />
                {template.supportsHandle && (
                  <label className="check" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={handle}
                      disabled={aiBusy}
                      onChange={(e) => setHandle(e.target.checked)}
                    />
                    เจาะรูหิ้ว (die-cut handle)
                  </label>
                )}
              </section>

              <section>
                <h2>การพับ</h2>
                <button className="primary" onClick={play}>
                  ▶ พับให้ดู
                </button>
                <label className="field">
                  <span>กาง ↔ พับ</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={fold}
                    aria-label="กาง-พับ"
                    aria-valuetext={`${Math.round(fold * 100)}%`}
                    onChange={(e) => {
                      cancelAnimationFrame(raf.current)
                      setFold(Number(e.target.value))
                    }}
                  />
                </label>
              </section>

              <section>
                <h2>Blueprint</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showDims}
                    onChange={(e) => setShowDims(e.target.checked)}
                  />
                  แสดงขนาดกำกับเส้น (มม.)
                </label>
                <button onClick={downloadSVG}>ดาวน์โหลด dieline (.svg)</button>
                <button onClick={downloadDXF}>ดาวน์โหลดไฟล์ผลิต (.dxf)</button>
                <p className="hint">
                  .dxf สำหรับส่งโรงทำมีดไดคัท — เลเยอร์ CUT/CREASE แยกกัน หน่วย มม. ไม่มีเส้นบอกขนาด
                </p>
                <p className="hint">
                  ขนาดแผ่น {Math.ceil(dieline.width)} × {Math.ceil(dieline.height)} มม. · สเกลจริง 1:1
                </p>
                <p className="hint">
                  ตัวเลขบนแบบคือระยะจริงบนแผ่น (บวกเผื่อความหนา {mat.thickness} มม. แล้ว)
                  จึงใหญ่กว่าขนาดด้านในที่ตั้งไว้เล็กน้อย
                </p>
              </section>
            </>
          )}
        </aside>

        <main>
          <PromptBar
            current={{ template: templateId, materialId, W, D, H, handle }}
            hasDesign={history.length > 0}
            onApply={applySpec}
            onLoadingChange={setAiBusy}
          />
          {history.length > 0 && (
            <div className="versions card" aria-label="ประวัติเวอร์ชัน">
              <button
                className="ver-nav"
                aria-label="ย้อนเวอร์ชัน"
                aria-disabled={histIdx <= 0 || aiBusy}
                onClick={() => restoreVersion(histIdx - 1)}
              >
                ↶ ย้อน
              </button>
              <button
                className="ver-nav"
                aria-label="ไปเวอร์ชันถัดไป"
                aria-disabled={histIdx >= history.length - 1 || aiBusy}
                onClick={() => restoreVersion(histIdx + 1)}
              >
                ไปหน้า ↷
              </button>
              <div className="ver-list">
                {history.map((v, i) => (
                  <button
                    key={i}
                    className={`ver-chip${i === histIdx ? ' active' : ''}`}
                    aria-disabled={aiBusy}
                    aria-current={i === histIdx ? 'true' : undefined}
                    title={v.label}
                    onClick={() => restoreVersion(i)}
                  >
                    v{i + 1} · {v.label}
                  </button>
                ))}
              </div>
              <span className="ver-saved hint">บันทึกอัตโนมัติ</span>
              <button className="ver-nav" aria-disabled={aiBusy} onClick={clearHistory}>
                ล้างประวัติ
              </button>
            </div>
          )}
          <div className="panels">
            {mat.foldable && dieline ? (
              <>
                <div className="viewer card">
                  <Viewer3D
                    dieline={dieline}
                    mat={mat}
                    fold={fold}
                    depth={template.foldDepth({ W, D, H }, mat)}
                    tilt={template.tilt}
                  />
                </div>
                <div className="blueprint card">
                  <div className="bp-head">
                    <span>blueprint การพับ</span>
                    <span className="legend">
                      <i className="sw-cut" /> เส้นตัด
                      <i className="sw-crease" /> เส้นพับ
                    </span>
                  </div>
                  <DielineSVG dieline={dieline} showDims={showDims} />
                </div>
              </>
            ) : (
              <div className="card notfoldable">
                <h2>{mat.nameTh} — พับไม่ได้</h2>
                <p>{mat.note}</p>
                <p>
                  ระบบจึงไม่สร้าง dieline การพับให้วัสดุนี้ เพราะกระบวนการขึ้นรูปจริงคือ “{mat.process}”
                  — เฟสถัดไปวัสดุกลุ่มนี้จะได้โปรไฟล์ทรง (revolve) + dieline ของฉลากแทน
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
