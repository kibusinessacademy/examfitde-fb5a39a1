
-- BerufsKI Premium Engine: Storage Bucket für Assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('berufski-assets', 'berufski-assets', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for berufski-assets: service_role only (signed URLs for delivery)
CREATE POLICY "berufski_assets_service_only_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'berufski-assets' AND (SELECT auth.role()) = 'service_role');

CREATE POLICY "berufski_assets_service_only_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'berufski-assets' AND (SELECT auth.role()) = 'service_role');

CREATE POLICY "berufski_assets_service_only_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'berufski-assets' AND (SELECT auth.role()) = 'service_role');

CREATE POLICY "berufski_assets_service_only_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'berufski-assets' AND (SELECT auth.role()) = 'service_role');
