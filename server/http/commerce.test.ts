import { describe,it,expect } from 'vitest'
import { matchCommerceRoute } from './commerce'
import { saveQuotationSchema, reviseRequestSchema, quoteActionSchema } from '../modules/commerce/validation'
const uuid='a1111111-1111-4111-8111-111111111111'
const valid={operationId:uuid,expectedRevision:0,requestRevisionId:uuid,totalMinor:1000,depositMinor:500,currency:'THB',leadDays:3,requiresProof:true,notes:'',validUntil:'2026-12-01T12:00:00Z'}
describe('commerce contract boundary',()=>{
 it('routes quote, order, revisions and scoped files without swallowing unrelated APIs',()=>{
  expect(matchCommerceRoute(`/api/v1/suppliers/${uuid}/quote-requests/${uuid}/quotation/send`)?.kind).toBe('quoteAction')
  expect(matchCommerceRoute(`/api/v1/marketplace/production-orders/${uuid}/files/${uuid}`)?.kind).toBe('orderFile')
  expect(matchCommerceRoute(`/api/v1/marketplace/requests/${uuid}/revisions`)?.kind).toBe('reviseRequest')
  expect(matchCommerceRoute('/api/v1/projects')).toBeNull()
  expect(matchCommerceRoute(`/api/v1/marketplace/production-orders/${uuid}/refund`)).toBeNull()
 })
 it('requires exact integer amounts and non-null expiry',()=>{
  expect(saveQuotationSchema.safeParse(valid).success).toBe(true)
  for(const change of [{totalMinor:1.1},{depositMinor:1001},{currency:'USD'},{validUntil:null},{requestRevisionId:'no'},{expectedRevision:-1},{unknown:true}]) expect(saveQuotationSchema.safeParse({...valid,...change}).success).toBe(false)
 })
 it('requires a current CAS revision for consequential quote mutations',()=>{
  expect(quoteActionSchema.safeParse({operationId:uuid,expectedRevision:1}).success).toBe(true)
  expect(quoteActionSchema.safeParse({operationId:uuid,expectedRevision:0}).success).toBe(false)
 })
 it('bounds published spec values and requires the prior revision identity',()=>{
  const input={operationId:uuid,expectedRevisionId:uuid,title:'Revised',quantity:100,notes:'',acceptingUntil:'2026-12-01T00:00:00Z',spec:{template:'tuck-end',materialId:'carton',W:80,D:50,H:120,handle:false}}
  expect(reviseRequestSchema.safeParse(input).success).toBe(true)
  expect(reviseRequestSchema.safeParse({...input,spec:{...input.spec,W:1000}}).success).toBe(false)
  expect(reviseRequestSchema.safeParse({...input,expectedRevisionId:null}).success).toBe(false)
 })
})
