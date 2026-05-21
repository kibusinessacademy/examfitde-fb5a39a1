
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_packages_package_key_published
  ON public.course_packages (package_key)
  WHERE is_published = true AND package_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_packages_curriculum_published
  ON public.course_packages (curriculum_id)
  WHERE is_published = true;

CREATE OR REPLACE VIEW public.v_canonical_package_drift AS
WITH dup_keys AS (
  SELECT package_key, COUNT(*) AS n, array_agg(id ORDER BY id) AS ids
  FROM public.course_packages WHERE package_key IS NOT NULL
  GROUP BY package_key HAVING COUNT(*) > 1
),
dup_curriculum_published AS (
  SELECT curriculum_id, COUNT(*) AS n, array_agg(id ORDER BY id) AS ids
  FROM public.course_packages WHERE is_published = true
  GROUP BY curriculum_id HAVING COUNT(*) > 1
),
dup_slug_published AS (
  SELECT b.bezeichnung_kurz AS slug, COUNT(DISTINCT cp.id) AS n, array_agg(DISTINCT cp.id) AS ids
  FROM public.course_packages cp
  JOIN public.curricula c ON c.id = cp.curriculum_id
  JOIN public.berufe b ON b.id = c.beruf_id
  WHERE cp.is_published = true AND b.ist_aktiv = true AND b.bezeichnung_kurz IS NOT NULL
  GROUP BY b.bezeichnung_kurz HAVING COUNT(DISTINCT cp.id) > 1
),
null_keys_published AS (SELECT id FROM public.course_packages WHERE is_published = true AND package_key IS NULL)
SELECT 'DUPLICATE_PACKAGE_KEY'::text AS drift_kind, package_key AS key, n AS occurrences, ids FROM dup_keys
UNION ALL SELECT 'DUPLICATE_CURRICULUM_PUBLISHED', curriculum_id::text, n, ids FROM dup_curriculum_published
UNION ALL SELECT 'DUPLICATE_SLUG_PUBLISHED', slug, n, ids FROM dup_slug_published
UNION ALL SELECT 'NULL_PACKAGE_KEY_PUBLISHED', id::text, 1, ARRAY[id] FROM null_keys_published;

REVOKE ALL ON public.v_canonical_package_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_canonical_package_drift TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_canonical_package_drift()
RETURNS TABLE(drift_kind text, key text, occurrences int, ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT d.drift_kind, d.key, d.occurrences::int, d.ids FROM public.v_canonical_package_drift d ORDER BY 1, 2;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_canonical_package_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_canonical_package_drift() TO authenticated, service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('canonical_package_drift_check', ARRAY['drift_kind_counts','total_drift_rows','baseline_clean']::text[], 'seo_p6_cut6a')
ON CONFLICT (action_type) DO UPDATE SET required_keys = EXCLUDED.required_keys, owner_module = EXCLUDED.owner_module;

DO $$
DECLARE v_total int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.v_canonical_package_drift;
  PERFORM public.fn_emit_audit(
    _action_type := 'canonical_package_drift_check',
    _target_type := 'system',
    _target_id := NULL,
    _result_status := CASE WHEN v_total = 0 THEN 'success' ELSE 'warning' END,
    _payload := jsonb_build_object(
      'drift_kind_counts', COALESCE((SELECT jsonb_object_agg(drift_kind, c) FROM (SELECT drift_kind, COUNT(*) c FROM public.v_canonical_package_drift GROUP BY 1) z), '{}'::jsonb),
      'total_drift_rows', v_total,
      'baseline_clean', v_total = 0
    ),
    _trigger_source := 'migration_p6_cut6a',
    _error_message := NULL
  );
END $$;
