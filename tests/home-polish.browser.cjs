/* global window, document, performance, requestAnimationFrame, cancelAnimationFrame, getComputedStyle, innerWidth */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const sharp = require('sharp')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'home-v1-final-frames')
fs.mkdirSync(output, { recursive: true })
;(async () => {
 const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,headless:true,args:['--enable-unsafe-swiftshader']})
 try {
 for (const width of [390,430,1280,1536]) {
  const height=width===390?844:width===430?932:900
  const page=await browser.newPage({viewport:{width,height}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort())
  await page.route('**/api/auth/session',r=>r.fulfill({json:{seller:{id:'test',displayName:'Tester'}}}))
  await page.route('**/_next/data/**/listings.json*',r=>r.fulfill({json:{pageProps:{listings:[],values:{status:'available',sort:'newest',search:'',category:'',condition:''},page:1,hasNextPage:false,error:null},__N_SSP:true}}))
  await page.goto('http://localhost:3100/listings',{waitUntil:'domcontentloaded',timeout:120000})
  await page.locator('[data-market-ready="true"]').waitFor({timeout:30000})
  const nav=page.getByRole('navigation',{name:'Home and Market navigation'})
  if(width<1024)await nav.waitFor()
  const style=async selector=>page.locator(selector).evaluate(e=>{const s=getComputedStyle(e);return {height:e.getBoundingClientRect().height,padding:s.padding,border:s.border,radius:s.borderRadius,font:s.fontSize,weight:s.fontWeight,line:s.lineHeight,color:s.color,icon:e.querySelector('svg')?.getBoundingClientRect().width}})
  const filterStyle=await style('button[aria-label="Filter"]')
  const marketBrand=width<1024?await style('main>header>div:first-child'):null
  const brandIcon=width<1024?await page.locator('main>header>div:first-child>span:first-child').evaluate(e=>({font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color,text:e.textContent})):null
  await page.evaluate(()=>{
   window.polishFrames=[];window.snapshotPixels=[];window.sampledSources=new WeakSet();window.originalNav=document.querySelector('[aria-label="Home and Market navigation"]')?.parentElement
   const sample=()=>{
    const track=document.querySelector('[data-route-track]');const source=document.querySelector('[data-route-source]'),surface=document.querySelector('[data-route-surface]')
    const nav=document.querySelector('[aria-label="Home and Market navigation"]')?.parentElement
    const r=nav?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
    if(source?.firstElementChild&&!window.sampledSources.has(source)){
     window.sampledSources.add(source)
     window.snapshotPixels.push([...source.querySelectorAll('canvas')].map(c=>c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height*0.75),1,1).data[3]))
    }
    const panel=document.querySelector('[aria-label="Sort options"]')
    window.polishFrames.push({t:performance.now(),phase:source?.dataset.routePhase,x:surface.getBoundingClientRect().x,w:surface.getBoundingClientRect().width,sourceX:source?.getBoundingClientRect().x,sourceW:source?.getBoundingClientRect().width,motion:track.getAnimations()[0]?.effect.getTiming(),topSource:document.elementFromPoint(innerWidth/2,350)?.closest('[data-route-source]')?.dataset.routeSource,prep:document.querySelector('[data-market-preparation]')?.dataset.marketPreparation,ready:!!document.querySelector('[data-market-ready="true"]'),nav:nav?{x:r.x,y:r.y,w:r.width,h:r.height,opacity:getComputedStyle(nav).opacity,selected:nav.querySelector('[aria-selected="true"]')?.textContent,count:document.querySelectorAll('[aria-label="Home and Market navigation"]').length,same:nav===window.originalNav,outside:!track.contains(nav),top:nav.contains(hit)}:null,panel:panel?{y:panel.getBoundingClientRect().y,opacity:+getComputedStyle(panel).opacity,transform:getComputedStyle(panel).transform,rows:[...panel.querySelectorAll('button')].map(e=>({y:e.getBoundingClientRect().y,transform:getComputedStyle(e).transform}))}:null})
    window.polishRAF=requestAnimationFrame(sample)
   };sample()
  })
  const session=await page.context().newCDPSession(page)
  const recordings=[];let recording=null
  session.on('Page.screencastFrame',({data,metadata,sessionId})=>{session.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});if(recording)recording.push({data,time:metadata.timestamp})})
  const slide=async(home)=>{
   const label=home?'to-home':'to-market',direction=home?1:-1
   await page.evaluate(()=>performance.clearMarks())
   const start=await page.evaluate(()=>window.polishFrames.length)
   recording=[];await session.send('Page.startScreencast',{format:'png',everyNthFrame:1})
   if(width<1024)await page.getByRole('tab',{name:home?'Home':'Market',exact:true}).click({noWaitAfter:true})
   else if(home)await page.getByRole('navigation',{name:'Market navigation'}).getByRole('link',{name:'Home',exact:true}).click({noWaitAfter:true})
   else await page.getByRole('link',{name:'Back to Market',exact:true}).click({noWaitAfter:true})
   await page.locator('[data-route-phase]').waitFor({state:'detached',timeout:40000})
   await page.waitForTimeout(160)
   await session.send('Page.stopScreencast')
   const frames=await page.evaluate(start=>window.polishFrames.slice(start),start)
   const marks=await page.evaluate(()=>Object.fromEntries(performance.getEntriesByType('mark').filter(e=>e.name.startsWith('page-slide:')).map(e=>[e.name.split(':')[1],e.startTime])))
   assert((await page.evaluate(()=>window.snapshotPixels)).flat().every(alpha=>alpha>0),'Rendered WebGL background retained in source snapshot')
   assert(marks.release>marks.land,'Paint barrier before source release')
   const moving=frames.filter(f=>f.phase==='enter'&&Math.abs(f.x)>1&&Math.abs(f.x)<width)
   assert(moving.length>=3);assert(moving.every(f=>Math.sign(f.x)===direction))
   assert(moving.every((f,i)=>!i||Math.abs(f.x)<=Math.abs(moving[i-1].x)+1))
   assert(moving.every(f=>Math.sign(f.sourceX)===-direction),'Source exits in the same travel direction')
   assert(moving.every(f=>Math.abs((f.x-f.sourceX)-direction*f.w)<0.02),'One track: constant adjacent-page offset, no gap')
   assert(moving.every(f=>Math.abs(f.sourceW-f.w)<0.02),'Equal viewport-sized pages')
   const timing=moving[0].motion
   assert.equal(timing.duration,width<1024?320:380)
   assert.equal(timing.easing,width<1024?'cubic-bezier(0.22, 0.61, 0.36, 1)':'cubic-bezier(0.42, 0, 1, 1)')
   const landed=frames.find(f=>f.phase==='landed')
   assert(landed&&Math.abs(landed.x)<0.02&&Math.abs(landed.sourceX+direction*landed.w)<0.02,'Source out, destination exactly at zero')
   assert(frames.filter(f=>f.t>=marks.land).every(f=>!f.topSource),'No source layer after landing')
   if(!home)assert(moving.every(f=>f.ready),'No incomplete Market entry')
   if(width<1024){
    assert(frames.filter(f=>f.phase==='waiting').every(f=>f.nav?.selected===(home?'Home':'Market')),'Immediate internal active feedback while destination prepares')
    const rect=frames[0].nav
    assert(rect)
    assert(frames.every(f=>f.nav&&f.nav.same&&f.nav.outside&&f.nav.count===1&&f.nav.opacity==='1'&&f.nav.top),'One persistent nav above both layers')
    assert(frames.every(f=>f.nav.x===rect.x&&f.nav.y===rect.y&&f.nav.w===230&&f.nav.h===56),'Nav never translates')
    assert.equal(rect.y,height-64)
   }
   const clip=recording;recording=null
   const origin=await page.evaluate(()=>performance.timeOrigin)
   // Inspect captured pixels as well as DOM geometry: stale compositor textures
   // can flash even while elementFromPoint already reports the destination.
   for(const shot of clip.filter(s=>s.time*1000-origin>=marks.land)){
    const pixel=await sharp(Buffer.from(shot.data,'base64')).extract({left:width<1024?80:200,top:200,width:1,height:1}).removeAlpha().raw().toBuffer()
    const light=(pixel[0]+pixel[1]+pixel[2])/3
    assert(home?light<80:light>100,`Rendered source flash after landing: ${width} ${label} at ${Math.round(shot.time*1000-origin-marks.land)}ms, pixel ${[...pixel]}`)
   }
   const keep=clip.map((shot,index)=>{const file=`${width}-${label}-${String(index).padStart(3,'0')}.png`;fs.writeFileSync(path.join(output,file),Buffer.from(shot.data,'base64'));return {file,t:shot.time*1000-origin}})
   fs.writeFileSync(path.join(output,`${width}-${label}.json`),JSON.stringify({marks,frames,shots:keep},null,2))
   recordings.push({label,frames:keep.length,requestAndSnapshot:Math.round(marks.snapshot-marks.prepare),route:Math.round(marks['route-mounted']-marks.prepare),ready:Math.round(marks.ready-marks['route-mounted']),handoff:Math.round(marks.release-marks.land)})
  }
  await slide(true)
  const root=page.locator('[data-slot="home-sidebar-demo"]')
  await root.locator('canvas[data-rendered="true"]').waitFor()
  if(width<1024){
   const homeBrand=await style('[data-home-mobile-header]')
   for(const key of ['padding','font','weight','line','color'])assert.equal(homeBrand[key],marketBrand[key],`Shared brand ${key}`)
   assert.deepEqual(await root.locator('[data-home-mobile-header]>span>span:first-child').evaluate(e=>({font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color,text:e.textContent})),brandIcon)
   const trigger=root.getByRole('button',{name:'Show more',exact:true})
   const showStyle=await style('[data-smooth-dropdown]>button')
   for(const key of ['height','padding','border','radius','font','icon'])assert.equal(showStyle[key],filterStyle[key],`Filter matched ${key}`)
   const before=await trigger.boundingBox(),header=await root.locator('[data-home-mobile-header]').boundingBox()
   assert.equal(await root.locator('main').first().getByRole('heading').textContent(),'Overview')
   await trigger.click();await page.waitForTimeout(300)
   assert.deepEqual(await trigger.boundingBox(),before);assert.deepEqual(await root.locator('[data-home-mobile-header]').boundingBox(),header)
   assert.equal(await trigger.evaluate(e=>getComputedStyle(e).opacity),'1')
   assert.equal(await trigger.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)')
   const panel=await root.locator('[data-smooth-menu]').evaluate(e=>{const r=e.parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
   assert.equal(panel.x+panel.width,before.x+before.width);assert.equal(panel.y,before.y+before.height+8)
   await page.screenshot({path:path.join(output,`${width}-dropdown.png`)})
   await root.getByRole('button',{name:'Listings',exact:true}).click();await page.waitForTimeout(250)
   await root.getByRole('button',{name:'Favorites',exact:true}).click()
   assert(await root.locator('main').first().getByRole('heading',{name:'Favorites'}).isVisible())
   await trigger.click()
   await root.getByRole('button',{name:'Profile',exact:true}).click()
   assert.equal(await root.locator('main').first().getByRole('heading').textContent(),'Overview')
   assert.equal(await root.getByRole('button',{name:'Overview',exact:true}).getAttribute('aria-current'),'page')
   await root.getByRole('button',{name:'Listings',exact:true}).click()
   assert.equal(await root.locator('main').first().getByRole('heading').textContent(),'My Listings')
   assert.equal(await root.getByRole('button',{name:'My Listings',exact:true}).getAttribute('aria-current'),'page')
   await root.getByRole('button',{name:'Create Listing',exact:true}).click()
   assert.equal(await root.locator('main').first().getByRole('heading').textContent(),'Create Listing')
   await trigger.click()
   await root.getByRole('button',{name:'Messages',exact:true}).click()
   assert.equal(await root.locator('main').first().getByRole('heading').textContent(),'Inbox')
   assert.equal(await root.getByRole('button',{name:'Inbox',exact:true}).getAttribute('aria-current'),'page')
   await root.getByRole('button',{name:'Settings',exact:true}).click()
   assert.equal(await root.locator('main').first().getByRole('heading').textContent(),'Settings')
   console.log(`STYLE ${width}:`,JSON.stringify({marketBrand,homeBrand,brandIcon,filterStyle,showStyle}))
  }else{
   const workspace=await root.locator('[data-slot="sidebar"]').boundingBox()
   assert.equal(workspace.x,48);assert.equal(workspace.y,48)
   assert.notEqual(await root.locator('main').last().evaluate(e=>getComputedStyle(e).backgroundColor),await root.locator('[data-slot="sidebar-body"]').evaluate(e=>getComputedStyle(e).backgroundColor))
  }
  await page.screenshot({path:path.join(output,`${width}-home.png`)})
  await slide(false)
  const start=await page.evaluate(()=>window.polishFrames.length)
  await page.getByRole('button',{name:'Sort',exact:true}).click()
  await page.waitForTimeout(300)
  await page.screenshot({path:path.join(output,`${width}-sort.png`)})
  await page.keyboard.press('Escape')
  await page.getByRole('region',{name:'Sort options',exact:true}).waitFor({state:'detached'})
  const sortFrames=await page.evaluate(start=>window.polishFrames.slice(start).filter(f=>f.panel),start)
  assert(sortFrames.length>6)
  assert(sortFrames.some(f=>f.panel.opacity>0&&f.panel.opacity<1))
  assert(sortFrames.every(f=>f.panel.transform==='none'&&f.panel.y===sortFrames[0].panel.y&&f.panel.rows.every((r,i)=>r.transform==='none'&&r.y===sortFrames[0].panel.rows[i].y)),'Sort panel/rows have no geometry animation')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  assert.deepEqual(errors,[])
  console.log(`PASS ${width}: persistent nav, adjacent two-page track in both directions, painted release, anchored dropdown, shared styles, Sort opacity only;`,JSON.stringify(recordings))
  await page.evaluate(()=>cancelAnimationFrame(window.polishRAF));await page.close()
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
