do $$begin
perform pg_temp.bc_assert((select count(*)=1 from cron.job where jobname='marketplace-v2-transaction-due-work' and schedule='* * * * *' and active and command='select marketplace_private.run_transaction_due_work();'),'one minute exact due-work entry');
perform pg_temp.bc_assert(not has_function_privilege('authenticated','marketplace_private.run_transaction_due_work()','EXECUTE'),'no client scheduler privilege');
end;$$;
