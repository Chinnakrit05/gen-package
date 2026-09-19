export const API_ERROR_CODES = [
  'ASSET_NOT_READY',
  'ASSET_QUOTA_EXCEEDED',
  'AI_API_KEY_INVALID',
  'AI_API_KEY_REQUIRED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_RATE_LIMITED',
  'AUTH_REQUIRED',
  'BODY_TOO_LARGE',
  'CONFIGURATION_ERROR',
  'DEPENDENCY_UNAVAILABLE',
  'IDEMPOTENCY_KEY_REUSED',
  'INVALID_REQUEST',
  'LEGACY_SOURCE_CHANGED',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'SESSION_INVALID',
  'USER_NOT_ACTIVE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_ERROR',
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
