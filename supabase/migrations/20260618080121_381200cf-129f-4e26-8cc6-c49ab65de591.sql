
ALTER TABLE public.storage_audit_runs DROP CONSTRAINT storage_audit_runs_run_kind_check;
ALTER TABLE public.storage_audit_runs ADD CONSTRAINT storage_audit_runs_run_kind_check
  CHECK (run_kind = ANY (ARRAY['inventory'::text, 'attack'::text, 'attack_phase2'::text]));
