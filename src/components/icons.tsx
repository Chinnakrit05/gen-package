// ไอคอน SVG เส้นเดียว (currentColor) สำหรับ toolbar เครื่องมือตกแต่ง
// ขนาด 16px, stroke 1.6, round — สืบสีจากตัวอักษรของปุ่มเอง
type IconProps = { size?: number }

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
}

export function IconImage({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.6" />
      <path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 20" />
    </svg>
  )
}

export function IconText({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 6h14M5 6V4.5h14V6M12 6v13M9.5 19h5" />
    </svg>
  )
}

export function IconLineHeight({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 5v14M2 7l2-2 2 2M2 17l2 2 2-2" />
    </svg>
  )
}

export function IconFontSize({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2 20l4.5-13 4.5 13M3.4 15.5h6.2" />
      <path d="M14 20l3-8.5 3 8.5M14.9 16.8h4.2" />
    </svg>
  )
}

export function IconStroke({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="4" strokeWidth={2.6} />
    </svg>
  )
}

export function IconEffects({ size = 16 }: IconProps) {
  // เอฟเฟกต์: ไม้กายสิทธิ์ + ประกาย (สื่อ "แต่งเอฟเฟกต์")
  return (
    <svg {...base(size)}>
      <path d="M4.5 19.5 14 10" />
      <path d="M16.6 4.2l.85 2.05 2.05.85-2.05.85-.85 2.05-.85-2.05-2.05-.85 2.05-.85z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconPosition({ size = 16 }: IconProps) {
  // จัดตำแหน่ง: กรอบประ + ชิ้นเล็กชิดมุม (สื่อ "จัดวางชิ้นในกรอบ")
  return (
    <svg {...base(size)}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.6" />
      <rect x="6.5" y="6.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconNutrition({ size = 16 }: IconProps) {
  // ป้ายข้อมูลโภชนาการ: กรอบเอกสาร + เส้นหัวหนา + แถวรายการ
  return (
    <svg {...base(size)}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 7.5h8" strokeWidth={2.4} />
      <path d="M8 11.5h8M8 15h8M8 18.2h5" />
    </svg>
  )
}

export function IconRect({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </svg>
  )
}

export function IconEllipse({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </svg>
  )
}

export function IconLine({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 19L19 5" />
    </svg>
  )
}

export function IconTriangle({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 4 21 20H3z" />
    </svg>
  )
}

export function IconPolygon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
    </svg>
  )
}

export function IconStar({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z" />
    </svg>
  )
}

export function IconTrash({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5" />
    </svg>
  )
}

export function IconAlignLeft({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M4 12h9M4 17h13" />
    </svg>
  )
}

export function IconAlignCenter({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M7.5 12h9M6 17h12" />
    </svg>
  )
}

export function IconAlignRight({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M11 12h9M7 17h13" />
    </svg>
  )
}

export function IconBox({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3 20 7.2v9.6L12 21l-8-4.2V7.2z" />
      <path d="M4 7.2 12 11.4l8-4.2" />
      <path d="M12 11.4V21" />
    </svg>
  )
}

export function IconBottle({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M10 3h4v2.4c0 .8.3 1.3 1 1.9 1 .9 1.5 2 1.5 3.3V19a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2v-8.4c0-1.3.5-2.4 1.5-3.3.7-.6 1-1.1 1-1.9z" />
      <path d="M9.5 12.5h5" />
    </svg>
  )
}

export function IconFill({ size = 16 }: IconProps) {
  // สีพื้น: สี่เหลี่ยมทึบ
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconNoFill({ size = 16 }: IconProps) {
  // ไม่มีพื้น: กรอบว่าง + ขีดทแยง
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M6 18 18 6" />
    </svg>
  )
}

export function IconGradient({ size = 16 }: IconProps) {
  // ไล่สี: สี่เหลี่ยมครึ่งทึบทแยง
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 20 20 4 20 20Z" fill="currentColor" stroke="none" opacity="0.45" />
    </svg>
  )
}

export function IconWidth({ size = 16 }: IconProps) {
  // กว้าง: ลูกศรแนวนอนสองหัว + เสาปลาย
  return (
    <svg {...base(size)}>
      <path d="M4 5v14M20 5v14" />
      <path d="M7 12h10M9 9l-3 3 3 3M15 9l3 3-3 3" />
    </svg>
  )
}

export function IconHeight({ size = 16 }: IconProps) {
  // สูง: ลูกศรแนวตั้งสองหัว + คานปลาย
  return (
    <svg {...base(size)}>
      <path d="M5 4h14M5 20h14" />
      <path d="M12 7v10M9 9l3-3 3 3M9 15l3 3 3-3" />
    </svg>
  )
}

export function IconGradStart({ size = 16 }: IconProps) {
  // สีเริ่มไล่: วงกลมทึบ
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconGradEnd({ size = 16 }: IconProps) {
  // สีปลายไล่: วงกลมโปร่ง
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="7" />
    </svg>
  )
}

export function IconRadial({ size = 16 }: IconProps) {
  // ไล่สีแบบวงกลม: วงซ้อน
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconAngle({ size = 16 }: IconProps) {
  // มุมไล่สี: มุม/องศา
  return (
    <svg {...base(size)}>
      <path d="M4 19h14" />
      <path d="M4 19 17 7" />
      <path d="M11.5 19a7.5 7.5 0 0 0-1.7-4.8" />
    </svg>
  )
}

export function IconCorner({ size = 16 }: IconProps) {
  // มุมโค้ง: มุมมนสองด้าน
  return (
    <svg {...base(size)}>
      <path d="M20 10V7a3 3 0 0 0-3-3h-3" />
      <path d="M4 14v3a3 3 0 0 0 3 3h3" />
    </svg>
  )
}

export function IconDash({ size = 16 }: IconProps) {
  // เส้นประ
  return (
    <svg {...base(size)}>
      <path d="M3 12h3.5M10.2 12h3.6M17.5 12H21" />
    </svg>
  )
}

export function IconCard({ size = 16 }: IconProps) {
  // นามบัตร: การ์ดแนวนอน + รูปเล็ก + บรรทัดข้อความ
  return (
    <svg {...base(size)}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="8" cy="11" r="1.9" />
      <path d="M12.5 10h5.5M12.5 13.2h3.5M6 15.2h7" />
    </svg>
  )
}

export function IconPouch({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      {/* ปากซีลด้านบน + ลำตัวถุงป่องเล็กน้อย + ก้นตั้ง */}
      <path d="M8 3h8l-.5 2.5M8 3l.5 2.5M8 3H7v1.5h10V3h-1" />
      <path d="M8.5 5.5C7.4 8 7 11 7 14c0 3 .3 5 .8 6.2.2.5.7.8 1.2.8h6c.5 0 1-.3 1.2-.8.5-1.2.8-3.2.8-6.2 0-3-.4-6-1.5-8.5" />
      <path d="M7.6 19.5h8.8" />
    </svg>
  )
}

export function IconUndo({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 6L4 10l4 4" />
      <path d="M4 10h9a6 6 0 0 1 0 12h-3" />
    </svg>
  )
}

export function IconRedo({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M16 6l4 4-4 4" />
      <path d="M20 10h-9a6 6 0 0 0 0 12h3" />
    </svg>
  )
}
