-- ===========================================
-- JOB_QUEUE mit SSOT-Constraints & Guards
-- ===========================================

-- 1. Tabelle erstellen
CREATE TABLE public.job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ DEFAULT now(),
  error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 2. Status-Enum Constraint
ALTER TABLE public.job_queue
ADD CONSTRAINT job_queue_status_enum
CHECK (
  status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')
);

-- 3. Pflicht-Constraint: curriculum_id MUSS im Payload existieren
ALTER TABLE public.job_queue
ADD CONSTRAINT job_queue_payload_has_curriculum_id
CHECK (
  payload ? 'curriculum_id'
);

-- 4. UUID-Validierung für curriculum_id
ALTER TABLE public.job_queue
ADD CONSTRAINT job_queue_payload_curriculum_id_uuid
CHECK (
  (payload->>'curriculum_id')::uuid IS NOT NULL
);

-- 5. Slug-Blacklist im Payload (global verboten)
ALTER TABLE public.job_queue
ADD CONSTRAINT job_queue_payload_no_slugs
CHECK (
  NOT (
    payload ? 'slug'
    OR payload ? 'profession_slug'
    OR payload ? 'curriculum_slug'
    OR payload ? 'curriculumCode'
  )
);

-- 6. Guard-Trigger-Funktion (Hard-Fail)
CREATE OR REPLACE FUNCTION public.guard_job_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  -- Prüfe curriculum_id
  IF NOT (NEW.payload ? 'curriculum_id') THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: job % missing curriculum_id',
      NEW.job_type;
  END IF;

  -- Prüfe verbotene Slug-Felder
  IF NEW.payload ? 'slug'
     OR NEW.payload ? 'profession_slug'
     OR NEW.payload ? 'curriculum_slug'
     OR NEW.payload ? 'curriculumCode'
  THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: slug-based fields are forbidden in job payload (%).',
      NEW.job_type;
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Trigger aktivieren
CREATE TRIGGER trg_guard_job_payload
BEFORE INSERT OR UPDATE ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.guard_job_payload();

-- 8. RLS aktivieren
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies - nur Admins dürfen Jobs verwalten
CREATE POLICY "Admins can manage jobs"
ON public.job_queue
FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- 10. Index für Status-Abfragen (Performance)
CREATE INDEX idx_job_queue_status ON public.job_queue(status);
CREATE INDEX idx_job_queue_run_after ON public.job_queue(run_after) WHERE status = 'pending';