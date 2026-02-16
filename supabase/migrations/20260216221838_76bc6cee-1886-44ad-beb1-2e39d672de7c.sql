
-- Backup tracking table
CREATE TABLE IF NOT EXISTS public.backup_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  backup_type text NOT NULL DEFAULT 'scheduled',
  tables_backed_up text[] NOT NULL DEFAULT '{}',
  row_counts jsonb NOT NULL DEFAULT '{}',
  size_estimate_mb numeric,
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  triggered_by text DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backup_snapshots ENABLE ROW LEVEL SECURITY;

-- Only admins can read backup snapshots
CREATE POLICY "Admins can view backups" ON public.backup_snapshots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Service role can insert
CREATE POLICY "Service role inserts backups" ON public.backup_snapshots
  FOR INSERT WITH CHECK (true);

COMMENT ON TABLE public.backup_snapshots IS 'Tracks automated backup snapshots for audit and recovery';
