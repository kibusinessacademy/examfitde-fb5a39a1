
-- ════════════════════════════════════════════════════════════════
-- v8.6 — Re-Block Loop Guard
-- 
-- Verhindert, dass Edge Functions release_ok Pakete fälschlich
-- auf blocked/pipeline_repair_required setzen.
-- 
-- Wenn ein Update {status='blocked', blocked_reason='pipeline_repair_required'}
-- versucht wird, prüft der Trigger die Release-Klassifikation:
--  - release_ok    → Block verhindern, statt: status normalisieren auf 'published' (wenn passend)
--  - andere        → Update normal durchlassen
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_guard_reblock_release_ok()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_release_class text;
  v_readiness jsonb;
BEGIN
  -- Nur eingreifen, wenn jemand versucht das Paket auf "pipeline_repair_required" zu setzen
  IF NEW.status = 'blocked' 
     AND NEW.blocked_reason = 'pipeline_repair_required'
     AND (OLD.status <> 'blocked' OR OLD.blocked_reason <> 'pipeline_repair_required')
  THEN
    -- Release-Klassifikation prüfen
    SELECT release_class INTO v_release_class
    FROM v_package_release_classification
    WHERE package_id = NEW.id;

    -- Wenn das Paket release_ok ist, Block verhindern
    IF v_release_class = 'release_ok' THEN
      -- Audit
      INSERT INTO admin_actions (action, scope, affected_ids, payload)
      VALUES (
        'reblock_loop_guard_v8.6',
        'publish_governance',
        ARRAY[NEW.id],
        jsonb_build_object(
          'attempted_status', NEW.status,
          'attempted_reason', NEW.blocked_reason,
          'previous_status', OLD.status,
          'previous_reason', OLD.blocked_reason,
          'release_class', v_release_class,
          'verdict', 'BLOCKED — release_ok package may not be re-blocked'
        )
      );

      -- Notification (severity=warning, einmal pro Stunde dedupen via title)
      INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        '🛡️ Re-Block Loop verhindert: ' || COALESCE(NEW.title, NEW.id::text),
        'Edge Function versuchte release_ok Paket auf pipeline_repair_required zu setzen. Block wurde verhindert.',
        'ops',
        'warning',
        'package',
        NEW.id,
        jsonb_build_object(
          'kind', 'reblock_guard',
          'release_class', v_release_class,
          'attempted_from', OLD.status
        )
      );

      -- Status auf published lassen, wenn vorher published war; sonst auf vorherigen Zustand zurücksetzen
      IF OLD.status = 'published' THEN
        NEW.status := 'published';
        NEW.blocked_reason := NULL;
        NEW.is_published := true;
      ELSE
        -- Force ready: Readiness prüfen
        v_readiness := fn_package_publish_readiness(NEW.id);
        IF (v_readiness->>'ready')::boolean = true THEN
          NEW.status := 'published';
          NEW.blocked_reason := NULL;
          NEW.is_published := true;
          NEW.published_at := COALESCE(NEW.published_at, now());
        ELSE
          -- Nicht ready trotz release_ok? Dann auf building zurück, NICHT blocked
          NEW.status := COALESCE(OLD.status, 'building');
          NEW.blocked_reason := NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_reblock_release_ok ON public.course_packages;

CREATE TRIGGER trg_guard_reblock_release_ok
BEFORE UPDATE ON public.course_packages
FOR EACH ROW
WHEN (NEW.status = 'blocked' AND NEW.blocked_reason = 'pipeline_repair_required')
EXECUTE FUNCTION public.fn_guard_reblock_release_ok();

COMMENT ON FUNCTION public.fn_guard_reblock_release_ok IS
  'v8.6 Re-Block Loop Guard: Verhindert dass release_ok Pakete fälschlich auf pipeline_repair_required gesetzt werden. SSOT-konform via v_package_release_classification.';
