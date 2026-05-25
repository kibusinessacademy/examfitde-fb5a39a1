-- ============================================================
-- Phase 5: Workflow Learning Engine
-- ============================================================

-- 5.0  Workflow-Klasse auf Definitions
ALTER TABLE public.berufs_ki_workflow_definitions
  ADD COLUMN IF NOT EXISTS workflow_class text NOT NULL DEFAULT 'official'
    CHECK (workflow_class IN ('official','community_verified','blueprint_materialized','experimental')),
  ADD COLUMN IF NOT EXISTS source_submission_id uuid REFERENCES public.berufs_ki_workflow_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_cluster_id uuid;

-- 5.1  Cluster-Tabelle
CREATE TABLE IF NOT EXISTS public.berufs_ki_workflow_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_signature text NOT NULL UNIQUE,
  category text NOT NULL,
  beruf_slug text,
  curriculum_id uuid,
  competency_refs uuid[] NOT NULL DEFAULT '{}',
  output_section_refs text[] NOT NULL DEFAULT '{}',
  submission_ids uuid[] NOT NULL DEFAULT '{}',
  submission_count integer NOT NULL DEFAULT 0,
  common_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
  merge_confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected','reviewing','promoted','dismissed')),
  promoted_candidate_id uuid,
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bki_clusters_status ON public.berufs_ki_workflow_clusters(status, merge_confidence DESC);
ALTER TABLE public.berufs_ki_workflow_clusters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read clusters" ON public.berufs_ki_workflow_clusters;
CREATE POLICY "admins read clusters" ON public.berufs_ki_workflow_clusters
  FOR SELECT USING (has_role(auth.uid(),'admin'::app_role));

