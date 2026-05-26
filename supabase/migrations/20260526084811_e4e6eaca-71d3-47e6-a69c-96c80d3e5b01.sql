
-- FördermittelOS Cut 7: Sales Inbox + Follow-up Pipeline
-- Reuse existing b2b_leads + auto_heal_log. No parallel sales tables.
-- All access via SECURITY DEFINER RPCs gated by has_role('admin').

-- 1) Register audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('foerdermittel_lead_status_changed', ARRAY['lead_id','from_status','to_status'], 'foerdermittel'),
  ('foerdermittel_lead_activity_added', ARRAY['lead_id','kind'], 'foerdermittel'),
  ('foerdermittel_lead_status_blocked', ARRAY['lead_id','from_status','to_status','reason'], 'foerdermittel')
ON CONFLICT (action_type) DO NOTHING;

-- 2) Helper: forward-only status policy
CREATE OR REPLACE FUNCTION public.fn_foerdermittel_lead_status_can_transition(
  _from text, _to text
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _from = _to THEN false
    WHEN _from IN ('won','lost') THEN false
    WHEN _to NOT IN ('new','qualified','contacted','won','lost') THEN false
    -- forward-only flow: new -> qualified -> contacted -> won
    -- lost is allowed from any non-terminal
    WHEN _to = 'lost' THEN _from IN ('new','qualified','contacted')
    WHEN _from = 'new' AND _to IN ('qualified','contacted','won') THEN true
    WHEN _from = 'qualified' AND _to IN ('contacted','won') THEN true
    WHEN _from = 'contacted' AND _to = 'won' THEN true
    ELSE false
  END;
$$;

-- 3) List leads (admin)
CREATE OR REPLACE FUNCTION public.admin_foerdermittel_leads_list(
  p_status text[] DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_total int;
  v_counts jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT *
    FROM public.b2b_leads
    WHERE source LIKE 'foerdermittel:%'
      AND (p_status IS NULL OR status = ANY(p_status))
      AND (p_source IS NULL OR source = 'foerdermittel:' || p_source)
      AND (p_region IS NULL OR meta->>'region' = p_region)
      AND (p_industry IS NULL OR industry = p_industry)
      AND (
        p_search IS NULL OR p_search = ''
        OR company_name ILIKE '%' || p_search || '%'
        OR contact_email ILIKE '%' || p_search || '%'
      )
  ),
  ranked AS (
    SELECT *,
      COALESCE((meta->>'lead_quality_score')::int, 0) AS score
    FROM base
  )
  SELECT
    COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.score DESC, t.created_at DESC), '[]'::jsonb),
    (SELECT count(*) FROM base)
  INTO v_items, v_total
  FROM (
    SELECT id, company_name, contact_email, industry, source, status, tags,
           created_at, updated_at, next_action, next_action_at, assigned_to,
           COALESCE((meta->>'lead_quality_score')::int, 0) AS score,
           COALESCE(meta->>'lead_tier', 'cold') AS tier,
           COALESCE(meta->>'region', NULL) AS region,
           COALESCE(meta->>'source_page', NULL) AS source_page,
           COALESCE(meta->'report_top_slugs', '[]'::jsonb) AS report_top_slugs,
           COALESCE(meta->>'report_readiness_verdict', NULL) AS report_readiness
    FROM ranked
    ORDER BY score DESC, created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) t;

  SELECT jsonb_object_agg(status, c) INTO v_counts
  FROM (
    SELECT status, count(*) AS c
    FROM public.b2b_leads
    WHERE source LIKE 'foerdermittel:%'
    GROUP BY status
  ) s;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'counts_by_status', COALESCE(v_counts, '{}'::jsonb)
  );
END;
$$;

