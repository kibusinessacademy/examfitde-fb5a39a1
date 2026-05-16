
-- ════════════════════════════════════════════════════════════════
-- Bridge 3: Support → Product Repair (v1)
-- ════════════════════════════════════════════════════════════════

-- 1. SSOT TABLE
CREATE TABLE IF NOT EXISTS public.content_feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','support_ticket','tutor_thumb_down','exam_question_report','auto_quality_gate','learner_in_app')),
  ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('exam_question','lesson','minicheck','handbook_section','tutor_response','h5p_asset','oral_exam','package')),
  entity_id UUID,
  package_id UUID REFERENCES public.course_packages(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  reason_code TEXT NOT NULL DEFAULT 'unspecified',
  reporter_user_id UUID,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','triaged','repair_enqueued','resolved','rejected','duplicate')),
  repair_job_id UUID,
  repair_job_type TEXT,
  resolution_action TEXT,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfe_status_severity ON public.content_feedback_events(status, severity);
CREATE INDEX IF NOT EXISTS idx_cfe_entity ON public.content_feedback_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cfe_package ON public.content_feedback_events(package_id);
CREATE INDEX IF NOT EXISTS idx_cfe_ticket ON public.content_feedback_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_cfe_created ON public.content_feedback_events(created_at DESC);

ALTER TABLE public.content_feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage content feedback"
  ON public.content_feedback_events FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Auth users insert own reports"
  ON public.content_feedback_events FOR INSERT
  TO authenticated
  WITH CHECK (reporter_user_id = auth.uid());

CREATE POLICY "Auth users see own reports"
  ON public.content_feedback_events FOR SELECT
  TO authenticated
  USING (reporter_user_id = auth.uid());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_cfe_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_cfe_touch
  BEFORE UPDATE ON public.content_feedback_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_cfe_touch_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 2. Resolve package_id helper
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_cfe_resolve_package_id(
  _entity_type TEXT, _entity_id UUID
) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pkg UUID;
BEGIN
  IF _entity_id IS NULL THEN RETURN NULL; END IF;

  IF _entity_type = 'package' THEN
    RETURN _entity_id;
  ELSIF _entity_type = 'exam_question' THEN
    SELECT package_id INTO v_pkg FROM exam_questions WHERE id = _entity_id LIMIT 1;
  ELSIF _entity_type IN ('lesson','minicheck') THEN
    SELECT cp.id INTO v_pkg
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN course_packages cp ON cp.curriculum_id = c.curriculum_id
    WHERE l.id = _entity_id
    LIMIT 1;
  END IF;

  RETURN v_pkg;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 3. Register new job type
-- ════════════════════════════════════════════════════════════════
INSERT INTO public.ops_job_type_registry (job_type, lane, requires_package_id, is_governance, description)
VALUES ('package_repair_content_feedback', 'repair', true, false, 'Bridge 3: Content-Repair aus aggregierten Feedback-Events')
ON CONFLICT (job_type) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 4. Auto-route trigger: feedback → repair job
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_feedback_event_auto_route()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job_type TEXT;
  v_pkg UUID;
  v_job_id UUID;
BEGIN
  -- resolve package_id if missing
  IF NEW.package_id IS NULL THEN
    NEW.package_id := fn_cfe_resolve_package_id(NEW.entity_type, NEW.entity_id);
  END IF;

  -- only auto-route high/critical
  IF NEW.severity NOT IN ('high','critical') THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  v_job_type := CASE NEW.entity_type
    WHEN 'exam_question' THEN 'package_repair_exam_pool_quality'
    WHEN 'minicheck' THEN 'package_repair_lesson_minichecks'
    WHEN 'lesson' THEN 'repair_learning_content'
    WHEN 'handbook_section' THEN 'handbook_expand_section'
    WHEN 'h5p_asset' THEN 'tutor_backfill_assets_for_course'
    WHEN 'tutor_response' THEN 'package_build_ai_tutor_index'
    WHEN 'oral_exam' THEN 'tutor_oral_exam_propose'
    WHEN 'package' THEN 'package_repair_content_feedback'
    ELSE NULL
  END;

  IF v_job_type IS NULL OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- enqueue (rely on existing guards: bronze-lock, fanout-cap, etc.)
  INSERT INTO public.job_queue (
    job_type, status, payload, package_id, priority,
    job_name, correlation_id, idempotency_key, metadata
  )
  VALUES (
    v_job_type, 'pending',
    jsonb_build_object(
      'package_id', NEW.package_id,
      'feedback_event_id', NEW.id,
      'entity_type', NEW.entity_type,
      'entity_id', NEW.entity_id,
      'reason_code', NEW.reason_code,
      'severity', NEW.severity,
      'origin', 'content_feedback_auto_route'
    ),
    NEW.package_id, 5,
    'cfe_repair|' || NEW.entity_type || '|' || COALESCE(NEW.entity_id::text, NEW.package_id::text),
    NEW.id,
    'cfe|' || NEW.id::text,
    jsonb_build_object('source','content_feedback_events','severity',NEW.severity)
  )
  RETURNING id INTO v_job_id;

  NEW.status := 'repair_enqueued';
  NEW.repair_job_id := v_job_id;
  NEW.repair_job_type := v_job_type;

  -- audit
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, details)
  VALUES (
    'content_feedback_auto_routed', 'package', NEW.package_id, 'enqueued',
    jsonb_build_object(
      'feedback_event_id', NEW.id,
      'entity_type', NEW.entity_type,
      'job_type', v_job_type,
      'job_id', v_job_id,
      'severity', NEW.severity,
      'reason_code', NEW.reason_code
    )
  );

  RETURN NEW;
