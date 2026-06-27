
CREATE TABLE public.store_ops_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_version text NOT NULL,
  health_score integer NOT NULL,
  summary jsonb NOT NULL,
  platform_split jsonb NOT NULL,
  risk_distribution jsonb NOT NULL,
  bottlenecks jsonb NOT NULL,
  top_blockers jsonb NOT NULL,
  top_rejection_reasons jsonb NOT NULL,
  recommended_actions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_ops_kpi_snapshots TO authenticated;
GRANT ALL ON public.store_ops_kpi_snapshots TO service_role;

ALTER TABLE public.store_ops_kpi_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_ops_kpi_snapshots_admin_read"
  ON public.store_ops_kpi_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "store_ops_kpi_snapshots_service_write"
  ON public.store_ops_kpi_snapshots
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_store_ops_kpi_snapshots_created_at
  ON public.store_ops_kpi_snapshots (created_at DESC);
