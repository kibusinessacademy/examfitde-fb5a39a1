-- Enable realtime for job_queue (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'job_queue'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.job_queue';
  END IF;
END$$;

-- REPLICA IDENTITY FULL für vollständige Payloads (nur wenn noch nicht gesetzt)
DO $$
DECLARE _ri char;
BEGIN
  SELECT relreplident INTO _ri FROM pg_class WHERE oid = 'public.job_queue'::regclass;
  IF _ri IS DISTINCT FROM 'f' THEN
    EXECUTE 'ALTER TABLE public.job_queue REPLICA IDENTITY FULL';
  END IF;
END$$;