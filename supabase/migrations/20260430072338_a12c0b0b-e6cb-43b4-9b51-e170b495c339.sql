
CREATE OR REPLACE FUNCTION public.cron_record_tick_intent(
  p_intent_type text,
  p_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bucket text;
  v_signature text;
  v_intent_id uuid;
  v_existing_id uuid;
BEGIN
  v_bucket := to_char(date_trunc('minute', now()) - (EXTRACT(MINUTE FROM now())::int % 5) * interval '1 minute', 'YYYY-MM-DD HH24:MI');
  v_signature := encode(extensions.digest('tick:' || p_intent_type || ':' || COALESCE(p_source,'') || ':' || v_bucket, 'sha256'), 'hex');

  INSERT INTO public.system_intents (intent_type, signature, source, payload, priority)
  VALUES (
    p_intent_type,
    v_signature,
    p_source,
    jsonb_build_object('bucket', v_bucket, 'recorded_at', now()),
    100
  )
  ON CONFLICT (signature) WHERE consumed_at IS NULL
  DO NOTHING
  RETURNING id INTO v_intent_id;

  IF v_intent_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM public.system_intents
    WHERE signature = v_signature AND consumed_at IS NULL
    LIMIT 1;
    RETURN jsonb_build_object('status', 'already_recorded', 'intent_id', v_existing_id, 'bucket', v_bucket);
  END IF;

  RETURN jsonb_build_object('status', 'recorded', 'intent_id', v_intent_id, 'bucket', v_bucket);
END;
$$;
