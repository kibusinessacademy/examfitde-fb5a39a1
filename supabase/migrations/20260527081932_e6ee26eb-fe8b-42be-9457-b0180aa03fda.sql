
-- ============================================================
-- Cut 2.1 — Business Intent Layer (corrected for ops_audit_contract schema)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.business_intent_risk_level AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.business_intent_governance_level AS ENUM ('standard','sensitive','regulated','board_approval');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.business_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key text NOT NULL UNIQUE,
  vertical_key text NOT NULL,
  title text NOT NULL,
  goal text NOT NULL,
  target_kpi_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  monetary_impact_eur numeric(14,2),
  risk_level public.business_intent_risk_level NOT NULL DEFAULT 'medium',
  governance_level public.business_intent_governance_level NOT NULL DEFAULT 'standard',
  no_go_constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  desired_transformation text,
  owner_actor_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_business_intents_vertical ON public.business_intents(vertical_key);
CREATE INDEX IF NOT EXISTS idx_business_intents_active ON public.business_intents(is_active);

GRANT ALL ON public.business_intents TO service_role;

ALTER TABLE public.business_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read business intents" ON public.business_intents;
CREATE POLICY "Admins can read business intents"
  ON public.business_intents FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role full access" ON public.business_intents;
CREATE POLICY "Service role full access"
  ON public.business_intents FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_business_intents_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_business_intents_touch_updated ON public.business_intents;
CREATE TRIGGER trg_business_intents_touch_updated
  BEFORE UPDATE ON public.business_intents
  FOR EACH ROW EXECUTE FUNCTION public.fn_business_intents_touch_updated();

