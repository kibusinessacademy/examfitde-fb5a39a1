-- =====================================================
-- STORAGE.RLS.REALITY.AUDIT — Phase 2.0 Scaffolding
-- Tenant-Reality Attacks (Synth-only)
-- =====================================================

-- 1. Attack class registry
CREATE TABLE IF NOT EXISTS public.storage_attack_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  phase text NOT NULL DEFAULT '2.0',
  default_severity text NOT NULL DEFAULT 'high'
    CHECK (default_severity IN ('low','medium','high','critical')),
  enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT true,
  synth_only boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.storage_attack_classes TO authenticated;
GRANT ALL ON public.storage_attack_classes TO service_role;

ALTER TABLE public.storage_attack_classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read attack classes"
  ON public.storage_attack_classes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins manage attack classes"
  ON public.storage_attack_classes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_storage_attack_classes_updated_at
  BEFORE UPDATE ON public.storage_attack_classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Seed Phase 2.0 attack classes (kill-switch ON, enabled OFF)
INSERT INTO public.storage_attack_classes
  (class_key, display_name, description, phase, default_severity, enabled, kill_switch, synth_only)
VALUES
  ('cross_tenant_object',
   'Cross-Tenant Object Access',
   'Synth Tenant A JWT versucht direkten Object-Read in Tenant-B-Pfad. Erwartung: 403/404.',
   '2.0', 'critical', false, true, true),
  ('signed_url_replay',
   'Signed-URL Cross-Context Replay',
   'Signed URL aus Tenant-A-Kontext wird in Tenant-B-Session/Header-Spoof verwendet. Erwartung: kein Cross-Context-Bypass.',
   '2.0', 'critical', false, true, true),
  ('path_enumeration',
   'Path Enumeration / Listing Drift',
   'list() mit fremden Tenant-Prefixes unter realistischen Policies. Erwartung: leeres Listing.',
   '2.0', 'high', false, true, true),
  ('idor_object_id',
   'IDOR auf bekannte Objekt-IDs',
   'Deterministische {tenant}/{resource}/{id}-Pfade werden cross-tenant geraten. Erwartung: 403/404.',
   '2.0', 'high', false, true, true)
ON CONFLICT (class_key) DO NOTHING;

-- 3. Extend storage_attack_run_results (additive, idempotent)
ALTER TABLE public.storage_attack_run_results
  ADD COLUMN IF NOT EXISTS attack_class text,
  ADD COLUMN IF NOT EXISTS synth_tenant_a text,
  ADD COLUMN IF NOT EXISTS synth_tenant_b text;

CREATE INDEX IF NOT EXISTS idx_storage_attack_run_results_attack_class
  ON public.storage_attack_run_results(attack_class);

-- 4. Helper: is this attack class runnable right now?
CREATE OR REPLACE FUNCTION public.fn_storage_attack_class_enabled(_class_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.storage_attack_classes
    WHERE class_key = _class_key
      AND enabled = true
      AND kill_switch = false
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_storage_attack_class_enabled(text) TO authenticated, service_role;

-- 5. Aggregation view: findings per attack_class × content_class
CREATE OR REPLACE VIEW public.v_admin_storage_attack_by_class AS
SELECT
  r.attack_class,
  COALESCE(f.content_class, 'unknown') AS content_class,
  COUNT(*) FILTER (WHERE f.severity = 'critical') AS critical_count,
  COUNT(*) FILTER (WHERE f.severity = 'high')     AS high_count,
  COUNT(*) FILTER (WHERE f.severity = 'medium')   AS medium_count,
  COUNT(*) FILTER (WHERE f.severity = 'low')      AS low_count,
  COUNT(*) AS total_findings,
  SUM(
    CASE f.severity
      WHEN 'critical' THEN 10
      WHEN 'high'     THEN 5
      WHEN 'medium'   THEN 2
      WHEN 'low'      THEN 1
      ELSE 0
    END
  ) AS risk_score,
  MAX(r.created_at) AS last_seen_at
FROM public.storage_attack_run_results r
LEFT JOIN public.storage_rls_audit_findings f
  ON f.run_id = r.run_id
WHERE r.attack_class IS NOT NULL
GROUP BY r.attack_class, COALESCE(f.content_class, 'unknown');

GRANT SELECT ON public.v_admin_storage_attack_by_class TO authenticated;