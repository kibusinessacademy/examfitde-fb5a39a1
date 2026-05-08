-- Extend security_events.event_type enum + decision values for edge auth audit logging
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='security_event_type' AND e.enumlabel='edge_auth_blocked'
  ) THEN
    ALTER TYPE public.security_event_type ADD VALUE 'edge_auth_blocked';
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- enum lives under different name; try common alternate
  NULL;
END$$;

-- Discover actual enum name and add value if needed
DO $$
DECLARE v_enum text;
BEGIN
  SELECT udt_name INTO v_enum FROM information_schema.columns
   WHERE table_schema='public' AND table_name='security_events' AND column_name='event_type';
  IF v_enum IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname=v_enum AND e.enumlabel='edge_auth_blocked'
  ) THEN
    EXECUTE format('ALTER TYPE public.%I ADD VALUE %L', v_enum, 'edge_auth_blocked');
  END IF;
END$$;