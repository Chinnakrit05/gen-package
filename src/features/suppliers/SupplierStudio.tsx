import './studio-suppliers.css'

export function SupplierIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="studio-supplier-intro">
    <p className="studio-eyebrow">{eyebrow}</p>
    <h2>{title}</h2>
    <p>{description}</p>
  </div>
}
