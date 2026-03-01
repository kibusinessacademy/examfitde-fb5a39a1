
-- FIX: Clean up sync trigger to Variante A (no auto-publish, Council-clean)
-- The trigger mirrors approved content → lessons.content but does NOT
-- auto-promote approved → published. That remains a Council decision.

CREATE OR REPLACE FUNCTION public.sync_lesson_content_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: only fire for approved + usable content
  IF NEW.lesson_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.content_json IS NULL OR length(NEW.content_json::text) < 200 THEN
    RETURN NEW;
  END IF;

  -- Bypass guard_lesson_content_writes
  PERFORM set_config('council.publish_bypass', 'true', true);

  UPDATE public.lessons
  SET content = NEW.content_json,
      qc_status = 'approved'
  WHERE id = NEW.lesson_id;

  -- Reset bypass (best effort, transaction-scoped anyway)
  PERFORM set_config('council.publish_bypass', 'false', true);

  RETURN NEW;
END;
$$;

-- Re-create trigger (also fires on content_json change, not just status)
DROP TRIGGER IF EXISTS trg_sync_lesson_content_on_approve ON public.content_versions;

CREATE TRIGGER trg_sync_lesson_content_on_approve
AFTER INSERT OR UPDATE OF status, content_json
ON public.content_versions
FOR EACH ROW
WHEN (NEW.status = 'approved')
EXECUTE FUNCTION public.sync_lesson_content_on_approve();
