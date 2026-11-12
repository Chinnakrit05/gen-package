export const CONVERSATION_PAGE_SIZE = 24
export const CONVERSATION_MESSAGE_PAGE_SIZE = 40
export const CONVERSATION_FILE_MAX_BYTES = 2 * 1024 * 1024
export const CONVERSATION_FILE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export interface Conversation {
  id: string
  requestId: string
  supplierId: string
  supplierName: string
  requestTitle: string
  createdAt: string
  updatedAt: string
  lastSequence: number
  lastReadSequence: number
  unreadCount: number
  /** Authoritative request-party context; optional for older API compatibility. */
  side?: 'buyer' | 'supplier'
  canWrite: boolean
  /** Subscribe private; invalidate and reload API data, never trust broadcast content. */
  realtimeTopic: string
}
export interface ConversationPage { items: Conversation[]; nextCursor: string | null }
export interface ConversationFile {
  id: string
  name: string
  mimeType: typeof CONVERSATION_FILE_MIME_TYPES[number]
  byteSize: number
  createdAt: string
}
export interface ConversationMessage {
  id: string
  conversationId: string
  sequence: number
  senderId: string
  senderName: string
  body: string
  attachments: ConversationFile[]
  createdAt: string
}
export interface ConversationMessagePage { items: ConversationMessage[]; nextCursor: number | null }
export interface EnsureConversationInput { requestId: string; supplierId: string }
export interface SendConversationMessageInput { operationId: string; body: string; attachmentIds: string[] }
export interface UploadConversationFileInput { operationId: string; name: string; mimeType: typeof CONVERSATION_FILE_MIME_TYPES[number]; dataBase64: string }
export interface ConversationFileDownload { file: ConversationFile; dataBase64: string }
export interface ConversationRead { lastReadSequence: number }
