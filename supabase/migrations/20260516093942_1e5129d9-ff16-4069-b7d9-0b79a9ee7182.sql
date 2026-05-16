
-- ============================================================
-- Bridge 10 — B2B Ausbildungsleiter Intelligence
-- ============================================================

-- ---------- TABLES ----------

CREATE TABLE IF NOT EXISTS public.organization_risk_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  curriculum_id uuid NULL,
  alert_type text NOT NULL CHECK (alert_type IN (
    'cohort_at_risk','inactive_learners','failure_pattern',
    'low_readiness','exam_window_critical','intervention_ineffective'
  )),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  title text NOT NULL,
  detail text NOT NULL,
  learners_affected int NOT NULL DEFAULT 0,
  recommended_action text NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_risk_alerts_org_status
  ON public.organization_risk_alerts(organization_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_org_risk_alerts_created
  ON public.organization_risk_alerts(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_risk_alerts_open
  ON public.organization_risk_alerts(organization_id, COALESCE(curriculum_id,'00000000-0000-0000-0000-000000000000'::uuid), alert_type)
  WHERE status = 'open';

ALTER TABLE public.organization_risk_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read org_risk_alerts" ON public.organization_risk_alerts;
CREATE POLICY "admin read org_risk_alerts" ON public.organization_risk_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service_role write org_risk_alerts" ON public.organization_risk_alerts;
CREATE POLICY "service_role write org_risk_alerts" ON public.organization_risk_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.trainer_action_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  curriculum_id uuid NULL,
  trainer_user_id uuid NULL,
  alert_id uuid NULL REFERENCES public.organization_risk_alerts(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN (
    'contact_learner','schedule_review','assign_rescue_track',
    'escalate_to_manager','order_exam_simulation','adjust_curriculum_pace',
    'celebrate_progress','custom'
  )),
  priority int NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  title text NOT NULL,
  detail text NOT NULL,
  target_learner_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  completed_at timestamptz NULL,
  completed_by uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trainer_actions_org_status
  ON public.trainer_action_recommendations(organization_id, status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_actions_trainer
  ON public.trainer_action_recommendations(trainer_user_id, status);

ALTER TABLE public.trainer_action_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read trainer_actions" ON public.trainer_action_recommendations;
CREATE POLICY "admin read trainer_actions" ON public.trainer_action_recommendations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "service_role write trainer_actions" ON public.trainer_action_recommendations;
CREATE POLICY "service_role write trainer_actions" ON public.trainer_action_recommendations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------- VIEWS ----------

CREATE OR REPLACE VIEW public.v_org_exam_readiness_dashboard AS
SELECT
  olh.organization_id,
  olh.curriculum_id,
  olh.snapshot_date,
  olh.total_learners,
  olh.active_learners,
  olh.avg_readiness,
  olh.pct_at_risk,
  olh.pct_ready,
  olh.pass_rate,
  olh.intervention_effectiveness_avg_pp,
  olh.quality_score,
  (SELECT COUNT(*) FROM public.organization_risk_alerts ra
     WHERE ra.organization_id = olh.organization_id
       AND COALESCE(ra.curriculum_id, olh.curriculum_id) IS NOT DISTINCT FROM olh.curriculum_id
       AND ra.status = 'open')::int AS open_alerts,
  (SELECT COUNT(*) FROM public.trainer_action_recommendations ta
     WHERE ta.organization_id = olh.organization_id
       AND COALESCE(ta.curriculum_id, olh.curriculum_id) IS NOT DISTINCT FROM olh.curriculum_id
       AND ta.status = 'open')::int AS open_actions
FROM public.organization_learning_health olh
WHERE olh.snapshot_date >= current_date - interval '90 days';

REVOKE ALL ON public.v_org_exam_readiness_dashboard FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_org_exam_readiness_dashboard TO service_role;

CREATE OR REPLACE VIEW public.v_trainer_next_best_actions AS
SELECT
  ta.id,
  ta.organization_id,
  ta.curriculum_id,
  ta.trainer_user_id,
  ta.alert_id,
  ta.action_type,
  ta.priority,
  ta.title,
  ta.detail,
  ta.target_learner_ids,
  ta.status,
  ta.created_at,
  ra.severity AS alert_severity,
  ra.alert_type AS alert_type
FROM public.trainer_action_recommendations ta
LEFT JOIN public.organization_risk_alerts ra ON ra.id = ta.alert_id
WHERE ta.status = 'open';

REVOKE ALL ON public.v_trainer_next_best_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_trainer_next_best_actions TO service_role;

-- ---------- ADMIN RPCs ----------

CREATE OR REPLACE FUNCTION public.admin_get_org_exam_readiness_dashboard(p_limit int DEFAULT 100)
RETURNS TABLE(
  organization_id uuid, curriculum_id uuid, snapshot_date date,
  total_learners int, active_learners int, avg_readiness numeric,
  pct_at_risk numeric, pct_ready numeric, pass_rate numeric,
  intervention_effectiveness_avg_pp numeric, quality_score numeric,
  open_alerts int, open_actions int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT v.organization_id, v.curriculum_id, v.snapshot_date,
           v.total_learners, v.active_learners, v.avg_readiness,
           v.pct_at_risk, v.pct_ready, v.pass_rate,
           v.intervention_effectiveness_avg_pp, v.quality_score,
           v.open_alerts, v.open_actions
    FROM public.v_org_exam_readiness_dashboard v
    ORDER BY v.snapshot_date DESC, v.open_alerts DESC, v.quality_score ASC NULLS LAST
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_org_risk_alerts(p_limit int DEFAULT 100, p_status text DEFAULT 'open')
RETURNS TABLE(
  id uuid, organization_id uuid, curriculum_id uuid,
  alert_type text, severity text, title text, detail text,
  learners_affected int, recommended_action text,
  status text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT a.id, a.organization_id, a.curriculum_id,
           a.alert_type, a.severity, a.title, a.detail,
           a.learners_affected, a.recommended_action,
           a.status, a.created_at
    FROM public.organization_risk_alerts a
    WHERE (p_status IS NULL OR a.status = p_status)
    ORDER BY CASE a.severity
               WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
               WHEN 'MEDIUM' THEN 2 ELSE 3 END,
             a.created_at DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_trainer_next_best_actions(p_limit int DEFAULT 100)
RETURNS TABLE(
  id uuid, organization_id uuid, curriculum_id uuid, trainer_user_id uuid,
  alert_id uuid, action_type text, priority int, title text, detail text,
  target_learner_ids uuid[], status text, created_at timestamptz,
  alert_severity text, alert_type text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  RETURN QUERY
    SELECT v.id, v.organization_id, v.curriculum_id, v.trainer_user_id,
           v.alert_id, v.action_type, v.priority, v.title, v.detail,
           v.target_learner_ids, v.status, v.created_at,
           v.alert_severity, v.alert_type
    FROM public.v_trainer_next_best_actions v
    ORDER BY v.priority DESC, v.created_at DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END $$;

CREATE OR REPLACE FUNCTION public.admin_dismiss_trainer_action(p_action_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  UPDATE public.trainer_action_recommendations
     SET status='dismissed', updated_at=now(),
         metadata = metadata || jsonb_build_object('dismiss_reason', p_reason, 'dismissed_by', v_uid)
   WHERE id = p_action_id AND status='open';
  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, actor_uid, details)
  VALUES ('trainer_action_dismissed','trainer_action', p_action_id::text, 'ok', v_uid,
          jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_complete_trainer_action(p_action_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'admin role required'; END IF;
  UPDATE public.trainer_action_recommendations
     SET status='done', completed_at=now(), completed_by=v_uid, updated_at=now(),
         metadata = metadata || jsonb_build_object('completion_note', p_note)
   WHERE id = p_action_id AND status='open';
  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, actor_uid, details)
  VALUES ('trainer_action_completed','trainer_action', p_action_id::text, 'ok', v_uid,
          jsonb_build_object('note', p_note));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- GENERATOR ----------

CREATE OR REPLACE FUNCTION public.fn_generate_trainer_risk_alerts()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_alerts_inserted int := 0;
  v_actions_inserted int := 0;
  r RECORD;
  v_alert_id uuid;
BEGIN
  -- Source 1: organization_learning_health (latest snapshot per org × curr)
  FOR r IN
    SELECT DISTINCT ON (organization_id, COALESCE(curriculum_id,'00000000-0000-0000-0000-000000000000'::uuid))
      organization_id, curriculum_id, total_learners, active_learners,
      avg_readiness, pct_at_risk, pct_ready, pass_rate, quality_score, snapshot_date
    FROM public.organization_learning_health
    WHERE snapshot_date >= current_date - interval '14 days'
    ORDER BY organization_id, COALESCE(curriculum_id,'00000000-0000-0000-0000-000000000000'::uuid), snapshot_date DESC
  LOOP
    IF COALESCE(r.pct_at_risk,0) >= 30 THEN
      INSERT INTO public.organization_risk_alerts
        (organization_id, curriculum_id, alert_type, severity, title, detail,
         learners_affected, recommended_action, metrics)
      VALUES
        (r.organization_id, r.curriculum_id, 'cohort_at_risk',
         CASE WHEN r.pct_at_risk >= 60 THEN 'CRITICAL'
              WHEN r.pct_at_risk >= 45 THEN 'HIGH'
              ELSE 'MEDIUM' END,
         'Kohorte ' || ROUND(r.pct_at_risk,0) || '% gefährdet',
         'Anteil Lernender mit verdict at_risk/critical liegt über Schwelle (30%).',
         COALESCE(ROUND(r.total_learners * r.pct_at_risk / 100.0),0)::int,
         'Rescue-Track aktivieren · betroffene Lernende kontaktieren',
         jsonb_build_object('pct_at_risk', r.pct_at_risk, 'avg_readiness', r.avg_readiness, 'snapshot_date', r.snapshot_date))
      ON CONFLICT (organization_id, COALESCE(curriculum_id,'00000000-0000-0000-0000-000000000000'::uuid), alert_type)
        WHERE status='open'
      DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        learners_affected = EXCLUDED.learners_affected,
        recommended_action = EXCLUDED.recommended_action,
        metrics = EXCLUDED.metrics,
        updated_at = now()
      RETURNING id INTO v_alert_id;

      IF v_alert_id IS NOT NULL THEN
        v_alerts_inserted := v_alerts_inserted + 1;
        INSERT INTO public.trainer_action_recommendations
          (organization_id, curriculum_id, alert_id, action_type, priority, title, detail)
        VALUES
          (r.organization_id, r.curriculum_id, v_alert_id, 'assign_rescue_track',
           CASE WHEN r.pct_at_risk >= 60 THEN 95
                WHEN r.pct_at_risk >= 45 THEN 80 ELSE 65 END,
           'Rescue-Track zuweisen',
           'Empfohlen für ' || COALESCE(ROUND(r.total_learners * r.pct_at_risk / 100.0),0)::text ||
           ' gefährdete Lernende.');
        v_actions_inserted := v_actions_inserted + 1;
      END IF;
    END IF;

    IF COALESCE(r.avg_readiness,100) < 50 AND COALESCE(r.total_learners,0) >= 3 THEN
      INSERT INTO public.organization_risk_alerts
        (organization_id, curriculum_id, alert_type, severity, title, detail,
         learners_affected, recommended_action, metrics)
      VALUES
        (r.organization_id, r.curriculum_id, 'low_readiness',
         CASE WHEN r.avg_readiness < 30 THEN 'CRITICAL'
              WHEN r.avg_readiness < 40 THEN 'HIGH' ELSE 'MEDIUM' END,
         'Ø Readiness ' || ROUND(r.avg_readiness,0) || ' — unter Bestehensschwelle',
         'Durchschnittliche Prüfungsreife liegt deutlich unter 60. Maßnahmen notwendig.',
         r.total_learners,
         'Curriculum-Pace anpassen · Übungsblock einplanen',
         jsonb_build_object('avg_readiness', r.avg_readiness, 'snapshot_date', r.snapshot_date))
      ON CONFLICT (organization_id, COALESCE(curriculum_id,'00000000-0000-0000-0000-000000000000'::uuid), alert_type)
        WHERE status='open'
      DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        learners_affected = EXCLUDED.learners_affected,
        recommended_action = EXCLUDED.recommended_action,
        metrics = EXCLUDED.metrics,
        updated_at = now()
      RETURNING id INTO v_alert_id;

      IF v_alert_id IS NOT NULL THEN
        v_alerts_inserted := v_alerts_inserted + 1;
        INSERT INTO public.trainer_action_recommendations
          (organization_id, curriculum_id, alert_id, action_type, priority, title, detail)
        VALUES
          (r.organization_id, r.curriculum_id, v_alert_id, 'adjust_curriculum_pace',
           CASE WHEN r.avg_readiness < 30 THEN 90 ELSE 70 END,
           'Curriculum-Pace anpassen',
           'Ø Readiness ' || ROUND(r.avg_readiness,1) || ' — Übungsphase intensivieren.');
        v_actions_inserted := v_actions_inserted + 1;
      END IF;
    END IF;

    IF COALESCE(r.active_learners,0) * 2 < COALESCE(r.total_learners,0)
       AND COALESCE(r.total_learners,0) >= 4 THEN
      INSERT INTO public.organization_risk_alerts
        (organization_id, curriculum_id, alert_type, severity, title, detail,
         learners_affected, recommended_action, metrics)
      VALUES
        (r.organization_id, r.curriculum_id, 'inactive_learners',
         'MEDIUM',
         'Aktivität niedrig: ' || r.active_learners || '/' || r.total_learners,
         'Weniger als die Hälfte der Kohorte aktiv. Engagement-Maßnahme empfohlen.',
         (r.total_learners - r.active_learners),
         'Inaktive Lernende kontaktieren · Erinnerungs-Sequenz starten',
         jsonb_build_object('active_learners', r.active_learners, 'total_learners', r.total_learners))
      ON CONFLICT (organization_id, COALESCE(curriculum_id,'00000000-0000-0000-0000-000000000000'::uuid), alert_type)
        WHERE status='open'
      DO UPDATE SET
        title = EXCLUDED.title, detail = EXCLUDED.detail,
        learners_affected = EXCLUDED.learners_affected,
        metrics = EXCLUDED.metrics, updated_at = now()
      RETURNING id INTO v_alert_id;

      IF v_alert_id IS NOT NULL THEN
        v_alerts_inserted := v_alerts_inserted + 1;
        INSERT INTO public.trainer_action_recommendations
          (organization_id, curriculum_id, alert_id, action_type, priority, title, detail)
        VALUES
          (r.organization_id, r.curriculum_id, v_alert_id, 'contact_learner', 60,
           'Inaktive Lernende kontaktieren',
           (r.total_learners - r.active_learners) || ' Lernende ohne aktuelle Aktivität.');
        v_actions_inserted := v_actions_inserted + 1;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, details)
  VALUES ('trainer_risk_alerts_generated','system','ok',
          jsonb_build_object('alerts_upserted', v_alerts_inserted, 'actions_inserted', v_actions_inserted));

  RETURN jsonb_build_object('alerts_upserted', v_alerts_inserted, 'actions_inserted', v_actions_inserted);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, details)
  VALUES ('trainer_risk_alerts_generated','system','error', jsonb_build_object('error', SQLERRM));
  RAISE;
END $$;

REVOKE ALL ON FUNCTION public.fn_generate_trainer_risk_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_generate_trainer_risk_alerts() TO service_role;
