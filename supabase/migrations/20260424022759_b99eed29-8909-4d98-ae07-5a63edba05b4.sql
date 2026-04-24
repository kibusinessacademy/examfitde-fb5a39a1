CREATE TABLE IF NOT EXISTS public.security_finding_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner_name text NOT NULL,
  internal_id text NOT NULL,
  finding_id text,
  priority text CHECK (priority IN ('P0','P1','P2','P3')),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','wontfix','deferred','mitigated')),
  reason text NOT NULL,
  accepted_until_audit text,
  accepted_until_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scanner_name, internal_id)
);

CREATE INDEX IF NOT EXISTS idx_security_finding_exceptions_lookup
  ON public.security_finding_exceptions (scanner_name, internal_id);

ALTER TABLE public.security_finding_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read finding exceptions"
  ON public.security_finding_exceptions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert finding exceptions"
  ON public.security_finding_exceptions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update finding exceptions"
  ON public.security_finding_exceptions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete finding exceptions"
  ON public.security_finding_exceptions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access finding exceptions"
  ON public.security_finding_exceptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tg_security_finding_exceptions_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_finding_exceptions_touch ON public.security_finding_exceptions;
CREATE TRIGGER trg_security_finding_exceptions_touch
  BEFORE UPDATE ON public.security_finding_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_security_finding_exceptions_touch();

COMMENT ON TABLE public.security_finding_exceptions IS
  'Persistente Akzeptanz-Marker für Security-Findings (SECDEF u.ä.). accepted_until_audit verknüpft mit Audit-Version (z. B. v2026.Q3). Admin-only RLS.';