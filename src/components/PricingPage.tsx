import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft, Box, Check, Crown, FileDown, Sparkles, X } from 'lucide-react'
import type { BillingCatalog, OrderKind, PlanCode } from '../../shared/contracts/billing'
import { useT } from '../i18n'
import { FALLBACK_AMOUNT_MINOR, formatBaht } from './PaywallModal'

// หน้าแพ็กเกจและราคา — เปรียบเทียบ Freemium / ซื้อรายแบบ / Pro (ดู docs/billing-freemium-pro.md §1)
// ใช้สองที่: ในแอป (สมาชิก cloud: เห็นแพ็กเกจปัจจุบัน ปุ่มซื้อเปิด PaywallModal) และหน้าเข้าสู่ระบบ (ผู้เยี่ยมชม:
// ปุ่มทั้งหมดพาไปเข้าสู่ระบบ) — ราคา/เครดิตมาจาก catalog ของ server; ผู้เยี่ยมชมยังไม่มี catalog (endpoint ต้อง login)
// จึงใช้ราคาสำรองเดียวกับ PaywallModal และไม่แสดงจำนวนเครดิต (ไม่เดาตัวเลขที่ผู้ดูแลปรับได้)
// ยังไม่เปิดขาย (purchasesEnabled false — ผู้เยี่ยมชมเป็น false เสมอ): ปุ่มของแพ็กเกจที่ต้องจ่ายเป็น "เปิดขายเร็ว ๆ นี้"
// แบบกดไม่ได้ (รวมต่ออายุ Pro) + ป้ายแจ้งใต้หัวหน้า + FAQ วิธีชำระบอกว่ายังไม่เปิด — ไม่มีข้อความให้ติดต่อผู้ดูแล
// ช่วงเปิดใช้ฟรี (สมาชิกที่ openAccess): ป้ายใต้หัวหน้าบอกว่าใช้ Pro ได้ฟรีพร้อมโควตาเครดิต และแบบที่ยังไม่ซื้อ
// จะกลับไปใช้กติกาปกติเมื่อเปิดขาย (ช่วงนี้ไม่ออกสิทธิ์ถาวร) — การ์ด Pro เป็น "ใช้ฟรีอยู่" ต่อรอบให้อัตโนมัติ

export type PricingViewer =
  | { kind: 'guest' }
  | {
      kind: 'member'
      plan: PlanCode
      proUntilLabel: string
      credits: number
      projectName: string
      activeLicensed: boolean
      // ช่วงเปิดใช้ฟรี (Entitlements.openAccess): plan เป็น 'pro' จากรอบ Pro ฟรีที่ต่อเองทุกรอบ
      openAccess?: boolean
    }

export interface PricingPageProps {
  viewer: PricingViewer
  catalog: BillingCatalog | null
  // เปิดให้ซื้อได้หรือไม่ (Entitlements.purchasesEnabled จาก server; ผู้เยี่ยมชม/โหลดสิทธิ์ไม่ได้ = false)
  purchasesEnabled: boolean
  onClose(): void
  // สมาชิก: 'design'/'pro' → เปิด paywall, 'free' → กลับไปออกแบบ; ผู้เยี่ยมชม: ทุกปุ่ม → เข้าสู่ระบบ
  onChoose(kind: OrderKind | 'free'): void
  // มี modal ซ้อนอยู่ข้างบน (paywall) — Esc ต้องปิด modal นั้น ไม่ใช่หน้านี้
  escapeDisabled?: boolean
}

type Cell = boolean | string

interface PlanCard {
  key: OrderKind | 'free'
  icon: ReactNode
  name: string
  tagline: string
  price: string
  unit: string
  features: { ok: boolean; text: string }[]
  cta: { label: string; disabled: boolean; primary: boolean }
  current: string | null // ป้าย "แพ็กเกจปัจจุบัน" (null = ไม่ใช่)
  featured?: boolean
  note?: string
}

