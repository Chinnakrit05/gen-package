import { z } from 'zod'
import type { SupabaseCommerceRepository } from '../adapters/supabase/commerceRepository'
import type { Actor } from '../modules/identity/actor'
import { commerceQuery, quoteActionSchema, saveQuotationSchema, uuid, orderActionSchema, selectQuotationSchema, reviseRequestSchema } from '../modules/commerce/validation'
import { HttpError } from './errors'
const paths=[
 ['buyerPreview', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/revisions\/([^/]+)\/preview$/,['GET']],
 ['supplierPreview', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests\/([^/]+)\/revisions\/([^/]+)\/preview$/,['GET']],
 ['orderPreview', /^\/api\/v1\/marketplace\/production-orders\/([^/]+)\/preview$/,['GET']],
 ['commerceNotifications', /^\/api\/v1\/marketplace\/commerce-notifications$/,['GET']],
 ['readCommerceNotification', /^\/api\/v1\/marketplace\/commerce-notifications\/([^/]+)\/read$/,['POST']],
 ['buyerQuoteHistory', /^\/api\/v1\/marketplace\/quotations\/([^/]+)\/history$/,['GET']],
 ['supplierQuoteHistory', /^\/api\/v1\/suppliers\/([^/]+)\/quotations\/([^/]+)\/history$/,['GET']],
 ['buyerTrading', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/trading$/,['GET']],
 ['supplierTrading', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests\/([^/]+)\/trading$/,['GET']],
 ['reviseRequest', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/revisions$/,['GET','POST']],
 ['supplierRequestHistory', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests\/([^/]+)\/revisions$/,['GET']],
 ['orderFile', /^\/api\/v1\/marketplace\/production-orders\/([^/]+)\/files\/([^/]+)$/,['GET']],
 ['buyerOrders', /^\/api\/v1\/marketplace\/production-orders$/,['GET']],
 ['supplierOrders', /^\/api\/v1\/suppliers\/([^/]+)\/production-orders$/,['GET']],
 ['order', /^\/api\/v1\/marketplace\/production-orders\/([^/]+)$/,['GET']],
 ['select', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/select-quotation$/,['POST']],
 ['orderAction', /^\/api\/v1\/marketplace\/production-orders\/([^/]+)\/(confirm|decline|cancel|proof|approve-proof|payment|confirm-payment|start-production|ship|complete)$/,['POST']],
 ['buyerQuotes', /^\/api\/v1\/marketplace\/requests\/([^/]+)\/quotations$/,['GET']],
 ['supplierQuotes', /^\/api\/v1\/suppliers\/([^/]+)\/quotations$/,['GET']],
 ['quotation', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests\/([^/]+)\/quotation$/,['GET','PUT']],
 ['quoteAction', /^\/api\/v1\/suppliers\/([^/]+)\/quote-requests\/([^/]+)\/quotation\/(send|withdraw)$/,['POST']],
] as const
export function matchCommerceRoute(path:string) {
 for(const [kind,pattern,methods] of paths) { const m=pattern.exec(path); if(m) return {kind,methods:methods as readonly string[],params:m.slice(1)} }
 return null
}
export async function serveCommerceRoute(route:NonNullable<ReturnType<typeof matchCommerceRoute>>,request:{method:string;query:URLSearchParams;authenticate():Promise<Actor>;readBody():Promise<unknown>},repo:SupabaseCommerceRepository) {
 if(Object.keys(Object.fromEntries(request.query)).length!==request.query.size) throw new HttpError(422,'VALIDATION_ERROR','query ซ้ำ')
 const actor=await request.authenticate()
 const [id,child,action]=route.params
 if(route.kind==='commerceNotifications') {
  const {cursor}=commerceQuery.parse(Object.fromEntries(request.query)); return {status:200,data:await repo.listNotifications(actor.userId,cursor??null)}
 }
 if(route.kind==='buyerQuoteHistory'||route.kind==='supplierQuoteHistory') {
  const {cursor}=z.object({cursor:z.coerce.number().int().positive().optional()}).strict().parse(Object.fromEntries(request.query))
  return {status:200,data:await repo.quoteHistory(actor.userId,uuid.parse(route.kind==='buyerQuoteHistory'?id:child),route.kind==='supplierQuoteHistory'?uuid.parse(id):null,cursor??null)}
 }
 if(route.kind==='buyerOrders'||route.kind==='supplierOrders') {
  const {cursor}=commerceQuery.parse(Object.fromEntries(request.query))
  return {status:200,data:await repo.listOrders(actor.userId,route.kind==='supplierOrders'?uuid.parse(id):null,cursor??null)}
 }
 const a=uuid.parse(id)
 if(route.kind==='buyerPreview') return {status:200,data:await repo.requestPreview(actor.userId,a,uuid.parse(child),null)}
 if(route.kind==='supplierPreview') return {status:200,data:await repo.requestPreview(actor.userId,uuid.parse(child),uuid.parse(action),a)}
 if(route.kind==='orderPreview') return {status:200,data:await repo.orderPreview(actor.userId,a)}
 if(route.kind==='readCommerceNotification') return {status:200,data:await repo.readNotification(actor.userId,a)}
 if(route.kind==='buyerTrading') return {status:200,data:await repo.getTrading(actor.userId,a,null)}
 if(route.kind==='supplierTrading') return {status:200,data:await repo.getTrading(actor.userId,uuid.parse(child),a)}
 if(route.kind==='supplierRequestHistory'||(route.kind==='reviseRequest'&&request.method==='GET')) {
  const {cursor}=z.object({cursor:z.coerce.number().int().positive().optional()}).strict().parse(Object.fromEntries(request.query))
  return {status:200,data:await repo.requestHistory(actor.userId,route.kind==='supplierRequestHistory'?uuid.parse(child):a,route.kind==='supplierRequestHistory'?a:null,cursor??null)}
 }
 if(route.kind==='reviseRequest') return {status:200,data:await repo.reviseRequest(actor.userId,a,reviseRequestSchema.parse(await request.readBody()))}
 if(route.kind==='orderFile') return {status:200,data:await repo.downloadOrderFile(actor.userId,a,uuid.parse(child))}
 if(route.kind==='order') return {status:200,data:await repo.getOrder(actor.userId,a)}
 if(route.kind==='select') return {status:200,data:await repo.selectQuotation(actor.userId,a,selectQuotationSchema.parse(await request.readBody()))}
 if(route.kind==='orderAction') return {status:200,data:await repo.orderAction(actor.userId,a,child,orderActionSchema.parse(await request.readBody()))}
 if(route.kind==='buyerQuotes'||route.kind==='supplierQuotes') {
  if(Object.keys(Object.fromEntries(request.query)).length!==request.query.size) throw new HttpError(422,'VALIDATION_ERROR','query ซ้ำ')
  const {cursor}=commerceQuery.parse(Object.fromEntries(request.query))
  return {status:200,data:await repo.listQuotations(actor.userId,route.kind==='supplierQuotes'?a:null,route.kind==='buyerQuotes'?a:null,cursor??null)}
 }
 const b=uuid.parse(child)
 if(route.kind==='quotation'&&request.method==='GET') return {status:200,data:await repo.getQuotation(actor.userId,a,b)}
 const input=route.kind==='quotation'?saveQuotationSchema.parse(await request.readBody()):quoteActionSchema.parse(await request.readBody())
 return {status:200,data:await repo.writeQuotation(actor.userId,a,b,route.kind==='quotation'?'save':action,input)}
}
