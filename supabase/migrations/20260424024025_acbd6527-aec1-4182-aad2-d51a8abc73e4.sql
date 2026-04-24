-- 1) History-Tabelle (append-only Audit-Log)
CREATE TABLE IF NOT EXISTS public.security_finding_exception_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner_name text NOT NULL,
  internal_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','deleted')),
  prev_status text,
  new_status text,
  prev_reason text,
  new_reason text,
  prev_accepted_until_audit text,
  new_accepted_until_audit text,
  prev_accepted_until_date date,
  new_accepted_until_date date,
  prev_priority text,
  new_priority text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secfind_excep_history_lookup
  ON public.security_finding_exception_history (scanner_name, internal_id, changed_at DESC);

ALTER TABLE public.security_finding_exception_history ENABLE ROW LEVEL SECURITY;

-- Admins dürfen lesen
CREATE POLICY "Admins can read exception history"
  ON public.security_finding_exception_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Service Role darf alles (für Trigger-Insert)
CREATE POLICY "Service role full access exception history"
  ON public.security_finding_exception_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated-Admins dürfen einfügen (vom Trigger via auth.uid() context, ansonsten App-seitig)
CREATE POLICY "Admins can insert exception history"
  ON public.security_finding_exception_history FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- KEINE Update/Delete-Policy → unveränderlich

-- 2) Trigger-Funktion: schreibt automatisch History-Einträge
CREATE OR REPLACE FUNCTION public.tg_security_finding_exceptions_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.security_finding_exception_history (
      scanner_name, internal_id, action,
      new_status, new_reason, new_accepted_until_audit, new_accepted_until_date, new_priority,
      changed_by
    ) VALUES (
      NEW.scanner_name, NEW.internal_id, 'created',
      NEW.status, NEW.reason, NEW.accepted_until_audit, NEW.accepted_until_date, NEW.priority,
      COALESCE(NEW.created_by, auth.uid())
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Nur loggen wenn relevantes Feld geändert
    IF (
      NEW.status IS DISTINCT FROM OLD.status OR
      NEW.reason IS DISTINCT FROM OLD.reason OR
      NEW.accepted_until_audit IS DISTINCT FROM OLD.accepted_until_audit OR
      NEW.accepted_until_date IS DISTINCT FROM OLD.accepted_until_date OR
      NEW.priority IS DISTINCT FROM OLD.priority
    ) THEN
      INSERT INTO public.security_finding_exception_history (
        scanner_name, internal_id, action,
        prev_status, new_status,
        prev_reason, new_reason,
        prev_accepted_until_audit, new_accepted_until_audit,
        prev_accepted_until_date, new_accepted_until_date,
        prev_priority, new_priority,
        changed_by
      ) VALUES (
        NEW.scanner_name, NEW.internal_id, 'updated',
        OLD.status, NEW.status,
        OLD.reason, NEW.reason,
        OLD.accepted_until_audit, NEW.accepted_until_audit,
        OLD.accepted_until_date, NEW.accepted_until_date,
        OLD.priority, NEW.priority,
        COALESCE(auth.uid(), NEW.created_by)
      );
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.security_finding_exception_history (
      scanner_name, internal_id, action,
      prev_status, prev_reason, prev_accepted_until_audit, prev_accepted_until_date, prev_priority,
      changed_by
    ) VALUES (
      OLD.scanner_name, OLD.internal_id, 'deleted',
      OLD.status, OLD.reason, OLD.accepted_until_audit, OLD.accepted_until_date, OLD.priority,
      auth.uid()
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_finding_exceptions_audit
  ON public.security_finding_exceptions;
CREATE TRIGGER trg_security_finding_exceptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.security_finding_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_security_finding_exceptions_audit();

COMMENT ON TABLE public.security_finding_exception_history IS
  'Append-only Audit-Log für Änderungen an security_finding_exceptions. Admin-only RLS, keine Updates/Deletes erlaubt.';