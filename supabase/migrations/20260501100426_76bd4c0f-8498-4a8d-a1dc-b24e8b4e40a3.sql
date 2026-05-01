-- ─────────────────────────────────────────────────────────────────────────
-- auto_heal_log Identity-Defaults (Producer-Single-Point-Fix)
-- ─────────────────────────────────────────────────────────────────────────

-- 1. BEFORE INSERT Trigger — setzt sane Defaults für globale Producer
CREATE OR REPLACE FUNCTION public.tg_auto_heal_log_identity_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- action_type ist Pflicht (Producer-Bug, nicht stillschweigend defaulten)
  IF NEW.action_type IS NULL OR NEW.action_type = '' THEN
    RAISE EXCEPTION 'AUTO_HEAL_LOG_IDENTITY: action_type ist Pflicht (NULL nicht erlaubt). trigger_source=%, metadata=%',
      NEW.trigger_source, NEW.metadata
      USING ERRCODE = '23502';
  END IF;

  -- target_type Default: 'system' für globale Cron-Cycles ohne Einzelziel
  IF NEW.target_type IS NULL OR NEW.target_type = '' THEN
    NEW.target_type := 'system';
  END IF;

  -- result_status Default: 'unknown' (Producer SOLL setzen, aber kein hard-block)
  IF NEW.result_status IS NULL OR NEW.result_status = '' THEN
    NEW.result_status := 'unknown';
  END IF;

  -- Wenn target_type != 'system' aber target_id NULL → ist ein Producer-Bug, aber wir loggen nur
  -- (kein hard-block, weil bestehende Logs gemischt sind und Phase 3 warn-only ist)
  IF NEW.target_type <> 'system' AND NEW.target_id IS NULL THEN
    -- Annotate metadata
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb)
      || jsonb_build_object('identity_warning', 'target_id_missing_for_non_system_target');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_heal_log_identity_defaults ON public.auto_heal_log;
CREATE TRIGGER trg_auto_heal_log_identity_defaults
  BEFORE INSERT ON public.auto_heal_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_heal_log_identity_defaults();

COMMENT ON FUNCTION public.tg_auto_heal_log_identity_defaults() IS
  'Identity-Default-Trigger für auto_heal_log: target_type→system, result_status→unknown, action_type bleibt Pflicht. Single-Point-Fix für 17 globale Cron-Producer (pipeline_watchdog, production_guardian, worker_liveness_check, etc.).';

-- ─────────────────────────────────────────────────────────────────────────
-- Legacy-Backfill mit separatem Audit-Eintrag VOR dem Update
-- ─────────────────────────────────────────────────────────────────────────

-- Audit-Eintrag (passiert durch eigenen Trigger, daher auch sauber)
INSERT INTO public.auto_heal_log
  (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
SELECT
  'system_backfill_target_type',
  'manual_migration:identity_contract_v1',
  'system',
  NULL,
  'success',
  'Backfill historischer auto_heal_log mit target_type IS NULL → ''system''',
  jsonb_build_object(
    'backfill_version', 'legacy_backfill_v1',
    'affected_count', (SELECT COUNT(*) FROM public.auto_heal_log WHERE target_type IS NULL),
    'reason', 'Globale Cron-Cycles (pipeline_watchdog, production_guardian, worker_liveness_check, etc.) haben kein Einzelziel — target_type=system ist die korrekte Semantik.',
    'rule_link', 'mem://architektur/ops/canonical-identity-contract-v1'
  );

-- Backfill (alle historischen NULL target_type → 'system')
UPDATE public.auto_heal_log
SET target_type = 'system'
WHERE target_type IS NULL;

-- result_status NULL → 'unknown' falls noch welche da sind (defensive)
UPDATE public.auto_heal_log
SET result_status = 'unknown'
WHERE result_status IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Identity-Guard SQL-View für laufende Beobachtung (für Cockpit/Cron)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_auto_heal_log_identity_health AS
WITH win AS (
  SELECT *
  FROM public.auto_heal_log
  WHERE created_at >= now() - interval '24 hours'
)
SELECT
  COUNT(*) AS total_24h,
  COUNT(*) FILTER (WHERE action_type IS NULL OR action_type = '') AS missing_action_type,
  COUNT(*) FILTER (WHERE target_type IS NULL OR target_type = '') AS missing_target_type,
  COUNT(*) FILTER (WHERE result_status IS NULL OR result_status = '') AS missing_result_status,
  COUNT(*) FILTER (WHERE target_type <> 'system' AND target_id IS NULL) AS non_system_without_target_id,
  CASE WHEN COUNT(*) FILTER (
    WHERE action_type IS NULL OR target_type IS NULL OR result_status IS NULL
  ) = 0 THEN 'green' ELSE 'red' END AS guard5_status
FROM win;

REVOKE ALL ON public.v_auto_heal_log_identity_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_auto_heal_log_identity_health TO service_role;