ALTER TABLE public.agent_outcome_bundles
  ADD COLUMN IF NOT EXISTS business_intent_id uuid
  REFERENCES public.business_intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aob_business_intent ON public.agent_outcome_bundles(business_intent_id);

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('business_intent_registered',
    ARRAY['intent_id','intent_key','vertical_key','actor_id'],
    'berufagentos_v2'),
  ('business_intent_updated',
    ARRAY['intent_id','intent_key','actor_id','changed_fields'],
    'berufagentos_v2'),
  ('bundle_linked_to_intent',
    ARRAY['bundle_id','intent_id','intent_key','actor_id'],
    'berufagentos_v2')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_register_business_intent(
  _intent_key text,
  _vertical_key text,
  _title text,
  _goal text,
  _target_kpi jsonb DEFAULT '[]'::jsonb,
  _monetary_impact_eur numeric DEFAULT NULL,
  _risk_level text DEFAULT 'medium',
  _governance_level text DEFAULT 'standard',
  _no_go_constraints jsonb DEFAULT '[]'::jsonb,
  _target_audience jsonb DEFAULT '{}'::jsonb,
  _desired_transformation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_intent_id uuid;
  v_existing uuid;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF _intent_key IS NULL OR length(trim(_intent_key)) < 3 THEN
    RAISE EXCEPTION 'invalid_intent_key';
  END IF;
  IF _goal IS NULL OR length(trim(_goal)) < 8 THEN
    RAISE EXCEPTION 'goal_too_short';
  END IF;

  SELECT id INTO v_existing FROM public.business_intents WHERE intent_key = _intent_key;

  IF v_existing IS NOT NULL THEN
    UPDATE public.business_intents SET
      vertical_key = _vertical_key,
      title = _title,
      goal = _goal,
      target_kpi_json = COALESCE(_target_kpi,'[]'::jsonb),
      monetary_impact_eur = _monetary_impact_eur,
      risk_level = _risk_level::public.business_intent_risk_level,
      governance_level = _governance_level::public.business_intent_governance_level,
      no_go_constraints = COALESCE(_no_go_constraints,'[]'::jsonb),
      target_audience = COALESCE(_target_audience,'{}'::jsonb),
      desired_transformation = _desired_transformation
    WHERE id = v_existing;
    v_intent_id := v_existing;
    PERFORM public.fn_emit_audit(
      'business_intent_updated',
      jsonb_build_object(
        'intent_id', v_intent_id,
        'intent_key', _intent_key,
        'actor_id', v_actor,
        'changed_fields', jsonb_build_array('upsert')
      )
    );
  ELSE
    INSERT INTO public.business_intents (
      intent_key, vertical_key, title, goal, target_kpi_json,
      monetary_impact_eur, risk_level, governance_level,
      no_go_constraints, target_audience, desired_transformation, created_by
    ) VALUES (
      _intent_key, _vertical_key, _title, _goal, COALESCE(_target_kpi,'[]'::jsonb),
      _monetary_impact_eur, _risk_level::public.business_intent_risk_level,
      _governance_level::public.business_intent_governance_level,
      COALESCE(_no_go_constraints,'[]'::jsonb),
      COALESCE(_target_audience,'{}'::jsonb), _desired_transformation, v_actor
    ) RETURNING id INTO v_intent_id;
    PERFORM public.fn_emit_audit(
      'business_intent_registered',
      jsonb_build_object(
        'intent_id', v_intent_id,
        'intent_key', _intent_key,
        'vertical_key', _vertical_key,
        'actor_id', v_actor
      )
    );
  END IF;

  RETURN jsonb_build_object('intent_id', v_intent_id, 'intent_key', _intent_key);
END $$;

REVOKE ALL ON FUNCTION public.admin_register_business_intent(text,text,text,text,jsonb,numeric,text,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_business_intent(text,text,text,text,jsonb,numeric,text,text,jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_business_intents(
  _vertical_key text DEFAULT NULL,
  _active_only boolean DEFAULT true,
  _limit int DEFAULT 200
)
RETURNS TABLE(
  id uuid, intent_key text, vertical_key text, title text, goal text,
  target_kpi_json jsonb, monetary_impact_eur numeric,
  risk_level text, governance_level text,
  no_go_constraints jsonb, target_audience jsonb,
  desired_transformation text, is_active boolean,
  linked_bundle_count bigint, last_bundle_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  RETURN QUERY
  SELECT
    bi.id, bi.intent_key, bi.vertical_key, bi.title, bi.goal,
    bi.target_kpi_json, bi.monetary_impact_eur,
    bi.risk_level::text, bi.governance_level::text,
    bi.no_go_constraints, bi.target_audience,
    bi.desired_transformation, bi.is_active,
    COALESCE(b.cnt, 0) AS linked_bundle_count,
    b.last_at AS last_bundle_at,
    bi.created_at, bi.updated_at
  FROM public.business_intents bi
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_at
    FROM public.agent_outcome_bundles aob
    WHERE aob.business_intent_id = bi.id
  ) b ON true
  WHERE (_vertical_key IS NULL OR bi.vertical_key = _vertical_key)
    AND (NOT _active_only OR bi.is_active = true)
  ORDER BY bi.updated_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 500));
END $$;

REVOKE ALL ON FUNCTION public.admin_list_business_intents(text,boolean,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_business_intents(text,boolean,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_link_bundle_to_intent(
  _bundle_id uuid,
  _intent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_intent_key text;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  SELECT intent_key INTO v_intent_key FROM public.business_intents WHERE id = _intent_id;
  IF v_intent_key IS NULL THEN
    RAISE EXCEPTION 'intent_not_found';
  END IF;
  UPDATE public.agent_outcome_bundles
    SET business_intent_id = _intent_id
  WHERE id = _bundle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bundle_not_found';
  END IF;
  PERFORM public.fn_emit_audit(
    'bundle_linked_to_intent',
    jsonb_build_object(
      'bundle_id', _bundle_id,
      'intent_id', _intent_id,
      'intent_key', v_intent_key,
      'actor_id', v_actor
    )
  );
  RETURN jsonb_build_object('bundle_id', _bundle_id, 'intent_id', _intent_id, 'intent_key', v_intent_key);
END $$;

REVOKE ALL ON FUNCTION public.admin_link_bundle_to_intent(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_link_bundle_to_intent(uuid,uuid) TO authenticated;
