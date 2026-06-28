-- LINTER.BUCKET.B.FUNCTION_SEARCH_PATH.1
DO $$
DECLARE
  r record;
  cnt int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp;',
      r.proname, r.args
    );
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'LINTER.BUCKET.B: hardened % function(s)', cnt;
END
$$;

INSERT INTO public.auto_heal_log (
  trigger_source, action_type, target_type, target_id,
  input_params, result_status, result_detail, metadata
)
VALUES (
  'manual',
  'linter_function_search_path_harden',
  'pg_function',
  'bucket_b_batch_1',
  jsonb_build_object('bucket','function_search_path_mutable'),
  'completed',
  jsonb_build_object('strategy','ALTER FUNCTION SET search_path = public, pg_temp'),
  jsonb_build_object('cut','LINTER.BUCKET.B.FUNCTION_SEARCH_PATH.1','behavior_change',false)
);