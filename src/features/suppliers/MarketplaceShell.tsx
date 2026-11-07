import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { SupplierCapability } from '../../../shared/contracts/marketplace'
import { PackItMark } from '../../components/Login'
import { supplierCapabilityNames } from './supplierUi'
import './marketplace.css'

export function MarketplaceShell({
  title,
  children,
  publicPage = false,
}: {
  title: string
  children: ReactNode
  publicPage?: boolean
}) {
  return (
    <div className="marketplace-page">
      <header className="marketplace-header">
        <Link className="marketplace-brand" to={publicPage ? '/' : '/app/projects'}>
          <span className="login-mark"><PackItMark /></span>
          <span>{publicPage ? 'PackIt' : 'กลับไปที่งานของฉัน'}</span>
        </Link>
        {!publicPage && <Link to="/factory/onboarding">พื้นที่ผู้รับผลิต</Link>}
      </header>
      <main className="marketplace-main">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  )
}

export function MarketplaceError({ message, retry }: { message: string; retry?(): void }) {
  return (
    <div className="marketplace-notice is-error" role="alert">
      <p>{message}</p>
      {retry && <button type="button" onClick={retry}>ลองใหม่</button>}
    </div>
  )
}

export function CapabilityList({ capabilities }: { capabilities: SupplierCapability[] }) {
  if (capabilities.length === 0) return <p className="marketplace-muted">ยังไม่ได้ระบุความสามารถในการผลิต</p>
  return (
    <ul className="marketplace-capabilities" aria-label="ความสามารถในการผลิต">
      {capabilities.map((item) => <li key={item}>{supplierCapabilityNames[item]}</li>)}
    </ul>
  )
}
