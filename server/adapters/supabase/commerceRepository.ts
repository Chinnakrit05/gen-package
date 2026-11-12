import { createClient, type SupabaseClient, type PostgrestError } from '@supabase/supabase-js'
import { z, type ZodType } from 'zod'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import { quotationSchema, quotationPageSchema, productionOrderSchema, productionOrderPageSchema, requestTradingSchema, quotationRevisionSchema, requestRevisionSchema, requestPreviewSchema } from '../../modules/commerce/validation'
import type { QuotationActionInput, SaveQuotationInput } from '../../../shared/contracts/commerce'
export function commerceDatabaseError(error: PostgrestError): HttpError {
 if (['MARKETPLACE_NOT_FOUND','QUOTE_REQUEST_NOT_FOUND','CONVERSATION_NOT_FOUND'].includes(error.message)) return new HttpError(404,'NOT_FOUND','ไม่พบรายการนี้')
 if (error.message === 'MARKETPLACE_FORBIDDEN') return new HttpError(403,'MARKETPLACE_FORBIDDEN','คุณไม่มีสิทธิ์ทำรายการนี้')
 if (error.message === 'IDEMPOTENCY_KEY_REUSED') return new HttpError(409,'IDEMPOTENCY_KEY_REUSED','รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว')
 if (error.message === 'REVISION_CONFLICT') return new HttpError(409,'REVISION_CONFLICT','ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่')
 if (error.message === 'MARKETPLACE_CONFLICT' || error.code === '23505') return new HttpError(409,'MARKETPLACE_CONFLICT','สถานะรายการไม่อนุญาตให้ทำรายการนี้')
 if (error.message === 'VALIDATION_ERROR' || ['22007','22P02','22003','23514'].includes(error.code)) return new HttpError(422,'VALIDATION_ERROR','ข้อมูลไม่ถูกต้อง')
 return new HttpError(503,'DEPENDENCY_UNAVAILABLE','ฐานข้อมูล Marketplace ไม่พร้อมใช้งาน')
}
export class SupabaseCommerceRepository {
 constructor(private readonly client: SupabaseClient) {}
 async rpc<T>(name: string,args: Record<string,unknown>,schema: ZodType<T>): Promise<T> {
  const { data,error }=await this.client.rpc(name,args)
  if(error) throw commerceDatabaseError(error)
  const result=schema.safeParse(data)
  if(!result.success) throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','ข้อมูล Marketplace ไม่ถูกต้อง')
  return result.data
 }
 downloadOrderFile(actor:string,order:string,file:string) { return this.rpc('marketplace_order_download_file',{p_actor:actor,p_order:order,p_file:file},z.object({file:z.object({id:z.string().uuid(),name:z.string(),mimeType:z.enum(['application/pdf','image/png','image/jpeg']),byteSize:z.number(),createdAt:z.string()}),dataBase64:z.string()})) }
 getTrading(actor:string,request:string,supplier:string|null) {return this.rpc('marketplace_request_trading_get',{p_actor:actor,p_request:request,p_supplier:supplier},requestTradingSchema)}
 reviseRequest(actor:string,request:string,input:unknown) {return this.rpc('marketplace_request_revise',{p_actor:actor,p_request:request,p_input:input},requestTradingSchema)}
 listNotifications(actor:string,after:string|null) {return this.rpc('marketplace_commerce_notifications',{p_actor:actor,p_after:after},z.object({items:z.array(z.object({id:z.string().uuid(),requestId:z.string().uuid(),supplierId:z.string().uuid(),kind:z.string(),entityId:z.string().uuid(),createdAt:z.string(),readAt:z.string().nullable(),requestTitle:z.string(),supplierName:z.string()})),nextCursor:z.string().uuid().nullable()}))}
 readNotification(actor:string,event:string) {return this.rpc('marketplace_commerce_notification_read',{p_actor:actor,p_event:event},z.object({id:z.string().uuid(),readAt:z.string()}))}
 quoteHistory(actor:string,quotation:string,supplier:string|null,after:number|null) {return this.rpc('marketplace_quotation_history',{p_actor:actor,p_quotation:quotation,p_supplier:supplier,p_after:after},z.object({items:z.array(quotationRevisionSchema),nextCursor:z.number().int().nullable()}))}
 requestHistory(actor:string,request:string,supplier:string|null,after:number|null) {return this.rpc('marketplace_request_history',{p_actor:actor,p_request:request,p_supplier:supplier,p_after:after},z.object({items:z.array(requestRevisionSchema),nextCursor:z.number().int().nullable()}))}
 requestPreview(actor:string,request:string,revision:string,supplier:string|null) {return this.rpc('marketplace_request_preview',{p_actor:actor,p_request:request,p_revision:revision,p_supplier:supplier},requestPreviewSchema)}
 orderPreview(actor:string,order:string) {return this.rpc('marketplace_order_preview',{p_actor:actor,p_order:order},requestPreviewSchema)}
 getOrder(actor:string,order:string) {return this.rpc('marketplace_order_get',{p_actor:actor,p_order:order},productionOrderSchema)}
 listOrders(actor:string,supplier:string|null,after:string|null) {return this.rpc('marketplace_order_list',{p_actor:actor,p_supplier:supplier,p_after:after},productionOrderPageSchema)}
 selectQuotation(actor:string,request:string,input:unknown) {return this.rpc('marketplace_order_select',{p_actor:actor,p_request:request,p_input:input},productionOrderSchema)}
 orderAction(actor:string,order:string,action:string,input:unknown) {return this.rpc('marketplace_order_action',{p_actor:actor,p_order:order,p_action:action,p_input:input},productionOrderSchema)}
 getQuotation(actor: string,supplier: string,request: string) { return this.rpc('marketplace_quotation_get',{p_actor:actor,p_supplier:supplier,p_request:request},z.object({quotation:quotationSchema.nullable()})) }
 listQuotations(actor: string,supplier: string|null,request: string|null,after: string|null) { return this.rpc('marketplace_quotation_list',{p_actor:actor,p_supplier:supplier,p_request:request,p_after:after},quotationPageSchema) }
 writeQuotation(actor: string,supplier: string,request: string,action: string,input: SaveQuotationInput|QuotationActionInput) { return this.rpc('marketplace_quotation_write',{p_actor:actor,p_supplier:supplier,p_request:request,p_action:action,p_input:input},quotationSchema) }
}
export function createSupabaseCommerceRepository(config: NonNullable<ServerConfig['supabase']>) {
 return new SupabaseCommerceRepository(createClient(config.url,config.secretKey,{auth:{autoRefreshToken:false,detectSessionInUrl:false,persistSession:false}}))
}
