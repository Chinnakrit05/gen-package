// หน้าทดลอง "ระดับ 2": AI ประกอบโครงสร้างกล่องด้วยภาษาแผง — เปิด /tests/browser/structure.html บน dev server
// ซ้าย: คำสั่ง + ขนาด + วัสดุ (+ คีย์ Anthropic ถ้า dev server ไม่มี) → POST /api/box-structure → รอบตรวจ/แก้ของ AI
// และ JSON ที่แก้เองได้แล้วคอมไพล์ใหม่ทันที; ขวา: 3D (Viewer3D ของแอป) + แผ่นคลี่ + ด้านที่ปิด
// ไม่ผูกกับ Project/billing — คอมไพล์ฝั่งเบราว์เซอร์ด้วย compileStructure ตัวเดียวกับ server
import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Viewer3D } from '../../src/components/Viewer3D'
import { getMaterial, MATERIALS } from '../../src/core/materials'
import { compileStructure, faceTh, type CompileResult } from '../../src/core/structure/compile'
import { EXAMPLE_STRUCTURES } from '../../src/core/structure/examples'
import { parseStructure, type BoxStructure, type StructureIssue } from '../../src/core/structure/grammar'
import type { Face } from '../../src/core/structure/validate'
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/700.css'

interface Round {
  attempt: number
  structure: BoxStructure | null
  issues: StructureIssue[]
  ok: boolean
}
interface ServerResult {
  ok: boolean
  structure: BoxStructure | null
  issues: StructureIssue[]
  rounds: Round[]
  model: string
  mock: boolean
}

const FOLDABLE = MATERIALS.filter((m) => m.foldable)
const KEY_STORAGE = 'packit-structure-lab-key'

