-- Staging deployment only, exact project checked by candidate administrator.
begin;
create extension if not exists pg_cron;
-- Privileged scheduler calls the same private idempotent entry point; client roles
-- have no EXECUTE. Jobs inspect V2 only and do not settle manual/legacy V1 samples.
select cron.schedule('marketplace-v2-transaction-due-work','* * * * *',
 'select marketplace_private.run_transaction_due_work();');
commit;
