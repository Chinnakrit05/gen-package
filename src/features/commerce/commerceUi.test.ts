import { describe, expect, it } from 'vitest'
import { createOperationTracker, parseMoney } from './commerceUi'
import { commerceNotificationTarget } from './CommerceNotificationsPage'
import type { CommerceNotification } from '../../../shared/contracts/commerce'
import { studioNavigation } from '../../app/studioNavigation'
describe('commerce money input', () => {
  it.each([['0',0], ['0.01',1], ['199.50',19950], [' 12.3 ',1230]])('parses %s exactly in satang', (value, expected) => expect(parseMoney(value)).toBe(expected))
  it.each(['-1', '1.001', '1e3', 'NaN', 'Infinity', '', '1,000', '9007199254740992'])('rejects ambiguous or unsafe money %s', value => expect(parseMoney(value)).toBeNull())
})
describe('operation intent lifecycle', () => {
  it('reuses same payload after uncertain outcome and rotates for changed intent', () => { const operation = createOperationTracker(); const first = operation({ body: 'OK' }); expect(operation({ body: 'OK' })).toBe(first); expect(operation({ body: 'Changed' })).not.toBe(first) })
  it('allows deliberate identical messages after successful completion', () => { const operation = createOperationTracker(); const first = operation({ body: 'OK' }); operation.reset(); expect(operation({ body: 'OK' })).not.toBe(first) })
})
describe('notification and admin navigation boundaries', () => {
  const notice: CommerceNotification = { id:'n', requestId:'request', supplierId:'loser', kind:'request_awarded', entityId:'request', createdAt:'', readAt:null, requestTitle:'', supplierName:'' }
  it('never links a losing supplier to winner production details', () => expect(commerceNotificationTarget(notice,['loser'])).toBe('/factory/loser/jobs/request'))
  it('links buyer and actual order events by distinct context', () => { expect(commerceNotificationTarget(notice,[])).toBe('/app/requests/request'); expect(commerceNotificationTarget({...notice,kind:'order_confirm',entityId:'order'},[])).toBe('/orders/order') })
  it('shows only granted staff tools', () => { const nav = studioNavigation('staff',undefined,false,true,['support'],false); expect(nav.map(item=>item.to)).toEqual(['/admin/support']); expect(studioNavigation('staff',undefined,false,true,[],false)).toEqual([]) })
})
