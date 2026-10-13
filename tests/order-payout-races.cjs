// Dedicated synthetic identities/listings only. Never consumes a canonical Request.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const { spawn } = require('node:child_process')
module.exports = async function ({
  query,
  root,
  ref,
  fingerprint,
  preflight,
  onlyCompeting = false,
}) {
  const seller = crypto.randomUUID(),
    buyer = crypto.randomUUID(),
    other = crypto.randomUUID(),
    users = [seller, buyer, other]
  const listings = []
  const marker = 'Payout race ' + crypto.randomUUID()
  const term = `'{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"pending"}'::jsonb`
  const scopeFile = path.join(root, 'race-scope.json')
  fs.writeFileSync(scopeFile, JSON.stringify({ users, listings, marker }))
  function as(actor, sql) {
    return `set local role authenticated;select set_config('request.jwt.claims','${JSON.stringify(
      { sub: actor, role: 'authenticated' }
    )}',true);${sql};reset role;`
  }
  function payout(status) {
    return `select public.marketplace_record_financial_capability('${seller}','payout_account','${status}',${
      status === 'unset'
        ? 'null,null,null,null,null'
        : "'staging_test','test_owner','test_payout','Test Bank','6789'"
    });`
  }
  function command(action, id) {
    const key = crypto.randomUUID()
    return action === 'accept'
      ? `perform public.marketplace_accept_order_request('${id}','${key}')`
      : action === 'create'
      ? `perform public.marketplace_create_order_request('${id}',${term},'${key}')`
      : `perform public.marketplace_replace_order_request('${id}',${term},'${key}')`
  }
  async function asyncQuery(sql) {
    const file = path.join(root, 'race-' + crypto.randomUUID() + '.sql')
    fs.writeFileSync(file, sql)
    try {
      return await new Promise((resolve, reject) => {
        const p = spawn(
          'cmd.exe',
          [
            '/d',
            '/c',
            'npx.cmd',
            '--no-install',
            'supabase',
            'db',
            'query',
            '--linked',
            '--project-ref',
            ref,
            '--file',
            file,
            '--output',
            'json',
          ],
          { windowsHide: true }
        )
        let out = '',
          err = ''
        p.stdout.on('data', (d) => (out += d))
        p.stderr.on('data', (d) => (err += d))
        p.on('close', (code) => {
          if (code) {
            fs.writeFileSync(path.join(root, 'race-diagnostic.txt'), err)
            return reject(Error('Race query failed; ignored diagnostic only'))
          }
          try {
            resolve(JSON.parse(out.slice(out.indexOf('{'))).rows)
          } catch {
            reject(Error('Invalid race response'))
          }
        })
      })
    } finally {
      fs.unlinkSync(file)
    }
  }
  function operation(action, id, tag, delay = 0) {
    const actor = action === 'accept' ? buyer : seller
    return `/* ${tag} */begin;set local lock_timeout='40s';set local statement_timeout='60s';create temporary table outcome(ok boolean,code text);grant all on outcome to authenticated;${as(
      actor,
      `do $race$ begin ${command(
        action,
        id
      )};insert into outcome values(true,null);exception when others then insert into outcome values(false,sqlstate);end;$race$`
    )}${delay ? `select pg_sleep(${delay});` : ''}select * from outcome;commit;`
  }
  async function waitFor(tag, event) {
    for (let i = 0; i < 5; i++) {
      const row = query(
        `select count(*) count from pg_stat_activity where pid<>pg_backend_pid() and query like '%${tag}%' and wait_event='${event}'`
      )[0]
      if (row.count > 0) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw Error('Race synchronization barrier missing: ' + event)
  }
  function scope(withRequest = true) {
    const lid = crypto.randomUUID()
    listings.push(lid)
    fs.writeFileSync(scopeFile, JSON.stringify({ users, listings, marker }))
    query(
      `begin;alter table public.listings disable trigger listings_publication_boundary;insert into public.listings(id,seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at) select '${lid}','${seller}','${marker}','Synthetic concurrency fixture',8000,currency,category,subcategory,condition,pickup_area,1,now() from public.listings where published_at is not null limit 1;set constraints all immediate;alter table public.listings enable trigger listings_publication_boundary;commit;`
    )
    const cid = query(
      `begin;${as(
        buyer,
        `select id from public.marketplace_find_or_create_conversation('${lid}')`
      )}commit;`
    )[0].id
    let rid
    if (withRequest) {
      query('begin;' + payout('ready') + 'commit;')
      rid = query(
        `begin;${as(
          seller,
          `select id from public.marketplace_create_order_request('${cid}',${term},gen_random_uuid())`
        )}commit;`
      )[0].id
    }
    return { lid, cid, rid }
  }
  let allPending = []
  try {
    query(
      `begin;insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ${users
        .map(
          (id) =>
            `('${id}','financial_${id}@uwo.ca',now(),jsonb_build_object('username','Fin_${id
              .replaceAll('-', '')
              .slice(0, 12)}'))`
        )
        .join(',')};commit;`
    )
    for (const [action, status] of onlyCompeting
      ? []
      : [
          ['accept', 'needs_attention'],
          ['replace', 'unset'],
          ['create', 'unset'],
          ['accept', 'ready'],
          ['create', 'ready'],
        ]) {
      const fixture = scope(action !== 'create'),
        id = action === 'create' ? fixture.cid : fixture.rid
      if (status === 'ready') query('begin;' + payout('unset') + 'commit;')
      const tag = 'paygate_' + crypto.randomUUID().replaceAll('-', ''),
        opTag = tag + '_operation'
      const first = asyncQuery(
        `/* ${tag} */begin;set local lock_timeout='40s';${payout(
          status
        )}select pg_sleep(25);commit;`
      )
      allPending = [first]
      await waitFor(tag, 'PgSleep')
      const second = asyncQuery(operation(action, id, opTag))
      allPending.push(second)
      await waitFor(opTag, 'advisory')
      const outcomes = await Promise.allSettled(allPending)
      allPending = []
      for (const o of outcomes) if (o.status === 'rejected') throw o.reason
      const result = outcomes[1].value[0]
      assert.equal(
        result.ok,
        status === 'ready',
        action + ' observes mutation winner'
      )
      if (status !== 'ready') {
        assert.equal(result.code, 'P0001')
        const counts = query(
          `select (select count(*) from public.orders where listing_id='${fixture.lid}') orders,(select count(*) from public.order_requests where conversation_id='${fixture.cid}') requests,(select count(*) from public.transaction_events where conversation_id='${fixture.cid}' and event_type in('order_created','request_replaced')) changed_events,(select status from public.listings where id='${fixture.lid}') inventory`
        )[0]
        assert.equal(counts.orders, 0)
        assert.equal(counts.requests, action === 'create' ? 0 : 1)
        assert.equal(counts.changed_events, 0)
        assert.equal(counts.inventory, 'available')
      }
      console.log(
        'PASS deterministic ' +
          action +
          ' vs ' +
          status +
          ': capability winner observed; blocked on shared advisory; no stale Ready/partial writes'
      )
    }
    // Opposite winner: operation holding the lock commits first; later capability loss
    // cannot retroactively invalidate that successful Request/Order. Repeat inversion probes.
    for (const action of onlyCompeting
      ? []
      : ['accept', 'replace', 'accept', 'replace']) {
      const fixture = scope(),
        id = fixture.rid
      query('begin;' + payout('ready') + 'commit;')
      const tag = 'paygate_' + crypto.randomUUID().replaceAll('-', ''),
        mutTag = tag + '_mutation'
      const first = asyncQuery(operation(action, id, tag, 25))
      allPending = [first]
      await waitFor(tag, 'PgSleep')
      const second = asyncQuery(
        `/* ${mutTag} */begin;set local lock_timeout='40s';${payout(
          'needs_attention'
        )}commit;`
      )
      allPending.push(second)
      await waitFor(mutTag, 'advisory')
      const results = await Promise.allSettled(allPending)
      allPending = []
      for (const r of results) if (r.status === 'rejected') throw r.reason
      assert.equal(results[0].value[0].ok, true)
      console.log(
        'PASS ' +
          action +
          ' winner then readiness loss; shared lock, no deadlock, no retroactive invalidation'
      )
    }
    // Two competing Buyers / same listing plus readiness mutation: listing serialization
    // remains intact; no lock inversion even across independent idempotency keys.
    const fixture = scope()
    const c2 = query(
      `begin;${as(
        other,
        `select id from public.marketplace_find_or_create_conversation('${fixture.lid}')`
      )}commit;`
    )[0].id
    const r2 = query(
      `begin;${as(
        seller,
        `select id from public.marketplace_create_order_request('${c2}',${term},gen_random_uuid())`
      )}commit;`
    )[0].id
    const tag = 'paygate_' + crypto.randomUUID().replaceAll('-', '')
    const first = asyncQuery(
      `/* ${tag} */begin;${payout(
        'needs_attention'
      )}select pg_sleep(25);commit;`
    )
    allPending = [first]
    await waitFor(tag, 'PgSleep')
    const second = asyncQuery(operation('accept', fixture.rid, tag + '_buyer1'))
    const third = asyncQuery(
      operation('accept', r2, tag + '_buyer2').replace(
        `"sub":"${buyer}"`,
        `"sub":"${other}"`
      )
    )
    allPending.push(second, third)
    const outcomes = await Promise.allSettled(allPending)
    allPending = []
    for (const o of outcomes) if (o.status === 'rejected') throw o.reason
    for (const outcome of outcomes.slice(1)) {
      assert.equal(outcome.value[0].ok, false)
      assert.equal(
        outcome.value[0].code,
        'P0001',
        'Domain denial, never deadlock/timeout'
      )
    }
    const invariant = query(
      `select (select count(*) from public.orders where listing_id='${fixture.lid}') orders, (select count(*) from public.order_requests where listing_id='${fixture.lid}' and status='active') active_requests, (select count(*) from public.transaction_events where conversation_id in('${fixture.cid}','${c2}') and event_type='order_created') order_events, (select status from public.listings where id='${fixture.lid}') inventory`
    )[0]
    assert.deepEqual(invariant, {
      orders: 0,
      active_requests: 2,
      order_events: 0,
      inventory: 'available',
    })
    console.log(
      'PASS competing Accepts plus payout mutation: both reject authoritative loss; no deadlock'
    )
  } finally {
    await Promise.allSettled(allPending)
    if (listings.length) {
      const ids = listings.map((id) => `'${id}'`).join(',')
      query(
        `begin;lock table public.listings,public.orders,public.order_requests,public.transaction_events,marketplace_private.order_commands,public.conversations in access exclusive mode;alter table public.listings disable trigger user;alter table public.orders disable trigger user;alter table public.order_requests disable trigger user;alter table public.transaction_events disable trigger user;delete from public.transaction_events where conversation_id in(select id from public.conversations where listing_id in(${ids}));delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${ids}));update public.listings set status='available',reserved_order_id=null where id in(${ids}) and seller_id='${seller}' and title='${marker}';delete from public.orders where listing_id in(${ids});delete from public.order_requests where listing_id in(${ids});delete from public.conversations where listing_id in(${ids});delete from public.listings where id in(${ids}) and seller_id='${seller}' and title='${marker}';set constraints all immediate;alter table public.listings enable trigger user;alter table public.orders enable trigger user;alter table public.order_requests enable trigger user;alter table public.transaction_events enable trigger user;delete from auth.users where id in(${users
          .map((id) => `'${id}'`)
          .join(',')});commit;`
      )
    } else
      query(
        `delete from auth.users where id in(${users
          .map((id) => `'${id}'`)
          .join(',')});`
      )
    assert.deepEqual(fingerprint(), preflight.fingerprint)
    assert.equal(
      query(
        `select count(*) count from marketplace_private.financial_capabilities`
      )[0].count,
      0
    )
    fs.unlinkSync(scopeFile)
    console.log(
      'PASS synthetic race fixtures removed; canonical data fingerprints unchanged, financial rows zero'
    )
  }
}
