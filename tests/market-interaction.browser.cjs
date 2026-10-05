/* global window, document, requestAnimationFrame, performance, getComputedStyle, marketCalls:writable, originalScroll, marketFrames, marketStarted */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--enable-unsafe-swiftshader'] })
  try {
    for (const [width, columns] of [[390,2],[768,3],[834,3],[1280,4],[1536,5]].filter(([width])=>!process.env.TEST_WIDTHS||process.env.TEST_WIDTHS.split(',').includes(String(width)))) {
      const page = await browser.newPage({viewport:{width,height:900},hasTouch:width<1024,serviceWorkers:process.env.PRODUCTION_PREVIEW?'allow':'block'})
      const errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/api/auth/session',r=>r.fulfill({json:{seller:null}}))
      await page.goto('http://localhost:3100/listings',{waitUntil:'domcontentloaded',timeout:120000})
      const button=name=>page.getByRole('button',{name,exact:true})
      await button('Filter').waitFor();await page.waitForTimeout(1000)
      const header=page.locator('main > header')
      const grid=page.locator('[data-market-grid] > div').first()
      assert.equal(await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),columns)
      assert.equal(await header.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(11, 11, 11)')
      if(width<1024) {
        assert.equal((await header.boundingBox()).height,106)
        assert.equal(await header.locator(':scope > div').first().evaluate(e=>getComputedStyle(e).paddingBottom),'12px')
      } else {
        const profile=page.getByRole('link',{name:'Home'})
        assert.equal(await profile.getAttribute('href'),'/home')
        assert.equal((await profile.boundingBox()).width,60)
        assert.equal((await profile.boundingBox()).height,60)
        assert.equal(await profile.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(22, 101, 52)')
        // Force a classic scrollbar in headless Chrome, where OS scrollbars overlay.
        await page.addStyleTag({content:'html { overflow-y: scroll; } html::-webkit-scrollbar { width: 17px; }'})
        assert.equal(await page.evaluate(()=>window.innerWidth-document.documentElement.clientWidth),17)
      }
      await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1000)
      const geometry=async()=>Promise.all([header,button('Open search'),button('Sort'),button('Filter')].map(e=>e.boundingBox()))
      const before=await geometry()
      await page.screenshot({path:`${process.env.TEMP}/market-interaction-${width}-before.png`})
      await page.locator('[data-market-card] [data-slot="expandable-card"]').first().click()
      const dialog=page.getByRole('dialog');await dialog.waitFor();await page.waitForTimeout(700)
      assert.deepEqual(await geometry(),before,'Header and controls stay pixel stable during body lock')
      if(width<1024) assert.equal(await page.getByRole('navigation',{name:'Home and Market navigation'}).count(),1)
      await page.screenshot({path:`${process.env.TEMP}/market-interaction-${width}-open.png`})
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await page.waitForTimeout(100)
      assert.deepEqual(await geometry(),before,'Header and controls restore without horizontal shift')
      await page.screenshot({path:`${process.env.TEMP}/market-interaction-${width}-closed.png`})
      await button('Filter').click();await page.waitForTimeout(300)
      const panel=page.getByRole('region',{name:'Filter options',exact:true})
      const scroll=panel.getByRole('region',{name:'Filter scrolling content',exact:true})
      const chooseCategory=async()=>{
        await page.getByRole('combobox',{name:'Category',exact:true}).click();await page.waitForTimeout(200)
        await page.getByRole('option',{name:'Electronics',exact:true}).click();await page.waitForTimeout(250)
      }
      await chooseCategory()
      const natural=await scroll.evaluate(e=>({height:e.clientHeight,content:e.scrollHeight,color:getComputedStyle(e).scrollbarColor}))
      assert.equal(natural.height,natural.content,'Natural Filter height has no unnecessary overflow')
      assert(natural.height>340,'Category and subcategory can extend beyond old fixed cap')
      assert.equal(natural.color,'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)')
      await page.screenshot({path:`${process.env.TEMP}/market-interaction-${width}-filter.png`})
      await page.setViewportSize({width,height:420});await page.waitForTimeout(250)
      const overflow=await scroll.evaluate(e=>e.scrollHeight>e.clientHeight)
      assert(overflow,'Short viewport constrains Filter only when needed')
      assert((await panel.boundingBox()).y+(await panel.boundingBox()).height<=404)
      await scroll.hover();await page.mouse.wheel(0,100);await page.waitForTimeout(100)
      assert.equal(await scroll.evaluate(e=>getComputedStyle(e).scrollbarColor),'rgb(245, 245, 245) rgba(0, 0, 0, 0)')
      await page.waitForTimeout(700)
      assert.equal(await scroll.evaluate(e=>getComputedStyle(e).scrollbarColor),'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)')
      await page.keyboard.press('Escape');await panel.waitFor({state:'detached'})
      await page.setViewportSize({width,height:900});await page.waitForTimeout(250)
      if(width>=1024) {
        await button('Page 2').scrollIntoViewIfNeeded()
        await page.evaluate(()=>{
          window.marketFrames=[];window.marketCalls=[]
          window.originalScroll=window.scrollTo.bind(window)
          window.scrollTo=(options)=>{marketCalls.push({t:performance.now()-window.marketStarted,y:window.scrollY,target:options.top});originalScroll(options)}
          window.marketStarted=performance.now()
          const sample=()=>{marketFrames.push({t:performance.now()-marketStarted,y:window.scrollY,header:document.querySelector('main>header').getBoundingClientRect().y});if(performance.now()-marketStarted<1100)requestAnimationFrame(sample)}
          sample();document.querySelector('[aria-label="Page 2"]').click()
        })
        await page.waitForTimeout(1200)
        const {frames,calls}=await page.evaluate(()=>({frames:marketFrames,calls:marketCalls}))
        const start=frames[0].y
        assert(start>200)
        assert(calls[0].t>=190,'Preserve 200ms delay')
        assert(frames.filter(f=>f.t<190).every(f=>f.y===start),'No browser pre-scroll jump on render')
        assert.equal(calls[0].y,start,'Animation starts at actual current scroll position')
        assert(frames.every(f=>f.header===0),'Header and Discover stay at the top throughout')
        assert(Math.abs(calls[0].target-start)<2,'Ease-in begins continuously')
        const middle=calls[Math.floor(calls.length/2)]
        assert(Math.abs(middle.target-start)/Math.abs(calls.at(-1).target-start)<0.3)
        assert(Math.abs((await header.locator('..').locator(':scope > div').last().boundingBox()).y-(await header.boundingBox()).height)<1,'Browsing top aligns below measured sticky region')
        assert.equal(await page.locator('[data-market-card]').count(),15)
        await button('Page 1').scrollIntoViewIfNeeded()
        await page.evaluate(()=>{marketCalls=[];document.querySelector('[aria-label="Page 1"]').click()})
        await page.waitForTimeout(70)
        await page.evaluate(()=>document.querySelector('[aria-label="Page 2"]').click())
        await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>marketCalls.length),0)
        await page.waitForTimeout(900)
        await button('Page 1').scrollIntoViewIfNeeded()
        await page.evaluate(()=>document.querySelector('[aria-label="Page 1"]').click());await page.waitForTimeout(300)
        await page.evaluate(()=>{marketCalls=[];document.querySelector('[aria-label="Page 2"]').click()})
        await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>marketCalls.length),0,'Active animation cancelled by new page change')
        await page.waitForTimeout(900)
        await page.evaluate(()=>window.scrollTo=window.originalScroll)
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
      assert.deepEqual(errors,[])
      console.log(`PASS ${width}: ${columns} columns, stable header/card geometry, green desktop control, natural/overflow Filter and transient scrollbar${width>=1024?', continuous delayed pagination and cancellation':''}`)
      await page.close()
    }
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
