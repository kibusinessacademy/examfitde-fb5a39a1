
CREATE TABLE IF NOT EXISTS public.sellable_content_blocker_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger_source text NOT NULL DEFAULT 'manual',
  dry_run boolean NOT NULL DEFAULT true,
  lanes text[] NOT NULL DEFAULT ARRAY['A','B','C']::text[],
  cap integer NOT NULL DEFAULT 100,
  before_snapshot jsonb,
  after_snapshot jsonb,
  actions jsonb,
  delta_sellable integer,
  delta_blockers integer,
  remaining_blocker_count integer,
  status text NOT NULL DEFAULT 'running',
  error text
);
GRANT SELECT ON public.sellable_content_blocker_runs TO authenticated;
GRANT ALL ON public.sellable_content_blocker_runs TO service_role;
ALTER TABLE public.sellable_content_blocker_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read blocker runs"
  ON public.sellable_content_blocker_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "service manages blocker runs"
  ON public.sellable_content_blocker_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_sellable_blocker_runs_started ON public.sellable_content_blocker_runs (started_at DESC);
