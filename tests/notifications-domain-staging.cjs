// Reusable deployed/candidate rollback qualification with an exact staging guard.
const { spawnSync } = require('node:child_process')
const result = spawnSync(
  process.execPath,
  [
    'tests/backend-contract-staging.cjs',
    '202610130001_notifications_domain.sql',
    'notifications-domain-staging.sql',
  ],
  { stdio: 'inherit' }
)
process.exitCode = result.status === null ? 1 : result.status
