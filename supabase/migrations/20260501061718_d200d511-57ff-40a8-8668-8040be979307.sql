
-- ═══════════════════════════════════════════════════════════════
-- Heal Apply + Permanent-Fix Backlog
-- ═══════════════════════════════════════════════════════════════

-- 1) Permanent-Fix-Backlog Tabelle
CREATE TABLE IF NOT EXISTS public.heal_permanent_fix_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid REFERENCES public.heal_pattern_recommendations(id) ON DELETE SET NULL,
  pattern_key text NOT NULL,
  cluster text NOT NULL,
  package_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','wontfix')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  assigned_to uuid,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid
);

CREATE INDEX IF NOT EXISTS idx_heal_pf_tasks_status ON public.heal_permanent_fix_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heal_pf_tasks_pattern ON public.heal_permanent_fix_tasks(pattern_key);

ALTER TABLE public.heal_permanent_fix_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_heal_pf_tasks" ON public.heal_permanent_fix_tasks;
CREATE POLICY "admin_all_heal_pf_tasks" ON public.heal_permanent_fix_tasks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.tg_heal_pf_tasks_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('done','wontfix') AND OLD.status NOT IN ('done','wontfix') THEN
    NEW.completed_at := now();
    NEW.completed_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_heal_pf_tasks_touch ON public.heal_permanent_fix_tasks;
CREATE TRIGGER trg_heal_pf_tasks_touch
  BEFORE UPDATE ON public.heal_permanent_fix_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_heal_pf_tasks_touch();