-- 5.2  Blueprint-Kandidaten
CREATE TABLE IF NOT EXISTS public.berufs_ki_blueprint_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_cluster_id uuid REFERENCES public.berufs_ki_workflow_clusters(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  beruf_slug text,
  curriculum_id uuid,
  competency_refs uuid[] NOT NULL DEFAULT '{}',
  suggested_input_schema jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  suggested_output_schema jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  suggested_system_prompt text,
  workflow_patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  adoption_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric NOT NULL DEFAULT 0,
  review_status text NOT NULL DEFAULT 'proposed'
    CHECK (review_status IN ('proposed','approved','rejected','materialized')),
  materialized_definition_id uuid REFERENCES public.berufs_ki_workflow_definitions(id) ON DELETE SET NULL,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bki_bpc_status ON public.berufs_ki_blueprint_candidates(review_status, confidence_score DESC);
ALTER TABLE public.berufs_ki_blueprint_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read bp candidates" ON public.berufs_ki_blueprint_candidates;
CREATE POLICY "admins read bp candidates" ON public.berufs_ki_blueprint_candidates
  FOR SELECT USING (has_role(auth.uid(),'admin'::app_role));

-- 5.3  Submitter-Notifications
CREATE TABLE IF NOT EXISTS public.berufs_ki_submitter_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES public.berufs_ki_workflow_submissions(id) ON DELETE CASCADE,
  cluster_id uuid REFERENCES public.berufs_ki_workflow_clusters(id) ON DELETE SET NULL,
  candidate_id uuid REFERENCES public.berufs_ki_blueprint_candidates(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'submission_received',
    'precheck_done',
    'approved',
    'approved_with_edits',
    'needs_changes',
    'rejected',
    'merged_into_official',
    'became_blueprint_candidate',
    'blueprint_materialized'
  )),
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bki_notif_recipient ON public.berufs_ki_submitter_notifications(recipient_user_id, created_at DESC);
ALTER TABLE public.berufs_ki_submitter_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own notifications" ON public.berufs_ki_submitter_notifications;
CREATE POLICY "users read own notifications" ON public.berufs_ki_submitter_notifications
  FOR SELECT USING (recipient_user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "users mark own notifications" ON public.berufs_ki_submitter_notifications;
CREATE POLICY "users mark own notifications" ON public.berufs_ki_submitter_notifications
  FOR UPDATE USING (recipient_user_id = auth.uid()) WITH CHECK (recipient_user_id = auth.uid());

-- 5.4  Notification-Trigger auf submissions
CREATE OR REPLACE FUNCTION public.fn_bki_notify_on_submission_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  evt text;
  ttl text;
  bdy text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.berufs_ki_submitter_notifications(recipient_user_id, submission_id, event_type, title, body, data)
    VALUES (NEW.submitted_by, NEW.id, 'submission_received',
      'Workflow eingereicht',
      'Dein Workflow „' || NEW.title || '" wird automatisch geprüft. Ergebnis kommt in Kürze.',
      jsonb_build_object('title', NEW.title));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    evt := CASE NEW.status::text
      WHEN 'precheck_done' THEN 'precheck_done'
      WHEN 'approved' THEN 'approved'
      WHEN 'approved_with_edits' THEN 'approved_with_edits'
      WHEN 'needs_changes' THEN 'needs_changes'
      WHEN 'rejected' THEN 'rejected'
      ELSE NULL
    END;

    IF evt IS NOT NULL THEN
      ttl := CASE evt
        WHEN 'precheck_done' THEN 'AI-Vorprüfung abgeschlossen'
        WHEN 'approved' THEN 'Dein Workflow wurde freigegeben'
        WHEN 'approved_with_edits' THEN 'Dein Workflow wurde mit Anpassungen freigegeben'
        WHEN 'needs_changes' THEN 'Dein Workflow braucht noch Anpassungen'
        WHEN 'rejected' THEN 'Dein Workflow wurde nicht übernommen'
      END;
      bdy := CASE evt
        WHEN 'approved' THEN 'Dein Workflow „' || NEW.title || '" hat die Berufslogik verbessert. Er ist jetzt offiziell verfügbar.'
        WHEN 'approved_with_edits' THEN 'Dein Workflow „' || NEW.title || '" wurde nach Review-Anpassungen freigegeben.'
        ELSE 'Status: ' || NEW.status::text
      END;

      INSERT INTO public.berufs_ki_submitter_notifications(recipient_user_id, submission_id, event_type, title, body, data)
      VALUES (NEW.submitted_by, NEW.id, evt, ttl, bdy,
        jsonb_build_object('reviewer_notes', NEW.reviewer_notes, 'promoted_definition_id', NEW.promoted_definition_id));
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bki_notify_on_submission ON public.berufs_ki_workflow_submissions;
CREATE TRIGGER trg_bki_notify_on_submission
AFTER INSERT OR UPDATE OF status ON public.berufs_ki_workflow_submissions
FOR EACH ROW EXECUTE FUNCTION public.fn_bki_notify_on_submission_status();

-- 5.5  Cluster-Engine: berechnet Cluster über Signatur
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_recompute_clusters(_min_size integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted integer := 0;
  v_updated integer := 0;
  rec record;
  sig text;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR rec IN
    SELECT
      category,
      COALESCE(beruf_slug,'_any_') AS beruf_key,
      curriculum_id,
      array_agg(id ORDER BY created_at) AS sub_ids,
      array_agg(DISTINCT title) AS titles,
      array_agg(DISTINCT goal) AS goals,
      jsonb_agg(proposed_inputs) AS inputs_agg,
      jsonb_agg(proposed_outputs) AS outputs_agg,
      array_agg(DISTINCT unnested_section) FILTER (WHERE unnested_section IS NOT NULL) AS sections,
      count(*)::int AS n
    FROM (
      SELECT s.*,
        jsonb_array_elements_text(COALESCE(s.proposed_outputs->'sections','[]'::jsonb)) AS unnested_section
      FROM public.berufs_ki_workflow_submissions s
      WHERE s.status::text IN ('approved','approved_with_edits','under_review','pending_review')
    ) x
    GROUP BY category, beruf_key, curriculum_id
    HAVING count(*) >= _min_size
  LOOP
    sig := rec.category || '|' || rec.beruf_key || '|' || COALESCE(rec.curriculum_id::text,'-');

    INSERT INTO public.berufs_ki_workflow_clusters(
      cluster_signature, category, beruf_slug, curriculum_id,
      submission_ids, submission_count,
      output_section_refs,
      common_inputs, common_outputs, common_patterns,
      merge_confidence, status, updated_at
    ) VALUES (
      sig, rec.category, NULLIF(rec.beruf_key,'_any_'), rec.curriculum_id,
      rec.sub_ids, rec.n,
      COALESCE(rec.sections, '{}'::text[]),
      to_jsonb(rec.inputs_agg), to_jsonb(rec.outputs_agg),
      jsonb_build_object('titles', rec.titles, 'goals', rec.goals),
      LEAST(1.0, rec.n::numeric / 10.0),
      'detected', now()
    )
    ON CONFLICT (cluster_signature) DO UPDATE SET
      submission_ids = EXCLUDED.submission_ids,
      submission_count = EXCLUDED.submission_count,
      output_section_refs = EXCLUDED.output_section_refs,
      common_inputs = EXCLUDED.common_inputs,
      common_outputs = EXCLUDED.common_outputs,
      common_patterns = EXCLUDED.common_patterns,
      merge_confidence = EXCLUDED.merge_confidence,
      updated_at = now();

    IF FOUND THEN v_updated := v_updated + 1; ELSE v_inserted := v_inserted + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'updated', v_updated, 'min_size', _min_size);
END $$;

REVOKE ALL ON FUNCTION public.admin_berufs_ki_recompute_clusters(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_recompute_clusters(integer) TO authenticated;

-- 5.6  Cluster auflisten
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_list_clusters(_status text DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, cluster_signature text, category text, beruf_slug text, curriculum_id uuid,
  submission_count integer, merge_confidence numeric, status text,
  output_section_refs text[], common_patterns jsonb,
  promoted_candidate_id uuid, detected_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, cluster_signature, category, beruf_slug, curriculum_id,
         submission_count, merge_confidence, status,
         output_section_refs, common_patterns,
         promoted_candidate_id, detected_at, updated_at
  FROM public.berufs_ki_workflow_clusters
  WHERE has_role(auth.uid(),'admin'::app_role)
    AND (_status IS NULL OR status = _status)
  ORDER BY merge_confidence DESC, submission_count DESC
  LIMIT GREATEST(1, _limit);
$$;

REVOKE ALL ON FUNCTION public.admin_berufs_ki_list_clusters(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_list_clusters(text, integer) TO authenticated;

-- 5.7  Cluster -> Blueprint-Kandidat fördern
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_promote_cluster_to_blueprint_candidate(_cluster_id uuid, _title text, _description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  new_id uuid;
  recipients uuid[];
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO c FROM public.berufs_ki_workflow_clusters WHERE id = _cluster_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cluster_not_found'; END IF;
  IF c.status = 'promoted' THEN RAISE EXCEPTION 'already_promoted'; END IF;

  INSERT INTO public.berufs_ki_blueprint_candidates(
    source_cluster_id, title, description, category, beruf_slug, curriculum_id,
    competency_refs,
    suggested_output_schema,
    workflow_patterns,
    quality_metrics,
    adoption_metrics,
    confidence_score,
    review_status
  ) VALUES (
    c.id, _title, _description, c.category, c.beruf_slug, c.curriculum_id,
    c.competency_refs,
    jsonb_build_object('sections', to_jsonb(c.output_section_refs)),
    c.common_patterns,
    jsonb_build_object('source_submissions', c.submission_count),
    jsonb_build_object('cluster_signature', c.cluster_signature),
    c.merge_confidence,
    'proposed'
  ) RETURNING id INTO new_id;

  UPDATE public.berufs_ki_workflow_clusters
    SET status = 'promoted', promoted_candidate_id = new_id, updated_at = now()
    WHERE id = c.id;

  -- Submitter-Notifications: alle Beitragenden des Clusters
  SELECT array_agg(DISTINCT submitted_by) INTO recipients
    FROM public.berufs_ki_workflow_submissions WHERE id = ANY(c.submission_ids);

  IF recipients IS NOT NULL THEN
    INSERT INTO public.berufs_ki_submitter_notifications(recipient_user_id, cluster_id, candidate_id, event_type, title, body, data)
    SELECT u, c.id, new_id, 'became_blueprint_candidate',
      'Dein Workflow ist Teil eines neuen Blueprints',
      'Aus deinem Beitrag und ähnlichen Workflows entsteht ein offizieller Berufs-KI Blueprint: „' || _title || '"',
      jsonb_build_object('cluster_signature', c.cluster_signature, 'confidence', c.merge_confidence)
    FROM unnest(recipients) AS u;
  END IF;

  RETURN jsonb_build_object('ok', true, 'candidate_id', new_id, 'notified', COALESCE(array_length(recipients,1),0));
END $$;

REVOKE ALL ON FUNCTION public.admin_berufs_ki_promote_cluster_to_blueprint_candidate(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_promote_cluster_to_blueprint_candidate(uuid, text, text) TO authenticated;

-- 5.8  Blueprint-Kandidaten listen
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_list_blueprint_candidates(_status text DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, title text, description text, category text, beruf_slug text, curriculum_id uuid,
  confidence_score numeric, review_status text, source_cluster_id uuid,
  materialized_definition_id uuid, suggested_output_schema jsonb,
  adoption_metrics jsonb, quality_metrics jsonb, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, title, description, category, beruf_slug, curriculum_id,
         confidence_score, review_status, source_cluster_id,
         materialized_definition_id, suggested_output_schema,
         adoption_metrics, quality_metrics, created_at, updated_at
  FROM public.berufs_ki_blueprint_candidates
  WHERE has_role(auth.uid(),'admin'::app_role)
    AND (_status IS NULL OR review_status = _status)
  ORDER BY confidence_score DESC, created_at DESC
  LIMIT GREATEST(1, _limit);
$$;
REVOKE ALL ON FUNCTION public.admin_berufs_ki_list_blueprint_candidates(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_list_blueprint_candidates(text, integer) TO authenticated;

-- 5.9  Kandidat materialisieren -> echte Definition (admin-gated, governance-first)
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_materialize_blueprint_candidate(
  _candidate_id uuid,
  _slug text,
  _system_prompt text,
  _user_prompt_template text,
  _tier text DEFAULT 'pro'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bp record;
  new_def_id uuid;
  recipients uuid[];
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _tier NOT IN ('free','pro','business') THEN RAISE EXCEPTION 'invalid_tier'; END IF;

  SELECT * INTO bp FROM public.berufs_ki_blueprint_candidates WHERE id = _candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_not_found'; END IF;
  IF bp.review_status = 'materialized' THEN RAISE EXCEPTION 'already_materialized'; END IF;

  INSERT INTO public.berufs_ki_workflow_definitions(
    slug, title, description, category, curriculum_id,
    competency_ids, target_roles, tier_required,
    input_schema, output_schema,
    system_prompt, user_prompt_template,
    workflow_class, source_cluster_id, is_active
  ) VALUES (
    _slug, bp.title, bp.description, bp.category, bp.curriculum_id,
    COALESCE(bp.competency_refs,'{}'::uuid[]),
    ARRAY['fachkraft']::text[], _tier,
    bp.suggested_input_schema, bp.suggested_output_schema,
    _system_prompt, _user_prompt_template,
    'blueprint_materialized', bp.source_cluster_id, true
  ) RETURNING id INTO new_def_id;

  UPDATE public.berufs_ki_blueprint_candidates
    SET review_status = 'materialized', materialized_definition_id = new_def_id, updated_at = now()
    WHERE id = bp.id;

  -- Notify alle Beitragenden des Clusters
  IF bp.source_cluster_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT s.submitted_by) INTO recipients
      FROM public.berufs_ki_workflow_clusters c
      JOIN public.berufs_ki_workflow_submissions s ON s.id = ANY(c.submission_ids)
      WHERE c.id = bp.source_cluster_id;

    IF recipients IS NOT NULL THEN
      INSERT INTO public.berufs_ki_submitter_notifications(recipient_user_id, cluster_id, candidate_id, event_type, title, body, data)
      SELECT u, bp.source_cluster_id, bp.id, 'blueprint_materialized',
        'Aus deinem Beitrag entstand ein offizieller Blueprint',
        'Der Blueprint „' || bp.title || '" ist jetzt offiziell in Berufs-KI verfügbar.',
        jsonb_build_object('definition_id', new_def_id, 'slug', _slug)
      FROM unnest(recipients) AS u;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'definition_id', new_def_id, 'slug', _slug);
END $$;
REVOKE ALL ON FUNCTION public.admin_berufs_ki_materialize_blueprint_candidate(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_materialize_blueprint_candidate(uuid, text, text, text, text) TO authenticated;

-- 5.10  Submitter-Inbox-RPCs
CREATE OR REPLACE FUNCTION public.learner_berufs_ki_list_my_notifications(_limit integer DEFAULT 30)
RETURNS TABLE(id uuid, event_type text, title text, body text, data jsonb, read_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, event_type, title, body, data, read_at, created_at
  FROM public.berufs_ki_submitter_notifications
  WHERE recipient_user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT GREATEST(1, _limit);
$$;
REVOKE ALL ON FUNCTION public.learner_berufs_ki_list_my_notifications(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.learner_berufs_ki_list_my_notifications(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.learner_berufs_ki_mark_notification_read(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.berufs_ki_submitter_notifications
    SET read_at = now()
    WHERE id = _id AND recipient_user_id = auth.uid();
  RETURN jsonb_build_object('ok', FOUND);
END $$;
REVOKE ALL ON FUNCTION public.learner_berufs_ki_mark_notification_read(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.learner_berufs_ki_mark_notification_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.learner_berufs_ki_list_my_submissions(_limit integer DEFAULT 30)
RETURNS TABLE(id uuid, title text, category text, status text, created_at timestamptz, updated_at timestamptz, promoted_definition_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, title, category, status::text, created_at, updated_at, promoted_definition_id
  FROM public.berufs_ki_workflow_submissions
  WHERE submitted_by = auth.uid()
  ORDER BY created_at DESC
  LIMIT GREATEST(1, _limit);
$$;
REVOKE ALL ON FUNCTION public.learner_berufs_ki_list_my_submissions(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.learner_berufs_ki_list_my_submissions(integer) TO authenticated;