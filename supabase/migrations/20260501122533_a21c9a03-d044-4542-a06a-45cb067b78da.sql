DO $$
DECLARE
  v_now timestamptz := now();
  v_mapping jsonb := jsonb_build_object(
    'exam_pool_503_empty_loop_v1',
      E'already_implemented (Coverage-Report 2026-05-01)\n'
      '- Pre-Flight: can_generate_exam_pool + fn_classify_exam_pool_gate + fn_guard_generate_exam_pool_causality\n'
      '- Stagnation/Empty-Loop: fn_exam_pool_stagnation_alert + fn_exam_pool_fallback_progress + fn_autofix_exam_pool_deficit\n'
      '- Fail-Fast: fn_check_repair_no_progress_and_block (3 runs / 4h -> step=blocked + audit)\n'
      '- Drift-Heal: fn_detect_and_heal_exam_pool_enqueue_drift (Cron */15, 130 runs / 67 success in 7d)\n'
      '- Verifikation: 0 Treffer fuer 503/empty_loop in auto_heal_log letzte 7 Tage',
    'dag_guard_block',
      E'already_implemented (Coverage-Report 2026-05-01)\n'
      '- DAG-Guard-Eskalation aktiv: 181x dag_guard_block in 7d (kontrollierte Mitigation, keine Hot-Loop)\n'
      '- Hot-Loop-Schutz: Tail-Step Artifact-Aware Defer (407x tail_step_retryable_deferred / 7d, mem://architektur/ops/tail-step-artifact-aware-defer-v1)\n'
      '- Requeue-Loop-Mitigation: 127x in 7d\n'
      '- Artefakt-Generation: ueberwacht via v_artifact_orphans + stuendlichem Cleanup-Cron (mem://architektur/ops/artifact-orphan-detection-and-cleanup-v1)\n'
      '- Demote-Schutz: trg_guard_building_to_queued_with_jobs blockt voreilige Demotion'
  );
  v_count int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.heal_permanent_fix_tasks t
    SET status = 'done',
        completed_at = v_now,
        notes = COALESCE(
          CASE WHEN pattern_key = 'exam_pool_503_empty_loop_v1'
               THEN v_mapping->>'exam_pool_503_empty_loop_v1'
               ELSE v_mapping->>'dag_guard_block'
          END,
          notes
        ),
        updated_at = v_now
    WHERE status = 'in_progress'
      AND pattern_key IN (
        'exam_pool_503_empty_loop_v1',
        '31dd9de450fadc4d32a70ffbb505cb87c88e9178',
        '04fad7b17012c81fd1a0266240a12b035652bf0c',
        '1dc475710dec9735646b36e9594ea1c05ee28506',
        '8acb70adc6b3154c9e5679004b06375f1144946c'
      )
    RETURNING id, pattern_key, title
  )
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  SELECT
    'permanent_fix_already_implemented',
    'heal_permanent_fix_task',
    upd.id::text,
    'success',
    jsonb_build_object(
      'pattern_key', upd.pattern_key,
      'title', upd.title,
      'reason', 'closed_by_coverage_report_2026_05_01',
      'mapping', CASE WHEN upd.pattern_key = 'exam_pool_503_empty_loop_v1'
                      THEN 'pre_flight + stagnation + fail_fast + drift_heal'
                      ELSE 'dag_guard_eskalation + tail_step_defer + requeue_loop_mitigation'
                 END
    )
  FROM upd;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Closed % permanent-fix backlog items as done (already_implemented)', v_count;
END $$;