
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_factory_intake_per_curriculum
ON public.factory_intake_queue (curriculum_id)
WHERE intake_status IN ('detected', 'evaluated', 'planned', 'queued');
