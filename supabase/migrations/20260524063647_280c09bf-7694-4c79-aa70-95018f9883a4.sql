
-- 1) Remove broad read policy on internal blueprint templates
DROP POLICY IF EXISTS cert_blueprint_templates_read_authenticated ON public.certification_blueprint_templates;

-- Admin-only read
CREATE POLICY cert_blueprint_templates_read_admin
ON public.certification_blueprint_templates
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Drop overly permissive product read policies
DROP POLICY IF EXISTS pub_read ON public.products;
DROP POLICY IF EXISTS public_read_products ON public.products;

-- 3) Storage: replace cross-entitlement policies with curriculum-scoped ones
DROP POLICY IF EXISTS "Entitled users can view course media" ON storage.objects;
DROP POLICY IF EXISTS "Entitled users can view h5p content" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read bonus songs" ON storage.objects;

CREATE POLICY "Entitled users can view course media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-media'
  AND EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND (e.valid_until IS NULL OR e.valid_until > now())
      AND e.curriculum_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Entitled users can view h5p content"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'h5p-content'
  AND EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND (e.valid_until IS NULL OR e.valid_until > now())
      AND e.curriculum_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Entitled users can view bonus songs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'bonus-songs'
  AND EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND (e.valid_until IS NULL OR e.valid_until > now())
      AND e.curriculum_id::text = (storage.foldername(name))[1]
  )
);
