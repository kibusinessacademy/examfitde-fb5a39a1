-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 2: job_queue Identity-Felder
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS job_name text,
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS root_job_id uuid;

-- Backfill job_name aus Registry
UPDATE public.job_queue jq
SET job_name = r.job_name
FROM public.ops_job_type_registry r
WHERE jq.job_type = r.job_type
  AND jq.job_name IS NULL;

-- Fallback für unregistrierte job_types
UPDATE public.job_queue
SET job_name = initcap(replace(job_type, '_', ' '))
WHERE job_name IS NULL;

-- Backfill correlation_id: parent_job_id-Kette folgen, sonst self
WITH RECURSIVE chain AS (
  -- Roots: Jobs ohne parent → sind selbst Wurzel
  SELECT id AS job_id, id AS root_id, id AS corr_id
  FROM public.job_queue
  WHERE parent_job_id IS NULL
  UNION ALL
  -- Kinder: erben root_id von Eltern
  SELECT child.id, parent.root_id, parent.corr_id
  FROM public.job_queue child
  JOIN chain parent ON child.parent_job_id = parent.job_id
)
UPDATE public.job_queue jq
SET correlation_id = c.corr_id,
    root_job_id    = c.root_id
FROM chain c
WHERE jq.id = c.job_id
  AND (jq.correlation_id IS NULL OR jq.root_job_id IS NULL);

-- Sicherheitsnetz: für alle übrigen (z.B. zyklische / orphan) → self
UPDATE public.job_queue
SET correlation_id = COALESCE(correlation_id, id),
    root_job_id    = COALESCE(root_job_id, id)
WHERE correlation_id IS NULL OR root_job_id IS NULL;

-- Indizes
CREATE INDEX IF NOT EXISTS idx_job_queue_correlation_id
  ON public.job_queue(correlation_id);

CREATE INDEX IF NOT EXISTS idx_job_queue_root_job_id
  ON public.job_queue(root_job_id);

COMMENT ON COLUMN public.job_queue.job_name IS
  'Menschenlesbarer Name (aus ops_job_type_registry.job_name). Pflicht für Logs/Admin.';
COMMENT ON COLUMN public.job_queue.correlation_id IS
  'Gemeinsame ID für alle Jobs eines logischen Vorgangs (z.B. Package-Build-Kette). Producer SOLL beim Enqueue setzen.';
COMMENT ON COLUMN public.job_queue.root_job_id IS
  'Wurzel-Job der Kette. Bei eigenständigen Jobs == id.';