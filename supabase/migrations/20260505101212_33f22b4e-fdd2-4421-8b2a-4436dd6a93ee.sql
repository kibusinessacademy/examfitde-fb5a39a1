-- Idempotente Tagespick-Funktion
CREATE OR REPLACE FUNCTION public.fn_ensure_daily_humor_pick(p_day date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT humor_id INTO v_id FROM humor_daily_pick
   WHERE day = p_day AND pick_key = 'daily' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT id INTO v_id FROM humor_items
   WHERE status = 'approved'
   ORDER BY md5(p_day::text || id::text) -- deterministisch pro Tag
   LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO humor_daily_pick(day, pick_key, humor_id)
  VALUES (p_day, 'daily', v_id)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_ensure_daily_humor_pick(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ensure_daily_humor_pick(date) TO service_role;

-- Sofort befüllen für heute + die letzten 7 Tage (für Backfill)
DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - 7, CURRENT_DATE, '1 day')::date LOOP
    PERFORM public.fn_ensure_daily_humor_pick(d);
  END LOOP;
END $$;

-- Täglicher Cron 05:10 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='daily-humor-pick') THEN
    PERFORM cron.unschedule('daily-humor-pick');
  END IF;
  PERFORM cron.schedule(
    'daily-humor-pick', '10 5 * * *',
    $job$ SELECT public.fn_ensure_daily_humor_pick(CURRENT_DATE); $job$
  );
END $$;