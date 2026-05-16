
-- Bridge 2 — Mastery → Exam Readiness v2 (P0) [fixed column name]

CREATE TABLE IF NOT EXISTS public.learner_readiness_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  readiness_score numeric NOT NULL,
  verdict text NOT NULL,
  coverage_pct numeric,
  confidence_pct numeric,
  stability_pct numeric,
  simulation_pct numeric,
  lf_gap_count integer NOT NULL DEFAULT 0,
  weak_competency_count integer NOT NULL DEFAULT 0,
  days_to_exam integer,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lrh_user_curr_time
  ON public.learner_readiness_history (user_id, curriculum_id, computed_at DESC);
ALTER TABLE public.learner_readiness_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own readiness history" ON public.learner_readiness_history;
CREATE POLICY "users read own readiness history"
  ON public.learner_readiness_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service role full" ON public.learner_readiness_history;
CREATE POLICY "service role full"
  ON public.learner_readiness_history FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_exam_readiness_v2 AS
WITH grants AS (
  SELECT DISTINCT user_id, curriculum_id FROM public.learner_course_grants
  WHERE status IN ('active','activated')
),
comp_total AS (
  SELECT lf.curriculum_id, COUNT(c.id)::int AS total_competencies
  FROM public.learning_fields lf
  JOIN public.competencies c ON c.learning_field_id = lf.id
  GROUP BY lf.curriculum_id
),
mastery AS (
  SELECT m.user_id, m.curriculum_id,
         COUNT(*)::int AS rated_count,
         AVG(m.mastery_score)::numeric AS avg_mastery,
         COUNT(*) FILTER (WHERE m.last_attempt_at > now() - interval '30 days')::int AS recent_count,
         COUNT(*) FILTER (WHERE m.mastery_score < 50)::int AS weak_count
  FROM public.user_competency_mastery m
  GROUP BY m.user_id, m.curriculum_id
),
lf_gaps AS (
  SELECT user_id, curriculum_id,
         COUNT(*) FILTER (WHERE lf_avg < 50)::int AS lf_gap_count
  FROM (
    SELECT m.user_id, m.curriculum_id, lf.id AS lf_id,
           AVG(COALESCE(m.mastery_score, 0))::numeric AS lf_avg
    FROM public.learning_fields lf
    JOIN public.competencies c ON c.learning_field_id = lf.id
    LEFT JOIN public.user_competency_mastery m
      ON m.competency_id = c.id AND m.curriculum_id = lf.curriculum_id
    WHERE m.user_id IS NOT NULL
    GROUP BY m.user_id, m.curriculum_id, lf.id
  ) x
  GROUP BY user_id, curriculum_id
),
sims AS (
  SELECT user_id, curriculum_id,
         AVG(CASE WHEN total_questions > 0 THEN (score::numeric/total_questions)*100.0 END)::numeric AS avg_sim_pct,
         COUNT(*)::int AS sim_count
  FROM (
    SELECT user_id, curriculum_id, score, total_questions,
           ROW_NUMBER() OVER (PARTITION BY user_id, curriculum_id ORDER BY completed_at DESC) AS rn
    FROM public.exam_attempts WHERE completed_at IS NOT NULL
  ) x WHERE rn <= 3
  GROUP BY user_id, curriculum_id
),
profile AS (
  SELECT user_id, exam_target_date AS exam_date FROM public.learner_profiles
),
base AS (
  SELECT g.user_id, g.curriculum_id,
    COALESCE(ct.total_competencies,0) AS total_competencies,
    COALESCE(m.rated_count,0) AS rated_count,
    COALESCE(m.avg_mastery,0) AS avg_mastery,
    COALESCE(m.recent_count,0) AS recent_count,
    COALESCE(m.weak_count,0) AS weak_count,
    COALESCE(lg.lf_gap_count,0) AS lf_gap_count,
    s.avg_sim_pct, COALESCE(s.sim_count,0) AS sim_count,
    p.exam_date
  FROM grants g
  LEFT JOIN comp_total ct ON ct.curriculum_id = g.curriculum_id
  LEFT JOIN mastery m ON m.user_id=g.user_id AND m.curriculum_id=g.curriculum_id
  LEFT JOIN lf_gaps lg ON lg.user_id=g.user_id AND lg.curriculum_id=g.curriculum_id
  LEFT JOIN sims s ON s.user_id=g.user_id AND s.curriculum_id=g.curriculum_id
  LEFT JOIN profile p ON p.user_id=g.user_id
),
scored AS (
  SELECT b.*,
    CASE WHEN total_competencies>0 THEN LEAST(1.0, rated_count::numeric/total_competencies) ELSE 0 END AS coverage,
    (avg_mastery/100.0) AS confidence,
    CASE WHEN rated_count>0 THEN GREATEST(0.5, LEAST(1.0, recent_count::numeric/rated_count)) ELSE 0.5 END AS stability,
    COALESCE(avg_sim_pct/100.0, 0.7) AS simulation
  FROM base b
)
SELECT user_id, curriculum_id, total_competencies, rated_count, weak_count, lf_gap_count, sim_count, avg_sim_pct, exam_date,
  CASE WHEN exam_date IS NOT NULL
       THEN GREATEST(0, EXTRACT(DAY FROM (exam_date::timestamptz - now()))::int) END AS days_to_exam,
  coverage, confidence, stability, simulation,
  ROUND((coverage * confidence * stability * simulation) * 100.0, 2) AS readiness_score,
  CASE
    WHEN rated_count=0 THEN 'NOT_STARTED'
    WHEN lf_gap_count>0 AND ROUND((coverage*confidence*stability*simulation)*100.0,2) >= 85 THEN 'PARTIAL'
    WHEN ROUND((coverage*confidence*stability*simulation)*100.0,2) >= 85 THEN 'READY'
    WHEN ROUND((coverage*confidence*stability*simulation)*100.0,2) >= 70 THEN 'PARTIAL'
    WHEN ROUND((coverage*confidence*stability*simulation)*100.0,2) >= 55 THEN 'AT_RISK'
    ELSE 'CRITICAL'
  END AS verdict
