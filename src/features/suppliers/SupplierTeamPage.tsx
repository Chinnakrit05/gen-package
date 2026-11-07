import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import {
  MARKETPLACE_ROLES,
  type CreatedSupplierInvite,
  type MarketplaceRole,
  type SupplierTeam,
  type SupplierTeamMember,
} from '../../../shared/contracts/marketplace'
import { SessionChangedError, useCloudSession } from '../../app/cloudSession'
import { supplierInviteLink } from '../../app/supplierInviteRoute'
import { ApiClientError } from '../../services/api/client'
import {
  getSupplierTeam,
  inviteSupplierMember,
  marketplaceContextKey,
  removeSupplierMember,
  revokeSupplierInvite,
  updateSupplierMember,
} from '../../services/api/marketplace'
import { MarketplaceError, MarketplaceShell } from './MarketplaceShell'
import { SUPPLIER_ID, supplierError, supplierRoleNames } from './supplierUi'

const inviteDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

export function SupplierTeamPage() {
  const { supplierId } = useParams()
  return (
    <MarketplaceShell title="จัดการทีมผู้รับผลิต">
      {supplierId && SUPPLIER_ID.test(supplierId)
        ? <SupplierTeamRoute key={supplierId} supplierId={supplierId} />
        : <MarketplaceError message="ลิงก์ทีมผู้รับผลิตไม่ถูกต้อง" />}
    </MarketplaceShell>
  )
}

function SupplierTeamRoute({ supplierId }: { supplierId: string }) {
  const session = useCloudSession()
  const team = useQuery({
    queryKey: ['cloud', session.appUserId, 'marketplace', 'supplier-team', supplierId],
    queryFn: ({ signal }) => getSupplierTeam(session.apiBaseUrl, session.getAccessToken(), supplierId, signal),
    gcTime: 0,
  })
  const unavailable = team.error instanceof ApiClientError && [401, 403, 404].includes(team.error.status)
  const reload = () => void team.refetch()

  return (
    <>
      <div><Link to={`/factory/${supplierId}/profile`}>กลับไปที่โปรไฟล์ผู้รับผลิต</Link></div>
      {team.isPending && <p role="status">กำลังโหลดข้อมูลทีม…</p>}
      {team.isError && (
        <MarketplaceError
          message={unavailable ? 'บัญชีนี้เปิดหน้าจัดการทีมไม่ได้' : 'โหลดข้อมูลทีมไม่สำเร็จ'}
          retry={unavailable ? undefined : reload}
        />
      )}
      {team.data && !unavailable && (
        <SupplierTeamPanel supplierId={supplierId} team={team.data} reload={reload} blocked={team.isFetching || team.isError} />
      )}
    </>
  )
}

