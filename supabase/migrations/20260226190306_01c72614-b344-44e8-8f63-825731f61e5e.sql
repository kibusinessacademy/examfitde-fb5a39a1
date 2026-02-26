
-- Drop old function with wrong param name, then recreate
DROP FUNCTION IF EXISTS public.set_idempotency_response(uuid,text,text,jsonb);

-- Also drop get if it exists with wrong column reference
DROP FUNCTION IF EXISTS public.get_idempotency_response(uuid,text,text);

-- 1) Tables (idempotent)
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  action_key text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_rate_limits_user_action_window_uniq UNIQUE (user_id, action_key, window_start)
);
CREATE INDEX IF NOT EXISTS api_rate_limits_user_action_idx ON public.api_rate_limits (user_id, action_key);
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='api_rate_limits' AND policyname='service_only_api_rate_limits') THEN
    CREATE POLICY "service_only_api_rate_limits" ON public.api_rate_limits FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.oral_exam_turns (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL,
  question_id uuid NULL,
  user_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('ask','followup','evaluate','finish')),
  role text NOT NULL CHECK (role IN ('examiner','learner')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_blueprint_id uuid NULL,
  source_blueprint_question text NULL,
  rendered_question text NULL,
  rendering_model text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oral_exam_turns_session_idx ON public.oral_exam_turns (session_id, created_at);
ALTER TABLE public.oral_exam_turns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='oral_exam_turns' AND policyname='service_only_oral_exam_turns') THEN
    CREATE POLICY "service_only_oral_exam_turns" ON public.oral_exam_turns FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE public.oral_exam_turns FROM PUBLIC, anon, authenticated;

-- Fix idempotency_keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='idempotency_keys' AND column_name='updated_at' AND table_schema='public') THEN
    ALTER TABLE public.idempotency_keys ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_user_endpoint_key_uniq') THEN
    ALTER TABLE public.idempotency_keys ADD CONSTRAINT idempotency_keys_user_endpoint_key_uniq UNIQUE (user_id, endpoint, idempotency_key);
  END IF;
END $$;
REVOKE ALL ON TABLE public.idempotency_keys FROM PUBLIC, anon, authenticated;

-- 2) RPCs

CREATE OR REPLACE FUNCTION public.check_rate_limit_oral(
  p_user_id uuid, p_action_key text, p_window_seconds int, p_max_requests int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bucket timestamptz; v_count int;
BEGIN
  v_bucket := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO public.api_rate_limits (user_id, action_key, window_start, request_count, updated_at)
  VALUES (p_user_id, p_action_key, v_bucket, 1, now())
  ON CONFLICT (user_id, action_key, window_start)
  DO UPDATE SET request_count = public.api_rate_limits.request_count + 1, updated_at = now()
  RETURNING request_count INTO v_count;
  IF v_count > p_max_requests THEN
    RETURN jsonb_build_object('ok', false, 'retry_after_sec', p_window_seconds - extract(epoch FROM (now() - v_bucket))::int, 'current_count', v_count, 'limit', p_max_requests);
  END IF;
  RETURN jsonb_build_object('ok', true, 'current_count', v_count, 'limit', p_max_requests);
END; $$;
REVOKE ALL ON FUNCTION public.check_rate_limit_oral(uuid,text,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_oral(uuid,text,int,int) TO service_role;

CREATE OR REPLACE FUNCTION public.get_idempotency_response(
  p_user_id uuid, p_endpoint text, p_idem_key text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT response_json FROM public.idempotency_keys
  WHERE user_id = p_user_id AND endpoint = p_endpoint AND idempotency_key = p_idem_key LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_idempotency_response(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_idempotency_response(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_idempotency_response(
  p_user_id uuid, p_endpoint text, p_idem_key text, p_response jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.idempotency_keys (user_id, endpoint, idempotency_key, response_json, created_at, updated_at)
  VALUES (p_user_id, p_endpoint, p_idem_key, p_response, now(), now())
  ON CONFLICT (user_id, endpoint, idempotency_key)
  DO UPDATE SET response_json = EXCLUDED.response_json, updated_at = now();
END; $$;
REVOKE ALL ON FUNCTION public.set_idempotency_response(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_idempotency_response(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.log_oral_exam_turn(
  p_session_id uuid, p_question_id uuid, p_user_id uuid, p_phase text, p_role text,
  p_payload jsonb, p_source_blueprint_id uuid, p_source_blueprint_question text,
  p_rendered_question text, p_rendering_model text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.oral_exam_turns (session_id, question_id, user_id, phase, role, payload_json,
    source_blueprint_id, source_blueprint_question, rendered_question, rendering_model)
  VALUES (p_session_id, p_question_id, p_user_id, p_phase, p_role, COALESCE(p_payload,'{}'::jsonb),
    p_source_blueprint_id, p_source_blueprint_question, p_rendered_question, p_rendering_model);
END; $$;
REVOKE ALL ON FUNCTION public.log_oral_exam_turn(uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_oral_exam_turn(uuid,uuid,uuid,text,text,jsonb,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_oral_exam_ephemeral()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.idempotency_keys WHERE created_at < now() - interval '24 hours';
  DELETE FROM public.api_rate_limits WHERE window_start < now() - interval '2 hours';
END; $$;
REVOKE ALL ON FUNCTION public.cleanup_oral_exam_ephemeral() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_oral_exam_ephemeral() TO service_role;

-- Sequence grants
GRANT USAGE, SELECT ON SEQUENCE public.api_rate_limits_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.oral_exam_turns_id_seq TO service_role;