export function PricingPage({ viewer, catalog, purchasesEnabled, onClose, onChoose, escapeDisabled = false }: PricingPageProps) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const escRef = useRef({ escapeDisabled, onClose })
  escRef.current = { escapeDisabled, onClose }

  // โฟกัสหน้าตอนเปิด, Esc ปิด (เว้นมี modal ซ้อน), ล็อกการเลื่อนของหน้าหลัง, ปิดแล้วคืนโฟกัส
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    rootRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || escRef.current.escapeDisabled) return
      escRef.current.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const guest = viewer.kind === 'guest'
  const member = viewer.kind === 'member' ? viewer : null
  const isPro = member?.plan === 'pro'
  const openAccess = member?.openAccess === true

  const designMinor = catalog?.design.amountMinor ?? FALLBACK_AMOUNT_MINOR.design
  const proMinor = catalog?.pro.amountMinor ?? FALLBACK_AMOUNT_MINOR.pro
  const designPrice = formatBaht(designMinor)
  const proPrice = formatBaht(proMinor)
  const designCredits = catalog?.design.credits ?? null
  const proCredits = catalog?.pro.credits ?? null
  const periodDays = catalog?.pro.periodDays ?? 30
  // Pro คุ้มกว่าซื้อรายแบบเมื่อทำตั้งแต่ N แบบต่อรอบ (N×ราคาแบบ > ราคา Pro)
  const breakEven = Math.floor(proMinor / designMinor) + 1

  const openAccessNote = proCredits !== null
    ? t(
      `ทุกบัญชีดาวน์โหลดไฟล์ผลิตได้ทุกแบบ ไม่มีลายน้ำ และได้เครดิต AI ${proCredits} เครดิตทุก ${periodDays} วัน — เมื่อเปิดขาย แบบที่ยังไม่ได้ซื้อจะกลับไปใช้กติกาปกติ`,
      `Every account can download production files for any design, with no watermark and ${proCredits} AI credits every ${periodDays} days. Once sales open, designs you have not bought follow the normal rules.`,
    )
    : t(
      `ทุกบัญชีดาวน์โหลดไฟล์ผลิตได้ทุกแบบ ไม่มีลายน้ำ และได้เครดิต AI ทุก ${periodDays} วัน — เมื่อเปิดขาย แบบที่ยังไม่ได้ซื้อจะกลับไปใช้กติกาปกติ`,
      `Every account can download production files for any design, with no watermark and AI credits every ${periodDays} days. Once sales open, designs you have not bought follow the normal rules.`,
    )

  const projectLabel = member ? `“${member.projectName}”` : ''
  const comingSoon = { label: t('เปิดขายเร็ว ๆ นี้', 'Coming soon'), disabled: true, primary: false }

  const cards: PlanCard[] = [
    {
      key: 'free',
      icon: <Box size={22} aria-hidden="true" />,
      name: 'Freemium',
      tagline: t('ลองออกแบบได้ทุกอย่าง ไม่มีค่าใช้จ่าย', 'Design anything, free of charge'),
      price: t('ฟรี', 'Free'),
      unit: t('ตลอดไป', 'forever'),
      features: [
        { ok: true, text: t('ออกแบบกล่อง ถุง ฉลาก สติกเกอร์ ได้ทุกแบบ', 'Every box, pouch, label and sticker template') },
        { ok: true, text: t('พรีวิว 3D + blueprint การพับ (มีลายน้ำ)', '3D preview + folding blueprint (watermarked)') },
        { ok: true, text: t('บันทึกงานบน cloud + ไฟล์สำรอง .genpkg.json', 'Cloud saves + .genpkg.json backups') },
        { ok: false, text: t('สั่ง AI สร้าง/ปรับสเปก', 'AI spec generation') },
        { ok: false, text: t('ดาวน์โหลดไฟล์ผลิตและใบสเปก', 'Production files and quote sheet') },
      ],
      cta: guest
        ? { label: t('เริ่มใช้ฟรี', 'Start for free'), disabled: false, primary: false }
        : isPro
          ? { label: t('รวมอยู่ใน Pro แล้ว', 'Included in Pro'), disabled: true, primary: false }
          : { label: t('กลับไปออกแบบต่อ', 'Back to designing'), disabled: false, primary: false },
      current: member && !isPro ? t('แพ็กเกจปัจจุบัน', 'Current plan') : null,
    },
    {
      key: 'design',
      icon: <FileDown size={22} aria-hidden="true" />,
      name: t('ซื้อรายแบบ', 'Per design'),
      tagline: t('จ่ายเฉพาะแบบที่จะส่งผลิต', 'Pay only for the design you produce'),
      price: designPrice,
      unit: t('ต่อแบบ · จ่ายครั้งเดียว', 'per design · one-time'),
      features: [
        { ok: true, text: t('ทุกอย่างใน Freemium', 'Everything in Freemium') },
        { ok: true, text: t('ดาวน์โหลด SVG · DXF · PDF 1:1 · ใบสเปก ของแบบนั้นได้ตลอด', 'SVG · DXF · 1:1 PDF · quote sheet for that design, forever') },
        { ok: true, text: t('แก้ต่อแล้วดาวน์โหลดใหม่ได้ ไม่ต้องจ่ายเพิ่ม', 'Edit and re-download at no extra cost') },
        { ok: true, text: t('ไม่มีลายน้ำบนแบบนั้น', 'No watermark on that design') },
        {
          ok: true,
          text: designCredits !== null
            ? t(`แถมเครดิต AI ${designCredits} เครดิต`, `${designCredits} bonus AI credits`)
            : t('แถมเครดิต AI', 'Bonus AI credits'),
        },
      ],
      // สถานะที่เป็นข้อเท็จจริง (Pro ครอบคลุมแล้ว / ซื้อแล้ว) แสดงเหมือนเดิมแม้ยังไม่เปิดขาย — ไม่ใช่ปุ่มซื้อ
      cta: isPro
        ? { label: t('Pro ดาวน์โหลดได้ทุกแบบอยู่แล้ว', 'Pro already covers every design'), disabled: true, primary: false }
        : member?.activeLicensed
          ? { label: t(`ซื้อแบบ ${projectLabel} แล้ว`, `${projectLabel} is already yours`), disabled: true, primary: false }
          : !purchasesEnabled
            ? comingSoon
            : guest
              ? { label: t('เข้าสู่ระบบเพื่อซื้อ', 'Sign in to buy'), disabled: false, primary: false }
              : { label: t(`ซื้อแบบ ${projectLabel}`, `Buy ${projectLabel}`), disabled: false, primary: false },
      current: null,
    },
    {
      key: 'pro',
      icon: <Crown size={22} aria-hidden="true" />,
      name: 'Pro',
      tagline: t('สำหรับคนทำแพ็กเกจหลายแบบ', 'For teams shipping many designs'),
      price: proPrice,
      unit: t('ต่อเดือน', 'per month'),
      features: [
        { ok: true, text: t('ดาวน์โหลดไฟล์ผลิตได้ทุกแบบ', 'Production files for every design') },
        { ok: true, text: t('ไม่มีลายน้ำบนพรีวิวทุกงาน', 'No watermark on any preview') },
        {
          ok: true,
          text: proCredits !== null
            ? t(`เครดิต AI ${proCredits} เครดิต ทุก ${periodDays} วัน`, `${proCredits} AI credits every ${periodDays} days`)
            : t(`เครดิต AI ทุก ${periodDays} วัน`, `AI credits every ${periodDays} days`),
        },
        { ok: true, text: t('เครดิตไม่หมดอายุ ใช้ต่อได้แม้เลิก Pro', 'Credits never expire, even after Pro ends') },
        { ok: true, text: t('แบบที่โหลดตอนเป็น Pro ยังโหลดได้หลังหมดอายุ', 'Designs downloaded while Pro stay downloadable') },
      ],
      cta: !purchasesEnabled
        ? isPro
          ? openAccess
            ? { label: t('ต่อรอบให้อัตโนมัติ', 'Renews automatically'), disabled: true, primary: false }
            : { label: t('ต่ออายุได้เมื่อเปิดขาย', 'Renewal opens soon'), disabled: true, primary: false }
          : comingSoon
        : guest
          ? { label: t('เข้าสู่ระบบเพื่อสมัคร Pro', 'Sign in to go Pro'), disabled: false, primary: true }
          : isPro
            ? { label: t('ต่ออายุ Pro', 'Renew Pro'), disabled: false, primary: true }
            : { label: t('สมัคร Pro', 'Go Pro'), disabled: false, primary: true },
      current: isPro
        ? openAccess
          ? t('ใช้ฟรีอยู่', 'Free for now')
          : member?.proUntilLabel
            ? t(`ใช้อยู่ · ถึง ${member.proUntilLabel}`, `Active · until ${member.proUntilLabel}`)
            : t('แพ็กเกจปัจจุบัน', 'Current plan')
        : null,
      featured: true,
      note: t(`คุ้มกว่าซื้อรายแบบ เมื่อทำตั้งแต่ ${breakEven} แบบต่อเดือน`, `Cheaper than per-design from ${breakEven} designs a month`),
    },
  ]

  const rows: { label: string; cells: [Cell, Cell, Cell] }[] = [
    { label: t('ออกแบบ + พรีวิว 3D / blueprint', 'Design + 3D / blueprint preview'), cells: [true, true, true] },
    { label: t('บันทึกบน cloud + ไฟล์สำรอง .genpkg.json', 'Cloud saves + .genpkg.json backup'), cells: [true, true, true] },
    {
      label: t('ลายน้ำบนพรีวิว', 'Preview watermark'),
      cells: [t('มี', 'Yes'), t('ไม่มี (แบบที่ซื้อ)', 'None (bought design)'), t('ไม่มี', 'None')],
    },
    {
      label: t('เครดิต AI', 'AI credits'),
      cells: [
        '0',
        designCredits !== null ? t(`แถม ${designCredits}`, `${designCredits} bonus`) : t('แถม', 'Bonus'),
        proCredits !== null ? t(`${proCredits} / ${periodDays} วัน`, `${proCredits} / ${periodDays} days`) : t(`ทุก ${periodDays} วัน`, `Every ${periodDays} days`),
      ],
    },
    {
      label: t('ไฟล์ผลิต SVG · DXF · PDF 1:1', 'Production SVG · DXF · 1:1 PDF'),
      cells: [false, t('แบบที่ซื้อ', 'Bought design'), t('ทุกแบบ', 'Every design')],
    },
    {
      label: t('ใบสเปกขอราคา (PDF)', 'Quote sheet (PDF)'),
      cells: [false, t('แบบที่ซื้อ', 'Bought design'), t('ทุกแบบ', 'Every design')],
    },
    {
      label: t('หลังหมดอายุ', 'After it ends'),
      cells: ['—', t('ใช้ได้ตลอด', 'Yours forever'), t('แบบที่โหลดไว้ยังโหลดได้', 'Downloaded designs stay')],
    },
  ]

  const faqs: { q: string; a: string }[] = [
    {
      q: t('เครดิต AI คืออะไร', 'What is an AI credit?'),
      a: t(
        '1 เครดิต = สั่ง AI 1 ครั้ง ทั้งพิมพ์สั่งสร้างและปุ่ม "ปรับเร็ว" (แนบรูปไม่คิดเพิ่ม) ถ้า AI ทำงานไม่สำเร็จระบบคืนเครดิตให้อัตโนมัติ และเครดิตไม่มีวันหมดอายุ',
        '1 credit = 1 AI request, typed or a quick adjust (images are free). If the AI fails, the credit is refunded automatically, and credits never expire.',
      ),
    },
    {
      q: t('"1 แบบ" นับอย่างไร', 'What counts as one design?'),
      a: t(
        'หนึ่งงานในพื้นที่งานของคุณ ซื้อแล้วแก้ขนาด วัสดุ หรือลายต่อ แล้วดาวน์โหลดใหม่ได้ตลอด ส่วนสำเนาหรืองานที่นำเข้าจากไฟล์นับเป็นงานใหม่ ต้องซื้อแยก',
        'One project in your workspace. After buying you can change its size, material or artwork and re-download anytime. Copies and imported files count as new designs.',
      ),
    },
    {
      q: t('ถ้า Pro หมดอายุจะเป็นอย่างไร', 'What happens when Pro ends?'),
      a: t(
        'แบบที่เคยดาวน์โหลดตอนเป็น Pro ยังดาวน์โหลดได้และไม่มีลายน้ำ แบบใหม่จะกลับเป็นกติกา Freemium และเครดิตที่เหลือยังใช้ต่อได้',
        'Designs you downloaded while Pro stay downloadable without a watermark. New designs follow Freemium rules, and leftover credits keep working.',
      ),
    },
    {
      q: t('ชำระเงินอย่างไร', 'How do I pay?'),
      a: purchasesEnabled
        ? t(
          'ระบบชำระเงินออนไลน์ยังไม่เปิดให้บริการ กดซื้อแล้วระบบจะสร้างคำสั่งซื้อไว้ให้ ติดต่อผู้ดูแลเพื่อเปิดสิทธิ์',
          'Online payment is not open yet. Pressing buy creates an order; contact the administrator to activate it.',
        )
        : openAccess
          ? t(
            'ยังไม่เปิดรับชำระเงิน เราจะประกาศให้ทราบเมื่อเปิดขาย ระหว่างนี้ทุกบัญชีใช้ Pro ได้ฟรี',
            'Payments are not open yet — we will announce when sales open. Meanwhile, every account gets Pro for free.',
          )
          : t(
            'ยังไม่เปิดรับชำระเงิน เราจะประกาศให้ทราบเมื่อเปิดขาย ระหว่างนี้ออกแบบและดูพรีวิวได้ฟรีทุกอย่าง',
            'Payments are not open yet — we will announce when sales open. Meanwhile, design and preview everything for free.',
          ),
    },
  ]

  const renderCell = (cell: Cell) => {
    if (cell === true) return <span className="pricing-yes" aria-label={t('มี', 'Included')}><Check size={16} aria-hidden="true" /></span>
    if (cell === false) return <span className="pricing-no" aria-label={t('ไม่มี', 'Not included')}><X size={16} aria-hidden="true" /></span>
    return cell
  }

  return (
    <div
      ref={rootRef}
      className="pricing-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-title"
      tabIndex={-1}
    >
      <div className="pricing-shell">
        <div className="pricing-top">
          <button type="button" className="pricing-back" onClick={onClose}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{guest ? t('กลับไปหน้าเข้าสู่ระบบ', 'Back to sign in') : t('กลับไปออกแบบ', 'Back to designing')}</span>
          </button>
          <span className="pricing-brand">PackIt</span>
        </div>

        <section className="pricing-hero">
          <span className="pricing-eyebrow"><Sparkles size={14} aria-hidden="true" /> {t('แพ็กเกจ PackIt', 'PackIt plans')}</span>
          <h1 id="pricing-title">{t('ออกแบบฟรี จ่ายเมื่อพร้อมผลิต', 'Design for free. Pay when you print.')}</h1>
          <p>
            {t(
              'ลองออกแบบบรรจุภัณฑ์พร้อมพรีวิว 3D ได้ไม่จำกัด แล้วเลือกจ่ายเฉพาะแบบที่จะส่งโรงพิมพ์ หรือสมัคร Pro เพื่อดาวน์โหลดได้ทุกแบบ',
              'Try unlimited packaging designs with 3D previews, then pay only for the design you send to print — or go Pro to download every design.',
            )}
          </p>
          {openAccess ? (
            <div className="pricing-soon" role="note">
              <b>{t('ตอนนี้ใช้ Pro ได้ฟรี', 'Pro is free for now')}</b>
              <span>{openAccessNote}</span>
            </div>
          ) : !purchasesEnabled && (
            <div className="pricing-soon" role="note">
              <b>{t('ยังไม่เปิดขาย', 'Not on sale yet')}</b>
              <span>
                {t(
                  'ระบบชำระเงินจะเปิดเร็ว ๆ นี้ ตอนนี้ออกแบบและดูพรีวิวได้ฟรี',
                  'Payments open soon. You can keep designing and previewing for free.',
                )}
              </span>
            </div>
          )}
          {member && (
            <div className="pricing-status" role="status">
              <b>{isPro ? 'Pro' : 'Freemium'}</b>
              {isPro && (openAccess
                ? <span>{t('ใช้ฟรีช่วงนี้', 'free for now')}</span>
                : member.proUntilLabel && <span>{t(`ถึง ${member.proUntilLabel}`, `until ${member.proUntilLabel}`)}</span>)}
              <span className="pricing-status-sep" aria-hidden="true">·</span>
              <span>{t(`เครดิต AI ${member.credits}`, `${member.credits} AI credits`)}</span>
            </div>
          )}
        </section>

        <section className="pricing-grid" aria-label={t('แพ็กเกจ', 'Plans')}>
          {cards.map((card) => (
            <article
              key={card.key}
              className={`plan-card${card.featured ? ' is-featured' : ''}${card.current ? ' is-current' : ''}`}
              aria-label={card.name}
            >
              {card.featured && <span className="plan-ribbon">{t('แนะนำ', 'Best value')}</span>}
              <div className="plan-head">
                <span className="plan-icon">{card.icon}</span>
                {card.current && <span className="plan-current">{card.current}</span>}
              </div>
              <h2 className="plan-name">{card.name}</h2>
              <p className="plan-tagline">{card.tagline}</p>
              <div className="plan-price">
                <b>{card.price}</b>
                <span>{card.unit}</span>
              </div>
              <button
                type="button"
                className={`plan-cta${card.cta.primary ? ' primary' : ''}`}
                disabled={card.cta.disabled}
                onClick={() => onChoose(card.key)}
              >
                {card.cta.label}
              </button>
              {card.note && (
                <p className="plan-note">
                  <Sparkles size={14} aria-hidden="true" /> {card.note}
                </p>
              )}
              <ul className="plan-features">
                {card.features.map((f) => (
                  <li key={f.text} className={f.ok ? 'ok' : 'no'}>
                    <span className="plan-feature-icon" aria-hidden="true">
                      {f.ok ? <Check size={14} /> : <X size={14} />}
                    </span>
                    <span>
                      {!f.ok && <span className="sr-only">{t('ไม่รวม: ', 'Not included: ')}</span>}
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="pricing-compare" aria-labelledby="pricing-compare-title">
          <h2 id="pricing-compare-title">{t('เปรียบเทียบแพ็กเกจ', 'Compare plans')}</h2>
          <div className="pricing-table-wrap">
            <table className="pricing-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">{t('ความสามารถ', 'Feature')}</span></th>
                  <th scope="col">Freemium</th>
                  <th scope="col">{t('รายแบบ', 'Per design')}<small>{designPrice}</small></th>
                  <th scope="col" className="is-featured">Pro<small>{proPrice}{t(' / เดือน', ' / month')}</small></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className={i === 2 ? 'is-featured' : undefined}>{renderCell(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pricing-faq" aria-labelledby="pricing-faq-title">
          <h2 id="pricing-faq-title">{t('คำถามที่พบบ่อย', 'Questions')}</h2>
          <div className="pricing-faq-grid">
            {faqs.map((f) => (
              <details key={f.q} className="pricing-faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="pricing-foot">
          {t(
            'ราคาเป็นเงินบาท · ไฟล์สำรอง .genpkg.json ส่งออก/นำเข้าได้ฟรีทุกแพ็กเกจ',
            'Prices in Thai baht · .genpkg.json backups are free on every plan',
          )}
        </p>
      </div>
    </div>
  )
}
