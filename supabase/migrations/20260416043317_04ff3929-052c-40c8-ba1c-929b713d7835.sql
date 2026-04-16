
UPDATE package_steps
SET meta = meta - 'stall_reason_code' - 'terminal_escalation' - 'hard_fail_reason',
    updated_at = now()
WHERE meta->>'stall_reason_code' ILIKE '%HARD_FAIL%'
   OR (meta->>'terminal_escalation')::boolean = true;
