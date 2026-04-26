-- Targeted Blocker Re-Enqueue Function (P1-P4)
-- Adresses the 13 real blockers from v_admin_publish_readiness without view changes,
-- without lesson archival, without track-drift cleanup.
--
-- Behavior:
--   p_execute=false → DRY RUN: returns planned actions, no enqueue
--   p_execute=true  → enqueues jobs via enqueue_job_if_absent and returns same plan with executed=true
--
-- Logic:
--   P1 INTEGRITY_NEVER_CHECKED  → enqueue package_run_integrity_check
--   P2 INTEGRITY_DEFERRED       → enqueue package_run_integrity_check ONLY if defer_reason
--                                 indicates a transient cause (WAITING_FOR_MATERIALIZATION) AND
--                                 enough materialized data is now present (approved_exam_questions>=track_min)
--   P3 QUALITY_COUNCIL_PENDING  → enqueue package_quality_council ONLY if integrity_passed=true
--   P4 EXAM_POOL_TOO_SMALL      → enqueue package_repair_exam_pool_quality (volume defect)
--                                 OR package_repair_exam_pool_competency_coverage (coverage defect)
--                                 OR package_repair_exam_pool_lf_coverage (LF gaps)

CREATE OR REPLACE FUNCTION public.admin_targeted_blocker_recheck(p_execute boolean DEFAULT false)
RETURNS TABLE(
  package_id uuid,
  course_title text,
  package_track text,
  blocker text,
  action text,
  reason text,
  executed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_min_questions int;
  v_lf_zero int;
  v_lf_below_5 int;
  v_repair_type text;
  v_action_reason text;
  v_curriculum_id uuid;
BEGIN
  FOR r IN
    SELECT v.package_id, v.course_title, v.package_track, v.primary_blocker,
           v.integrity_passed, v.approved_exam_questions,
           v.integrity_report->>'defer_reason' AS defer_reason,
           v.integrity_report->>'reason_code'  AS reason_code,
           COALESCE((v.integrity_report->>'deferred')::boolean, false) AS deferred
    FROM v_admin_publish_readiness v
    WHERE v.package_status IN ('building','publish_ready','published')
      AND v.primary_blocker IN (
        'INTEGRITY_NEVER_CHECKED',
        'INTEGRITY_DEFERRED',
        'QUALITY_COUNCIL_PENDING',
        'EXAM_POOL_TOO_SMALL'
      )
  LOOP
    -- ============ P1: INTEGRITY_NEVER_CHECKED ============
    IF r.primary_blocker = 'INTEGRITY_NEVER_CHECKED' THEN
      package_id := r.package_id; course_title := r.course_title; package_track := r.package_track;
      blocker := r.primary_blocker;
      action := 'enqueue:package_run_integrity_check';
      reason := 'no integrity report yet — first run';
      executed := false;
      IF p_execute THEN
        PERFORM public.enqueue_job_if_absent(
          p_job_type    => 'package_run_integrity_check',
          p_package_id  => r.package_id,
          p_payload     => jsonb_build_object('package_id', r.package_id, 'origin','targeted_blocker_recheck'),
          p_priority    => 50,
          p_max_attempts=> 5
        );
        executed := true;
      END IF;
      RETURN NEXT;

    -- ============ P2: INTEGRITY_DEFERRED ============
    ELSIF r.primary_blocker = 'INTEGRITY_DEFERRED' THEN
      v_min_questions := CASE r.package_track
        WHEN 'AUSBILDUNG_VOLL' THEN 300
        WHEN 'EXAM_FIRST'      THEN 150
        WHEN 'EXAM_FIRST_PLUS' THEN 300
        WHEN 'STUDIUM'         THEN 200
        ELSE 150
      END;

      package_id := r.package_id; course_title := r.course_title; package_track := r.package_track;
      blocker := r.primary_blocker;

      IF r.defer_reason = 'WAITING_FOR_MATERIALIZATION'
         AND r.approved_exam_questions >= v_min_questions THEN
        action := 'enqueue:package_run_integrity_check';
        reason := format('defer_reason=%s, approved=%s>=min(%s) — re-check safe',
                         r.defer_reason, r.approved_exam_questions, v_min_questions);
        executed := false;
        IF p_execute THEN
          PERFORM public.enqueue_job_if_absent(
            p_job_type    => 'package_run_integrity_check',
            p_package_id  => r.package_id,
            p_payload     => jsonb_build_object('package_id', r.package_id, 'origin','targeted_blocker_recheck'),
            p_priority    => 50,
            p_max_attempts=> 5
          );
          executed := true;
        END IF;
      ELSE
        action := 'skip';
        reason := format('defer_reason=%s, approved=%s/min=%s — cause may persist',
                         COALESCE(r.defer_reason,'<null>'), r.approved_exam_questions, v_min_questions);
        executed := false;
      END IF;
      RETURN NEXT;

    -- ============ P3: QUALITY_COUNCIL_PENDING ============
    ELSIF r.primary_blocker = 'QUALITY_COUNCIL_PENDING' THEN
      package_id := r.package_id; course_title := r.course_title; package_track := r.package_track;
      blocker := r.primary_blocker;

      IF COALESCE(r.integrity_passed,false) = true THEN
        -- if report still carries stale "deferred=true" alongside integrity_passed=true,
        -- re-run integrity to refresh the report cache, THEN council can proceed
        IF r.deferred = true THEN
          action := 'enqueue:package_run_integrity_check (refresh stale report)';
          reason := 'integrity_passed=true but report.deferred=true (stale) — refresh first';
          executed := false;
          IF p_execute THEN
            PERFORM public.enqueue_job_if_absent(
              p_job_type    => 'package_run_integrity_check',
              p_package_id  => r.package_id,
              p_payload     => jsonb_build_object('package_id', r.package_id, 'origin','targeted_blocker_recheck_refresh'),
              p_priority    => 50,
              p_max_attempts=> 5
            );
            executed := true;
          END IF;
          RETURN NEXT;
        END IF;

        action := 'enqueue:package_quality_council';
        reason := 'integrity_passed=true — council can run';
        executed := false;
        IF p_execute THEN
          PERFORM public.enqueue_job_if_absent(
            p_job_type    => 'package_quality_council',
            p_package_id  => r.package_id,
            p_payload     => jsonb_build_object('package_id', r.package_id, 'origin','targeted_blocker_recheck'),
            p_priority    => 60,
            p_max_attempts=> 5
          );
          executed := true;
        END IF;
        RETURN NEXT;
      ELSE
        action := 'skip';
        reason := 'integrity_passed!=true — council not allowed';
        executed := false;
        RETURN NEXT;
      END IF;

    -- ============ P4: EXAM_POOL_TOO_SMALL ============
    ELSIF r.primary_blocker = 'EXAM_POOL_TOO_SMALL' THEN
      SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = r.package_id;

      SELECT
        count(*) FILTER (WHERE approved_q = 0),
        count(*) FILTER (WHERE approved_q < 5)
      INTO v_lf_zero, v_lf_below_5
      FROM (
        SELECT lf.id,
               (SELECT count(*) FROM exam_questions eq
                 WHERE eq.curriculum_id = v_curriculum_id
                   AND eq.learning_field_id = lf.id
                   AND eq.status = 'approved') AS approved_q
        FROM learning_fields lf
        WHERE lf.curriculum_id = v_curriculum_id
      ) sub;

      -- Defect classification
      IF COALESCE(v_lf_zero,0) > 0 THEN
        v_repair_type := 'package_repair_exam_pool_lf_coverage';
        v_action_reason := format('%s LF without ANY approved questions', v_lf_zero);
      ELSIF COALESCE(v_lf_below_5,0) > 0 THEN
        v_repair_type := 'package_repair_exam_pool_competency_coverage';
        v_action_reason := format('%s LF with <5 approved questions', v_lf_below_5);
      ELSE
        v_repair_type := 'package_repair_exam_pool_quality';
        v_action_reason := format('volume defect: approved=%s, all LF covered', r.approved_exam_questions);
      END IF;

      package_id := r.package_id; course_title := r.course_title; package_track := r.package_track;
      blocker := r.primary_blocker;
      action := 'enqueue:' || v_repair_type;
      reason := v_action_reason;
      executed := false;
      IF p_execute THEN
        PERFORM public.enqueue_job_if_absent(
          p_job_type    => v_repair_type,
          p_package_id  => r.package_id,
          p_payload     => jsonb_build_object('package_id', r.package_id, 'origin','targeted_blocker_recheck'),
          p_priority    => 70,
          p_max_attempts=> 5
        );
        executed := true;
      END IF;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_targeted_blocker_recheck(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_targeted_blocker_recheck(boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_targeted_blocker_recheck(boolean) IS
'Targeted re-enqueue for the 4 real blocker classes: NEVER_CHECKED, DEFERRED (cause-aware), COUNCIL_PENDING (only if integrity_passed), EXAM_POOL_TOO_SMALL (defect-aware repair). Always run with p_execute=false first (dry run).';