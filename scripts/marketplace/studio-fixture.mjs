// Synthetic routed-browser QA only. No Supabase/database/integration claims.
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
const base = process.env.STUDIO_BASE ?? 'http://127.0.0.1:56391'
if (new URL(base).hostname !== '127.0.0.1') throw new Error('Local fixture only')
const out = process.env.STUDIO_FEATURE_OFF?'tmp/studio/screenshots-feature-off':'tmp/studio/screenshots'; mkdirSync(out,{recursive:true})
const f=JSON.parse(readFileSync('docs/marketplace/fixtures/phase-1.json','utf8')), C=f.cases, ids=f.ids
const sid='70000000-0000-4000-8000-000000000001', rid='80000000-0000-4000-8000-000000000001'
const now='2026-11-08T10:00:00Z'
const profile={id:sid,workspaceId:ids.team,kind:'print_shop',name:'Studio Print · โรงพิมพ์ตัวอย่าง',slug:'studio-print',description:'ผู้รับผลิตบรรจุภัณฑ์สำหรับแบรนด์ยุคใหม่ พร้อมดูแลตั้งแต่ต้นแบบถึงงานผลิตจริง',contactEmail:'studio@example.test',capabilities:['digital_printing','die_cutting','foil_stamping'],status:'approved',revision:2,reviewNote:null,updatedAt:now}
const project={...structuredClone(C['projects.detail'].response.data),workspaceId:ids.team,name:'กล่องของขวัญ · Morning Ritual'}
const spec={template:'mailer',materialId:'kraft',W:200,D:140,H:60,handle:false}
project.document.live={...project.document.live,...spec}; project.document.qty=1500
const draft={id:rid,workspaceId:ids.team,projectId:project.id,projectRevision:project.revision,projectName:project.name,title:'กล่องของขวัญ Morning Ritual',quantity:1500,notes:'พิมพ์สีเดียวด้านนอก ใช้กระดาษคราฟท์ พร้อมจัดส่งภายในสิ้นเดือน',spec,createdAt:now}
const quote={...draft,revisionId:rid,publishedAt:now}
const session={access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'a0000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'studio@example.test',app_metadata:{provider:'google'},user_metadata:{},created_at:now}}
const browser=await chromium.launch({executablePath:process.env.PACKIT_E2E_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const results=[]
export async function fixture(width,{mode='normal',loggedIn=true}={}) {
 const ctx=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1}); const errors=[],unhandled=[],writes=[]; let readAt=null,publication=mode==='published'?{revisionId:rid,publishedAt:now,suppliers:[profile]}:null
 await ctx.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace(/^\/api\/v1/,''),method=req.method()
  if(u.origin===base&&!u.pathname.startsWith('/api/'))return route.continue()
  if(u.origin==='http://127.0.0.1:59999')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...session.user,factors:[]})})
  if(u.origin!==base) {unhandled.push(req.url()); return route.abort()}
  if(method!=='GET') writes.push({method,path:p})
  let data,status=200
  if(p==='/session/bootstrap')data=C['bootstrap.owner'].response.data
  else if(p==='/me'){data=structuredClone(C['me.owner'].response.data);if(mode==='viewer')data.workspaces=data.workspaces.map(w=>({...w,role:'viewer'}))}
  else if(p==='/marketplace/context')data={suppliers:mode==='outsider'?[]:[{profile,role:mode==='viewer'?'viewer':'manager'}],staff:{canReviewSuppliers:!['denied','viewer','outsider'].includes(mode),requiresMfa:mode==='mfa'}}
  else if(p==='/projects')data={items:mode==='empty'?[]:Array.from({length:6},(_,i)=>({...C['projects.page1'].response.data.items[i],name:[project.name,'สติกเกอร์ Botanical','กล่องขนม Sunday','Coffee Collection','ชุดของขวัญ Minimal','ฉลากน้ำผลไม้'][i]})),nextCursor:null}
  else if(p==='/projects/thumbnails')data={items:[]}
  else if(p.startsWith('/projects/'))data=project
  else if(p==='/marketplace/requests')data=method==='POST'?draft:{items:mode==='empty'?[]:[draft],nextCursor:null}
  else if(p.endsWith('/eligible-suppliers'))data={items:[profile,{...profile,id:sid.replace(/1$/,'2'),name:'Green Box Factory',kind:'factory'}],nextCursor:null}
  else if(p.endsWith('/publication')) {if(method==='POST')publication={revisionId:rid,publishedAt:now,suppliers:[profile]};data=method==='POST'?publication:{publication}}
  else if(p===`/marketplace/requests/${rid}`)data=draft
  else if(p==='/marketplace/quote-request-notifications')data={items:[{createdAt:now,requestId:rid,supplierId:sid,supplierName:profile.name,requestTitle:draft.title,readAt}],nextCursor:null,hasUnread:!readAt}
  else if(p.endsWith('/read')){readAt=now;data={id:rid,requestId:rid,supplierId:sid,readAt}}
  else if(p.endsWith('/notifications'))data={items:[{id:rid,createdAt:now,supplierId:sid,supplierName:profile.name,action:'approve',readAt:null}],nextCursor:null}
  else if(p.endsWith('/review-documents'))data={documents:[{id:rid,name:'company-verification-example.pdf',mimeType:'application/pdf',byteSize:42100,createdAt:now}]}
  else if(p.endsWith('/team'))data={members:[{userId:ids.owner,displayName:'Studio Owner',role:'manager',isWorkspaceOwner:true},{userId:ids.editor,displayName:'Production Team',role:'staff',isWorkspaceOwner:false}],invites:[{id:rid,email:'new-team-member@example.test',role:'staff',createdAt:now,expiresAt:'2026-12-01T00:00:00Z'}]}
  else if(p.endsWith('/quote-requests'))data={items:mode==='empty'?[]:[quote],nextCursor:null}
  else if(p.includes('/quote-requests/'))data=quote
  else if(p.startsWith('/suppliers/public/'))data=profile
  else if(p==='/admin/suppliers')data={items:[{...profile,status:'pending'}],nextCursor:null}
  else if(p.startsWith('/suppliers/'))data={profile:{...profile,status:mode==='draft'?'draft':'approved'},role:mode==='viewer'?'viewer':'manager'}
  else {unhandled.push(`${method} ${p}`);status=404}
  if(mode==='error'&&p==='/marketplace/requests')status=500
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{data,requestId:rid}:{error:{code:'FIXTURE_FAILURE',message:'Synthetic error'},requestId:rid})})
 })
 await ctx.addInitScript(({session,owner,team,loggedIn})=>{if(loggedIn)localStorage.setItem('sb-127-auth-token',JSON.stringify(session));localStorage.setItem(`packit-active-workspace:${owner}`,team)},{session,owner:ids.owner,team:ids.team,loggedIn})
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return{ctx,page,errors,unhandled,writes}
}
const routes=[['viewer-projects','/app/projects','viewer'],['viewer-requests','/app/requests','viewer'],['viewer-profile',`/factory/${sid}/profile`,'viewer'],['outsider-onboarding','/factory/onboarding','outsider'],['signedout-deeplink','/app/requests','login'],['projects','/app/projects'],['requests','/app/requests'],['new-request',`/app/requests/new?projectId=${project.id}`],['request-picker',`/app/requests/${rid}`],['request-receipt',`/app/requests/${rid}`,'published'],['supplier-onboarding','/factory/onboarding'],['supplier-profile',`/factory/${sid}/profile`],['supplier-draft',`/factory/${sid}/profile`,'draft'],['supplier-team',`/factory/${sid}/team`],['supplier-jobs',`/factory/${sid}/jobs`],['supplier-job',`/factory/${sid}/jobs/${rid}`],['supplier-invite','/factory/invitations/accept#token='+'a'.repeat(43)],['public-supplier','/suppliers/studio-print'],['admin-review','/admin/suppliers'],['admin-mfa','/admin/suppliers','mfa'],['admin-denied','/admin/suppliers','denied'],['empty-requests','/app/requests','empty'],['error-requests','/app/requests','error'],['invalid-request','/app/requests/invalid'],['not-found','/not-a-real-route'],['login','/login','login']]
try {
if(process.env.STUDIO_FEATURE_OFF)routes.push(['feature-off-factory','/factory/onboarding'],['feature-off-admin','/admin/suppliers'])
const jobs=(process.env.STUDIO_WIDTHS??'1440,834,390,320').split(',').map(Number).flatMap(width=>routes.filter(([name])=>!process.env.STUDIO_CASES||process.env.STUDIO_CASES.split(',').includes(name)).map(route=>[width,...route]));let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<jobs.length){const [width,name,path,mode]=jobs[cursor++];
 const{ctx,page,errors,unhandled}=await fixture(width,{mode,loggedIn:mode!=='login'});let detail
 try{await page.goto(base+path,{waitUntil:'networkidle'});await page.waitForTimeout(180);if(mode==='error')await page.getByRole('alert').first().waitFor({timeout:12000});await page.screenshot({path:`${out}/${width}-${name}.png`,fullPage:true});detail=await page.evaluate(()=>({title:document.querySelector('h1')?.textContent,bodyWidth:document.body.scrollWidth,viewport:innerWidth,appError:document.body.innerText.includes('Unexpected Application Error'),overflow:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+2}).slice(0,10).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,50)}))}));const accessChecks=[];if(['viewer','outsider','denied'].includes(mode))accessChecks.push(await page.locator('.studio-role-switch a[href="/admin/suppliers"]').count()===0);if(mode==='viewer')accessChecks.push(await page.locator('.studio-navigation a[href$="/team"]').count()===0,await page.locator('.studio-navigation a[href="/app/requests"]').count()===0);if(process.env.STUDIO_FEATURE_OFF&&name==='projects')accessChecks.push(await page.locator('.studio-role-switch a[href="/factory/onboarding"]').count()===0,await page.locator('.studio-navigation a[href="/app/requests"]').count()===0);if(process.env.STUDIO_FEATURE_OFF&&name.startsWith('feature-off'))accessChecks.push(detail.title==='ไม่พบหน้านี้');if(name==='signedout-deeplink')accessChecks.push(new URL(page.url()).pathname==='/login',new URL(page.url()).searchParams.get('returnTo')==='/app/requests');results.push({width,name,accessChecks,ok:accessChecks.every(Boolean)&&!errors.length&&!unhandled.length&&!detail.appError&&detail.bodyWidth<=width+2,errors,unhandled,...detail})}catch(e){results.push({width,name,ok:false,error:e.message,errors,unhandled})}finally{await ctx.close()}
 console.log(JSON.stringify(results.at(-1)))
}}))
for(const width of ((process.env.STUDIO_FEATURE_OFF||process.env.STUDIO_SKIP_INTERACTIONS||process.env.STUDIO_DRAWER_ONLY)?[]:[1440,834,390,320])) {
 const {ctx,page,errors,unhandled,writes}=await fixture(width)
 try {
  await page.goto(base+'/app/requests/'+rid,{waitUntil:'networkidle'})
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button',{name:'ตรวจรายชื่อก่อนส่ง'}).click()
  await page.screenshot({path:`${out}/${width}-request-confirmation.png`,fullPage:true})
  await page.getByRole('button',{name:'กลับไปแก้รายชื่อ'}).click()
  await page.getByRole('checkbox').first().waitFor()
  await page.getByRole('button',{name:'ตรวจรายชื่อก่อนส่ง'}).click()
  await page.getByRole('button',{name:'ยืนยันส่งคำขอ',exact:true}).click()
  await page.waitForTimeout(300)
  if(!writes.some(x=>x.path.endsWith('/publication'))) throw new Error('Publish button did not issue fixture API write')
  await page.goto(base+'/factory/onboarding',{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'ดูแจ้งเตือนคำขอราคา',exact:true}).click()
  await page.screenshot({path:`${out}/${width}-quote-notifications.png`,fullPage:true})
  await page.getByRole('button',{name:'ทำเครื่องหมายว่าอ่านแล้ว',exact:true}).last().click()
  await page.waitForTimeout(250)
  if(!writes.some(x=>x.path.endsWith('/read')))throw new Error('Mark-read button did not issue fixture API write')
  await page.goto(base+'/admin/suppliers',{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'ดูเอกสารประกอบ',exact:true}).click()
  await page.getByText('company-verification-example.pdf').waitFor()
  await page.screenshot({path:`${out}/${width}-admin-documents.png`,fullPage:true})
  results.push({width,name:'publication-notifications-documents-interactions',ok:!errors.length&&!unhandled.length,errors,unhandled,writes})
 }catch(e){results.push({width,name:'publication-notifications-documents-interactions',ok:false,error:e.message,errors,unhandled})}finally{await ctx.close()}
 console.log(JSON.stringify(results.at(-1)))
}
for(const width of ((process.env.STUDIO_FEATURE_OFF||process.env.STUDIO_SKIP_INTERACTIONS)?[]:[834,390,320])) {
 const {ctx,page,errors,unhandled}=await fixture(width)
 try {
  await page.goto(base+'/app/requests',{waitUntil:'networkidle'})
  const menu=page.getByRole('button',{name:'เปิดเมนู',exact:true});const dialog=page.getByRole('dialog',{name:'เมนูนำทาง'})
  await menu.focus();await page.keyboard.press('Enter');await dialog.waitFor()
  await page.screenshot({path:`${out}/${width}-navigation-drawer.png`,fullPage:true})
  for(let i=0;i<18;i++) {await page.keyboard.press('Tab');if(process.env.STUDIO_NATIVE_FOCUS&&await page.evaluate(()=>document.activeElement===document.body&&document.querySelector('dialog').matches(':modal')))await page.keyboard.press('Tab');if(!await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)))throw new Error('Keyboard focus escaped modal drawer '+JSON.stringify(await page.evaluate(()=>({active:document.activeElement.outerHTML.slice(0,300),modal:document.querySelector('dialog').matches(':modal')}))))}
  for(let i=0;i<18;i++){await page.keyboard.press('Shift+Tab');if(!await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)))throw new Error('Reverse keyboard focus escaped modal drawer')}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});if(!await menu.evaluate(el=>el===document.activeElement))throw new Error('Escape did not restore menu focus')
  await menu.click();await dialog.getByRole('button',{name:'ปิดเมนู',exact:true}).click();await dialog.waitFor({state:'hidden'})
  await menu.click();await page.mouse.click(width-3,500);await dialog.waitFor({state:'hidden'})
  await menu.click();await dialog.locator('a[href="/app/projects"]').first().click();await page.waitForURL('**/app/projects');await dialog.waitFor({state:'hidden'})
  await page.goBack();await page.waitForURL('**/app/requests');await page.goForward();await page.waitForURL('**/app/projects');await page.locator('main').focus();await page.waitForTimeout(200);if(!await page.locator('main').evaluate(el=>el===document.activeElement))throw new Error('History transition stole focus from content');await page.reload({waitUntil:'networkidle'})
  if(await page.locator('dialog[open]').count())throw new Error('Drawer reopened across history or reload')
  results.push({width,name:'drawer-keyboard-dismissal-history-reload',ok:!errors.length&&!unhandled.length,errors,unhandled})
 }catch(e){results.push({width,name:'drawer-keyboard-dismissal-history-reload',ok:false,error:e.message,errors,unhandled})}finally{await ctx.close()}
 console.log(JSON.stringify(results.at(-1)))
}
}finally{writeFileSync(process.env.STUDIO_REPORT??(process.env.STUDIO_FEATURE_OFF?'tmp/studio/feature-off-results.json':'tmp/studio/qa-results.json'),JSON.stringify(results,null,2));await browser.close();const files=readdirSync(out).filter(x=>x.endsWith('.png'));writeFileSync(`${out}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>PackIt Studio responsive review</title><style>body{font:16px system-ui;background:#f5f6fa;color:#202939;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}figure{margin:0;background:white;padding:16px;border-radius:16px}img{width:100%;height:440px;object-fit:contain;object-position:top}a{color:#6654c7}figcaption{margin-bottom:12px;font-weight:600}</style><h1>PackIt Studio responsive review</h1><p>Synthetic local browser fixtures. These screenshots do not represent real accounts or live backend integration.</p><main>${files.map(name=>`<figure><figcaption>${name.replace('.png','')}</figcaption><a href="${name}"><img src="${name}" loading="lazy" alt="${name}"></a></figure>`).join('')}</main></html>`)}
console.log(`${results.filter(r=>r.ok).length}/${results.length} passed; synthetic browser fixture, not real integration`)

process.exitCode = results.every(result => result.ok) ? 0 : 1
