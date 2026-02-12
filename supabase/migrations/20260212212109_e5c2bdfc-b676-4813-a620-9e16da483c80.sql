
-- Step 1: Add columns
ALTER TABLE public.curricula ADD COLUMN IF NOT EXISTS seeding_version text DEFAULT NULL;
ALTER TABLE public.curricula ADD COLUMN IF NOT EXISTS seeding_completed_at timestamptz DEFAULT NULL;
ALTER TABLE public.auto_heal_policies ADD COLUMN IF NOT EXISTS required_seeding_version text DEFAULT 'bibb_2025-01';
ALTER TABLE public.auto_heal_policies ADD COLUMN IF NOT EXISTS seeding_circuit_breaker jsonb DEFAULT '{"max_attempts_per_day": 3, "cooldown_minutes": 60, "on_repeat_fail": "freeze_and_notify"}'::jsonb;
