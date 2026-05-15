
DO $$
BEGIN
  PERFORM cron.unschedule('lf-gap-variant-bridge-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
VALUES ('manual_ops','lf_gap_variant_bridge_paused','system','system','success',
  'Cron lf-gap-variant-bridge-15min unscheduled — GATE_SOURCE_DRIFT: Klassifikator liest blueprint_variants (leer), Variant-Generator schreibt nach exam_question_variants (8k+ review, 0 approved). Bridge erzeugt sinnlose Fanouts die vom Phantom-Guard gecancelt werden.',
  jsonb_build_object(
    'cron_job','lf-gap-variant-bridge-15min',
    'evidence', jsonb_build_object(
      'bv_rows_for_pkgs', 0,
      'eqv_rows_curricula', 19029,
      'eqv_status_distribution','100% review, 0 approved',
      'phantom_cancel_rate','15/15',
      'phantom_error','STEP_ALREADY_DONE_PHANTOM'
    ),
    'real_subcode_candidate','LF_REPAIR_GATE_SOURCE_DRIFT',
    'next_decision','User: View-Fix oder Variant-Approval-Pipeline'));
