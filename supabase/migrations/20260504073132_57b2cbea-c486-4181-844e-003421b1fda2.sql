
-- ═══════════════════════════════════════════════════════════════════
-- Bronze-Lock-Trigger auf job_queue (Single Choke-Point)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_guard_bronze_lock_on_job_enqueue()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_locked boolean;
  v_source text;
  v_pkg_id uuid;
BEGIN
  -- Nur für die zwei Loop-relevanten Job-Typen aktiv
  IF NEW.job_type NOT IN ('package_quality_council','package_auto_publish') THEN
    RETURN NEW;
  END IF;

  -- Nur INSERT oder Reaktivierung (queued/pending/processing) prüfen
  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('queued','pending','processing')
     AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('queued','pending','processing') THEN
    RETURN NEW;
  END IF;

  v_pkg_id := NEW.package_id;
  IF v_pkg_id IS NULL THEN
    v_pkg_id := NULLIF(NEW.payload->>'package_id','')::uuid;
  END IF;

  IF v_pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bronze-Lock prüfen
  SELECT public.fn_is_bronze_locked(v_pkg_id) INTO v_locked;
  IF NOT v_locked THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(NEW.payload->>'enqueue_source', 'unknown');

  -- Ausnahme 1: Bronze-Repair-Dispatch selbst (kein quality_council/auto_publish, aber falls doch)
  IF v_source = 'bronze_targeted_repair' THEN
    RETURN NEW;
  END IF;

  -- Ausnahme 2: Expliziter Admin-Override im Payload (Manual Review-Freigabe)
  IF (NEW.payload->>'bronze_lock_override')::boolean = true THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_lock_admin_override',
            v_pkg_id::text,'package','success',
            format('Admin override: %s passed through bronze lock', NEW.job_type),
            jsonb_build_object('package_id', v_pkg_id, 'job_type', NEW.job_type, 'enqueue_source', v_source));
    RETURN NEW;
  END IF;

  -- BLOCK: Audit + Cancel-as-INSERT (statt RAISE, damit Bulk-Caller nicht crasht)
  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_locked_enqueue_blocked',
          v_pkg_id::text,'package','skipped',
          format('Bronze lock active — %s rejected (source=%s)', NEW.job_type, v_source),
          jsonb_build_object(
            'package_id', v_pkg_id,
            'job_type', NEW.job_type,
            'enqueue_source', v_source,
            'tg_op', TG_OP,
            'skipped_reason','BRONZE_LOCKED_REQUIRES_REVIEW'));

  -- Statt INSERT/UPDATE durchgehen zu lassen: hart blockieren
  -- (UPDATE zurück auf cancelled, INSERT mit RETURN NULL verhindern)
  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  ELSE
    NEW.status := 'cancelled';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.last_error := 'BRONZE_LOCKED_REQUIRES_REVIEW: package marked requires_review=true';
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by','bronze_lock_guard',
      'reason','BRONZE_LOCKED_REQUIRES_REVIEW',
      'enqueue_source', v_source);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bronze_lock_on_job_enqueue ON public.job_queue;
CREATE TRIGGER trg_guard_bronze_lock_on_job_enqueue
BEFORE INSERT OR UPDATE OF status ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_bronze_lock_on_job_enqueue();

COMMENT ON FUNCTION public.fn_guard_bronze_lock_on_job_enqueue() IS
  'Phase 2 Bronze-Lock: blockt package_quality_council und package_auto_publish für Bronze-Locked Pakete an der Schreibstelle. Single Choke-Point für Watchdog/Reconciler/Heal-Playbook/Bulk-Promote/Nudge/Pending-Enqueue. Ausnahmen: enqueue_source=bronze_targeted_repair, payload.bronze_lock_override=true.';
