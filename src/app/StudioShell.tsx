import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, useLocation } from 'react-router'
import { ArrowUpRight, Bell, Box, Building2, ChevronRight, FileText, Layers3, LogOut, MessageCircle, Menu, ShieldCheck, Store, Users, X } from 'lucide-react'
import { CloudSessionContext, type CloudSessionValue } from './cloudSession'
import { marketplaceSuppliersEnabled } from '../config'
import { getAdminContext } from '../services/api/admin'
import { getMarketplaceContext, marketplaceContextKey } from '../services/api/marketplace'
import { studioHasStaffAccess, studioNavigation, studioRoleForPath, studioSupplierForPath, type StudioIconName, type StudioRole, type StudioNavItem } from './studioNavigation'
import './studioShell.css'

const icons = { projects: Layers3, requests: FileText, factory: Building2, team: Users, review: ShieldCheck, profile: Store, bell: Bell, chat: MessageCircle, orders: Box }
export function StudioIcon({ name }: { name: StudioIconName }) { const Icon = icons[name]; return <Icon size={19} strokeWidth={1.7} aria-hidden="true" /> }
function StudioNavigationLink({ item, activeTo, closeDrawer }: { item: StudioNavItem; activeTo?: string; closeDrawer(): void }) {
  const content = <><StudioIcon name={item.icon} /><span>{item.label}</span><ChevronRight size={14} aria-hidden="true" /></>
  return activeTo === item.to
    ? <Link to={item.to} aria-current="page" onClick={closeDrawer} className="studio-nav-item is-active">{content}</Link>
    : <NavLink to={item.to} end={item.exact} onClick={closeDrawer} className={({ isActive }) => `studio-nav-item${isActive ? ' is-active' : ''}`}>{content}</NavLink>
}
export function StudioBrand({ to = '/app/projects' }: { to?: string }) {
  return <Link className="studio-brand" to={to} aria-label="PackIt หน้าหลัก"><span><Box size={25} strokeWidth={1.8} aria-hidden="true" /></span><strong>PackIt<span>.</span></strong></Link>
}
export interface StudioNavigationContext { role: StudioRole; supplierId?: string; activeTo?: string }
interface StudioShellProps {
  navigationContext?: StudioNavigationContext
  title: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  publicPage?: boolean
  onWorkspaceChange?(workspaceId: string): void
  className?: string
}
export function StudioShell(props: StudioShellProps) {
  const session = useContext(CloudSessionContext)
  if (props.publicPage || !session) return <div className="studio-shell studio-public"><header className="studio-public-header"><StudioBrand to="/" /><Link className="studio-button" to="/app/projects">พื้นที่ทำงาน <ArrowUpRight size={16} aria-hidden="true" /></Link></header><main id="studio-main" className={`studio-content ${props.className ?? ''}`}><PageHeading {...props} />{props.children}</main><StudioFooter /></div>
  return <AuthenticatedStudioShell {...props} session={session} />
}
function PageHeading({ title, description, eyebrow, actions }: StudioShellProps) {
  return <div className="studio-page-heading"><div><p className="studio-eyebrow">{eyebrow ?? 'PACKIT / WORKSPACE'}</p><h1>{title}</h1>{description && <p className="studio-page-description">{description}</p>}</div>{actions && <div className="studio-heading-actions">{actions}</div>}</div>
}
function StudioFooter() { return <footer className="studio-footer"><span>PackIt Marketplace</span><span>จากไอเดีย สู่บรรจุภัณฑ์ที่เป็นไปได้</span></footer> }
function AuthenticatedStudioShell({ session, ...props }: StudioShellProps & { session: CloudSessionValue }) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawer = useRef<HTMLDialogElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const context = useQuery({
    queryKey: marketplaceContextKey(session.appUserId),
    queryFn: ({ signal }) => getMarketplaceContext(session.apiBaseUrl, session.getAccessToken(), signal),
    enabled: marketplaceSuppliersEnabled,
    retry: false,
    staleTime: 30_000,
  })
  const admin = useQuery({ queryKey: ['cloud', session.appUserId, session.workspaceId, 'commerce', 'admin-context'], queryFn: ({ signal }) => getAdminContext(session.apiBaseUrl, session.getAccessToken(), signal), enabled: marketplaceSuppliersEnabled, retry: false, gcTime: 0, refetchOnWindowFocus: true })
  const adminScopes = admin.isSuccess ? admin.data.scopes : []
  const role = props.navigationContext?.role ?? studioRoleForPath(location.pathname)
  const supplier = props.navigationContext?.supplierId ? (context.isSuccess ? context.data.suppliers.find(item => item.profile.id === props.navigationContext?.supplierId) : undefined) : studioSupplierForPath(location.pathname, context.isSuccess ? context.data.suppliers : [])
  const nav = studioNavigation(role, supplier, session.meStatus === 'ready' && session.role === 'owner', marketplaceSuppliersEnabled, adminScopes, studioHasStaffAccess(context.isSuccess ? context.data : undefined))
  const canReview = studioHasStaffAccess(context.isSuccess ? context.data : undefined) || adminScopes.length > 0
  const adminHome = adminScopes.includes('operations') ? '/admin' : adminScopes.some(s => s === 'support' || s === 'support_supervisor') ? '/admin/support' : adminScopes.includes('auditor') ? '/admin/audit-log' : adminScopes.includes('user_moderator') ? '/admin/users' : '/admin/suppliers'
  const roleLabel = { buyer: 'ผู้ซื้อ', supplier: 'ผู้รับผลิต', staff: 'เจ้าหน้าที่', shared: 'งานร่วมกัน' }[role]
  const workspace = session.me?.workspaces.find((item) => item.id === session.workspaceId)
  const name = session.me?.user.displayName || 'บัญชี PackIt'
  const closeDrawer = () => { drawer.current?.close(); setDrawerOpen(false) }
  useEffect(() => { closeDrawer() }, [location.pathname, location.search, location.hash])
  useEffect(() => {
    if (!drawerOpen) return
    const dialog = drawer.current
    dialog?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const breakpoint = window.matchMedia('(min-width: 1100px)')
    const onResize = () => { if (breakpoint.matches) closeDrawer() }
    breakpoint.addEventListener('change', onResize)
    return () => { document.body.style.overflow = previous; breakpoint.removeEventListener('change', onResize); dialog?.close() }
  }, [drawerOpen])
  const changeWorkspace = (next: string) => {
    if (next === session.workspaceId) return
    if (props.onWorkspaceChange) props.onWorkspaceChange(next)
    else {
      void queryClient.cancelQueries({ queryKey: ['cloud', session.appUserId, session.workspaceId] })
      session.setWorkspaceId(next)
    }
  }
  const navigation = (mobile = false) => <>
    <div className="studio-sidebar-top"><StudioBrand />{mobile && <button className="studio-icon-button" type="button" aria-label="ปิดเมนู" onClick={closeDrawer}><X size={20} /></button>}</div>
    <p className="studio-sidebar-label">WORKSPACE</p>
    <div className="studio-workspace-card"><span className="studio-workspace-avatar">{role === 'staff' ? <ShieldCheck size={19} /> : role === 'supplier' ? <Building2 size={19} /> : (workspace?.name || 'P').slice(0, 1)}</span><div><strong>{role === 'supplier' ? supplier?.profile.name || 'พื้นที่ผู้รับผลิต' : role === 'staff' ? 'PackIt Platform' : role === 'shared' ? 'พื้นที่งานร่วมกัน' : workspace?.kind === 'personal' ? 'พื้นที่ส่วนตัว' : workspace?.name || 'พื้นที่ทำงาน'}</strong><small>{roleLabel}{role === 'buyer' && session.role === 'viewer' ? ' · ดูอย่างเดียว' : ''}</small></div></div>
    {role === 'buyer' && (session.me?.workspaces.length ?? 0) > 1 && <label className="studio-workspace-select"><span className="sr-only">เปลี่ยนพื้นที่งาน</span><select aria-label="พื้นที่งาน" value={session.workspaceId} onChange={(e) => changeWorkspace(e.target.value)}>{session.me?.workspaces.map((item) => <option key={item.id} value={item.id}>{item.kind === 'personal' ? 'ส่วนตัว' : item.name}{item.role === 'viewer' ? ' (ดูอย่างเดียว)' : ''}</option>)}</select></label>}
    <nav className="studio-navigation" aria-label={mobile ? 'เมนูหลักมือถือ' : 'เมนูหลัก'}>{nav.map((item) => <StudioNavigationLink key={item.to} item={item} activeTo={props.navigationContext?.activeTo} closeDrawer={closeDrawer} />)}</nav>
    <div className="studio-sidebar-bottom"><div className="studio-maker-note"><span className="studio-eyebrow">MADE FOR MAKERS</span><strong>จากไอเดีย<br />สู่สิ่งที่เป็นไปได้</strong><p>ออกแบบและประสานงานผลิต<br />ในพื้นที่เดียวกัน</p></div><div className="studio-account"><span className="studio-avatar">{name.slice(0, 1)}</span><div><strong>{name}</strong><small>{roleLabel} · PackIt</small></div><button className="studio-icon-button" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={() => void session.signOut()}><LogOut size={17} /></button></div></div>
  </>
  return <div className="studio-shell">
    <a className="studio-skip" href="#studio-main">ข้ามไปยังเนื้อหา</a>
    <aside className="studio-sidebar">{navigation()}</aside>
    <dialog ref={drawer} className="studio-drawer" aria-label="เมนูนำทาง" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((item) => item.getClientRects().length > 0)
      const first = items[0], last = items.at(-1)
      if (!first || !last) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }} onClose={() => { setDrawerOpen(false); menuButton.current?.focus() }} onClick={(event) => { if (event.target === event.currentTarget) closeDrawer() }}><div className="studio-drawer-inner">{navigation(true)}</div></dialog>
    <div className="studio-body"><header className="studio-topbar"><button ref={menuButton} type="button" className="studio-icon-button studio-menu" aria-label="เปิดเมนู" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu size={21} /></button><div className="studio-breadcrumb"><span>Workspace</span><ChevronRight size={13} aria-hidden="true" /><strong>{roleLabel}</strong></div><nav className="studio-role-switch" aria-label="พื้นที่การทำงาน"><Link to="/app/projects" aria-current={role === 'buyer' ? 'page' : undefined}>ผู้ซื้อ</Link>{marketplaceSuppliersEnabled && <Link to="/factory/onboarding" aria-current={role === 'supplier' ? 'page' : undefined}>ผู้รับผลิต</Link>}{canReview && <Link to={adminHome} aria-current={role === 'staff' ? 'page' : undefined}>เจ้าหน้าที่</Link>}</nav><div className="studio-topbar-end">{role === 'supplier' && <Link className="studio-icon-button" to="/factory/onboarding#supplier-notifications" aria-label="การแจ้งเตือน"><Bell size={19} /></Link>}<span className="studio-avatar" aria-label={name}>{name.slice(0, 1)}</span></div></header>
      <main id="studio-main" className={`studio-content ${props.className ?? ''}`} tabIndex={-1}><PageHeading {...props} eyebrow={props.eyebrow ?? `PACKIT / ${role === 'supplier' ? 'MAKER WORKSPACE' : role === 'staff' ? 'PLATFORM OPERATIONS' : role === 'shared' ? 'SHARED WORKSPACE' : 'YOUR CREATIVE WORKSPACE'}`} />{props.children}</main><StudioFooter />
    </div>
    <nav className="studio-mobile-bottom" aria-label="เมนูด่วน"><NavLink to="/app/projects"><Layers3 size={20} /><span>งานออกแบบ</span></NavLink>{session.role === 'owner' && marketplaceSuppliersEnabled && <NavLink to="/app/requests"><FileText size={20} /><span>คำขอราคา</span></NavLink>}{marketplaceSuppliersEnabled && <NavLink to="/factory/onboarding"><Building2 size={20} /><span>ผู้รับผลิต</span></NavLink>}{canReview && <NavLink to={adminHome}><ShieldCheck size={20} /><span>เจ้าหน้าที่</span></NavLink>}</nav>
  </div>
}
