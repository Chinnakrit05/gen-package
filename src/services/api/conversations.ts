import type { Conversation, ConversationPage, ConversationMessage, ConversationMessagePage, ConversationFile, ConversationFileDownload, ConversationRead, EnsureConversationInput, SendConversationMessageInput, UploadConversationFileInput } from '../../../shared/contracts/conversations'
import { commerceRead, commerceWrite } from './commerce'
const root = '/marketplace/conversations'
const path = (id: string) => `${root}/${encodeURIComponent(id)}`
export const listConversations = (base: string, token: string, after: string | null, signal?: AbortSignal) => commerceRead<ConversationPage>(base, token, `${root}${after ? `?after=${encodeURIComponent(after)}` : ''}`, signal)
export const ensureConversation = (base: string, token: string, input: EnsureConversationInput) => commerceWrite<Conversation>(base, token, root, input)
export const getConversation = (base: string, token: string, id: string, signal?: AbortSignal) => commerceRead<Conversation>(base, token, path(id), signal)
export const getConversationMessages = (base: string, token: string, id: string, before: number | null, signal?: AbortSignal) => commerceRead<ConversationMessagePage>(base, token, `${path(id)}/messages${before ? `?before=${before}` : ''}`, signal)
export const sendConversationMessage = (base: string, token: string, id: string, input: SendConversationMessageInput) => commerceWrite<ConversationMessage>(base, token, `${path(id)}/messages`, input)
export const readConversation = (base: string, token: string, id: string, sequence: number) => commerceWrite<ConversationRead>(base, token, `${path(id)}/read`, { sequence })
export const uploadConversationFile = (base: string, token: string, id: string, input: UploadConversationFileInput) => commerceWrite<ConversationFile>(base, token, `${path(id)}/files`, input)
export const downloadConversationFile = (base: string, token: string, id: string, fileId: string, signal?: AbortSignal) => commerceRead<ConversationFileDownload>(base, token, `${path(id)}/files/${encodeURIComponent(fileId)}`, signal)
