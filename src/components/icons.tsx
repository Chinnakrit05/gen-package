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
