-- Create backup storage bucket (private, 50MB file limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('backups', 'backups', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- RLS: only service_role can access backups
CREATE POLICY "backups_service_only_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'backups' AND false);

CREATE POLICY "backups_service_only_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'backups' AND false);

CREATE POLICY "backups_deny_anon_select"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'backups' AND false);

CREATE POLICY "backups_deny_anon_insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'backups' AND false);