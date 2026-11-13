-- Historical scheduler migration retained for audit. Canonical empty-database
-- replays intentionally install no cron jobs: deployment configuration must
-- explicitly enable the idempotent due-work scheduler after its environment
-- authority and operational runbook have been verified.
begin;
-- Historical production command (not executed by a canonical replay):
-- select cron.schedule('marketplace-v2-transaction-due-work','* * * * *',
--  'select marketplace_private.run_transaction_due_work();');
commit;
