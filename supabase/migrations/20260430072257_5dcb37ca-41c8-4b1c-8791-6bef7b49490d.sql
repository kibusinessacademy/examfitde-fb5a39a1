
-- KPI View: Intents Aggregat letzte 24h
CREATE OR REPLACE VIEW public.v_system_intents_kpi AS
SELECT
  intent_type,
  source,
  COUNT(*) FILTER (WHERE claimed_at IS NULL AND consumed_at IS NULL) AS pending,
  COUNT(*) FILTER (WHERE claimed_at IS NOT NULL AND consumed_at IS NULL) AS claimed_open,
  COUNT(*) FILTER (WHERE claimed_at IS NOT NULL AND consumed_at IS NULL AND claimed_at < now() - interval '15 minutes') AS stuck_claimed,
  COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed,
  COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS created_last_hour,
  COUNT(*) FILTER (WHERE consumed_at > now() - interval '1 hour') AS consumed_last_hour,
  MAX(created_at) AS last_created_at,
  MAX(consumed_at) AS last_consumed_at,
  AVG(EXTRACT(EPOCH FROM (consumed_at - claimed_at))) FILTER (WHERE consumed_at IS NOT NULL AND claimed_at IS NOT NULL) AS avg_processing_seconds
FROM public.system_intents
WHERE created_at > now() - interval '24 hours'
GROUP BY intent_type, source
ORDER BY pending DESC, claimed_open DESC, intent_type;

COMMENT ON VIEW public.v_system_intents_kpi IS 'Phase 2a: KPI für system_intents — pending/claimed/stuck/consumed je intent_type+source der letzten 24h';

-- Stuck-Claimed Detail-View
CREATE OR REPLACE VIEW public.v_system_intents_stuck_claimed AS
SELECT
  id,
  intent_type,
  source,
  package_id,
  claimed_by,
  claimed_at,
  EXTRACT(EPOCH FROM (now() - claimed_at))/60 AS stuck_minutes,
  signature,
  payload
FROM public.system_intents
WHERE claimed_at IS NOT NULL
  AND consumed_at IS NULL
  AND claimed_at < now() - interval '15 minutes'
ORDER BY claimed_at;

COMMENT ON VIEW public.v_system_intents_stuck_claimed IS 'Phase 2a: Worker-Crash-Detection — Intents claimed aber >15min nicht consumed';

-- Idempotenter Tick-Recorder: 1 Intent pro 5-Min-Bucket pro Typ+Source
CREATE OR REPLACE FUNCTION public.cron_record_tick_intent(
  p_intent_type text,
  p_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket text;
  v_signature text;
  v_intent_id uuid;
  v_existing_id uuid;
BEGIN
  -- 5-Min-Bucket: gleicher Bucket = gleiche Signatur = Insert wird durch UNIQUE-Index unterdrückt
  v_bucket := to_char(date_trunc('minute', now()) - (EXTRACT(MINUTE FROM now())::int % 5) * interval '1 minute', 'YYYY-MM-DD HH24:MI');
  v_signature := encode(digest('tick:' || p_intent_type || ':' || COALESCE(p_source,'') || ':' || v_bucket, 'sha256'), 'hex');

  -- Versuche Insert; bei Konflikt (offene Signature existiert schon) gib bestehende ID zurück
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

COMMENT ON FUNCTION public.cron_record_tick_intent IS 'Phase 2a: Idempotenter Cron-Tick-Recorder. 1 Intent pro 5-Min-Bucket pro intent_type+source. Verhindert Mehrfach-Triggering.';

GRANT EXECUTE ON FUNCTION public.cron_record_tick_intent TO service_role, authenticated;
GRANT SELECT ON public.v_system_intents_kpi TO service_role, authenticated;
GRANT SELECT ON public.v_system_intents_stuck_claimed TO service_role, authenticated;
