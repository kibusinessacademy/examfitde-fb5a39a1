
-- 1) Storage policy: restrict standalone-bundles bucket to service_role only
DROP POLICY IF EXISTS "Service role can manage standalone bundles" ON storage.objects;
CREATE POLICY "Service role can manage standalone bundles"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (bucket_id = 'standalone-bundles' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'standalone-bundles' AND auth.role() = 'service_role');

-- 2) Restrict SSO login event inserts to service_role / admins only
DROP POLICY IF EXISTS "System can insert SSO events" ON public.sso_login_events;
CREATE POLICY "Service role inserts SSO events"
  ON public.sso_login_events
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3) Restrict license event inserts to admins (service_role bypasses RLS)
DROP POLICY IF EXISTS "System inserts license events" ON public.work_license_events;
CREATE POLICY "Service role inserts license events"
  ON public.work_license_events
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4) Add admin-only storage policies for private buckets (defense-in-depth)
CREATE POLICY "Admins can read evidence-packs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'evidence-packs' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role manages evidence-packs"
  ON storage.objects FOR ALL TO public
  USING (bucket_id = 'evidence-packs' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'evidence-packs' AND auth.role() = 'service_role');

CREATE POLICY "Admins can read private-source-documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'private-source-documents' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role manages private-source-documents"
  ON storage.objects FOR ALL TO public
  USING (bucket_id = 'private-source-documents' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'private-source-documents' AND auth.role() = 'service_role');
