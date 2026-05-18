
CREATE TABLE IF NOT EXISTS public.activation_nudge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  package_id uuid,
  stage text NOT NULL,
  nudge_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned','dispatched','skipped','suppressed')),
  skip_reason text,
  blocked_reason text,
  channel_hint text,
  dedupe_key text NOT NULL,
  planned_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_nudge_dedupe
  ON public.activation_nudge_events(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_activation_nudge_grant_recent
  ON public.activation_nudge_events(grant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activation_nudge_status
  ON public.activation_nudge_events(status, created_at DESC);

ALTER TABLE public.activation_nudge_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activation_nudge_admin_read ON public.activation_nudge_events;
CREATE POLICY activation_nudge_admin_read ON public.activation_nudge_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.activation_nudge_events FROM PUBLIC, anon;
GRANT SELECT ON public.activation_nudge_events TO authenticated;
GRANT ALL ON public.activation_nudge_events TO service_role;

CREATE OR REPLACE FUNCTION public.fn_classify_activation_nudge(_stage text, _blocked_reason text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _blocked_reason = 'no_first_value_after_24h' THEN 'inactive_24h'
    WHEN _stage = 'grant_created' THEN 'welcome_not_started'
    WHEN _stage IN ('welcome_seen','first_minicheck_started') THEN 'first_task_missing'
    WHEN _stage = 'first_minicheck_completed' THEN 'aha_missing'
    WHEN _stage = 'aha_completed' THEN 'plan_missing'
    ELSE 'none'
  END
$$;

CREATE OR REPLACE FUNCTION public.fn_activation_nudge_dedupe_key(_grant_id uuid, _stage text, _nudge_type text, _at timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT _grant_id::text || ':' || _stage || ':' || _nudge_type || ':'
       || to_char(date_trunc('hour', _at) - make_interval(hours => (EXTRACT(hour FROM _at)::int % 6)), 'YYYYMMDDHH24')
$$;

CREATE OR REPLACE FUNCTION public.admin_preview_activation_nudges(_window_hours int DEFAULT 48, _limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _result jsonb;
  _cutoff timestamptz := now() - make_interval(hours => GREATEST(_window_hours, 1));
  _lim int := LEAST(GREATEST(_limit, 1), 200);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH stale AS (
    SELECT * FROM public.v_activation_assurance_ssot
    WHERE paid_at >= _cutoff AND is_stale_activation = true
    ORDER BY paid_at DESC
    LIMIT _lim
  ),
  planned AS (
    SELECT s.*,
      public.fn_classify_activation_nudge(s.current_stage, s.blocked_reason) AS nudge_type,
      public.fn_activation_nudge_dedupe_key(
        s.grant_id, s.current_stage,
        public.fn_classify_activation_nudge(s.current_stage, s.blocked_reason),
        now()
      ) AS dedupe_key
    FROM stale s
  ),
  enriched AS (
    SELECT p.*, e.id AS existing_event_id, e.status AS existing_status, e.created_at AS existing_at
    FROM planned p
    LEFT JOIN public.activation_nudge_events e ON e.dedupe_key = p.dedupe_key
  )
  SELECT jsonb_build_object(
    'window_hours', _window_hours,
    'fetched_at', now(),
    'total', (SELECT COUNT(*) FROM enriched),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'grant_id', grant_id,
        'package_id', package_id,
        'package_key', package_key,
        'track', track,
        'learner_ref', 'user_' || substr(encode(digest(user_id::text,'sha256'),'hex'),1,10),
        'current_stage', current_stage,
        'blocked_reason', blocked_reason,
        'nudge_type', nudge_type,
        'dedupe_key', dedupe_key,
        'minutes_since_grant', round(minutes_since_grant::numeric, 1),
        'idempotency_state', CASE
          WHEN existing_event_id IS NULL THEN 'eligible'
          WHEN existing_status = 'dispatched' THEN 'already_dispatched'
          WHEN existing_status = 'planned' THEN 'already_planned'
          ELSE existing_status
        END,
        'existing_event_id', existing_event_id,
        'existing_at', existing_at
      ) ORDER BY minutes_since_grant DESC) FROM enriched
    ), '[]'::jsonb)
  ) INTO _result;

  BEGIN
    PERFORM public.fn_emit_audit('activation_nudge_preview_viewed',
      jsonb_build_object('window_hours', _window_hours, 'total', _result->'total'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_preview_activation_nudges(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_activation_nudges(int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_dispatch_activation_nudge(
  _grant_id uuid, _reason text, _dry_run boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record;
  _nudge_type text;
  _dedupe text;
  _existing record;
  _inserted_id uuid;
  _actor uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_actor, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 4 THEN
    RAISE EXCEPTION 'reason required (min 4 chars)';
  END IF;

  SELECT * INTO _row FROM public.v_activation_assurance_ssot WHERE grant_id = _grant_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','skipped','skip_reason','grant_not_found','grant_id',_grant_id);
  END IF;

  IF NOT _row.is_stale_activation THEN
    RETURN jsonb_build_object('status','skipped','skip_reason','not_stale','current_stage',_row.current_stage);
  END IF;

  _nudge_type := public.fn_classify_activation_nudge(_row.current_stage, _row.blocked_reason);
  IF _nudge_type = 'none' THEN
    RETURN jsonb_build_object('status','skipped','skip_reason','no_applicable_nudge','current_stage',_row.current_stage);
  END IF;

  _dedupe := public.fn_activation_nudge_dedupe_key(_grant_id, _row.current_stage, _nudge_type, now());

  SELECT * INTO _existing FROM public.activation_nudge_events WHERE dedupe_key = _dedupe LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','skipped','skip_reason','idempotent_duplicate',
      'existing_event_id', _existing.id, 'existing_status', _existing.status, 'dedupe_key', _dedupe);
  END IF;

  IF _dry_run THEN
    RETURN jsonb_build_object('status','dry_run','would_insert', true,
      'grant_id', _grant_id, 'stage', _row.current_stage, 'nudge_type', _nudge_type, 'dedupe_key', _dedupe);
  END IF;

  INSERT INTO public.activation_nudge_events(
    grant_id, user_id, package_id, stage, nudge_type, status,
    blocked_reason, channel_hint, dedupe_key, meta, created_by
  ) VALUES (
    _grant_id, _row.user_id, _row.package_id, _row.current_stage, _nudge_type, 'planned',
    _row.blocked_reason, 'inapp', _dedupe,
    jsonb_build_object('reason', _reason, 'minutes_since_grant', round(_row.minutes_since_grant::numeric, 1)),
    _actor
  ) RETURNING id INTO _inserted_id;

  BEGIN
    PERFORM public.fn_emit_audit('activation_nudge_dispatched',
      jsonb_build_object('event_id', _inserted_id, 'nudge_type', _nudge_type,
        'stage', _row.current_stage, 'dedupe_key', _dedupe, 'reason', _reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('status','planned','event_id', _inserted_id,
    'stage', _row.current_stage, 'nudge_type', _nudge_type, 'dedupe_key', _dedupe);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_activation_nudge(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_activation_nudge(uuid, text, boolean) TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.ops_audit_contract') IS NOT NULL THEN
    INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
    VALUES
      ('activation_nudge_preview_viewed', ARRAY['window_hours','total'], 'activation_cut_1d'),
      ('activation_nudge_dispatched', ARRAY['event_id','nudge_type','stage','dedupe_key','reason'], 'activation_cut_1d'),
      ('activation_nudge_skipped', ARRAY['skip_reason'], 'activation_cut_1d')
    ON CONFLICT (action_type) DO NOTHING;
  END IF;
END $$;
