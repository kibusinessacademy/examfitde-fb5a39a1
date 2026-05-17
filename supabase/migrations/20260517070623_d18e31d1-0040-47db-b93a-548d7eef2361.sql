-- Migration A: P0-2/3/4 Role-level GRANTs (RLS-Policies existieren bereits,
-- aber GRANT auf anon/authenticated fehlte → 401 permission denied).

-- tracking_events: anon + authenticated dürfen schreiben (RLS already restricts)
GRANT INSERT ON public.tracking_events TO anon, authenticated;
GRANT SELECT ON public.tracking_events TO service_role;

-- store_products: public read (RLS already filters is_active=true)
GRANT SELECT ON public.store_products TO anon, authenticated;

-- curriculum_products: public read (RLS already filters is_published=true)
GRANT SELECT ON public.curriculum_products TO anon, authenticated;

-- Allow RPC call for unauthenticated tracking (SECURITY DEFINER already)
GRANT EXECUTE ON FUNCTION public.track_conversion_event_v2(text,jsonb,text,text,text,uuid,text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_conversion_event_v2(text,jsonb,text,text,text,uuid,text,uuid,uuid,text,text) TO anon, authenticated;

-- Audit (writes via legacy direct INSERT until Phase 0 contract lands)
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'public_read_grants_applied',
  'system',
  'success',
  jsonb_build_object(
    'migration', 'journey1_p0_grants',
    'tables', jsonb_build_array('tracking_events','store_products','curriculum_products'),
    'note', 'Closes 401 perm denied on anon tracking + catalog reads',
    'rollback', 'REVOKE INSERT ON tracking_events FROM anon, authenticated; REVOKE SELECT ON store_products, curriculum_products FROM anon, authenticated;'
  )
);

-- Smoke
DO $$
DECLARE
  v_anon_insert boolean;
  v_anon_read_sp boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='tracking_events'
      AND grantee='anon' AND privilege_type='INSERT'
  ) INTO v_anon_insert;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='store_products'
      AND grantee='anon' AND privilege_type='SELECT'
  ) INTO v_anon_read_sp;

  IF NOT v_anon_insert THEN
    RAISE EXCEPTION 'Smoke failed: anon INSERT on tracking_events not granted';
  END IF;
  IF NOT v_anon_read_sp THEN
    RAISE EXCEPTION 'Smoke failed: anon SELECT on store_products not granted';
  END IF;
END $$;