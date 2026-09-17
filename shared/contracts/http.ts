import type { ApiFailure } from './errors'

export interface ApiSuccess<T> {
  data: T
  requestId: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure
