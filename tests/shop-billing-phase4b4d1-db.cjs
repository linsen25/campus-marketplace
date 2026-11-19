// Extends the proven isolated 4B-4C fixture so governance is tested against
// the exact reversal review schema and migration chain, not a mock schema.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const base = fs.readFileSync(
  path.join(__dirname, 'shop-billing-phase4b4c-db.cjs'),
  'utf8'
)
const marker = "    reversal('evt_Dispute', 'dp_Won', {"
const extraMigrations =
  "      '20261119001659_shop_billing_reversal_manual_review.sql',\n      '20261119053840_shop_billing_reversal_governance_records.sql',"
let governance = String.raw`
    sql(\`
      insert into marketplace_private.shop_billing_review_operators(id,operator_user_id,role,authorization_source)
      values('71000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','reviewer','isolated_test'),
            ('71000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','approver','isolated_test'),
            ('71000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','billing_admin','isolated_test')
      on conflict do nothing;
    \`)
    const reviewRevision = Number(
      sql(
        \`select revision::text from marketplace_private.shop_billing_reversal_reviews where id='\${partialReview}'::uuid\`
      ).trim()
    )
    assert.ok(Number.isSafeInteger(reviewRevision), 'current review revision')
    const proposalExpiresAt = sql(
      "select (clock_timestamp() + interval '1 day')::text"
    ).trim()
    const expiredProposalAt = sql(
      "select (clock_timestamp() - interval '1 minute')::text"
    ).trim()
    const overlongProposalAt = sql(
      "select (clock_timestamp() + interval '31 days')::text"
    ).trim()
    assert.ok(proposalExpiresAt && expiredProposalAt && overlongProposalAt)
    sql(\`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.p45_reject($q$select public.marketplace_shop_billing_create_reversal_review_proposal('{
        "reviewId":"\${partialReview}","operatorId":"71000000-0000-4000-8000-000000000001","requestId":"72000000-0000-4000-8000-000000000010","proposalKind":"no_effect","reasonCode":"expired_fixture","expiresAt":"\${expiredProposalAt}","expectedReviewRevision":\${reviewRevision}
      }'::jsonb)$q$,'23514');
      select public.p45_reject($q$select public.marketplace_shop_billing_create_reversal_review_proposal('{
        "reviewId":"\${partialReview}","operatorId":"71000000-0000-4000-8000-000000000001","requestId":"72000000-0000-4000-8000-000000000011","proposalKind":"no_effect","reasonCode":"overlong_fixture","expiresAt":"\${overlongProposalAt}","expectedReviewRevision":\${reviewRevision}
      }'::jsonb)$q$,'23514');
      select public.p45_reject($q$select public.marketplace_shop_billing_create_reversal_review_proposal('{
        "reviewId":"\${partialReview}","operatorId":"71000000-0000-4000-8000-000000000001","requestId":"72000000-0000-4000-8000-000000000012","proposalKind":"no_effect","reasonCode":"stale_fixture","expiresAt":"\${proposalExpiresAt}","expectedReviewRevision":\${reviewRevision - 1}
      }'::jsonb)$q$,'40001');
      reset role;
    \`)
    const proposal = readUuid(
      \`with service_claim as (
        select set_config('request.jwt.claim.role','service_role',true)
      ) select (public.marketplace_shop_billing_create_reversal_review_proposal('{
        "reviewId":"\${partialReview}","operatorId":"71000000-0000-4000-8000-000000000001","requestId":"72000000-0000-4000-8000-000000000001","proposalKind":"no_effect","reasonCode":"partial_refund_review","note":"isolated governance proof","expiresAt":"\${proposalExpiresAt}","expectedReviewRevision":\${reviewRevision}
      }'::jsonb)->>'proposalId')::text from service_claim\`,
      'governance proposal'
    )
    const proposalRevision = Number(
      sql(
        \`select revision::text from marketplace_private.shop_billing_reversal_review_proposals where id='\${proposal}'::uuid\`
      ).trim()
    )
    assert.ok(Number.isSafeInteger(proposalRevision), 'current proposal revision')
    sql(\`
      set role service_role; select set_config('request.jwt.claim.role','service_role',false);
      select public.p45_reject($q$select public.marketplace_shop_billing_approve_reversal_review_proposal('{
        "proposalId":"\${proposal}","operatorId":"71000000-0000-4000-8000-000000000001","requestId":"72000000-0000-4000-8000-000000000002","decision":"approved","reasonCode":"self_approval","expectedProposalRevision":\${proposalRevision}
      }'::jsonb)$q$,'23514');
      select public.p45_reject($q$select public.marketplace_shop_billing_create_reversal_review_proposal('{
        "reviewId":"\${partialReview}","operatorId":"71000000-0000-4000-8000-000000000099","requestId":"72000000-0000-4000-8000-000000000099","proposalKind":"escalate","reasonCode":"untrusted","expiresAt":"\${proposalExpiresAt}","expectedReviewRevision":\${reviewRevision}
      }'::jsonb)$q$,'42501');
      select public.marketplace_shop_billing_approve_reversal_review_proposal('{
        "proposalId":"\${proposal}","operatorId":"71000000-0000-4000-8000-000000000002","requestId":"72000000-0000-4000-8000-000000000003","decision":"approved","reasonCode":"independent_approval","expectedProposalRevision":\${proposalRevision}
      }'::jsonb);
      select public.p45_assert((public.marketplace_shop_billing_approve_reversal_review_proposal('{
        "proposalId":"\${proposal}","operatorId":"71000000-0000-4000-8000-000000000002","requestId":"72000000-0000-4000-8000-000000000003","decision":"approved","reasonCode":"independent_approval","expectedProposalRevision":\${proposalRevision}
      }'::jsonb)->>'outcome')='already_recorded','duplicate approval request is idempotent');
      select public.p45_assert((select proposal_status='approved_unexecuted' from marketplace_private.shop_billing_reversal_review_proposals where id='\${proposal}'::uuid),'two different operators approve without execution');
      select public.p45_assert((select count(*)=1 from marketplace_private.shop_billing_reversal_review_approvals where proposal_id='\${proposal}'::uuid),'one immutable approval');
      select public.p45_assert((select count(*)=0 from marketplace_private.shop_membership_provider_terms),'governance never creates Provider Terms');
      select public.p45_assert((select count(*)=0 from marketplace_private.shop_memberships),'governance never changes Membership');
      reset role;
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select public.p45_reject($q$select * from marketplace_private.shop_billing_review_operators$q$,'42501');
      select public.p45_reject($q$select * from marketplace_private.shop_billing_reversal_review_proposals$q$,'42501');
      select public.p45_reject($q$select public.marketplace_shop_billing_create_reversal_review_proposal('{}'::jsonb)$q$,'42501');
      reset role;
    \`)
`
governance = governance.replaceAll('\\`', '`')
// `String.raw` intentionally preserved the escapes that protected the outer
// generator template. Remove them before injecting into the child fixture so
// its own partialReview/proposal variables interpolate at execution time.
governance = governance.replaceAll('\\${', '${')
assert.doesNotMatch(
  governance,
  /\\\$\{/,
  'generated fixture must interpolate its local IDs rather than send literals'
)

assert.ok(base.includes(marker), '4B-4C fixture anchor missing')
let generated = base.replace(
  "      '20261119001659_shop_billing_reversal_manual_review.sql',",
  extraMigrations
)
generated = generated.replace(marker, governance + '\n' + marker)
generated = generated.replace(
  'PASS isolated Billing Phase 4B-4C PostgreSQL: service-only manual review, duplicate/stale-safe cases, partial/dispute no-op, private-table denial, and no entitlement mutation.',
  'PASS isolated Billing Phase 4B-4D-1 PostgreSQL: private operator registry, dual-control proposals, immutable approvals, denial, and no entitlement mutation.'
)
const generatedPath = path.join(
  root,
  'tests/.shop-billing-phase4b4d1-generated.cjs'
)
fs.mkdirSync(path.dirname(generatedPath), { recursive: true })
try {
  fs.writeFileSync(generatedPath, generated)
  const result = spawnSync(process.execPath, [generatedPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  assert.equal(
    result.status,
    0,
    result.error?.message || '4B-4D-1 database fixture failed'
  )
} finally {
  fs.rmSync(generatedPath, { force: true })
}
