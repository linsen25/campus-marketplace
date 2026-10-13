// Dedicated synthetic identities/listings only. Never consumes a canonical Request.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const { spawn } = require('node:child_process')
module.exports = async function ({ query, root, ref, fingerprint, preflight }) {
  const seller = crypto.randomUUID(),
    buyer = crypto.randomUUID(),
    other = crypto.randomUUID(),
    users = [seller, buyer, other]
  const listings = []
  const marker = 'Financial race ' + crypto.randomUUID()
  const term = `'{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}'::jsonb`
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
  function trusted(sql) {
    return `select set_config('request.jwt.claims','{"role":"service_role","ref":"${ref}"}',true);${sql}`
  }
  function pay(oid, tag, delay = 0) {
    return `/* ${tag} */begin;set local lock_timeout='40s';set local statement_timeout='60s';create temporary table result(value jsonb);${trusted(
      `insert into result select public.marketplace_simulate_order_payment_success('${oid}','${buyer}',gen_random_uuid());`
    )}${
      delay ? `select pg_sleep(${delay});` : ''
    }select value result from result;commit;`
  }
  function accepted() {
    const f = scope()
    query(
      `begin;select public.marketplace_record_financial_capability('${buyer}','payment_method','set','staging_test','test_owner','test_method','Test Card','4242');commit;`
    )
    f.c2 = query(
      `begin;${as(
        other,
        `select id from public.marketplace_find_or_create_conversation('${f.lid}')`
      )}commit;`
    )[0].id
    f.r2 = query(
      `begin;${as(
        seller,
        `select id from public.marketplace_create_order_request('${f.c2}',${term},gen_random_uuid())`
      )}commit;`
    )[0].id
    f.oid = query(
      `begin;${as(
        buyer,
        `select id from public.marketplace_accept_order_request('${f.rid}',gen_random_uuid())`
      )}commit;`
    )[0].id
    return f
  }
  function deadline(f, interval) {
    query(
      `begin;alter table public.orders disable trigger orders_immutable;with t as(select clock_timestamp()+interval '${interval}' deadline) update public.orders set created_at=t.deadline-interval '30 minutes',accepted_at=t.deadline-interval '30 minutes',reservation_started_at=t.deadline-interval '30 minutes',reservation_expires_at=t.deadline from t where id='${f.oid}';alter table public.orders enable trigger orders_immutable;commit;`
    )
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
    for (const winner of ['payment', 'expiry']) {
      const f = accepted(),
        tag = 'financial_' + crypto.randomUUID().replaceAll('-', '')
      deadline(f, winner === 'payment' ? '20 seconds' : '-1 second')
      const first = asyncQuery(
        winner === 'payment'
          ? pay(f.oid, tag, 25)
          : `/* ${tag} */begin;select marketplace_private.settle_listing_reservation('${f.lid}');select pg_sleep(25);commit;`
      )
      allPending = [first]
      await waitFor(tag, 'PgSleep')
      const secondTag = tag + '_second'
      const second = asyncQuery(
        winner === 'payment'
          ? `/* ${secondTag} */begin;set local lock_timeout='40s';select marketplace_private.settle_listing_reservation('${f.lid}');commit;`
          : pay(f.oid, secondTag)
      )
      allPending.push(second)
      let waited = false
      for (let i = 0; i < 5; i++) {
        if (
          query(
            `select count(*) count from pg_stat_activity where pid<>pg_backend_pid() and query like '%${secondTag}%' and wait_event_type='Lock'`
          )[0].count > 0
        ) {
          waited = true
          break
        }
      }
      assert(waited, 'real overlapping inventory lock observed')
      const results = await Promise.allSettled(allPending)
      allPending = []
      for (const r of results) if (r.status === 'rejected') throw r.reason
      const current = query(
        `select payment_status,lifecycle_status,holds_listing,payout_status,(select status from public.listings where id='${f.lid}') inventory,(select count(*) from public.transaction_events where order_id='${f.oid}' and event_type='payment_paid') events from public.orders where id='${f.oid}'`
      )[0]
      if (winner === 'payment') {
        assert.equal(results[0].value[0].result.order.payment_status, 'paid')
        assert.deepEqual(current, {
          payment_status: 'paid',
          lifecycle_status: 'open',
          holds_listing: true,
          payout_status: 'not_eligible',
          inventory: 'reserved',
          events: 1,
        })
        // Another Buyer cannot win this paid inventory, even after the old deadline.
        const outcome = await asyncQuery(
          `begin;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${other}","role":"authenticated"}',true);create temporary table outcome(code text);do $$begin perform public.marketplace_accept_order_request('${f.r2}',gen_random_uuid());insert into outcome values('unexpected_success');exception when others then insert into outcome values(sqlstate);end;$$;select * from outcome;rollback;`
        )
        assert.equal(outcome[0].code, '23505')
        console.log(
          'PASS competing Buyer Accept denied after paid deadline; paid inventory remains held'
        )
      } else {
        assert.equal(
          results[1].value[0].result.errorCode,
          'order_not_payment_ready'
        )
        assert.deepEqual(current, {
          payment_status: 'pending',
          lifecycle_status: 'expired',
          holds_listing: false,
          payout_status: 'not_eligible',
          inventory: 'available',
          events: 0,
        })
      }
      console.log(
        'PASS ' +
          winner +
          ' wins payment/expiry overlap: authoritative serialized outcome, no Paid+Expired or released Paid inventory'
      )
    }
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
