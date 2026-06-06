ALTER TABLE public.p18_idempotency_ledger
  DROP CONSTRAINT IF EXISTS p18_ledger_drift_type_check;

ALTER TABLE public.p18_idempotency_ledger
  ADD CONSTRAINT p18_ledger_drift_type_check CHECK (drift_type IN (
    'ssot_conflict','healability_missing','cross_domain_unbridged',
    'orphan_node','rule_violation','reuse_recommendation','duplicate_registration',
    'ux_gap'
  ));