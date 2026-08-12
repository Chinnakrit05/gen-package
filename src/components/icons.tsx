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
