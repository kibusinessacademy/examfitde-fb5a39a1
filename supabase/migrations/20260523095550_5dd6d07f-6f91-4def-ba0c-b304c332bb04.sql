
-- =========================================================================
-- P20 Cut 1 — GIL Signal Collector Foundation
-- =========================================================================

-- ---------- Source Registry --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gil_signal_sources (
  source_key text PRIMARY KEY,
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('manual','rss','api')),
  enabled boolean NOT NULL DEFAULT false,
  allowed_signal_types text[] NOT NULL DEFAULT '{}',
  default_severity text NOT NULL DEFAULT 'info' CHECK (default_severity IN ('info','warning','critical')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gil_signal_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gil_signal_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gil_signal_sources TO service_role;

DROP POLICY IF EXISTS gil_signal_sources_admin_read ON public.gil_signal_sources;
CREATE POLICY gil_signal_sources_admin_read ON public.gil_signal_sources
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.fn_guard_gil_signal_sources_reserved()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_key IN ('p18','manual') THEN
    RAISE EXCEPTION 'source_key % is reserved', NEW.source_key;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_gil_signal_sources_reserved ON public.gil_signal_sources;
CREATE TRIGGER trg_guard_gil_signal_sources_reserved
  BEFORE INSERT OR UPDATE ON public.gil_signal_sources
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_gil_signal_sources_reserved();

-- ---------- Intake (review-first staging) -----------------------------------
CREATE TABLE IF NOT EXISTS public.gil_signal_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL REFERENCES public.gil_signal_sources(source_key) ON DELETE RESTRICT,
  signal_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  url text,
  external_id text,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','duplicate')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  decision_reason text,
  promoted_signal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gil_signal_intake ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gil_signal_intake FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gil_signal_intake TO service_role;

DROP POLICY IF EXISTS gil_signal_intake_admin_read ON public.gil_signal_intake;
CREATE POLICY gil_signal_intake_admin_read ON public.gil_signal_intake
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE UNIQUE INDEX IF NOT EXISTS uq_gil_signal_intake_fp_active
  ON public.gil_signal_intake (source_key, fingerprint)
  WHERE status <> 'rejected';

CREATE INDEX IF NOT EXISTS idx_gil_signal_intake_status_created
  ON public.gil_signal_intake (status, created_at DESC);

-- ---------- Audit contracts -------------------------------------------------
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('gil_intake_submitted',
     ARRAY['source_key','submitted','duplicates','rejected'], 'p20.gil_collector'),
  ('gil_intake_approved',
     ARRAY['intake_id','signal_id','source_key'], 'p20.gil_collector'),
  ('gil_intake_rejected',
     ARRAY['intake_id','source_key','reason'], 'p20.gil_collector'),
  ('gil_intake_duplicate_skipped',
     ARRAY['source_key','fingerprint','reason'], 'p20.gil_collector')
ON CONFLICT (action_type) DO NOTHING;

-- ---------- Seed registry ---------------------------------------------------
INSERT INTO public.gil_signal_sources (source_key, label, kind, enabled, allowed_signal_types, default_severity, notes) VALUES
  ('manual_paste','Manual Paste (Generic)','manual', true,
     ARRAY['manual_observation','press_mention','review_signal']::text[],
     'info','Operator-curated free observations.'),
  ('press_paste','Press / Mention Paste','manual', true,
     ARRAY['press_mention','campaign_change']::text[],
     'info', NULL),
  ('competitor_paste','Competitor Observation Paste','manual', true,
     ARRAY['competitor_release','pricing_change','competitor_feature_added','review_signal']::text[],
     'warning','Competitor releases / pricing — defaults to warning.'),
  ('rss','RSS Collector (planned)','rss', false,
     ARRAY['press_mention','competitor_release']::text[],
     'info','Reserved for Cut 2.'),
  ('semrush','Semrush API (planned)','api', false,
     ARRAY['serp_change','pricing_change']::text[],
     'info','Reserved for Cut 3.')
ON CONFLICT (source_key) DO UPDATE
  SET label = EXCLUDED.label,
      kind = EXCLUDED.kind,
      enabled = EXCLUDED.enabled,
      allowed_signal_types = EXCLUDED.allowed_signal_types,
      default_severity = EXCLUDED.default_severity,
      notes = EXCLUDED.notes,
      updated_at = now();

-- ---------- RPC: list registry (admin) --------------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_list_collector_sources()
RETURNS TABLE (
  source_key text, label text, kind text, enabled boolean,
  allowed_signal_types text[], default_severity text, notes text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.source_key, s.label, s.kind, s.enabled,
         s.allowed_signal_types, s.default_severity, s.notes
  FROM public.gil_signal_sources s
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY s.enabled DESC, s.source_key;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_list_collector_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_list_collector_sources() TO authenticated;

-- ---------- RPC: list pending intake (admin) --------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_intake_list(
  p_status text DEFAULT 'pending',
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid, source_key text, signal_type text, severity text,
  title text, summary text, url text, external_id text, fingerprint text,
  status text, observed_at timestamptz, created_at timestamptz,
  payload jsonb, decision_reason text, promoted_signal_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT i.id, i.source_key, i.signal_type, i.severity,
         i.title, i.summary, i.url, i.external_id, i.fingerprint,
         i.status, i.observed_at, i.created_at,
         i.payload, i.decision_reason, i.promoted_signal_id
  FROM public.gil_signal_intake i
  WHERE (p_status IS NULL OR i.status = p_status)
  ORDER BY i.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_intake_list(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_intake_list(text, integer) TO authenticated;

-- ---------- RPC: submit batch (admin) ---------------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_intake_submit_batch(
  p_source_key text,
  p_items jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_src public.gil_signal_sources%ROWTYPE;
  v_item jsonb;
  v_inserted int := 0;
  v_dupes int := 0;
  v_rejected int := 0;
  v_signal_type text;
  v_severity text;
  v_fp text;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF coalesce(length(trim(p_reason)), 0) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 characters';
  END IF;
  IF p_source_key IN ('p18','manual') THEN
    RAISE EXCEPTION 'source_key % is reserved', p_source_key;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a jsonb array';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'batch too large (max 100)';
  END IF;

  SELECT * INTO v_src FROM public.gil_signal_sources WHERE source_key = p_source_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown source %', p_source_key; END IF;
  IF NOT v_src.enabled THEN RAISE EXCEPTION 'source % is disabled', p_source_key; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_signal_type := COALESCE(NULLIF(trim(v_item->>'signal_type'), ''), v_src.allowed_signal_types[1]);
    IF NOT (v_signal_type = ANY (v_src.allowed_signal_types)) THEN
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;
    v_severity := COALESCE(NULLIF(v_item->>'severity', ''), v_src.default_severity);
    IF v_severity NOT IN ('info','warning','critical') THEN
      v_severity := v_src.default_severity;
    END IF;
    v_fp := COALESCE(NULLIF(v_item->>'fingerprint', ''), '');
    IF v_fp = '' OR coalesce(length(trim(v_item->>'title')), 0) < 3 THEN
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_existing
    FROM public.gil_signal_intake
    WHERE source_key = p_source_key AND fingerprint = v_fp AND status <> 'rejected'
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_dupes := v_dupes + 1;
      PERFORM public.fn_emit_audit(
        'gil_intake_duplicate_skipped',
        jsonb_build_object(
          'source_key', p_source_key,
          'fingerprint', v_fp,
          'reason', 'pre_existing_active_row'
        ),
        'governance', v_existing::text, 'success'
      );
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.gil_signal_intake (
        source_key, signal_type, severity, title, summary, url, external_id, fingerprint,
        payload, status, observed_at, submitted_by
      ) VALUES (
        p_source_key,
        v_signal_type,
        v_severity,
        left(v_item->>'title', 200),
        left(coalesce(v_item->>'summary',''), 600),
        NULLIF(v_item->>'url',''),
        NULLIF(v_item->>'external_id',''),
        v_fp,
        jsonb_build_object(
          'origin','collector',
          'submitted_by', v_uid,
          'reason', left(p_reason, 600),
          'tags', COALESCE(v_item->'tags', '[]'::jsonb)
        ),
        'pending',
        COALESCE((v_item->>'observed_at')::timestamptz, now()),
        v_uid
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      v_dupes := v_dupes + 1;
      PERFORM public.fn_emit_audit(
        'gil_intake_duplicate_skipped',
        jsonb_build_object(
          'source_key', p_source_key,
          'fingerprint', v_fp,
          'reason', 'unique_violation'
        ),
        'governance', NULL, 'success'
      );
    END;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'gil_intake_submitted',
    jsonb_build_object(
      'source_key', p_source_key,
      'submitted', v_inserted,
      'duplicates', v_dupes,
      'rejected', v_rejected,
      'reason', left(p_reason, 600)
    ),
    'governance', NULL, 'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'source_key', p_source_key,
    'submitted', v_inserted,
    'duplicates', v_dupes,
    'rejected', v_rejected
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_intake_submit_batch(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_intake_submit_batch(text, jsonb, text) TO authenticated;

-- ---------- RPC: decide single intake (admin) -------------------------------
CREATE OR REPLACE FUNCTION public.admin_gil_intake_decide(
  p_intake_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.gil_signal_intake%ROWTYPE;
  v_signal_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'decision must be approve|reject';
  END IF;
  IF coalesce(length(trim(p_reason)), 0) < 8 THEN
    RAISE EXCEPTION 'reason must be at least 8 characters';
  END IF;

  SELECT * INTO v_row FROM public.gil_signal_intake WHERE id = p_intake_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'intake row not found'; END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason','already_decided','status', v_row.status);
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.gil_signal_intake
       SET status = 'rejected',
           reviewed_by = v_uid,
           reviewed_at = now(),
           decision_reason = left(p_reason, 600)
     WHERE id = p_intake_id;
    PERFORM public.fn_emit_audit(
      'gil_intake_rejected',
      jsonb_build_object(
        'intake_id', p_intake_id,
        'source_key', v_row.source_key,
        'reason', left(p_reason, 600)
      ),
      'governance', p_intake_id::text, 'success'
    );
    RETURN jsonb_build_object('ok', true, 'decision','rejected','intake_id', p_intake_id);
  END IF;

  -- approve → materialize into gil_market_signals
  INSERT INTO public.gil_market_signals (
    signal_type, source, severity, title, summary, payload, observed_at
  ) VALUES (
    v_row.signal_type,
    v_row.source_key,
    v_row.severity,
    v_row.title,
    v_row.summary,
    jsonb_build_object(
      'origin','intake',
      'intake_id', v_row.id,
      'source_key', v_row.source_key,
      'fingerprint', v_row.fingerprint,
      'url', v_row.url,
      'external_id', v_row.external_id,
      'tags', COALESCE(v_row.payload->'tags', '[]'::jsonb),
      'approved_by', v_uid,
      'approval_reason', left(p_reason, 600),
      'submission_payload', v_row.payload
    ),
    v_row.observed_at
  )
  RETURNING id INTO v_signal_id;

  UPDATE public.gil_signal_intake
     SET status = 'approved',
         reviewed_by = v_uid,
         reviewed_at = now(),
         decision_reason = left(p_reason, 600),
         promoted_signal_id = v_signal_id
   WHERE id = p_intake_id;

  PERFORM public.fn_emit_audit(
    'gil_intake_approved',
    jsonb_build_object(
      'intake_id', p_intake_id,
      'signal_id', v_signal_id,
      'source_key', v_row.source_key,
      'reason', left(p_reason, 600)
    ),
    'governance', p_intake_id::text, 'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'decision','approved',
    'intake_id', p_intake_id,
    'signal_id', v_signal_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_gil_intake_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gil_intake_decide(uuid, text, text) TO authenticated;