-- Erweitere status-CHECK auf heal_pattern_recommendations um 'applied'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'heal_pattern_recommendations_status_check'
  ) THEN
    ALTER TABLE public.heal_pattern_recommendations DROP CONSTRAINT heal_pattern_recommendations_status_check;
  END IF;
  ALTER TABLE public.heal_pattern_recommendations
    ADD CONSTRAINT heal_pattern_recommendations_status_check
    CHECK (status IN ('active','superseded','resolved','dismissed','applied'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- Erweitere ggf. spalten für Apply-Tracking
ALTER TABLE public.heal_pattern_recommendations
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_by uuid,
  ADD COLUMN IF NOT EXISTS apply_result jsonb;

-- ═══════════════════════════════════════════════════════════════
-- 2) RPC: admin_create_permanent_fix_task
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_create_permanent_fix_task(
  p_recommendation_id uuid,
  p_priority text DEFAULT 'medium'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_task_id uuid;
  v_existing uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT id, pattern_key, cluster, package_id, root_cause, permanent_fix_suggestion
  INTO v_rec
  FROM public.heal_pattern_recommendations
  WHERE id = p_recommendation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','recommendation_not_found');
  END IF;

  IF v_rec.permanent_fix_suggestion IS NULL OR length(trim(v_rec.permanent_fix_suggestion))=0 THEN
    RETURN jsonb_build_object('error','no_permanent_fix_text');
  END IF;

  -- Idempotent: existing open task for this recommendation? Return it.
  SELECT id INTO v_existing
  FROM public.heal_permanent_fix_tasks
  WHERE recommendation_id = p_recommendation_id
    AND status IN ('open','in_progress')
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'task_id', v_existing, 'reused', true);
  END IF;

  INSERT INTO public.heal_permanent_fix_tasks(
    recommendation_id, pattern_key, cluster, package_id,
    title, description, priority, status, created_by
  ) VALUES (
    p_recommendation_id, v_rec.pattern_key, v_rec.cluster, v_rec.package_id,
    'Permanent-Fix: ' || v_rec.cluster,
    v_rec.permanent_fix_suggestion,
    COALESCE(p_priority, 'medium'),
    'open',
    auth.uid()
  ) RETURNING id INTO v_task_id;

  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('permanent_fix_task_created', 'admin', COALESCE(v_rec.package_id::text, v_rec.pattern_key), 'permanent_fix',
    'success', 'task_id='||v_task_id,
    jsonb_build_object('task_id', v_task_id, 'recommendation_id', p_recommendation_id, 'cluster', v_rec.cluster));

  RETURN jsonb_build_object('ok', true, 'task_id', v_task_id, 'reused', false);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3) RPC: admin_update_permanent_fix_task
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_update_permanent_fix_task(
  p_task_id uuid,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.heal_permanent_fix_tasks
  SET
    status = COALESCE(p_status, status),
    priority = COALESCE(p_priority, priority),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','task_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 4) RPC: admin_list_permanent_fix_tasks (mit Filter)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_list_permanent_fix_tasks(
  p_status_filter text[] DEFAULT ARRAY['open','in_progress'],
  p_limit int DEFAULT 50
) RETURNS TABLE(
  id uuid,
  recommendation_id uuid,
  pattern_key text,
  cluster text,
  package_id uuid,
  package_title text,
  title text,
  description text,
  status text,
  priority text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  age_hours numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    t.id, t.recommendation_id, t.pattern_key, t.cluster, t.package_id,
    cp.canonical_title AS package_title,
    t.title, t.description, t.status, t.priority, t.notes,
    t.created_at, t.updated_at, t.completed_at,
    ROUND(EXTRACT(EPOCH FROM (now() - t.created_at))/3600.0, 1)::numeric AS age_hours
  FROM public.heal_permanent_fix_tasks t
  LEFT JOIN public.course_packages cp ON cp.id = t.package_id
  WHERE t.status = ANY(p_status_filter)
  ORDER BY
    CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    t.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 5) RPC: admin_heal_apply_recommendation — Heal-Plan ausführen
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_heal_apply_recommendation(
  p_recommendation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_step jsonb;
  v_action text;
  v_params jsonb;
  v_pkg_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_step_result jsonb;
  v_steps_executed int := 0;
  v_steps_failed int := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT id, pattern_key, cluster, package_id, heal_plan, status
  INTO v_rec
  FROM public.heal_pattern_recommendations
  WHERE id = p_recommendation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','recommendation_not_found');
  END IF;

  IF v_rec.status = 'applied' THEN
    RETURN jsonb_build_object('error','already_applied','recommendation_id', v_rec.id);
  END IF;

  v_pkg_id := v_rec.package_id;

  IF v_rec.heal_plan IS NULL OR jsonb_typeof(v_rec.heal_plan->'steps') <> 'array' THEN
    RETURN jsonb_build_object('error','no_heal_plan');
  END IF;

  -- Iteriere Steps
  FOR v_step IN SELECT * FROM jsonb_array_elements(v_rec.heal_plan->'steps')
  LOOP
    v_action := v_step->>'action';
    v_params := COALESCE(v_step->'params', '{}'::jsonb);
    v_step_result := jsonb_build_object('action', v_action);

    BEGIN
      IF v_action = 'soft_reentry' OR v_action = 'soft_heal' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
          v_step_result := v_step_result || jsonb_build_object('status','ok','detail','nudge_atomic_trigger');
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'hard_heal' OR v_action = 'reset_to_step' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          DECLARE
            v_step_key text := COALESCE(v_params->>'step_key', v_params->>'step', '');
          BEGIN
            IF v_step_key = '' THEN
              -- Fallback: nudge
              PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
              v_step_result := v_step_result || jsonb_build_object('status','ok','detail','nudge_atomic (no step_key)');
            ELSE
              PERFORM public.admin_retry_failed_step(v_pkg_id, v_step_key, COALESCE(v_step->>'why','heal_apply'));
              v_step_result := v_step_result || jsonb_build_object('status','ok','detail','retry_failed_step:'||v_step_key);
            END IF;
            v_steps_executed := v_steps_executed + 1;
          END;
        END IF;

      ELSIF v_action = 'mark_content_gap' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          PERFORM public.admin_mark_content_gap(v_pkg_id, COALESCE(v_step->>'why','heal_apply: content gap'));
          v_step_result := v_step_result || jsonb_build_object('status','ok','detail','mark_content_gap');
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'force_depublish_rebuild' THEN
        IF v_pkg_id IS NULL THEN
          v_step_result := v_step_result || jsonb_build_object('status','skipped','reason','no_package_id');
        ELSE
          -- Sanfter: published → draft + status=queued, dann nudge.
          UPDATE public.course_packages
            SET status = 'queued',
                published_at = NULL,
                updated_at = now()
          WHERE id = v_pkg_id;
          PERFORM public.admin_nudge_atomic_trigger(v_pkg_id, false);
          v_step_result := v_step_result || jsonb_build_object('status','ok','detail','depublish+rebuild');
          v_steps_executed := v_steps_executed + 1;
        END IF;

      ELSIF v_action = 'manual_review' THEN
        v_step_result := v_step_result || jsonb_build_object('status','noop','detail','manual_review_logged');

      ELSE
        v_step_result := v_step_result || jsonb_build_object('status','unknown_action');
      END IF;
    EXCEPTION WHEN others THEN
      v_step_result := v_step_result || jsonb_build_object('status','error','error', SQLERRM);
      v_steps_failed := v_steps_failed + 1;
    END;

    v_results := v_results || v_step_result;
  END LOOP;

  -- Markiere Empfehlung als applied
  UPDATE public.heal_pattern_recommendations
    SET status = 'applied',
        applied_at = now(),
        applied_by = v_uid,
        apply_result = jsonb_build_object('executed', v_steps_executed, 'failed', v_steps_failed, 'steps', v_results),
        updated_at = now()
  WHERE id = p_recommendation_id;

  -- Audit
  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_id, target_type, result_status, result_detail, metadata)
  VALUES (
    'heal_recommendation_applied',
    'admin',
    COALESCE(v_pkg_id::text, v_rec.pattern_key),
    CASE WHEN v_pkg_id IS NOT NULL THEN 'package' ELSE 'pattern' END,
    CASE WHEN v_steps_failed = 0 THEN 'success' ELSE 'partial' END,
    format('executed=%s failed=%s', v_steps_executed, v_steps_failed),
    jsonb_build_object(
      'recommendation_id', p_recommendation_id,
      'pattern_key', v_rec.pattern_key,
      'cluster', v_rec.cluster,
      'admin_uid', v_uid,
      'steps', v_results
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'executed', v_steps_executed,
    'failed', v_steps_failed,
    'steps', v_results
  );
END $$;
