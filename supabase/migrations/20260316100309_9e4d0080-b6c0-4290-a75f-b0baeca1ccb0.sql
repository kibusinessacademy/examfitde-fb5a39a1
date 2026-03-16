
CREATE TABLE public.daily_ops_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL UNIQUE,
  report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  trigger_source text NOT NULL DEFAULT 'cron'
);

ALTER TABLE public.daily_ops_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read daily ops reports"
  ON public.daily_ops_reports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
