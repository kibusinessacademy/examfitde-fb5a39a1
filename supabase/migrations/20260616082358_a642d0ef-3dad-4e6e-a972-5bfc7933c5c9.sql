
-- ============================================================
-- KIMI.INTELLIGENCE.2 — Outcome Feedback, Confidence Decay,
-- Predictive Triage, Proof Window, Council Pre-Brief
-- ============================================================

-- 1) Outcome Feedback Table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quality_intelligence_outcome_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.quality_intelligence_recommendations(id) ON DELETE CASCADE,
  job_id uuid NULL,
  action_kind text NOT NULL,
  package_id uuid NULL,
  curriculum_id uuid NULL,
  job_status text NULL,                 -- completed | failed | dead
  job_completed_at timestamptz NULL,
  coverage_before numeric NULL,
  coverage_after numeric NULL,
  approved_questions_before integer NULL,
  approved_questions_after integer NULL,
  publishable_before boolean NULL,
  publishable_after boolean NULL,
  published_before boolean NULL,
  published_after boolean NULL,
  effective_delta numeric NULL,         -- aggregated improvement score [-1..1]
  was_effective boolean NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.quality_intelligence_outcome_feedback TO authenticated;
GRANT ALL ON public.quality_intelligence_outcome_feedback TO service_role;
ALTER TABLE public.quality_intelligence_outcome_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read outcome feedback"
  ON public.quality_intelligence_outcome_feedback
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages outcome feedback"
  ON public.quality_intelligence_outcome_feedback
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_qil_outcome_feedback_rec ON public.quality_intelligence_outcome_feedback(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_qil_outcome_feedback_kind ON public.quality_intelligence_outcome_feedback(action_kind, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_qil_outcome_feedback_job ON public.quality_intelligence_outcome_feedback(job_id);

CREATE TRIGGER trg_qil_outcome_feedback_updated_at
  BEFORE UPDATE ON public.quality_intelligence_outcome_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Action-Kind Effectiveness aggregate (rolling) -------------------------
CREATE OR REPLACE VIEW public.v_qil_action_kind_effectiveness AS
SELECT
  action_kind,
  count(*)                                         AS total_measured,
  count(*) FILTER (WHERE was_effective IS TRUE)    AS effective_count,
  count(*) FILTER (WHERE was_effective IS FALSE)   AS ineffective_count,
  COALESCE(avg(effective_delta), 0)::numeric(6,3)  AS avg_delta,
  COALESCE(
    count(*) FILTER (WHERE was_effective IS TRUE)::numeric
    / NULLIF(count(*), 0), 0
  )::numeric(6,3)                                  AS effectiveness_rate,
  max(measured_at)                                 AS last_measured_at
FROM public.quality_intelligence_outcome_feedback
WHERE measured_at > now() - interval '30 days'
GROUP BY action_kind;

GRANT SELECT ON public.v_qil_action_kind_effectiveness TO authenticated, service_role;

-- 3) Confidence Decay RPC --------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_apply_confidence_decay()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin boolean := COALESCE(public.has_role(auth.uid(), 'admin'), false);
  v_updated int := 0;
  r record;
BEGIN
  IF NOT (v_is_admin OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- For each action_kind with measured effectiveness, recalc confidence on
  -- pending recommendations: low effectiveness rate -> decay confidence and
  -- demote risk_level so wave-1 auto-apply stops picking them up.
  FOR r IN
    SELECT action_kind, effectiveness_rate, avg_delta, total_measured
    FROM public.v_qil_action_kind_effectiveness
    WHERE total_measured >= 3
  LOOP
    -- Demotion logic:
    --   effectiveness_rate < 0.3  -> hard demote (confidence 0.4, risk locked)
    --   effectiveness_rate < 0.6  -> soft decay (confidence *= 0.8)
    --   otherwise                 -> reinforce (cap +0.05 up to 0.95)
    IF r.effectiveness_rate < 0.3 THEN
      UPDATE public.quality_intelligence_recommendations
         SET confidence = LEAST(confidence, 0.4),
             risk_level = 'locked',
             expected_mutation = 'manual_review_only',
             updated_at = now()
       WHERE action_kind = r.action_kind
         AND status IN ('pending','proposed','queued');
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    ELSIF r.effectiveness_rate < 0.6 THEN
      UPDATE public.quality_intelligence_recommendations
         SET confidence = GREATEST(0.3, ROUND((confidence * 0.8)::numeric, 2)),
             updated_at = now()
       WHERE action_kind = r.action_kind
         AND status IN ('pending','proposed','queued');
    ELSE
      UPDATE public.quality_intelligence_recommendations
         SET confidence = LEAST(0.95, ROUND((confidence + 0.05)::numeric, 2)),
             updated_at = now()
       WHERE action_kind = r.action_kind
         AND status IN ('pending','proposed','queued')
         AND confidence < 0.95;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'decayed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_confidence_decay() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_apply_confidence_decay() TO authenticated, service_role;

-- 4) Outcome Feedback Ingest RPC -------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ingest_qil_outcome_feedback()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin boolean := COALESCE(public.has_role(auth.uid(), 'admin'), false);
  v_inserted int := 0;
  r record;
  v_cov_after numeric;
  v_appr_after int;
  v_publishable_after boolean;
  v_published_after boolean;
  v_delta numeric;
  v_effective boolean;
BEGIN
  IF NOT (v_is_admin OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Walk every applied recommendation whose enqueued job has reached a
  -- terminal state but no feedback row exists yet.
  FOR r IN
    SELECT rec.id        AS rec_id,
           rec.action_kind,
           rec.enqueued_job_id,
           j.status      AS job_status,
           j.completed_at,
           j.package_id,
           (j.payload->>'curriculum_id')::uuid AS curriculum_id
      FROM public.quality_intelligence_recommendations rec
      JOIN public.job_queue j ON j.id = rec.enqueued_job_id
     WHERE rec.status IN ('applied','enqueued','completed')
       AND j.status IN ('completed','failed','dead')
       AND NOT EXISTS (
         SELECT 1 FROM public.quality_intelligence_outcome_feedback f
          WHERE f.recommendation_id = rec.id
       )
     LIMIT 500
  LOOP
    -- Approximate "after" metrics using current package state.
    SELECT
      COALESCE((cp.quality_score)::numeric, 0),
      COALESCE(cp.approved_question_count, 0),
      (cp.status IN ('publishable','published','approved')),
      (cp.status = 'published')
      INTO v_cov_after, v_appr_after, v_publishable_after, v_published_after
    FROM public.course_packages cp
    WHERE cp.id = r.package_id;

    v_delta := CASE
      WHEN v_publishable_after IS TRUE THEN 0.8
      WHEN r.job_status = 'completed' THEN 0.4
      WHEN r.job_status IN ('failed','dead') THEN -0.5
      ELSE 0
    END;
    v_effective := r.job_status = 'completed' AND COALESCE(v_appr_after, 0) > 0;

    INSERT INTO public.quality_intelligence_outcome_feedback (
      recommendation_id, job_id, action_kind, package_id, curriculum_id,
      job_status, job_completed_at,
      coverage_after, approved_questions_after,
      publishable_after, published_after,
      effective_delta, was_effective
    ) VALUES (
      r.rec_id, r.enqueued_job_id, r.action_kind, r.package_id, r.curriculum_id,
      r.job_status, r.completed_at,
      v_cov_after, v_appr_after,
      v_publishable_after, v_published_after,
      v_delta, v_effective
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ingest_qil_outcome_feedback() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_ingest_qil_outcome_feedback() TO authenticated, service_role;

-- 5) Predictive Triage RPC -------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_run_qil_predictive_triage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin boolean := COALESCE(public.has_role(auth.uid(), 'admin'), false);
  v_snapshot_id uuid;
  v_inserted int := 0;
  p record;
BEGIN
  IF NOT (v_is_admin OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO public.quality_intelligence_snapshots (id, source, summary, created_at)
  VALUES (gen_random_uuid(), 'predictive_triage', jsonb_build_object('window_days', 7), now())
  RETURNING id INTO v_snapshot_id;

  -- Identify packages at risk: building/in_progress with low approved_question_count
  -- and stalled progress in last 7 days.
  FOR p IN
    SELECT cp.id                AS package_id,
           cp.title,
           cp.status,
           COALESCE(cp.approved_question_count, 0) AS approved_q,
           cp.updated_at
      FROM public.course_packages cp
     WHERE cp.status IN ('building','in_progress','review','queued')
       AND COALESCE(cp.approved_question_count, 0) < 500
       AND cp.updated_at < now() - interval '5 days'
     LIMIT 200
  LOOP
    INSERT INTO public.quality_intelligence_recommendations (
      snapshot_id, module, priority, action_kind, title, rationale,
      proposed_payload, target_table, target_ids, status,
      confidence, risk_level, expected_mutation
    ) VALUES (
      v_snapshot_id,
      'predictive_triage',
      'P1',
      'expand_question_pool',
      'Preemptive expand: ' || COALESCE(p.title, p.package_id::text),
      format('Drop-off-Risiko 7d: %s approved, last update %s', p.approved_q, p.updated_at::date),
      jsonb_build_object('package_id', p.package_id, 'reason', 'predictive_triage_low_pool'),
      'course_packages',
      jsonb_build_array(p.package_id),
      'pending',
      0.85,
      'low',
      'repair_job_enqueue_only'
    )
    ON CONFLICT DO NOTHING;
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'snapshot_id', v_snapshot_id, 'inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_qil_predictive_triage() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_run_qil_predictive_triage() TO authenticated, service_role;

-- 6) Wave-1 Proof Window RPC ----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_run_wave1_proof_window()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin boolean := COALESCE(public.has_role(auth.uid(), 'admin'), false);
  v_summary jsonb;
BEGIN
  IF NOT (v_is_admin OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Pull current proof metrics
  SELECT to_jsonb(t) INTO v_summary
    FROM public.v_qil_repair_conversion_summary t
   LIMIT 1;

  -- Re-ingest outcome feedback so confidence-decay sees the latest signal
  PERFORM public.admin_ingest_qil_outcome_feedback();
  PERFORM public.admin_apply_confidence_decay();

  INSERT INTO public.admin_notifications (id, notification_type, severity, title, message, payload, created_at, updated_at)
  VALUES (
    gen_random_uuid(),
    'kimi_wave1_proof_window',
    CASE
      WHEN COALESCE((v_summary->>'jobs_completed')::int, 0) > 0
       AND COALESCE((v_summary->>'publishable_delta')::int, 0) >= 1 THEN 'info'
      ELSE 'warning'
    END,
    'KIMI Wave-1 Proof Window Result',
    'jobs_completed=' || COALESCE(v_summary->>'jobs_completed','0')
      || ' publishable_delta=' || COALESCE(v_summary->>'publishable_delta','0'),
    v_summary,
    now(), now()
  );

  RETURN jsonb_build_object('ok', true, 'summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_wave1_proof_window() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_run_wave1_proof_window() TO authenticated, service_role;

-- 7) Council Pre-Brief RPC -------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_council_prebrief(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin boolean := COALESCE(public.has_role(auth.uid(), 'admin'), false);
  v_similar_rejected int := 0;
  v_recent_failures int := 0;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  IF NOT (v_is_admin OR v_caller_role = 'service_role') THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Count similar coverage-fix recommendations that were rejected
  SELECT count(*) INTO v_similar_rejected
    FROM public.quality_intelligence_recommendations r
   WHERE r.action_kind IN ('enqueue_coverage_repair','expand_question_pool')
     AND r.status IN ('rejected','dismissed')
     AND r.created_at > now() - interval '30 days';

  -- Count outcome feedback failures for coverage actions
  SELECT count(*) INTO v_recent_failures
    FROM public.quality_intelligence_outcome_feedback f
   WHERE f.action_kind IN ('enqueue_coverage_repair','expand_question_pool')
     AND f.was_effective IS FALSE
     AND f.measured_at > now() - interval '14 days';

  IF v_similar_rejected > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'level','warning',
      'code','similar_coverage_pattern_rejected',
      'message', format('%s ähnliche Coverage-Repair-Empfehlungen wurden in 30d abgelehnt.', v_similar_rejected)
    ));
  END IF;

  IF v_recent_failures > 2 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'level','warning',
      'code','coverage_repair_low_effectiveness',
      'message', format('%s wirkungslose Coverage-Repairs in 14d (was_effective=false).', v_recent_failures)
    ));
  END IF;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'similar_rejected_30d', v_similar_rejected,
    'ineffective_repairs_14d', v_recent_failures,
    'warnings', v_warnings,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_council_prebrief(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_council_prebrief(uuid) TO authenticated, service_role;
