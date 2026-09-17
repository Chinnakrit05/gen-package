export const API_ERROR_CODES = [
  'AUTH_REQUIRED',
  'CONFIGURATION_ERROR',
  'DEPENDENCY_UNAVAILABLE',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'SESSION_INVALID',
  'USER_NOT_ACTIVE',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface ApiFailure {
  error: ApiErrorBody
  requestId: string
}
