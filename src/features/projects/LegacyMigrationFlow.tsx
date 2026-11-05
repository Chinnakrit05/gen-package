import { useCallback, useEffect, useMemo, useState } from 'react'
import { getProject, importLegacyProject } from '../../services/api/projects'
import { IndexedDbLegacyMigrationStore, type LegacyMigrationJournal } from '../../services/drafts/legacyMigrationStore'
import type { AssetSidecarScope } from '../../services/projects/cloudProjectCodec'
import { createHttpAssetTransfer } from '../../services/projects/httpAssetTransfer'
import {
  discoverLegacyMigration,
  reopenLegacyMigrationConsent,
  resumeLegacyMigration,
  setLegacyMigrationConsent,
} from './legacyMigration'
import './legacyMigration.css'

interface LegacyMigrationFlowProps {
  scope: AssetSidecarScope
  apiBaseUrl: string
  getAccessToken(): string
  onMigrated(): void | Promise<unknown>
  onClose?(): void
}

export function LegacyMigrationFlow({ scope, apiBaseUrl, getAccessToken, onMigrated, onClose }: LegacyMigrationFlowProps) {
  const manual = onClose !== undefined
  const store = useMemo(() => new IndexedDbLegacyMigrationStore(), [])
  const [journal, setJournal] = useState<LegacyMigrationJournal | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const migrate = useCallback(async (accepted: LegacyMigrationJournal) => {
    setBusy(true)
    setError(null)
    try {
      const completed = await resumeLegacyMigration({
        journal: accepted,
        store,
        transfer: createHttpAssetTransfer({ apiBaseUrl, getAccessToken }),
        importProject: (input) => importLegacyProject(apiBaseUrl, getAccessToken(), input),
        getProject: (id) => getProject(apiBaseUrl, getAccessToken(), id),
        onProgress: setJournal,
      })
      setJournal(completed)
      await onMigrated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ย้ายข้อมูลงานเดิมไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }, [apiBaseUrl, getAccessToken, onMigrated, store])

  useEffect(() => {
    let active = true
    void discoverLegacyMigration(scope, store)
      .then(async (discovered) => {
        if (!active || !discovered) return
        const current = manual && discovered.consent === 'declined'
          ? await reopenLegacyMigrationConsent(discovered, store)
          : discovered
        if (!active) return
        const resumable = current.consent === 'accepted'
          && current.items.some((item) => ['pending', 'uploading', 'importing', 'error'].includes(item.status))
        if (manual || current.consent !== 'accepted' || resumable || current.items.some((item) => item.status === 'conflict')) {
          setJournal(current)
        }
        if (resumable) void migrate(current)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'ตรวจข้อมูลงานเดิมไม่สำเร็จ')
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => { active = false }
  }, [manual, migrate, scope, store])

  const changeConsent = async (current: LegacyMigrationJournal, accepted: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const next = await setLegacyMigrationConsent(current, store, accepted)
      setJournal(next)
      if (accepted) await migrate(next)
      else onClose?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกการเลือกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (!journal || (manual && journal.items.length === 0)) {
    if (!manual) return null
    return (
      <div className="modal-overlay">
        <div className="modal migration-modal" role="dialog" aria-label="ย้ายงานเดิมขึ้น Cloud">
          <h3>ย้ายงานเดิมขึ้น Cloud</h3>
          <p role="status">{checking ? 'กำลังตรวจงานในเครื่อง…' : error ?? 'ไม่พบงานเดิมในเครื่องนี้'}</p>
          <div className="modal-actions"><button onClick={onClose}>ปิด</button></div>
        </div>
      </div>
    )
  }
  if (journal.consent === 'declined') {
    if (manual) return null
    return (
      <button
        className="migration-reopen-button"
        onClick={() => void reopenLegacyMigrationConsent(journal, store).then(setJournal).catch(() => {
          setError('เปิดการย้ายงานเดิมไม่สำเร็จ')
        })}
        title={error ?? undefined}
      >
        ย้ายงานเดิมขึ้น Cloud
      </button>
    )
  }
  return (
    <LegacyMigrationModal
      journal={journal}
      busy={busy}
      error={error}
      onAccept={() => void changeConsent(journal, true)}
      onDecline={() => void changeConsent(journal, false)}
      onRetry={() => void migrate(journal)}
      onClose={onClose ?? (() => setJournal(null))}
    />
  )
}

function LegacyMigrationModal({
  journal,
  busy,
  error,
  onAccept,
  onDecline,
  onRetry,
  onClose,
}: {
  journal: LegacyMigrationJournal
  busy: boolean
  error: string | null
  onAccept(): void
  onDecline(): void
  onRetry(): void
  onClose(): void
}) {
  const migratable = journal.items.filter((item) => item.project).length
  const complete = journal.items.filter((item) => item.status === 'complete').length
  const failed = journal.items.filter((item) => item.status === 'error').length
  const skipped = journal.items.filter((item) => item.status === 'skipped').length
  const conflicts = journal.items.filter((item) => item.status === 'conflict').length
  const terminal = journal.items.every((item) => ['complete', 'skipped', 'conflict'].includes(item.status))
  return (
    <div className="modal-overlay">
      <div className="modal migration-modal" role="dialog" aria-label="ย้ายงานเดิมขึ้น Cloud">
        <h3>พบงานเดิมในเครื่องนี้</h3>
        {journal.consent === 'pending' ? (
          <>
            <p>พบงานที่ย้ายได้ {migratable} งาน ต้องการคัดลอกขึ้นพื้นที่ Cloud ของบัญชีนี้หรือไม่?</p>
            <p className="migration-note">
              ระบบเก็บ raw backup ไว้ก่อนอ่านข้อมูลและจะไม่ลบ localStorage เดิม ลาย preset ภายในจะถูกแปลงเป็น PNG 2048px;
              SVG อื่นจะถูกข้ามเพื่อความปลอดภัย
            </p>
            {journal.items.flatMap((item) => item.warnings).map((warning, index) => (
              <div className="migration-warning" key={`${warning}-${index}`}>{warning}</div>
            ))}
            {error && <div className="login-error">{error}</div>}
            <div className="modal-actions">
              <button onClick={onDecline}>ยังไม่ย้าย</button>
              <button className="primary" disabled={!migratable || busy} onClick={onAccept}>ย้ายขึ้น Cloud</button>
            </div>
          </>
        ) : (
          <>
            <p>{busy ? 'กำลังย้ายและตรวจสอบงาน…' : `ย้ายสำเร็จ ${complete} งาน`}</p>
            {(skipped > 0 || conflicts > 0 || failed > 0) && (
              <p className="migration-note">ข้าม {skipped} · ข้อมูลเปลี่ยน {conflicts} · ลองใหม่ได้ {failed}</p>
            )}
            {journal.items.map((item) => (
              <div className={`migration-item migration-${item.status}`} key={item.sourceProjectKey}>
                <span>{item.project?.name ?? item.sourceProjectKey}</span>
                <span>{migrationStatusLabel(item.status)}</span>
                {item.error && <small>{item.error}</small>}
              </div>
            ))}
            {error && <div className="login-error">{error}</div>}
            <div className="modal-actions">
              {failed > 0 && <button disabled={busy} onClick={onRetry}>ลองใหม่</button>}
              <button className="primary" disabled={busy || (!terminal && failed === 0)} onClick={onClose}>ปิด</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function migrationStatusLabel(status: LegacyMigrationJournal['items'][number]['status']): string {
  switch (status) {
    case 'pending': return 'รอ'
    case 'uploading': return 'กำลังอัปโหลดรูป'
    case 'importing': return 'กำลังสร้างงาน'
    case 'complete': return 'สำเร็จ'
    case 'skipped': return 'ข้าม'
    case 'conflict': return 'ต้นทางเปลี่ยน'
    case 'error': return 'ไม่สำเร็จ'
  }
}
