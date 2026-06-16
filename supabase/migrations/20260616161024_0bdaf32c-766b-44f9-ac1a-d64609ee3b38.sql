
-- Severity / status enums
DO $$ BEGIN
  CREATE TYPE public.security_scan_severity AS ENUM ('critical','high','medium','low','info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.security_scan_category AS ENUM (
    'rls_missing','rls_permissive','exposed_pii','exposed_secrets',
    'security_definer_view','privilege_escalation','dependency_vuln',
    'connector_finding','config_drift','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.security_ticket_status AS ENUM ('open','in_progress','resolved','wont_fix','duplicate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Runs
CREATE TABLE IF NOT EXISTS public.security_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner text NOT NULL,
  source text NOT NULL DEFAULT 'cron',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_scan_runs TO authenticated;
GRANT ALL ON public.security_scan_runs TO service_role;
ALTER TABLE public.security_scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_runs_admin_read" ON public.security_scan_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Findings (deduped via fingerprint)
CREATE TABLE IF NOT EXISTS public.security_scan_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  scanner text NOT NULL,
  category public.security_scan_category NOT NULL DEFAULT 'other',
  severity public.security_scan_severity NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text,
  target text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_scan_findings TO authenticated;
GRANT ALL ON public.security_scan_findings TO service_role;
ALTER TABLE public.security_scan_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_findings_admin_read" ON public.security_scan_findings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_scan_findings_sev_open
  ON public.security_scan_findings(severity, last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- Tickets
CREATE TABLE IF NOT EXISTS public.security_scan_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.security_scan_findings(id) ON DELETE CASCADE,
  status public.security_ticket_status NOT NULL DEFAULT 'open',
  severity public.security_scan_severity NOT NULL,
  category public.security_scan_category NOT NULL,
  title text NOT NULL,
  summary text,
  assigned_to uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id)
);
GRANT SELECT, UPDATE ON public.security_scan_tickets TO authenticated;
GRANT ALL ON public.security_scan_tickets TO service_role;
ALTER TABLE public.security_scan_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_tickets_admin_read" ON public.security_scan_tickets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "scan_tickets_admin_update" ON public.security_scan_tickets
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_security_scan_tables()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_security_scan_findings ON public.security_scan_findings;
CREATE TRIGGER trg_touch_security_scan_findings
  BEFORE UPDATE ON public.security_scan_findings
  FOR EACH ROW EXECUTE FUNCTION public.touch_security_scan_tables();

DROP TRIGGER IF EXISTS trg_touch_security_scan_tickets ON public.security_scan_tickets;
CREATE TRIGGER trg_touch_security_scan_tickets
  BEFORE UPDATE ON public.security_scan_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_security_scan_tables();

-- Ingest RPC: upserts findings + auto-creates tickets for NEW ones
CREATE OR REPLACE FUNCTION public.ingest_security_scan_findings(
  p_run_id uuid,
  p_scanner text,
  p_findings jsonb
) RETURNS TABLE(new_count int, updated_count int, tickets_created int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f jsonb;
  fp text;
  existing_id uuid;
  v_new int := 0;
  v_upd int := 0;
  v_tix int := 0;
  v_finding_id uuid;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(p_findings)
  LOOP
    fp := encode(digest(
      coalesce(p_scanner,'') || '|' ||
      coalesce(f->>'category','other') || '|' ||
      coalesce(f->>'target','') || '|' ||
      coalesce(f->>'title',''),
      'sha256'
    ),'hex');

    SELECT id INTO existing_id FROM public.security_scan_findings WHERE fingerprint = fp;

    IF existing_id IS NULL THEN
      INSERT INTO public.security_scan_findings(
        fingerprint, scanner, category, severity, title, description, target, evidence
      ) VALUES (
        fp, p_scanner,
        coalesce((f->>'category')::public.security_scan_category,'other'),
        coalesce((f->>'severity')::public.security_scan_severity,'medium'),
        coalesce(f->>'title','Untitled finding'),
        f->>'description',
        f->>'target',
        coalesce(f->'evidence','{}'::jsonb)
      ) RETURNING id INTO v_finding_id;
      v_new := v_new + 1;

      INSERT INTO public.security_scan_tickets(finding_id, severity, category, title, summary)
      SELECT v_finding_id, severity, category, title, description
      FROM public.security_scan_findings WHERE id = v_finding_id;
      v_tix := v_tix + 1;
    ELSE
      UPDATE public.security_scan_findings SET
        last_seen_at = now(),
        occurrence_count = occurrence_count + 1,
        severity = coalesce((f->>'severity')::public.security_scan_severity, severity),
        evidence = coalesce(f->'evidence', evidence),
        resolved_at = NULL
      WHERE id = existing_id;
      v_upd := v_upd + 1;

      -- Reopen ticket if previously resolved
      UPDATE public.security_scan_tickets
      SET status = 'open', resolved_at = NULL
      WHERE finding_id = existing_id AND status IN ('resolved','wont_fix');
    END IF;
  END LOOP;

  IF p_run_id IS NOT NULL THEN
    UPDATE public.security_scan_runs
    SET finished_at = now(),
        status = 'completed',
        totals = jsonb_build_object('new', v_new, 'updated', v_upd, 'tickets', v_tix)
    WHERE id = p_run_id;
  END IF;

  RETURN QUERY SELECT v_new, v_upd, v_tix;
END $$;

GRANT EXECUTE ON FUNCTION public.ingest_security_scan_findings(uuid,text,jsonb) TO service_role;

-- Convenience view
CREATE OR REPLACE VIEW public.v_security_open_tickets AS
SELECT t.id, t.status, t.severity, t.category, t.title, t.summary,
       t.opened_at, f.target, f.scanner, f.last_seen_at, f.occurrence_count
FROM public.security_scan_tickets t
JOIN public.security_scan_findings f ON f.id = t.finding_id
WHERE t.status IN ('open','in_progress')
ORDER BY
  CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  t.opened_at DESC;

GRANT SELECT ON public.v_security_open_tickets TO authenticated;
