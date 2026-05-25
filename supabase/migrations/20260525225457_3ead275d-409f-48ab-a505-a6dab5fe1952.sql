-- ============================================================================
-- BK-Act-2 Revenue UX Spine
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_workflow_time_saved_minutes(_category text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _category
    WHEN 'kommunikation' THEN 12
    WHEN 'analyse'       THEN 25
    WHEN 'dokumentation' THEN 18
    WHEN 'organisation'  THEN 8
    WHEN 'fach'          THEN 15
    WHEN 'lernhilfe'     THEN 10
    ELSE 10
  END
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_get_workflow_usage_summary(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_days integer := GREATEST(1, LEAST(COALESCE(p_days, 7), 30));
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_tier text;
  v_runs_today integer;
  v_runs_window integer;
  v_minutes_saved integer;
  v_distinct_workflows integer;
  v_heavy_today integer;
  v_top jsonb;
  v_per_day jsonb;
  v_categories jsonb;
  v_business_signal boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('error', 'auth_required');
  END IF;

  SELECT CASE
    WHEN bool_or(COALESCE(has_workflows_business, false)) THEN 'business'
    WHEN bool_or(COALESCE(has_workflows_pro, false))      THEN 'pro'
    ELSE 'free'
  END
  INTO v_tier FROM public.entitlements
  WHERE user_id = v_user AND (valid_until IS NULL OR valid_until > now());
  v_tier := COALESCE(v_tier, 'free');

  SELECT count(*) INTO v_runs_today FROM public.berufs_ki_workflow_runs
   WHERE user_id = v_user AND created_at >= v_today::timestamp;

  SELECT count(*) INTO v_runs_window FROM public.berufs_ki_workflow_runs
   WHERE user_id = v_user AND created_at >= (now() - make_interval(days => v_days));

  SELECT COALESCE(SUM(public.fn_workflow_time_saved_minutes(d.category::text)), 0)
  INTO v_minutes_saved
  FROM public.berufs_ki_workflow_runs r
  JOIN public.berufs_ki_workflow_definitions d ON d.id = r.workflow_id
  WHERE r.user_id = v_user
    AND r.created_at >= (now() - make_interval(days => v_days))
    AND r.status = 'ok';

  SELECT count(DISTINCT workflow_id) INTO v_distinct_workflows
  FROM public.berufs_ki_workflow_runs
  WHERE user_id = v_user AND created_at >= (now() - make_interval(days => v_days));

  SELECT count(*) INTO v_heavy_today FROM public.berufs_ki_workflow_runs
  WHERE user_id = v_user AND created_at >= v_today::timestamp
    AND (COALESCE(latency_ms, 0) > 8000 OR COALESCE(tokens_out, 0) > 1500);

  SELECT COALESCE(jsonb_agg(t ORDER BY t.runs DESC), '[]'::jsonb) INTO v_top
  FROM (
    SELECT d.slug, d.title, d.category::text AS category,
           d.tier_required::text AS tier_required,
           count(*)::int AS runs, max(r.created_at) AS last_at
    FROM public.berufs_ki_workflow_runs r
    JOIN public.berufs_ki_workflow_definitions d ON d.id = r.workflow_id
    WHERE r.user_id = v_user AND r.created_at >= (now() - make_interval(days => v_days))
    GROUP BY d.slug, d.title, d.category, d.tier_required
    ORDER BY runs DESC LIMIT 5
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'runs', runs) ORDER BY day), '[]'::jsonb)
  INTO v_per_day FROM (
    SELECT d::date AS day,
      COALESCE((SELECT count(*) FROM public.berufs_ki_workflow_runs
                WHERE user_id = v_user AND created_at::date = d::date), 0)::int AS runs
    FROM generate_series(v_today - (v_days - 1), v_today, '1 day'::interval) d
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'runs', runs) ORDER BY runs DESC), '[]'::jsonb)
  INTO v_categories FROM (
    SELECT d.category::text AS category, count(*)::int AS runs
    FROM public.berufs_ki_workflow_runs r
    JOIN public.berufs_ki_workflow_definitions d ON d.id = r.workflow_id
    WHERE r.user_id = v_user AND r.created_at >= (now() - make_interval(days => v_days))
    GROUP BY d.category
  ) c;

  v_business_signal := (v_runs_window >= 10) OR EXISTS (
    SELECT 1 FROM public.berufs_ki_workflow_runs r
    JOIN public.berufs_ki_workflow_definitions d ON d.id = r.workflow_id
    WHERE r.user_id = v_user
      AND r.created_at >= (now() - make_interval(days => v_days))
      AND d.tier_required = 'business'
  );

  RETURN jsonb_build_object(
    'tier', v_tier,
    'window_days', v_days,
    'runs_today', v_runs_today,
    'runs_window', v_runs_window,
    'minutes_saved_window', v_minutes_saved,
    'distinct_workflows', v_distinct_workflows,
    'heavy_runs_today', v_heavy_today,
    'top_workflows', v_top,
    'per_day', v_per_day,
    'categories', v_categories,
    'business_signal', v_business_signal,
    'capacity_hint', CASE
      WHEN v_tier = 'business' THEN 'unlimited'
      WHEN v_tier = 'pro' AND v_runs_today >= 35 THEN 'heavy_usage'
      WHEN v_tier = 'pro' THEN 'comfortable'
      WHEN v_tier = 'free' AND v_runs_today >= 2 THEN 'near_daily_limit'
      ELSE 'plenty'
    END,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_get_workflow_usage_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learner_get_workflow_usage_summary(integer) TO authenticated;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_get_workflow_upgrade_signal()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tier text := 'free';
  v_runs_7d integer := 0;
  v_runs_30d integer := 0;
  v_distinct_workflows_7d integer := 0;
  v_locked_attempts_30d integer := 0;
  v_business_locked_30d integer := 0;
  v_reasons text[] := ARRAY[]::text[];
  v_target text := NULL;
  v_recommendation text := 'stay_free';
  v_label text := NULL;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('recommendation', 'auth_required');
  END IF;

  SELECT CASE
    WHEN bool_or(COALESCE(has_workflows_business, false)) THEN 'business'
    WHEN bool_or(COALESCE(has_workflows_pro, false))      THEN 'pro'
    ELSE 'free'
  END
  INTO v_tier FROM public.entitlements
  WHERE user_id = v_user AND (valid_until IS NULL OR valid_until > now());
  v_tier := COALESCE(v_tier, 'free');

  SELECT count(*) INTO v_runs_7d FROM public.berufs_ki_workflow_runs
   WHERE user_id = v_user AND created_at >= now() - interval '7 days';
  SELECT count(*) INTO v_runs_30d FROM public.berufs_ki_workflow_runs
   WHERE user_id = v_user AND created_at >= now() - interval '30 days';
  SELECT count(DISTINCT workflow_id) INTO v_distinct_workflows_7d
   FROM public.berufs_ki_workflow_runs
   WHERE user_id = v_user AND created_at >= now() - interval '7 days';

  SELECT count(*) INTO v_locked_attempts_30d
  FROM public.auto_heal_log
  WHERE action_type = 'workflow_tier_blocked'
    AND created_at >= now() - interval '30 days'
    AND details->>'user_id' = v_user::text;

  SELECT count(*) INTO v_business_locked_30d
  FROM public.auto_heal_log
  WHERE action_type = 'workflow_tier_blocked'
    AND created_at >= now() - interval '30 days'
    AND details->>'user_id' = v_user::text
    AND details->>'tier_required' = 'business';

  IF v_tier = 'business' THEN
    v_recommendation := 'stay_current';
    v_label := 'Du nutzt bereits Business — voller Funktionsumfang.';
  ELSIF v_business_locked_30d >= 2 OR (v_runs_30d >= 40 AND v_distinct_workflows_7d >= 3) THEN
    v_recommendation := 'upgrade_business';
    v_target := 'business';
    v_label := 'Business lohnt sich wahrscheinlich für dein Team.';
    IF v_business_locked_30d >= 2 THEN
      v_reasons := v_reasons || 'Du wolltest in den letzten 30 Tagen mehrfach Team-Workflows nutzen.';
    END IF;
    IF v_runs_30d >= 40 THEN
      v_reasons := v_reasons || 'Hohe AI-Nutzung — Team-Skalierung ab Größe 5 typischerweise rentabel.';
    END IF;
    IF v_distinct_workflows_7d >= 3 THEN
      v_reasons := v_reasons || 'Du nutzt mehrere Workflow-Typen regelmäßig.';
    END IF;
  ELSIF v_tier = 'free' AND (v_locked_attempts_30d >= 1 OR v_runs_7d >= 5) THEN
    v_recommendation := 'upgrade_pro';
    v_target := 'pro';
    v_label := 'Pro entsperrt berufsspezifische Workflows mit Lernpaket-Bindung.';
    IF v_locked_attempts_30d >= 1 THEN
      v_reasons := v_reasons || 'Du hast bereits Pro-Workflows angefragt.';
    END IF;
    IF v_runs_7d >= 5 THEN
      v_reasons := v_reasons || 'Aktive Wochennutzung — Free-Limit wird häufig erreicht.';
    END IF;
  ELSE
    v_label := 'Free reicht aktuell — alles im grünen Bereich.';
  END IF;

  RETURN jsonb_build_object(
    'recommendation', v_recommendation,
    'tier_current', v_tier,
    'tier_target', v_target,
    'human_label', v_label,
    'reasons', to_jsonb(v_reasons),
    'runs_7d', v_runs_7d,
    'runs_30d', v_runs_30d,
    'distinct_workflows_7d', v_distinct_workflows_7d,
    'locked_attempts_30d', v_locked_attempts_30d,
    'business_locked_30d', v_business_locked_30d,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_get_workflow_upgrade_signal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learner_get_workflow_upgrade_signal() TO authenticated;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_get_locked_workflow_preview(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_wf record;
  v_tier text := 'free';
  v_outcome text;
  v_time_saved integer;
  v_use_case text;
  v_sample_sections text[];
BEGIN
  SELECT d.id, d.slug, d.title, d.description, d.category::text AS category,
         d.tier_required::text AS tier_required, d.target_roles, d.output_schema,
         d.curriculum_id, d.competency_id
    INTO v_wf
  FROM public.berufs_ki_workflow_definitions d
  WHERE d.slug = p_slug AND d.is_active = true;

  IF v_wf.id IS NULL THEN
    RETURN jsonb_build_object('error', 'workflow_not_found');
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT CASE
      WHEN bool_or(COALESCE(has_workflows_business, false)) THEN 'business'
      WHEN bool_or(COALESCE(has_workflows_pro, false))      THEN 'pro'
      ELSE 'free'
    END
    INTO v_tier FROM public.entitlements
    WHERE user_id = v_user AND (valid_until IS NULL OR valid_until > now());
    v_tier := COALESCE(v_tier, 'free');
  END IF;

  v_time_saved := public.fn_workflow_time_saved_minutes(v_wf.category);

  v_outcome := CASE v_wf.category
    WHEN 'kommunikation' THEN 'Schreibe professionelle, freundliche und rechtssichere Antworten — in unter zwei Minuten statt einer halben Stunde.'
    WHEN 'analyse'       THEN 'Erkenne Auffälligkeiten, KPIs und Risiken in deinen Daten — ohne Excel-Akrobatik.'
    WHEN 'dokumentation' THEN 'Strukturiere Protokolle und Berichte automatisch — bereit zum Versenden.'
    WHEN 'organisation'  THEN 'Plane Tage und Wochen mit klarer Priorisierung — keine vergessenen Tasks mehr.'
    WHEN 'fach'          THEN 'Simuliere realistische Fach- und Prüfungsgespräche — mit präzisem Feedback.'
    WHEN 'lernhilfe'     THEN 'Erkläre komplexe Themen auf deinem Niveau — verständlich und sofort einsetzbar.'
    ELSE 'Erreiche berufliche Ergebnisse schneller und strukturierter.'
  END;

  v_use_case := CASE v_wf.tier_required
    WHEN 'business' THEN 'Typischer Use Case: Ausbildungsleiter:innen, Teamleads, HR — wiederkehrende Reports und Übersichten ohne manuelle Recherche.'
    WHEN 'pro'      THEN 'Typischer Use Case: Auszubildende und Fachkräfte mit aktivem Lernpaket — berufsspezifische Workflows mit Curriculum-Bindung.'
    ELSE 'Kostenlos verfügbar.'
  END;

  v_sample_sections := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_wf.output_schema->'sections', '[]'::jsonb))),
    ARRAY[]::text[]
  );

  RETURN jsonb_build_object(
    'slug',                  v_wf.slug,
    'title',                 v_wf.title,
    'description',           v_wf.description,
    'category',              v_wf.category,
    'tier_required',         v_wf.tier_required,
    'tier_actual',           v_tier,
    'is_locked',             (v_wf.tier_required <> 'free' AND v_tier <> v_wf.tier_required AND v_tier <> 'business'),
    'outcome',               v_outcome,
    'use_case',              v_use_case,
    'estimated_time_saved_minutes', v_time_saved,
    'output_sample_sections', to_jsonb(v_sample_sections),
    'has_curriculum_binding', (v_wf.curriculum_id IS NOT NULL),
    'has_competency_binding', (v_wf.competency_id IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_get_locked_workflow_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learner_get_locked_workflow_preview(text) TO authenticated, anon;

-- ---------------------------------------------------------------------------
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'workflow_upgrade_signal_shown',
  ARRAY['recommendation', 'tier_current', 'tier_target', 'reason_count']::text[],
  'berufs-ki/revenue-ux'
)
ON CONFLICT (action_type) DO UPDATE SET
  required_keys = EXCLUDED.required_keys,
  owner_module  = EXCLUDED.owner_module,
  updated_at    = now();

COMMENT ON FUNCTION public.learner_get_workflow_usage_summary(integer) IS
  'BK-Act-2 Revenue UX: usage intelligence per learner.';
COMMENT ON FUNCTION public.learner_get_workflow_upgrade_signal() IS
  'BK-Act-2 Revenue UX: deterministic upgrade recommendation.';
COMMENT ON FUNCTION public.learner_get_locked_workflow_preview(text) IS
  'BK-Act-2 Revenue UX: outcome-selling preview for locked workflows.';
