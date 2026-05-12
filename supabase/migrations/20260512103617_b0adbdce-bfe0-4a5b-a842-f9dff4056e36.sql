
-- ============================================================================
-- v_publish_readiness_gate v2 + RPC v3
-- Neue Klasse BRONZE_REVIEW_CLEAN: bronze_locked (Audit-Historie) + aktuell clean
-- (hard_fails=[] AND score>=85). Semantisch eindeutig — Bronze-Flag bleibt erhalten,
-- aber Reconciler darf enqueuen.
-- Rollback: vorherige View/RPC-Definition aus Migration 20260512095738/20260512101940 wiederherstellen.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_publish_readiness_gate AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.package_key,
    cp.title,
    cp.track,
    cp.status AS package_status,
    cp.integrity_passed,
    cp.council_approved,
    COALESCE((cp.integrity_report->>'score')::int, 0) AS score,
    COALESCE(cp.integrity_report->'v3'->'summary'->'hard_fail_reasons', '[]'::jsonb) AS hard_fail_reasons,
    COALESCE((cp.integrity_report->'v3'->'summary'->>'questions_approved_total')::int, 0) AS approved_total,
    NULLIF(cp.integrity_report->>'generated_at','')::timestamptz AS last_integrity_run_at,
    public.fn_is_bronze_locked(cp.id) AS bronze_locked,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending','processing')
    ) AS has_active_integrity_job,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_quality_council'
        AND jq.status IN ('pending','processing')
    ) AS has_active_council_job,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_auto_publish'
        AND jq.status IN ('pending','processing')
    ) AS has_active_auto_publish_job
  FROM public.course_packages cp
  WHERE cp.status IN ('building','queued')
),
classified AS (
  SELECT
    b.*,
    jsonb_array_length(b.hard_fail_reasons) AS hard_fail_count,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(b.hard_fail_reasons) r
      WHERE r ILIKE '%TOO_FEW_APPROVED%'
    ) AS has_pool_gap,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(b.hard_fail_reasons) r
      WHERE r ILIKE '%BLOOM_GATE%' OR r ILIKE '%MISSING_UNDERSTAND%' OR r ILIKE '%MISSING_EVALUATE%'
    ) AS has_bloom_gap,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(b.hard_fail_reasons) r
      WHERE r ILIKE '%TRAP_COVERAGE_BLOCK%' OR r ILIKE '%HARDISH_TOO_LOW%' OR r ILIKE '%ELITE_CONTEXT%' OR r ILIKE '%CONFLICT_TYPE_LOW%'
    ) AS has_trap_gap
  FROM base b
)
SELECT
  c.package_id, c.package_key, c.title, c.track, c.package_status,
  c.integrity_passed, c.council_approved, c.score, c.approved_total,
  c.hard_fail_reasons, c.hard_fail_count, c.bronze_locked,
  c.last_integrity_run_at,
  c.has_active_integrity_job, c.has_active_council_job, c.has_active_auto_publish_job,
  EXTRACT(EPOCH FROM (now() - COALESCE(c.last_integrity_run_at, '1970-01-01'::timestamptz))) / 3600.0 AS hours_since_integrity,
  CASE
    -- Active downstream tail jobs first (don't reclassify in-flight)
    WHEN c.has_active_council_job THEN 'COUNCIL_PENDING'
    WHEN c.has_active_auto_publish_job THEN 'AUTO_PUBLISH_PENDING'
    -- Bronze-Locked + aktuell clean → enqueuebar (Audit-Historie bleibt)
    WHEN c.bronze_locked AND c.hard_fail_count = 0 AND c.score >= 85 THEN 'BRONZE_REVIEW_CLEAN'
    -- Bronze-Locked + nicht clean → echter Review nötig
    WHEN c.bronze_locked THEN 'BRONZE_REVIEW_REQUIRED'
    -- Pool/Bloom/Trap-Gaps (erfordern repair vor integrity-retry)
    WHEN c.has_pool_gap THEN 'POOL_GAP_REPAIR'
    WHEN c.has_bloom_gap THEN 'BLOOM_GAP_REPAIR'
    WHEN c.has_trap_gap THEN 'TRAP_GAP_REPAIR'
    -- Clean + Score≥85 + integrity_passed
    WHEN c.hard_fail_count = 0 AND c.score >= 85 AND c.integrity_passed = true THEN 'READY'
    -- Score 75-84, no hard_fails, NICHT bronze-locked → Bronze-Review benötigt
    WHEN c.hard_fail_count = 0 AND c.score >= 75 AND c.score < 85 THEN 'BRONZE_REVIEW_REQUIRED'
    -- Clean + Score≥85 aber integrity_passed=false → Stale-Integrity
    WHEN c.hard_fail_count = 0 AND c.score >= 85 AND c.integrity_passed = false
         AND NOT c.has_active_integrity_job THEN 'STALE_INTEGRITY'
    ELSE 'NEEDS_INTEGRITY_FIRST'
  END AS gate_class
FROM classified c;

REVOKE ALL ON public.v_publish_readiness_gate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_publish_readiness_gate TO service_role;

COMMENT ON VIEW public.v_publish_readiness_gate IS
  'v2: BRONZE_REVIEW_CLEAN trennt Audit-Bronze-Flag von echtem Review-Bedarf. Coverage ist KEIN Readiness-Signal — integrity_report.v3.summary.hard_fail_reasons SSOT.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC v3: BRONZE_REVIEW_CLEAN in Allowlist + Step-Matrix
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reconcile_queued_tail_without_job(
  p_dry_run boolean DEFAULT true,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(package_id uuid, package_key text, next_tail_step text, action_taken text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID := auth.uid();
  v_is_admin BOOLEAN;
  rec RECORD;
  v_enq_count INT := 0;
  v_skipped_count INT := 0;
  v_cooldown_count INT := 0;
  v_bypass BOOLEAN;
BEGIN
  IF v_caller IS NULL THEN
    v_is_admin := true;
  ELSE
    SELECT has_role(v_caller, 'admin'::app_role) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: admin role required';
    END IF;
  END IF;

  FOR rec IN
    SELECT v.package_id, v.package_key, v.curriculum_id, v.next_tail_step, v.bronze_bypass,
           prg.gate_class, prg.score, prg.bronze_locked
    FROM v_queued_tail_without_job v
    JOIN v_publish_readiness_gate prg ON prg.package_id = v.package_id
    WHERE v.reconciler_verdict='ELIGIBLE'
      AND v.next_tail_step IS NOT NULL
      AND (
        (v.next_tail_step = 'run_integrity_check' AND prg.gate_class = 'STALE_INTEGRITY')
        OR (v.next_tail_step = 'quality_council'    AND prg.gate_class IN ('READY','COUNCIL_PENDING','BRONZE_REVIEW_CLEAN'))
        OR (v.next_tail_step = 'auto_publish'       AND prg.gate_class IN ('READY','AUTO_PUBLISH_PENDING','BRONZE_REVIEW_CLEAN'))
      )
    ORDER BY v.approved_q DESC
    LIMIT p_limit
  LOOP
    -- BRONZE_REVIEW_CLEAN braucht bronze_lock_override=true, weil Bronze-Lock-Trigger sonst blockt
    v_bypass := rec.bronze_bypass OR rec.gate_class = 'BRONZE_REVIEW_CLEAN' OR rec.bronze_locked;

    IF NOT p_dry_run AND public.fn_tail_heal_package_cooldown_active(rec.package_id, interval '5 minutes') THEN
      v_cooldown_count := v_cooldown_count + 1;
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id::text, 'package', 'tail_heal_skipped_package_cooldown', 'skipped',
              jsonb_build_object('package_id', rec.package_id,
                                 'producer','queued_tail_reconciler_enqueue',
                                 'step_key', rec.next_tail_step, 'window','5 minutes',
                                 'gate_class', rec.gate_class));
      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step; action_taken := 'SKIPPED:cooldown_5min';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step;
      action_taken := 'DRY_RUN_WOULD_ENQUEUE[' || rec.gate_class || '/score=' || COALESCE(rec.score::text,'-') || '/bypass=' || v_bypass::text || ']';
      RETURN NEXT; CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue (job_type, status, package_id, payload, priority, worker_pool, job_name)
      VALUES (
        'package_' || rec.next_tail_step, 'pending', rec.package_id,
        jsonb_build_object(
          'package_id', rec.package_id,
          'curriculum_id', rec.curriculum_id,
          'enqueue_source', 'queued_tail_reconciler_v3_gate_aware',
          'step_key', rec.next_tail_step,
          'bronze_lock_override', v_bypass,
          'gate_class', rec.gate_class
        ),
        5, 'core', 'package_' || rec.next_tail_step
      );

      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
      VALUES (rec.package_id::text, 'package', 'queued_tail_reconciler_enqueue', 'success',
              jsonb_build_object('package_id', rec.package_id,
                                 'step_key', rec.next_tail_step, 'package_key', rec.package_key,
                                 'bronze_bypass', v_bypass, 'gate_class', rec.gate_class,
                                 'rpc_version','v3_bronze_review_clean'));
      v_enq_count := v_enq_count + 1;

      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step; action_taken := 'ENQUEUED[' || rec.gate_class || ']';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, error_message, metadata)
      VALUES (rec.package_id::text, 'package', 'queued_tail_reconciler_enqueue_error', 'failed', SQLERRM,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.next_tail_step,
                                 'gate_class', rec.gate_class));
      v_skipped_count := v_skipped_count + 1;
      package_id := rec.package_id; package_key := rec.package_key;
      next_tail_step := rec.next_tail_step; action_taken := 'SKIPPED:' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO auto_heal_log(target_id, target_type, action_type, result_status, metadata)
  VALUES (NULL, 'system', 'queued_tail_reconciler_run_summary', 'success',
          jsonb_build_object('dry_run', p_dry_run, 'enqueued', v_enq_count,
                             'errored', v_skipped_count, 'cooldown_skipped', v_cooldown_count,
                             'rpc_version','v3_bronze_review_clean'));
END;
$function$;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'publish_readiness_gate_v2_bronze_review_clean',
  'system', NULL, 'success',
  jsonb_build_object(
    'migration', 'v_publish_readiness_gate_v2',
    'new_class', 'BRONZE_REVIEW_CLEAN',
    'definition', 'bronze_locked AND hard_fail_count=0 AND score>=85',
    'rpc_version', 'v3_bronze_review_clean',
    'allowlist_extended', jsonb_build_object(
      'quality_council', ARRAY['READY','COUNCIL_PENDING','BRONZE_REVIEW_CLEAN'],
      'auto_publish',    ARRAY['READY','AUTO_PUBLISH_PENDING','BRONZE_REVIEW_CLEAN'],
      'run_integrity_check', ARRAY['STALE_INTEGRITY']
    ),
    'rationale', 'Audit-Historie via Bronze-Flag bleibt; Reconciler unterscheidet jetzt zwischen Audit-Bronze und echtem Review-Bedarf.'
  )
);
