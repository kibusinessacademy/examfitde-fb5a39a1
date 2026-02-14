
-- ============================================================
-- Storage Governance v1: Private Buckets + Entitlement-Gated Access
-- ============================================================

-- 1) Make buckets private
UPDATE storage.buckets SET public = false WHERE id IN ('h5p-content', 'course-media');

-- 2) Drop old permissive policies
DROP POLICY IF EXISTS "Anyone can view h5p content" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view course media" ON storage.objects;

-- 3) Entitlement-gated SELECT policies for authenticated users
CREATE POLICY "Entitled users can view h5p content"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'h5p-content'
    AND EXISTS (
      SELECT 1 FROM public.entitlements e
      WHERE e.user_id = auth.uid()
        AND e.valid_until > now()
    )
  );

CREATE POLICY "Entitled users can view course media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'course-media'
    AND EXISTS (
      SELECT 1 FROM public.entitlements e
      WHERE e.user_id = auth.uid()
        AND e.valid_until > now()
    )
  );

-- 4) Admin policies already exist (from earlier migration) - skip

-- 5) RPC for edge function entitlement check (curriculum-based)
CREATE OR REPLACE FUNCTION public.has_storage_entitlement(
  p_user_id uuid,
  p_curriculum_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_curriculum_id IS NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM entitlements
      WHERE user_id = p_user_id
        AND valid_until > now()
    );
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM entitlements
    WHERE user_id = p_user_id
      AND curriculum_id = p_curriculum_id
      AND valid_until > now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_storage_entitlement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_storage_entitlement(uuid, uuid) TO authenticated;
