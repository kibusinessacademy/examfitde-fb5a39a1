
-- ═══════════════════════════════════════════════════════════════
-- BACKUP TABLE for tier1_failed lesson content (reversible)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.lesson_content_backups (
  id bigserial PRIMARY KEY,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  lesson_id uuid NOT NULL,
  package_id uuid NOT NULL,
  old_qc_status text,
  old_content jsonb
);

-- RLS: admin-only via service_role
ALTER TABLE public.lesson_content_backups ENABLE ROW LEVEL SECURITY;
