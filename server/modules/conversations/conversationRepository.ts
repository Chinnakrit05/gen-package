import type { Actor } from '../identity/actor'
import type { Conversation, ConversationFile, ConversationFileDownload, ConversationMessage, ConversationMessagePage, ConversationPage, ConversationRead, EnsureConversationInput, SendConversationMessageInput, UploadConversationFileInput } from '../../../shared/contracts/conversations'
export interface ConversationRepository {
  list(actor: Actor, after: string | null): Promise<ConversationPage>
  ensure(actor: Actor, input: EnsureConversationInput): Promise<Conversation>
  get(actor: Actor, id: string): Promise<Conversation>
  messages(actor: Actor, id: string, before: number | null): Promise<ConversationMessagePage>
  send(actor: Actor, id: string, input: SendConversationMessageInput): Promise<ConversationMessage>
  read(actor: Actor, id: string, sequence: number): Promise<ConversationRead>
  upload(actor: Actor, id: string, input: UploadConversationFileInput): Promise<ConversationFile>
  download(actor: Actor, id: string, fileId: string): Promise<ConversationFileDownload>
}