function SupplierTeamPanel({ supplierId, team, reload, blocked }: {
  supplierId: string
  team: SupplierTeam
  reload(): void
  blocked: boolean
}) {
  const { apiBaseUrl, appUserId, getAccessToken } = useCloudSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MarketplaceRole>('staff')
  const [createdInvite, setCreatedInvite] = useState<CreatedSupplierInvite | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const disabled = busy || blocked
  const runAction = async <Result,>(
    request: (token: string) => Promise<Result>,
    onSuccess: (result: Result) => void,
    fallback: string,
  ) => {
    if (disabled) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await request(getAccessToken())
      if (!active.current) return
      getAccessToken()
      onSuccess(result)
    } catch (failure) {
      if (active.current && !(failure instanceof SessionChangedError)) setError(supplierError(failure, fallback))
    } finally {
      if (active.current) {
        setBusy(false)
        // A request can reach the server even when its response is lost.
        reload()
      }
    }
  }

  const leaveAfterOwnRoleChange = (path: string) => {
    void queryClient.invalidateQueries({ queryKey: marketplaceContextKey(appUserId) })
    void navigate(path, { replace: true })
  }

  const changeRole = (member: SupplierTeamMember, role: MarketplaceRole) => {
    void runAction((token) => updateSupplierMember(apiBaseUrl, token, supplierId, member.userId, role), () => {
      if (member.userId === appUserId && role !== 'manager') leaveAfterOwnRoleChange(`/factory/${supplierId}/profile`)
      else setNotice('บันทึกบทบาทสมาชิกแล้ว')
    }, 'เปลี่ยนบทบาทสมาชิกไม่สำเร็จ')
  }

  const removeMember = (member: SupplierTeamMember) => {
    if (!window.confirm(`นำ ${member.displayName} ออกจากทีมผู้รับผลิตใช่ไหม?`)) return
    void runAction((token) => removeSupplierMember(apiBaseUrl, token, supplierId, member.userId), () => {
      if (member.userId === appUserId) leaveAfterOwnRoleChange('/factory/onboarding')
      else setNotice('นำสมาชิกออกจากทีมแล้ว')
    }, 'นำสมาชิกออกจากทีมไม่สำเร็จ')
  }

  const revokeInvite = (inviteId: string, address: string) => {
    if (!window.confirm(`ยกเลิกคำเชิญของ ${address} ใช่ไหม?`)) return
    void runAction((token) => revokeSupplierInvite(apiBaseUrl, token, supplierId, inviteId), () => {
      if (createdInvite?.invite.id === inviteId) setCreatedInvite(null)
      setNotice('ยกเลิกคำเชิญแล้ว')
    }, 'ยกเลิกคำเชิญไม่สำเร็จ')
  }

  return (
    <>
      {error && <MarketplaceError message={error} />}
      {notice && <p className="marketplace-notice" role="status">{notice}</p>}
      <section className="marketplace-card">
        <h2>เชิญสมาชิก</h2>
        <p>สร้างลิงก์แล้วส่งให้ผู้รับทางช่องทางที่คุณใช้ ผู้รับต้องเข้าสู่ PackIt ด้วยอีเมลที่ระบุ</p>
        <form className="marketplace-form" onSubmit={(event) => {
          event.preventDefault()
          setCreatedInvite(null)
          void runAction((token) => inviteSupplierMember(apiBaseUrl, token, supplierId, { email: email.trim(), role: inviteRole }), (result) => {
            setCreatedInvite(result)
            setEmail('')
          }, 'สร้างลิงก์เชิญไม่สำเร็จ')
        }}>
          <fieldset className="marketplace-form-fields" disabled={disabled}>
            <div className="marketplace-form-columns">
              <label>
                อีเมลผู้รับคำเชิญ
                <input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label>
                บทบาทของผู้รับคำเชิญ
                <RoleSelect value={inviteRole} onChange={setInviteRole} />
              </label>
            </div>
            <button type="submit" className="primary">สร้างลิงก์เชิญ</button>
          </fieldset>
        </form>
        {createdInvite && (
          <CreatedInviteLink key={createdInvite.invite.id} invite={createdInvite} dismiss={() => setCreatedInvite(null)} />
        )}
      </section>
      <section className="marketplace-card">
        <div className="marketplace-meta">
          <h2>สมาชิกในทีม</h2>
          <button type="button" disabled={disabled} onClick={reload}>โหลดข้อมูลทีมล่าสุด</button>
        </div>
        <ul className="marketplace-list">
          {team.members.map((member) => (
            <TeamMemberRow
              key={`${member.userId}:${member.role}`}
              member={member}
              ownAccount={member.userId === appUserId}
              disabled={disabled}
              save={(role) => changeRole(member, role)}
              remove={() => removeMember(member)}
            />
          ))}
        </ul>
      </section>
      <section className="marketplace-card">
        <h2>คำเชิญที่รอตอบรับ</h2>
        {team.invites.length === 0 ? <p className="marketplace-muted">ไม่มีคำเชิญที่รอตอบรับ</p> : (
          <ul className="marketplace-list">
            {team.invites.map((invite) => (
              <li className="marketplace-team-row" key={invite.id}>
                <div className="marketplace-description">
                  <strong>{invite.email}</strong>
                  <p>{supplierRoleNames[invite.role]} · หมดอายุ <time dateTime={invite.expiresAt}>{inviteDate.format(new Date(invite.expiresAt))}</time></p>
                </div>
                <button type="button" disabled={disabled} onClick={() => revokeInvite(invite.id, invite.email)}>ยกเลิกคำเชิญ</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function RoleSelect({ value, onChange }: { value: MarketplaceRole; onChange(value: MarketplaceRole): void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as MarketplaceRole)}>
      {MARKETPLACE_ROLES.map((role) => <option key={role} value={role}>{supplierRoleNames[role]}</option>)}
    </select>
  )
}

function TeamMemberRow({ member, ownAccount, disabled, save, remove }: {
  member: SupplierTeamMember
  ownAccount: boolean
  disabled: boolean
  save(role: MarketplaceRole): void
  remove(): void
}) {
  const [role, setRole] = useState(member.role)
  return (
    <li className="marketplace-team-row">
      <div className="marketplace-description">
        <strong>{member.displayName || 'สมาชิก PackIt'}{ownAccount ? ' (คุณ)' : ''}</strong>
        <p>{supplierRoleNames[member.role]}{member.isWorkspaceOwner ? ' · เจ้าของพื้นที่ทำงาน' : ''}</p>
      </div>
      {!member.isWorkspaceOwner && (
        <fieldset className="marketplace-team-actions" disabled={disabled}>
          <label>
            บทบาทสมาชิก
            <RoleSelect value={role} onChange={setRole} />
          </label>
          <button type="button" disabled={role === member.role} onClick={() => save(role)}>บันทึกบทบาท</button>
          <button type="button" onClick={remove}>นำออกจากทีม</button>
        </fieldset>
      )}
    </li>
  )
}

function CreatedInviteLink({ invite, dismiss }: { invite: CreatedSupplierInvite; dismiss(): void }) {
  const [notice, setNotice] = useState<string | null>(null)
  const link = supplierInviteLink(window.location.origin, invite.token)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setNotice('คัดลอกลิงก์แล้ว')
    } catch {
      setNotice('คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความในช่องลิงก์แล้วคัดลอก')
    }
  }
  return (
    <div className="marketplace-notice">
      <p>สร้างลิงก์สำหรับ <strong>{invite.invite.email}</strong> แล้ว คัดลอกลิงก์ไว้ก่อนออกจากหน้านี้</p>
      <label>
        ลิงก์เชิญ
        <input type="text" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <div className="marketplace-meta">
        <button type="button" onClick={() => void copy()}>คัดลอกลิงก์เชิญ</button>
        <button type="button" onClick={dismiss}>ซ่อนลิงก์</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}
