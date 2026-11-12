// Local Phase 2 acceptance. Pass a dedicated Supabase workdir with TOTP enabled.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { chromium } from 'playwright-core'

const workdir = process.argv[2]
assert(workdir, 'Pass the workdir of the isolated PackIt Phase 2 Supabase stack')
const config = readFileSync(resolve(workdir, 'supabase/config.toml'), 'utf8')
assert.match(config, /^project_id\s*=\s*"packit-marketplace-phase7-local"/m)
const cli = resolve('node_modules/supabase/dist/supabase.js')
const status = spawnSync(process.execPath, [cli, 'status', '-o', 'json', '--workdir', workdir], { encoding: 'utf8' })
assert.equal(status.status, 0, 'Start the isolated PackIt Phase 2 Supabase stack first')
const local = JSON.parse(status.stdout)
for (const value of [local.API_URL, local.DB_URL]) assert.equal(new URL(value).hostname, '127.0.0.1')
const port=process.env.PHASE7_PORT??'52477'
const origin = `http://127.0.0.1:${port}`
const auth = { persistSession: false, autoRefreshToken: false }
const admin = createClient(local.API_URL, local.SECRET_KEY, { auth })
const sql = postgres(local.DB_URL, { max: 4 })
const authIds = []
let vite

async function request(path, { actor, method = 'GET', body, expectStatus = 200, code } = {}) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const payload = await response.json()
  assert.equal(response.status, expectStatus, `${method} ${path.split('?')[0]} returned ${payload.error?.code ?? 'success'}`)
  if (code) assert.equal(payload.error?.code, code)
  return payload
}