function Blueprint({ result }: { result: CompileResult }) {
  const d = result.dieline
  if (!d) return null
  const pad = 20
  return (
    <svg className="blueprint" viewBox={`${-pad} ${-pad} ${d.width + 2 * pad} ${d.height + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
      {d.panels.map((p) => {
        const cx = p.outline.reduce((s, v) => s + v.x, 0) / p.outline.length
        const cy = p.outline.reduce((s, v) => s + v.y, 0) / p.outline.length
        return (
          <text key={p.id} x={cx} y={cy} fontSize={Math.max(3, Math.min(d.width, d.height) * 0.03)} textAnchor="middle" fill="#9aacae">
            {p.id}
          </text>
        )
      })}
      {d.segments.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={s.kind === 'cut' ? '#c0392b' : '#2471a3'} strokeWidth={0.6} strokeDasharray={s.kind === 'crease' ? '3 2' : undefined} />
      ))}
    </svg>
  )
}

function Issues({ issues }: { issues: StructureIssue[] }) {
  if (!issues.length) return <p className="round">ไม่พบปัญหา</p>
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={i.severity}>
          {i.severity === 'error' ? '✗' : i.severity === 'warning' ? '△' : '·'} {i.message}
        </li>
      ))}
    </ul>
  )
}

function Lab() {
  const [prompt, setPrompt] = useState('กล่องฝาเสียบใส่ครีม มีลิ้นกันฝุ่น')
  const [box, setBox] = useState({ W: 80, D: 50, H: 120 })
  const [materialId, setMaterialId] = useState('carton-300')
  const [apiKey, setApiKey] = useState(() => {
    try {
      return sessionStorage.getItem(KEY_STORAGE) ?? ''
    } catch {
      return ''
    }
  })
  const [json, setJson] = useState(() => JSON.stringify(EXAMPLE_STRUCTURES[0], null, 2))
  const [structure, setStructure] = useState<BoxStructure | null>(EXAMPLE_STRUCTURES[0])
  const [parseIssues, setParseIssues] = useState<StructureIssue[]>([])
  const [rounds, setRounds] = useState<Round[]>([])
  const [serverNote, setServerNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [fold, setFold] = useState(1)
  const mat = getMaterial(materialId)

  const compiled = useMemo(() => (structure ? compileStructure(structure, box, mat) : null), [structure, box, mat])

  const applyJson = (text: string) => {
    setJson(text)
    try {
      const parsed = parseStructure(JSON.parse(text))
      if (parsed.ok) {
        setParseIssues([])
        setStructure(parsed.structure)
      } else setParseIssues(parsed.issues)
    } catch (e) {
      setParseIssues([{ severity: 'error', code: 'json', message: `JSON ไม่ถูกต้อง: ${(e as Error).message}` }])
    }
  }

  const design = async (edit: boolean) => {
    setBusy(true)
    setServerNote('')
    setRounds([])
    try {
      try {
        if (apiKey) sessionStorage.setItem(KEY_STORAGE, apiKey)
        else sessionStorage.removeItem(KEY_STORAGE)
      } catch {
        /* ปิด storage */
      }
      const res = await fetch('/api/box-structure', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-packit-anthropic-api-key': apiKey } : {}) },
        body: JSON.stringify({ prompt, box, materialId, ...(edit && structure ? { current: structure } : {}) }),
      })
      const data = (await res.json()) as ServerResult & { error?: string }
      if (!res.ok) {
        setServerNote(`ผิดพลาด ${res.status}: ${data.error ?? ''}`)
        return
      }
      setRounds(data.rounds)
      setServerNote(`${data.mock ? 'โหมดจำลอง' : `โมเดล ${data.model}`} · ${data.rounds.length} รอบ · ${data.ok ? 'ผ่านการตรวจ' : 'ยังมีข้อผิดพลาด (แสดงรอบสุดท้าย)'}`)
      if (data.structure) applyJson(JSON.stringify(data.structure, null, 2))
    } catch (e) {
      setServerNote(`เรียก server ไม่ได้: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const coverage = compiled?.coverage ?? {}
  return (
    <div className="lab">
      <div className="col">
        <section className="card">
          <h2>1. บอก AI ว่าต้องการกล่องแบบไหน</h2>
          <label>
            คำสั่ง
            <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="row">
            {(['W', 'D', 'H'] as const).map((k) => (
              <label key={k}>
                {k} ด้านใน (มม.)
                <input type="number" min={10} max={400} value={box[k]} onChange={(e) => setBox({ ...box, [k]: Number(e.target.value) || box[k] })} />
              </label>
            ))}
          </div>
          <label>
            วัสดุ
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              {FOLDABLE.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nameTh} ({m.thickness} มม.)
                </option>
              ))}
            </select>
          </label>
          <label>
            คีย์ Anthropic (ถ้า dev server ไม่มีคีย์/CLI — เก็บใน sessionStorage ของแท็บนี้เท่านั้น)
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
          </label>
          <p style={{ display: 'flex', gap: 8, margin: '10px 0 0' }}>
            <button type="button" disabled={busy} onClick={() => void design(false)}>
              {busy ? 'กำลังออกแบบ…' : 'ออกแบบใหม่ด้วย AI'}
            </button>
            <button type="button" className="secondary" disabled={busy || !structure} onClick={() => void design(true)}>
              แก้ต่อจากโครงสร้างปัจจุบัน
            </button>
          </p>
          {serverNote && <p className="round">{serverNote}</p>}
          {rounds.map((r) => (
            <div key={r.attempt}>
              <p className="round">
                รอบ {r.attempt}: {r.ok ? 'ผ่าน' : r.structure ? 'ตรวจพบปัญหา' : 'JSON ไม่ผ่านรูปแบบ'}
              </p>
              {!r.ok && <Issues issues={r.issues.filter((i) => i.severity === 'error')} />}
            </div>
          ))}
        </section>
        <section className="card">
          <h2>2. โครงสร้าง (ภาษาแผง) — แก้ได้ แล้วกดคอมไพล์</h2>
          <div className="examples">
            {EXAMPLE_STRUCTURES.map((s) => (
              <button key={s.name} type="button" className="secondary" onClick={() => applyJson(JSON.stringify(s, null, 2))}>
                {s.name}
              </button>
            ))}
          </div>
          <textarea className="json" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          <p style={{ margin: '8px 0 0' }}>
            <button type="button" className="secondary" onClick={() => applyJson(json)}>
              คอมไพล์
            </button>
          </p>
          <Issues issues={parseIssues} />
        </section>
      </div>
      <div className="col">
        <section className="card">
          <h2>
            3. ผล: {structure?.name ?? '—'} {compiled && (compiled.ok ? '· ผ่านการตรวจ' : '· มีข้อผิดพลาด')}
          </h2>
          {compiled?.dieline ? (
            <>
              <div className="viewer">
                <Viewer3D dieline={compiled.dieline} mat={mat} fold={fold} depth={compiled.foldDepth} tilt={compiled.tilt} />
              </div>
              <label style={{ marginTop: 8 }}>
                พับ {Math.round(fold * 100)}%
                <input type="range" min={0} max={1} step={0.01} value={fold} onChange={(e) => setFold(Number(e.target.value))} />
              </label>
              <p className="meta">
                <span>แผ่นคลี่ <b>{compiled.dieline.width.toFixed(1)} × {compiled.dieline.height.toFixed(1)}</b> มม.</span>
                <span>แผง <b>{compiled.dieline.panels.length}</b></span>
                <span>จังหวะพับ <b>{compiled.stages}</b></span>
                {(Object.keys(coverage) as Face[]).map((f) => (
                  <span key={f}>
                    {faceTh(f)} <b>{Math.round((coverage[f] ?? 0) * 100)}%</b>
                  </span>
                ))}
              </p>
              {structure?.explanation && <p className="round">{structure.explanation}</p>}
            </>
          ) : (
            <p className="round">ยังไม่มีโครงสร้างที่คอมไพล์ได้</p>
          )}
          {compiled && <Issues issues={compiled.issues} />}
        </section>
        {compiled?.dieline && (
          <section className="card">
            <h2>แผ่นคลี่ (แดง = ตัด, น้ำเงินประ = พับ)</h2>
            <Blueprint result={compiled} />
          </section>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
