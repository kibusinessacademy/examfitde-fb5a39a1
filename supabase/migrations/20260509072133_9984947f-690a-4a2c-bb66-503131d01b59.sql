-- =====================================================================
-- S6 Welle 1 — Foundation: Engagement / Readiness / Oral / B2B (retry)
-- =====================================================================

ALTER TABLE public.readiness_snapshots
  ADD COLUMN IF NOT EXISTS reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_action_key text,
  ADD COLUMN IF NOT EXISTS version text NOT NULL DEFAULT 'v2';

ALTER TABLE public.learner_profiles
  ADD COLUMN IF NOT EXISTS consistency_7d numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consistency_30d numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS morning_evening_pattern text,
  ADD COLUMN IF NOT EXISTS recovery_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exam_target_date date,
  ADD COLUMN IF NOT EXISTS exam_type text;

ALTER TABLE public.daily_challenges
  ADD COLUMN IF NOT EXISTS adaptive_strategy text,
  ADD COLUMN IF NOT EXISTS weakness_targets uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS expected_minutes int,
  ADD COLUMN IF NOT EXISTS completion_minutes int,
  ADD COLUMN IF NOT EXISTS streak_contribution boolean NOT NULL DEFAULT false;

ALTER TABLE public.oral_exam_sessions
  ADD COLUMN IF NOT EXISTS kommunikationssicherheit_score numeric,
  ADD COLUMN IF NOT EXISTS vollstaendigkeit_score numeric,
  ADD COLUMN IF NOT EXISTS next_training_recs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.user_badges
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS awarded_by text;

-- ---------- New tables -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.badge_definitions (
  badge_key text PRIMARY KEY,
  category text NOT NULL,
  level text NOT NULL CHECK (level IN ('bronze','silber','gold','pruefungsreif')),
  rule_key text NOT NULL,
  label text NOT NULL,
  description text,
  icon text,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_badge_definitions_active ON public.badge_definitions(active) WHERE active;
CREATE INDEX IF NOT EXISTS idx_badge_definitions_rule ON public.badge_definitions(rule_key);
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read badge definitions" ON public.badge_definitions;
CREATE POLICY "Authenticated can read badge definitions"
  ON public.badge_definitions FOR SELECT TO authenticated
  USING (active = true);
DROP POLICY IF EXISTS "Admins manage badge definitions" ON public.badge_definitions;
CREATE POLICY "Admins manage badge definitions"
  ON public.badge_definitions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.engagement_daily_state (
  user_id uuid NOT NULL,
  day date NOT NULL,
  daily_check_status text NOT NULL DEFAULT 'pending' CHECK (daily_check_status IN ('pending','in_progress','completed','skipped')),
  streak_active boolean NOT NULL DEFAULT false,
  consistency_7d numeric NOT NULL DEFAULT 0,
  tasks_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_engagement_daily_state_day ON public.engagement_daily_state(day DESC);
ALTER TABLE public.engagement_daily_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own engagement state" ON public.engagement_daily_state;
CREATE POLICY "Users see own engagement state"
  ON public.engagement_daily_state FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all engagement state" ON public.engagement_daily_state;
CREATE POLICY "Admins read all engagement state"
  ON public.engagement_daily_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.oral_session_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  competency_id uuid,
  curriculum_id uuid,
  weak_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  recurring_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  language_patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_sessions int NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oral_session_memory_user_comp
  ON public.oral_session_memory(
    user_id,
    COALESCE(competency_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(curriculum_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
ALTER TABLE public.oral_session_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own oral memory" ON public.oral_session_memory;
CREATE POLICY "Users see own oral memory"
  ON public.oral_session_memory FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all oral memory" ON public.oral_session_memory;
CREATE POLICY "Admins read all oral memory"
  ON public.oral_session_memory FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DO $$ BEGIN
  CREATE TYPE public.readiness_risk_type AS ENUM (
    'competency_critical','stagnation','decay','oral_unsicherheit','exam_proximity','consistency_drop'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.readiness_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid,
  risk_type public.readiness_risk_type NOT NULL,
  severity int NOT NULL CHECK (severity BETWEEN 1 AND 5),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_action_key text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_readiness_risk_user_created
  ON public.readiness_risk_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readiness_risk_unresolved
  ON public.readiness_risk_events(user_id, risk_type) WHERE resolved_at IS NULL;
ALTER TABLE public.readiness_risk_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own risk events" ON public.readiness_risk_events;
CREATE POLICY "Users see own risk events"
  ON public.readiness_risk_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all risk events" ON public.readiness_risk_events;
CREATE POLICY "Admins read all risk events"
  ON public.readiness_risk_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- updated_at triggers ----------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='update_updated_at_column' AND pronamespace='public'::regnamespace) THEN
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql AS $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END $f$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_badge_definitions_updated_at ON public.badge_definitions;
CREATE TRIGGER trg_badge_definitions_updated_at
  BEFORE UPDATE ON public.badge_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_oral_session_memory_updated_at ON public.oral_session_memory;
CREATE TRIGGER trg_oral_session_memory_updated_at
  BEFORE UPDATE ON public.oral_session_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- Smoke test -------------------------------------------------

DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing FROM (VALUES
    ('readiness_snapshots.reason_codes'),
    ('readiness_snapshots.next_action_key'),
    ('learner_profiles.consistency_7d'),
    ('learner_profiles.exam_target_date'),
    ('daily_challenges.adaptive_strategy'),
    ('oral_exam_sessions.kommunikationssicherheit_score'),
    ('user_badges.level')
  ) v(c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND (table_name||'.'||column_name) = v.c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'S6 W1 smoke failed — missing columns: %', v_missing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='badge_definitions') THEN
    RAISE EXCEPTION 'S6 W1 smoke failed — badge_definitions missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='engagement_daily_state') THEN
    RAISE EXCEPTION 'S6 W1 smoke failed — engagement_daily_state missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='oral_session_memory') THEN
    RAISE EXCEPTION 'S6 W1 smoke failed — oral_session_memory missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='readiness_risk_events') THEN
    RAISE EXCEPTION 'S6 W1 smoke failed — readiness_risk_events missing'; END IF;
END $$;

-- ---------- Audit (correct columns) ------------------------------------

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  's6_w1_foundation_migration',
  'system',
  'success',
  jsonb_build_object(
    'sprint', 'S6',
    'wave', 1,
    'altered_tables', ARRAY['readiness_snapshots','learner_profiles','daily_challenges','oral_exam_sessions','user_badges'],
    'new_tables', ARRAY['badge_definitions','engagement_daily_state','oral_session_memory','readiness_risk_events'],
    'new_enums', ARRAY['readiness_risk_type'],
    'rollback_hint', 'see migration footer'
  )
);