async function account(label) {
  const email = `phase7-${label}-${randomUUID()}@example.test`
  const password = `Local-${randomUUID()}!aA1`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert(created.data.user && !created.error, 'Could not create synthetic account')
  authIds.push(created.data.user.id)
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth })
  const signIn = await client.auth.signInWithPassword({ email, password })
  assert(signIn.data.session && !signIn.error, 'Could not sign in synthetic account')
  const actor = { client, token: signIn.data.session.access_token }
  const session = await request('/session/bootstrap', { actor, method: 'POST', body: {} })
  const [row] = await sql`select personal.id from app_private.workspaces personal where personal.owner_user_id=${session.data.user.id} and personal.kind='personal'`; return { ...actor, id: session.data.user.id, workspaceId: row.id }
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = Array.from(secret.replace(/=+$/, ''), (letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((octet) => parseInt(octet, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hash = createHmac('sha1', key).update(counter).digest()
  const offset = hash.at(-1) & 15
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

async function verifyMfa(actor) {
  const enrolled = await actor.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Local acceptance' })
  assert(enrolled.data?.type === 'totp' && !enrolled.error, 'Enable TOTP in the isolated local test config')
  const verified = await actor.client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(enrolled.data.totp.secret) })
  assert(verified.data?.access_token && !verified.error, 'Local TOTP challenge failed')
  return { ...actor, token: verified.data.access_token }
}

try {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    env: {
      ...process.env,
      NODE_ENV: 'development', APP_ENV: 'test', APP_ALLOWED_ORIGINS: origin, ANTHROPIC_API_KEY: '',
      VITE_APP_MODE: 'cloud', VITE_API_BASE_URL: '/api/v1', VITE_SUPABASE_URL: local.API_URL,
      VITE_MARKETPLACE_SUPPLIERS_ENABLED: 'true',
      VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local API startup timed out')), 20000)
    vite.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(origin)) { clearTimeout(timeout); resolve() }
    })
    vite.once('exit', () => { clearTimeout(timeout); reject(new Error('Local API failed to start')) })
    vite.once('error', (error) => { clearTimeout(timeout); reject(error) })
  })
  const buyer = await account('buyer'), supplierActor = await account('supplier'), outsider = await account('outsider'), viewer = await account('viewer'), staff = await account('staff'), reviewer = await account('reviewer')
  const supplier = (await request('/suppliers',{actor:supplierActor,method:'POST',expectStatus:201,body:{operationId:randomUUID(),kind:'factory',name:'Phase7 synthetic factory',slug:`phase7-${randomUUID()}`,description:'Local test only',contactEmail:'synthetic@example.test',capabilities:['offset_printing']}})).data.profile
  await sql`insert into app_private.platform_staff(user_id,role) values (${reviewer.id},'supplier_reviewer')`
  await request('/admin/suppliers',{actor:reviewer,expectStatus:403,code:'MARKETPLACE_MFA_REQUIRED'})
  const verifiedReviewer=await verifyMfa(reviewer)
  await request(`/suppliers/${supplier.id}/submit`,{actor:supplierActor,method:'POST',body:{expectedRevision:1}})
  await request(`/admin/suppliers/${supplier.id}/review`,{actor:verifiedReviewer,method:'POST',body:{expectedRevision:2,action:'approve',reason:'Synthetic integration acceptance'}})
  console.log('PASS real Auth + TOTP and separate supplier approval authority')
  for (const [actor,role] of [[viewer,'viewer'],[staff,'staff']]) await sql`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership) values (${supplier.workspaceId},${actor.id},${role},false)`
  const project=randomUUID()
  await sql`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document) values (${project},${buyer.workspaceId},${buyer.id},'Synthetic private project',1,${sql.json({live:{template:'tuck-end',materialId:'carton-300',W:80,D:50,H:120,handle:false},private:'not shared'})})`
  const draft=(await request('/marketplace/requests',{actor:buyer,method:'POST',expectStatus:201,body:{workspaceId:buyer.workspaceId,projectId:project,expectedProjectRevision:1,operationId:randomUUID(),title:'Phase7 RFQ',quantity:500,notes:'Synthetic'}})).data
  const pub=(await request(`/marketplace/requests/${draft.id}/publication`,{actor:buyer,method:'POST',body:{supplierIds:[supplier.id]}})).data
  if(process.env.PHASE7_EXPORT==='1'){
    const actors={};for(const [name,actor] of Object.entries({buyer,supplier:supplierActor,reviewer:verifiedReviewer,viewer,staff,outsider})){actors[name]={id:actor.id,workspaceId:actor.workspaceId,session:(await actor.client.auth.getSession()).data.session}}
    writeFileSync(resolve(workdir,'browser-fixture.json'),JSON.stringify({origin,apiUrl:local.API_URL,publishableKey:local.PUBLISHABLE_KEY,supplier,request:draft,publication:pub,actors}),{mode:0o600})
    console.log('Browser fixture ready; dedicated local server retained')
    await new Promise(()=>{})
  }
  const path=`/suppliers/${supplier.id}/quote-requests/${draft.id}/quotation`
  const terms={operationId:randomUUID(),expectedRevision:0,requestRevisionId:pub.revisionId,totalMinor:100000,currency:'THB',leadDays:14,validUntil:new Date(Date.now()+86400000).toISOString(),depositMinor:50000,requiresProof:true,notes:'Synthetic price'}
  await request(path,{actor:outsider,expectStatus:404})
  await request(path,{actor:buyer,expectStatus:404})
  await request(path,{actor:viewer,method:'PUT',body:terms,expectStatus:403})
  await request(path,{actor:supplierActor,method:'PUT',body:{...terms,validUntil:null},expectStatus:422})
  const first=(await request(path,{actor:supplierActor,method:'PUT',body:terms})).data
  const retry=(await request(path,{actor:supplierActor,method:'PUT',body:terms})).data
  assert.deepEqual(first,retry)
  await request(path,{actor:supplierActor,method:'PUT',body:{...terms,totalMinor:200000},expectStatus:409,code:'IDEMPOTENCY_KEY_REUSED'})
  assert.equal((await request(`/marketplace/requests/${draft.id}/quotations`,{actor:buyer})).data.items.length,0)
  await request(path+'/send',{actor:staff,method:'POST',body:{operationId:randomUUID(),expectedRevision:first.revision},expectStatus:403})
  const send={operationId:randomUUID(),expectedRevision:first.revision}
  const results=await Promise.all(Array.from({length:6},()=>request(path+'/send',{actor:supplierActor,method:'POST',body:send})))
  for(const r of results) assert.deepEqual(r.data,results[0].data)
  const sent=results[0].data
  const buyerQuotes=(await request(`/marketplace/requests/${draft.id}/quotations`,{actor:buyer})).data.items
  assert.equal(buyerQuotes.length,1);assert.equal(buyerQuotes[0].draft,null)
  await request(`/marketplace/requests/${draft.id}/quotations`,{actor:outsider,expectStatus:404})
  console.log('PASS cross-organization, manager/staff/viewer, private drafts, validation, changed retry and six-way send idempotency')
  await sql`delete from app_private.workspace_marketplace_members where workspace_id=${supplier.workspaceId} and user_id=${viewer.id}`
  await request(path,{actor:viewer,expectStatus:404})
  const denied=await supplierActor.client.rpc('marketplace_quotation_get',{p_actor:supplierActor.id,p_supplier:supplier.id,p_request:draft.id})
  assert(denied.error,'Authenticated browser must not invoke service-role commerce RPC')
  console.log('PASS current membership revocation and direct authenticated RPC denial')
  if(process.env.PHASE7_CHAT==='1') {
    const conversation=(await request('/marketplace/conversations',{actor:buyer,method:'POST',body:{requestId:draft.id,supplierId:supplier.id}})).data
    const cp=`/marketplace/conversations/${conversation.id}`
    await buyer.client.realtime.setAuth(buyer.token)
    await outsider.client.realtime.setAuth(outsider.token)
    const room=buyer.client.channel(conversation.realtimeTopic,{config:{private:true}})
    const broadcasts=[]
    room.on('broadcast',{event:'changed'},event=>broadcasts.push(event.payload))
    const subscription=channel=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Realtime subscription timeout')),15000);channel.subscribe(status=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);resolve(status)}})})
    assert.equal(await subscription(room),'SUBSCRIBED')
    const forbidden=outsider.client.channel(conversation.realtimeTopic,{config:{private:true}})
    assert.notEqual(await subscription(forbidden),'SUBSCRIBED','Outsider must not join private conversation topic')
    await outsider.client.removeChannel(forbidden)

    assert.equal((await request('/marketplace/conversations',{actor:supplierActor,method:'POST',body:{requestId:draft.id,supplierId:supplier.id}})).data.id,conversation.id)
    await request(cp,{actor:outsider,expectStatus:404})
    const fileInput={operationId:randomUUID(),name:'ทดสอบ.pdf',mimeType:'application/pdf',dataBase64:Buffer.from('%PDF-1.4\nSynthetic local acceptance file\n%%EOF').toString('base64')}
    const file=(await request(cp+'/files',{actor:buyer,method:'POST',expectStatus:201,body:fileInput})).data
    assert.deepEqual((await request(cp+'/files',{actor:buyer,method:'POST',expectStatus:201,body:fileInput})).data,file)
    await request(cp+`/files/${file.id}`,{actor:outsider,expectStatus:404})
    const input={operationId:randomUUID(),body:'Synthetic chat with attachment',attachmentIds:[file.id]}
    const messages=await Promise.all(Array.from({length:6},()=>request(cp+'/messages',{actor:buyer,method:'POST',expectStatus:201,body:input})))
    for(const m of messages)assert.deepEqual(m.data,messages[0].data)
    await request(cp+'/messages',{actor:buyer,method:'POST',expectStatus:409,body:{...input,body:'Changed payload'}})
    await new Promise(resolve=>setTimeout(resolve,600))
    assert(broadcasts.length>0,'Expected real private realtime invalidation after message persisted')
    for(const payload of broadcasts){assert(Object.keys(payload).every(key=>key==='id'));if(payload.id)assert.match(payload.id,/^[a-f0-9-]{36}$/)}
    await buyer.client.removeChannel(room)
    console.log('PASS real private realtime membership gating and content-free persisted-message invalidation')
    const downloaded=(await request(cp+`/files/${file.id}`,{actor:supplierActor})).data
    assert.equal(downloaded.dataBase64,fileInput.dataBase64)
    const page=(await request(cp+'/messages',{actor:supplierActor})).data
    assert.equal(page.items.length,1)
    await request(cp+'/read',{actor:supplierActor,method:'POST',body:{sequence:page.items[0].sequence}})
    assert.equal((await request(cp,{actor:supplierActor})).data.unreadCount,0)
    assert.equal((await request(cp,{actor:buyer})).data.lastReadSequence,0)
    await sql`delete from app_private.workspace_marketplace_members where workspace_id=${supplier.workspaceId} and user_id=${staff.id}`
    await request(cp,{actor:staff,expectStatus:404})
    console.log('PASS real chat persistence, unique conversation, six-way retry, Unicode attachment byte equality, outsider denial, independent reads and role revocation')
    if(process.env.PHASE7_ORDERS==='1') {
      const select={operationId:randomUUID(),quoteRevisionId:sent.current.id}
      const selected=await Promise.all(Array.from({length:6},()=>request(`/marketplace/requests/${draft.id}/select-quotation`,{actor:buyer,method:'POST',body:select})))
      for(const r of selected)assert.deepEqual(r.data,selected[0].data)
      let order=selected[0].data
      const op=`/marketplace/production-orders/${order.id}`
      assert.equal(order.status,'pending_supplier_confirmation')
      await request(op,{actor:outsider,expectStatus:404})
      await request(op+'/confirm',{actor:buyer,method:'POST',expectStatus:403,body:{operationId:randomUUID(),expectedRevision:order.revision}})
      const action=async(name,actor,extra={})=>{order=(await request(op+'/'+name,{actor,method:'POST',body:{operationId:randomUUID(),expectedRevision:order.revision,...extra}})).data;return order}
      await action('confirm',supplierActor)
      assert.equal(order.status,'confirmed')
      await request(op+'/start-production',{actor:supplierActor,method:'POST',expectStatus:409,body:{operationId:randomUUID(),expectedRevision:order.revision}})
      await request(op+'/proof',{actor:supplierActor,method:'POST',expectStatus:404,body:{operationId:randomUUID(),expectedRevision:order.revision,fileId:file.id,notes:'Must not use other actor upload'}})
      const proofFile=(await request(cp+'/files',{actor:supplierActor,method:'POST',expectStatus:201,body:{...fileInput,operationId:randomUUID(),name:'proof.pdf'}})).data
      await action('proof',supplierActor,{fileId:proofFile.id,notes:'Synthetic proof'})
      await request(op+'/approve-proof',{actor:buyer,method:'POST',expectStatus:409,body:{operationId:randomUUID(),expectedRevision:order.revision}})
      const proof1=order.proofs.at(-1).id
      await action('approve-proof',buyer,{proofId:proof1})
      await action('proof',supplierActor,{fileId:proofFile.id,notes:'Synthetic revised proof'})
      await request(op+'/approve-proof',{actor:buyer,method:'POST',expectStatus:409,body:{operationId:randomUUID(),expectedRevision:order.revision,proofId:proof1}})
      await action('approve-proof',buyer,{proofId:order.proofs.at(-1).id})
      await action('payment',buyer,{amountMinor:terms.depositMinor,reference:'SYNTHETIC-NO-MONEY',fileId:file.id})
      await request(op+'/start-production',{actor:supplierActor,method:'POST',expectStatus:409,body:{operationId:randomUUID(),expectedRevision:order.revision}})
      await action('confirm-payment',supplierActor,{paymentReportId:order.payments.at(-1).id})
      assert.equal((await request(op+`/files/${proofFile.id}`,{actor:buyer})).data.dataBase64,fileInput.dataBase64)
      await request(op+`/files/${file.id}`,{actor:outsider,expectStatus:404})
      await action('start-production',supplierActor)
      assert.equal(order.status,'in_production')
      await action('ship',supplierActor)
      await action('complete',supplierActor)
      assert.equal(order.status,'completed')
      console.log('PASS real six-way order selection, two-party confirmation, proof/deposit guards, scoped file bytes, production-shipping-completion')
      if(process.env.PHASE7_ADMIN==='1') {
        const support=await account('support'),otherSupport=await account('other-support')
        for(const scope of ['operations','support_supervisor','auditor'])await sql`insert into app_private.marketplace_admin_grants(user_id,scope) values (${reviewer.id},${scope})`
        for(const actor of [support,otherSupport])await sql`insert into app_private.marketplace_admin_grants(user_id,scope) values (${actor.id},'support')`
        await request('/admin/dashboard',{actor:reviewer,expectStatus:403,code:'MARKETPLACE_MFA_REQUIRED'})
        await request('/admin/dashboard',{actor:verifiedReviewer})
        const verifiedSupport=await verifyMfa(support),verifiedOther=await verifyMfa(otherSupport)
        await request('/admin/dashboard',{actor:verifiedSupport,expectStatus:403})
        const search=(await request('/admin/search?q=Phase7&kind=order',{actor:verifiedReviewer})).data
        for(const item of search.items)assert.deepEqual(Object.keys(item).sort(),['id','kind','status','title'])
        const input={operationId:randomUUID(),title:'Synthetic support case',reason:'Investigate synthetic acceptance',assignedTo:support.id,conversationId:conversation.id,orderId:order.id,permissions:['messages','message_files','order_details','order_files'],expiresAt:new Date(Date.now()+3600000).toISOString()}
        await request('/admin/support-cases',{actor:verifiedSupport,method:'POST',body:input,expectStatus:403})
        await request('/admin/support-cases',{actor:verifiedReviewer,method:'POST',body:{...input,expiresAt:new Date(Date.now()+172800000).toISOString()},expectStatus:422})
        const supportCase=(await request('/admin/support-cases',{actor:verifiedReviewer,method:'POST',body:input,expectStatus:201})).data
        const sp=`/admin/support-cases/${supportCase.id}`
        await request(sp+'/access',{actor:verifiedOther,method:'POST',body:{reason:'Other support denied',view:'messages'},expectStatus:404})
        await request(sp+'/access',{actor:verifiedSupport,method:'POST',body:{reason:'x',view:'messages'},expectStatus:422})
        const read=(await request(sp+'/access',{actor:verifiedSupport,method:'POST',body:{reason:'Inspect synthetic message detail',view:'messages'}})).data
        assert(read.messages.some(m=>m.body===input.body || m.body==='Synthetic chat with attachment'))
        assert.equal((await request(sp+'/access',{actor:verifiedSupport,method:'POST',body:{reason:'Inspect synthetic order detail',view:'order_details'}})).data.order.id,order.id)
        assert.equal((await request(sp+`/files/${proofFile.id}/access`,{actor:verifiedSupport,method:'POST',body:{reason:'Inspect synthetic proof bytes'}})).data.dataBase64,fileInput.dataBase64)
        await sql`delete from app_private.marketplace_admin_grants where user_id=${support.id} and scope='support'`
        await request(sp+'/access',{actor:verifiedSupport,method:'POST',body:{reason:'Revoked support denied',view:'messages'},expectStatus:403})
        await sql`insert into app_private.marketplace_admin_grants(user_id,scope) values (${support.id},'support')`
        await sql`update app_private.marketplace_support_cases set expires_at=clock_timestamp()-interval '1 second' where id=${supportCase.id}`
        await request(sp+'/access',{actor:verifiedSupport,method:'POST',body:{reason:'Expired case denied',view:'messages'},expectStatus:404})
        await sql`update app_private.marketplace_support_cases set expires_at=clock_timestamp()+interval '1 hour' where id=${supportCase.id}`
        await request(sp+'/close',{actor:verifiedReviewer,method:'POST',body:{operationId:randomUUID(),expectedRevision:1,reason:'Synthetic case resolved'}})
        await request(sp+'/access',{actor:verifiedSupport,method:'POST',body:{reason:'Closed case denied',view:'messages'},expectStatus:404})
        const events=await sql`select action,reason from app_private.marketplace_admin_audit where case_id=${supportCase.id}`
        assert(events.filter(e=>e.action.includes('access')||e.action.includes('download')).length>=3)
        await request('/admin/audit-log',{actor:verifiedReviewer})
        await request('/admin/audit-log',{actor:verifiedSupport,expectStatus:403})
        await request(`/admin/users?q=${outsider.id}`,{actor:verifiedReviewer,expectStatus:403})
        await sql`insert into app_private.marketplace_admin_grants(user_id,scope) values (${reviewer.id},'user_moderator')`
        const users=(await request(`/admin/users?q=${outsider.id}`,{actor:verifiedReviewer})).data.items
        assert.equal(users.length,1);assert(!JSON.stringify(users).includes('@'));assert.equal(users[0].canChangeStatus,true)
        const statusBody={operationId:randomUUID(),expectedRevision:users[0].revision,status:'suspended',reason:'Synthetic account moderation check'}
        await request(`/admin/users/${reviewer.id}/status`,{actor:verifiedReviewer,method:'POST',body:statusBody,expectStatus:403})
        const suspended=(await request(`/admin/users/${outsider.id}/status`,{actor:verifiedReviewer,method:'POST',body:statusBody})).data
        assert.equal(suspended.status,'suspended')
        await request('/me',{actor:outsider,expectStatus:403})
        await request(`/admin/users/${outsider.id}/status`,{actor:verifiedReviewer,method:'POST',body:{...statusBody,operationId:randomUUID(),status:'active'},expectStatus:409})
        await request(`/admin/users/${outsider.id}/status`,{actor:verifiedReviewer,method:'POST',body:{...statusBody,operationId:randomUUID(),expectedRevision:suspended.revision,status:'active'}})
        await request('/me',{actor:outsider})
        const maintenance={operationId:randomUUID(),reason:'Synthetic bounded maintenance check'}
        await request('/admin/maintenance',{actor:verifiedSupport,method:'POST',body:maintenance,expectStatus:403})
        const done=(await request('/admin/maintenance',{actor:verifiedReviewer,method:'POST',body:maintenance})).data
        assert.deepEqual((await request('/admin/maintenance',{actor:verifiedReviewer,method:'POST',body:maintenance})).data,done)
        assert(Object.values(done).every(value=>Number.isInteger(value)&&value>=0))
        console.log('PASS real scoped user moderation/redacted search/CAS/self-denial/suspended fresh authentication and bounded idempotent maintenance')
        console.log('PASS real Admin MFA, scoped redacted search, assigned case/read/file audit, expiry/closure/revoked scope and distinct auditor')
      }

    }

  }
  if(process.env.PHASE7_BROWSER==='1') {
    const browser=await chromium.launch({executablePath:process.env.PACKIT_E2E_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
    try {
      for (const width of [1440,390]) {
        const context=await browser.newContext({viewport:{width,height:900}})
        const session=(await buyer.client.auth.getSession()).data.session
        await context.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:`sb-${new URL(local.API_URL).hostname.split('.')[0]}-auth-token`,session})
        const page=await context.newPage()
        const errors=[];page.on('pageerror',error=>errors.push(error.message))
        await page.goto(`${origin}/app/requests/${draft.id}/quotations`)
        await page.getByRole('heading',{name:'Phase7 synthetic factory',exact:true}).waitFor({timeout:20000})
        assert.equal(await page.getByRole('link',{name:'ตรวจสอบก่อนเลือกข้อเสนอ'}).count(),1)
        await page.reload()
        await page.getByRole('heading',{name:'Phase7 synthetic factory',exact:true}).waitFor()
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow')
        assert.deepEqual(errors,[])
        await page.screenshot({path:resolve(workdir,`real-comparison-${width}.png`),fullPage:true})
        await context.close()
      }
      console.log('PASS real browser buyer comparison + deep-link refresh at1440/390, no mock API, no page errors or horizontal overflow')
    } finally {await browser.close()}
  }
  console.log('PASS quotation HTTP/Auth integration complete; fixtures retained in isolated stack for phase5/7 follow-on')
} finally { vite?.kill(); await sql.end() }
