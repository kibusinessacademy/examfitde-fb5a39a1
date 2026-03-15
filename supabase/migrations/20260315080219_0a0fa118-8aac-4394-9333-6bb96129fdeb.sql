-- FIX 1: Add Anthropic cross-provider fallback to minicheck routing
-- Current: gpt-4o-mini(p1) → gpt-5-mini(p2) — ALL OpenAI = death spiral
-- Target:  gpt-4o-mini(p1) → claude-haiku-4-5(p2) → gpt-5-mini(p3) → gpt-5.2(p4)

-- Update existing gpt-5-mini from priority 2 → 3
UPDATE model_routing_rules
SET priority = 3, updated_at = now()
WHERE intent = 'minicheck' AND model = 'gpt-5-mini' AND provider = 'openai';

-- Insert Anthropic cross-provider escape at priority 2
INSERT INTO model_routing_rules (intent, provider, model, priority, is_fallback, enabled, ab_weight, notes)
VALUES ('minicheck', 'anthropic', 'claude-haiku-4-5-20251001', 2, true, true, 100, 'Cross-provider escape to prevent OpenAI death spiral')
ON CONFLICT DO NOTHING;

-- Insert GPT-5.2 strong fallback at priority 4
INSERT INTO model_routing_rules (intent, provider, model, priority, is_fallback, enabled, ab_weight, notes)
VALUES ('minicheck', 'openai', 'gpt-5.2', 4, true, true, 100, 'Final strong fallback')
ON CONFLICT DO NOTHING;

-- FIX 2: Unblock the stalled generate_lesson_minichecks step for package fd1d8192
UPDATE package_steps
SET status = 'queued',
    meta = jsonb_set(
      jsonb_set(
        jsonb_set(meta, '{stall_runs}', '0'),
        '{unblocked_reason}', '"routing_fix_cross_provider_escape"'
      ),
      '{unblocked_at}', to_jsonb(now()::text)
    )
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  AND step_key = 'generate_lesson_minichecks'
  AND status = 'blocked';

-- FIX 3: Cancel the stuck pending job and let pipeline re-dispatch
UPDATE job_queue 
SET status = 'cancelled',
    completed_at = now(),
    result = jsonb_build_object(
      'cancelled_reason', 'routing_fix_reset',
      'original_transient_attempts', (meta->>'transient_attempts')::int
    )
WHERE id = 'd11b4bcc-421c-4bdf-96da-dce0f621d971'
  AND status = 'pending';