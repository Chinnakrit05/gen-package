export const APP_MODES = ['local', 'cloud'] as const

export type AppMode = (typeof APP_MODES)[number]

export interface HealthData {
  status: 'ok'
}