-- 4) Lead detail (admin)
CREATE OR REPLACE FUNCTION public.admin_foerdermittel_lead_detail(
  p_lead_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead jsonb;
  v_events jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(l) INTO v_lead
  FROM public.b2b_leads l
  WHERE l.id = p_lead_id AND l.source LIKE 'foerdermittel:%';

  IF v_lead IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb ORDER BY e.created_at DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT event_type, page_path, intent, created_at,
           jsonb_strip_nulls(jsonb_build_object(
             'request_id', metadata->>'request_id',
             'source_page', metadata->>'source_page',
             'lead_quality_score', metadata->>'lead_quality_score',
             'lead_tier', metadata->>'lead_tier'
           )) AS metadata_public
    FROM public.conversion_events
    WHERE metadata->>'lead_id' = p_lead_id::text
       OR (metadata->>'module' = 'foerdermittel' AND metadata->>'request_id' = v_lead->'meta'->>'request_id')
    ORDER BY created_at DESC
    LIMIT 50
  ) e;

  RETURN jsonb_build_object('lead', v_lead, 'events', v_events);
END;
$$;

-- 5) Update status (forward-only, audit)
CREATE OR REPLACE FUNCTION public.admin_foerdermittel_lead_set_status(
  p_lead_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_current
  FROM public.b2b_leads
  WHERE id = p_lead_id AND source LIKE 'foerdermittel:%';

  IF v_current IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','not_found');
  END IF;

  IF NOT public.fn_foerdermittel_lead_status_can_transition(v_current, p_new_status) THEN
    PERFORM public.fn_emit_audit(
      'foerdermittel_lead_status_blocked', 'b2b_lead', p_lead_id::text, 'blocked',
      jsonb_build_object('lead_id', p_lead_id, 'from_status', v_current, 'to_status', p_new_status, 'reason', p_reason)
    );
    RETURN jsonb_build_object('ok', false, 'error','invalid_transition','from', v_current, 'to', p_new_status);
  END IF;

  UPDATE public.b2b_leads
  SET status = p_new_status,
      updated_at = now()
  WHERE id = p_lead_id;

  PERFORM public.fn_emit_audit(
    'foerdermittel_lead_status_changed', 'b2b_lead', p_lead_id::text, 'success',
    jsonb_build_object('lead_id', p_lead_id, 'from_status', v_current, 'to_status', p_new_status, 'reason', left(p_reason, 240))
  );

  RETURN jsonb_build_object('ok', true, 'from', v_current, 'to', p_new_status);
END;
$$;

-- 6) Add activity (note / follow-up) — stored in meta.activities[]
CREATE OR REPLACE FUNCTION public.admin_foerdermittel_lead_add_activity(
  p_lead_id uuid,
  p_kind text,
  p_note text,
  p_next_action_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_actor text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('note','call','email','meeting','followup','outcome') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR length(trim(p_note)) < 2 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(auth.uid()::text, 'system');
  v_entry := jsonb_build_object(
    'kind', p_kind,
    'note', left(p_note, 2000),
    'at', now(),
    'by', v_actor,
    'next_action_at', p_next_action_at
  );

  UPDATE public.b2b_leads
  SET meta = jsonb_set(
        COALESCE(meta, '{}'::jsonb),
        '{activities}',
        COALESCE(meta->'activities', '[]'::jsonb) || jsonb_build_array(v_entry)
      ),
      next_action = CASE WHEN p_kind = 'followup' THEN left(p_note, 240) ELSE next_action END,
      next_action_at = COALESCE(p_next_action_at, next_action_at),
      updated_at = now()
  WHERE id = p_lead_id AND source LIKE 'foerdermittel:%';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error','not_found');
  END IF;

  PERFORM public.fn_emit_audit(
    'foerdermittel_lead_activity_added', 'b2b_lead', p_lead_id::text, 'success',
    jsonb_build_object('lead_id', p_lead_id, 'kind', p_kind, 'has_followup', p_next_action_at IS NOT NULL)
  );

  RETURN jsonb_build_object('ok', true, 'entry', v_entry);
END;
$$;

-- 7) Grants — admin RPCs are SECURITY DEFINER; expose to authenticated, gate inside.
REVOKE ALL ON FUNCTION public.admin_foerdermittel_leads_list(text[],text,text,text,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_foerdermittel_lead_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_foerdermittel_lead_set_status(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_foerdermittel_lead_add_activity(uuid,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_foerdermittel_leads_list(text[],text,text,text,text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_foerdermittel_lead_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_foerdermittel_lead_set_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_foerdermittel_lead_add_activity(uuid,text,text,timestamptz) TO authenticated;