FROM scored;

REVOKE ALL ON public.v_exam_readiness_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_exam_readiness_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.fn_exam_readiness_v2(p_user_id uuid, p_curriculum_id uuid)
RETURNS public.learner_readiness_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.learner_readiness_history; r record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>p_user_id AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO r FROM public.v_exam_readiness_v2 WHERE user_id=p_user_id AND curriculum_id=p_curriculum_id;
  IF NOT FOUND THEN
    INSERT INTO public.learner_readiness_history(user_id,curriculum_id,readiness_score,verdict)
    VALUES (p_user_id,p_curriculum_id,0,'NOT_STARTED') RETURNING * INTO v_row; RETURN v_row;
  END IF;
  INSERT INTO public.learner_readiness_history(user_id,curriculum_id,readiness_score,verdict,
    coverage_pct,confidence_pct,stability_pct,simulation_pct,lf_gap_count,weak_competency_count,days_to_exam,components)
  VALUES (p_user_id,p_curriculum_id,r.readiness_score,r.verdict,
    ROUND(r.coverage*100,2),ROUND(r.confidence*100,2),ROUND(r.stability*100,2),ROUND(r.simulation*100,2),
    r.lf_gap_count,r.weak_count,r.days_to_exam,
    jsonb_build_object('total_competencies',r.total_competencies,'rated_count',r.rated_count,'sim_count',r.sim_count,'avg_sim_pct',r.avg_sim_pct))
  RETURNING * INTO v_row;
  RETURN v_row;
