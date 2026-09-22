import type { ApiErrorCode, ApiFailure } from '../../shared/contracts/errors'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function toApiFailure(error: HttpError, requestId: string): ApiFailure {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    requestId,
  }
}
