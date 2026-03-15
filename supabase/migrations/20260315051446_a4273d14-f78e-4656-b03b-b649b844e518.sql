
-- Unblock 3 healable packages (Watchdog marked "ready-to-continue")
UPDATE public.course_packages
SET status = 'queued',
    blocked_reason = NULL,
    last_error = 'Unblocked: tier-gate deadlock fix, QG healed',
    updated_at = now()
WHERE id IN (
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',  -- Mechatroniker
  '59b6e214-e181-4c2b-986e-1ce544984d04',  -- Verkäufer
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'   -- Elektroniker
)
AND status = 'blocked';

-- Log the fix
INSERT INTO public.auto_heal_log (action_type, trigger_source, result_status, result_detail, metadata)
VALUES (
  'tier_gate_deadlock_fix',
  'manual_forensic',
  'ok',
  'Removed blocked from tier gate calculation. Unblocked 3 healable prio-1 packages. 307 queued packages were deadlocked.',
  '{"root_cause": "blocked prio-1 packages in tier gate prevented all 307 queued packages from being acquired", "fix": "excluded blocked from MIN(priority) calculation in acquire_next_package_lease_v2 and factory-orchestrator", "unblocked": ["Mechatroniker", "Verkäufer", "Elektroniker"]}'::jsonb
);