END $$;

CREATE TRIGGER trg_cfe_auto_route
  BEFORE INSERT ON public.content_feedback_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_feedback_event_auto_route();

-- ════════════════════════════════════════════════════════════════
-- 5. Support-Ticket bridge: content-error tickets → feedback event
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_support_ticket_to_feedback_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity_type TEXT;
  v_entity_id UUID;
  v_severity TEXT;
BEGIN
  IF NEW.category <> 'content' AND NEW.ticket_type <> 'content_error' THEN
    RETURN NEW;
  END IF;

  -- pick best entity ref
  IF NEW.context_lesson_id IS NOT NULL THEN
    v_entity_type := 'lesson'; v_entity_id := NEW.context_lesson_id;
  ELSIF NEW.context_course_id IS NOT NULL THEN
    v_entity_type := 'package'; v_entity_id := NULL;
  ELSE
    RETURN NEW;
  END IF;

  v_severity := CASE NEW.priority
    WHEN 'urgent' THEN 'critical'
    WHEN 'high' THEN 'high'
    WHEN 'low' THEN 'low'
    ELSE 'medium'
  END;

  INSERT INTO public.content_feedback_events (
    source, ticket_id, entity_type, entity_id, severity, reason_code,
    reporter_user_id, description
  ) VALUES (
    'support_ticket', NEW.id, v_entity_type, v_entity_id, v_severity,
    COALESCE(NEW.ticket_type, 'content_error'),
    NEW.user_id, LEFT(COALESCE(NEW.description, NEW.subject), 500)
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ticket_to_feedback ON public.support_tickets;
CREATE TRIGGER trg_ticket_to_feedback
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_support_ticket_to_feedback_event();

-- ════════════════════════════════════════════════════════════════
-- 6. SSOT view
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_content_feedback_pipeline AS
SELECT
  entity_type,
  COUNT(*) FILTER (WHERE status = 'open') AS open_count,
  COUNT(*) FILTER (WHERE status = 'triaged') AS triaged_count,
  COUNT(*) FILTER (WHERE status = 'repair_enqueued') AS repair_enqueued_count,
  COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
  COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
  COUNT(*) FILTER (WHERE severity IN ('high','critical') AND status NOT IN ('resolved','rejected')) AS high_severity_open,
  COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS last_24h,
  AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60.0)
    FILTER (WHERE resolved_at IS NOT NULL AND created_at > now() - interval '30 days') AS mttr_minutes_30d
FROM public.content_feedback_events
GROUP BY entity_type;

REVOKE ALL ON public.v_content_feedback_pipeline FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_content_feedback_pipeline TO service_role;

-- ════════════════════════════════════════════════════════════════
-- 7. Admin RPCs
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_get_content_feedback_pipeline()
RETURNS TABLE (
  entity_type TEXT, open_count BIGINT, triaged_count BIGINT,
  repair_enqueued_count BIGINT, resolved_count BIGINT, rejected_count BIGINT,
  high_severity_open BIGINT, last_24h BIGINT, mttr_minutes_30d NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.v_content_feedback_pipeline ORDER BY high_severity_open DESC NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_content_feedback_events(
  _status TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _limit INT DEFAULT 100
)
RETURNS SETOF public.content_feedback_events
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT * FROM public.content_feedback_events
  WHERE (_status IS NULL OR status = _status)
    AND (_entity_type IS NULL OR entity_type = _entity_type)
  ORDER BY
    CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 500));
END $$;

CREATE OR REPLACE FUNCTION public.admin_resolve_feedback_event(
  _event_id UUID, _action TEXT, _notes TEXT DEFAULT NULL
) RETURNS public.content_feedback_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.content_feedback_events;
  v_new_status TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_new_status := CASE _action
    WHEN 'resolve' THEN 'resolved'
    WHEN 'reject' THEN 'rejected'
    WHEN 'duplicate' THEN 'duplicate'
    WHEN 'triage' THEN 'triaged'
    ELSE NULL
  END;

  IF v_new_status IS NULL THEN
    RAISE EXCEPTION 'invalid_action: %', _action;
  END IF;

  UPDATE public.content_feedback_events
  SET status = v_new_status,
      resolution_action = _action,
      resolution_notes = COALESCE(_notes, resolution_notes),
      resolved_at = CASE WHEN v_new_status IN ('resolved','rejected','duplicate') THEN now() ELSE resolved_at END,
      resolved_by = CASE WHEN v_new_status IN ('resolved','rejected','duplicate') THEN auth.uid() ELSE resolved_by END
  WHERE id = _event_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'feedback_event_not_found';
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, details)
  VALUES (
    'content_feedback_resolved', 'package', v_row.package_id, v_new_status,
    jsonb_build_object('feedback_event_id', v_row.id, 'action', _action, 'notes', _notes)
  );

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_content_feedback_pipeline() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_content_feedback_events(TEXT, TEXT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_feedback_event(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_content_feedback_pipeline() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_content_feedback_events(TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_feedback_event(UUID, TEXT, TEXT) TO authenticated;
