import type { ReactNode } from 'react'
import type { SupplierCapability } from '../../../shared/contracts/marketplace'
import { StudioShell, type StudioNavigationContext } from '../../app/StudioShell'
import { supplierCapabilityNames } from './supplierUi'
import './marketplace.css'

export function MarketplaceShell({
  title,
  children,
  publicPage = false,
  navigationContext,
}: {
  title: string
  children: ReactNode
  publicPage?: boolean
  navigationContext?: StudioNavigationContext
}) {
  return (
    <StudioShell title={title} navigationContext={navigationContext} publicPage={publicPage} className="marketplace-page">
      <div className="marketplace-main">{children}</div>
    </StudioShell>
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
