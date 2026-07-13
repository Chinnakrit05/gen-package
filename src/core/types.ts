export interface Vec2 {
  x: number
  y: number
}

export type LineKind = 'cut' | 'crease'

export interface Segment {
  kind: LineKind
  d: string
}

export interface Panel {
  id: string
  parentId: string | null
  outline: Vec2[]
  holes?: Vec2[][]
  hingeA?: Vec2
  hingeB?: Vec2
  foldAngle?: number
  stage: number
  zOffset?: number
}

export interface DimMark {
  a: Vec2
  b: Vec2
  label: string
}

export interface Dieline {
  width: number
  height: number
  segments: Segment[]
  panels: Panel[]
  dims: DimMark[]
}

export interface Material {
  id: string
  nameTh: string
  detail: string
  thickness: number
  foldable: boolean
  process: string
  color: string
  opacity?: number
  roughness?: number
  note?: string
}

export interface BoxParams {
  W: number
  D: number
  H: number
  handle?: boolean
}