END;$$;
REVOKE ALL ON FUNCTION public.fn_exam_readiness_v2(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_exam_readiness_v2(uuid,uuid) TO authenticated, service_role;

INSERT INTO public.ops_job_type_registry (job_type,pool,lane,description,is_active,requires_package_id,is_governance,job_name)
VALUES
  ('learner_readiness_recompute','learner','learner_readiness','Recompute v2 readiness snapshot',true,false,false,'learner_readiness_recompute'),
  ('learner_intervention_dispatch','learner','learner_readiness','Dispatch rescue intervention for AT_RISK/CRITICAL',true,false,false,'learner_intervention_dispatch'),
  ('learner_next_best_step_generate','learner','learner_readiness','Generate next-best-step recommendation',true,false,false,'learner_next_best_step_generate')
ON CONFLICT (job_type) DO UPDATE SET is_active=true, lane=EXCLUDED.lane, description=EXCLUDED.description, updated_at=now();

CREATE OR REPLACE FUNCTION public.fn_enqueue_readiness_recompute(p_user_id uuid,p_curriculum_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.job_queue
             WHERE job_type='learner_readiness_recompute' AND status='pending'
               AND (payload->>'user_id')::uuid=p_user_id AND (payload->>'curriculum_id')::uuid=p_curriculum_id
               AND created_at > now() - interval '30 seconds') THEN
    RETURN;
  END IF;
  INSERT INTO public.job_queue (job_type,status,payload,run_after,idempotency_key,job_name,correlation_id)
  VALUES ('learner_readiness_recompute','pending',
    jsonb_build_object('user_id',p_user_id,'curriculum_id',p_curriculum_id,'reason',p_reason),
    now()+interval '30 seconds',
    'readiness_recompute|'||p_user_id::text||'|'||p_curriculum_id::text||'|'||extract(epoch from date_trunc('minute',now()))::text,
    'learner_readiness_recompute','readiness_'||p_user_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING;
END;$$;

CREATE OR REPLACE FUNCTION public.trg_mastery_enqueue_readiness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.fn_enqueue_readiness_recompute(NEW.user_id, NEW.curriculum_id, 'mastery_update'); RETURN NEW; END;$$;
DROP TRIGGER IF EXISTS trg_mastery_enqueue_readiness ON public.user_competency_mastery;
CREATE TRIGGER trg_mastery_enqueue_readiness AFTER INSERT OR UPDATE OF mastery_score, mastery_state
  ON public.user_competency_mastery FOR EACH ROW EXECUTE FUNCTION public.trg_mastery_enqueue_readiness();

CREATE OR REPLACE FUNCTION public.trg_exam_attempt_enqueue_readiness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.completed_at IS NULL) THEN
    PERFORM public.fn_enqueue_readiness_recompute(NEW.user_id, NEW.curriculum_id, 'exam_attempt_completed');
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS trg_exam_attempt_enqueue_readiness ON public.exam_attempts;
CREATE TRIGGER trg_exam_attempt_enqueue_readiness AFTER INSERT OR UPDATE OF completed_at
  ON public.exam_attempts FOR EACH ROW EXECUTE FUNCTION public.trg_exam_attempt_enqueue_readiness();

CREATE OR REPLACE FUNCTION public.fn_detect_readiness_sla_breach()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer:=0; r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (h.user_id, h.curriculum_id) h.user_id, h.curriculum_id, h.verdict, h.computed_at
    FROM public.learner_readiness_history h
    ORDER BY h.user_id, h.curriculum_id, h.computed_at DESC
  LOOP
    IF r.verdict IN ('AT_RISK','CRITICAL')
       AND r.computed_at < now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM public.job_queue
                       WHERE job_type='learner_intervention_dispatch'
                         AND (payload->>'user_id')::uuid=r.user_id
                         AND (payload->>'curriculum_id')::uuid=r.curriculum_id
                         AND created_at > now() - interval '24 hours') THEN
      INSERT INTO public.job_queue (job_type,status,payload,run_after,idempotency_key,job_name,correlation_id)
      VALUES ('learner_intervention_dispatch','pending',
        jsonb_build_object('user_id',r.user_id,'curriculum_id',r.curriculum_id,'verdict',r.verdict),
        now(),
        'intervention|'||r.user_id::text||'|'||r.curriculum_id::text||'|'||to_char(now(),'YYYY-MM-DD'),
        'learner_intervention_dispatch','readiness_'||r.user_id::text)
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('readiness_sla_check','system','ok', jsonb_build_object('interventions_enqueued',v_count));
  RETURN v_count;
END;$$;
REVOKE ALL ON FUNCTION public.fn_detect_readiness_sla_breach() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_readiness_sla_breach() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_readiness_distribution(p_curriculum_id uuid DEFAULT NULL)
RETURNS TABLE(curriculum_id uuid, ready_count integer, partial_count integer, at_risk_count integer,
              critical_count integer, not_started_count integer, total_learners integer, avg_score numeric)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (h.user_id, h.curriculum_id) h.*
    FROM public.learner_readiness_history h
    WHERE p_curriculum_id IS NULL OR h.curriculum_id=p_curriculum_id
    ORDER BY h.user_id, h.curriculum_id, h.computed_at DESC
  )
  SELECT l.curriculum_id,
    COUNT(*) FILTER (WHERE verdict='READY')::int,
    COUNT(*) FILTER (WHERE verdict='PARTIAL')::int,
    COUNT(*) FILTER (WHERE verdict='AT_RISK')::int,
    COUNT(*) FILTER (WHERE verdict='CRITICAL')::int,
    COUNT(*) FILTER (WHERE verdict='NOT_STARTED')::int,
    COUNT(*)::int,
    ROUND(AVG(readiness_score)::numeric, 2)
  FROM latest l
  WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='admin')
  GROUP BY l.curriculum_id;
$$;
REVOKE ALL ON FUNCTION public.admin_get_readiness_distribution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_readiness_distribution(uuid) TO authenticated, service_role;
