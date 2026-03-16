
-- Enqueue ONE council job per package (the worker processes all sessions)
INSERT INTO public.job_queue (
  job_type, package_id, status, priority,
  payload, meta, max_attempts, created_at, updated_at
)
VALUES
  (
    'quality_council',
    '7feb726e-f699-4d42-9cbc-970a650d00a5',
    'pending', 5,
    '{"package_id":"7feb726e-f699-4d42-9cbc-970a650d00a5","curriculum_id":"63635f46-0186-49e7-80c1-67925dbdf638"}'::jsonb,
    '{"source":"remediation_2026_03_16"}'::jsonb,
    3, now(), now()
  ),
  (
    'quality_council',
    'd173ff82-6ab7-4853-a5c2-ad57254c7dce',
    'pending', 5,
    '{"package_id":"d173ff82-6ab7-4853-a5c2-ad57254c7dce","curriculum_id":"7d72d436-db9b-4b22-bda8-fd7c764ae7eb"}'::jsonb,
    '{"source":"remediation_2026_03_16"}'::jsonb,
    3, now(), now()
  )
ON CONFLICT DO NOTHING;
