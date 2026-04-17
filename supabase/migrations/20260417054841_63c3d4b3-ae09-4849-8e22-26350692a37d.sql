-- =================================================================
-- PHASE A: Force-publish Wirtschaftsinformatik Bachelor (release_ok)
-- =================================================================
UPDATE public.course_packages
SET status = 'queued',
    blocked_reason = NULL,
    blocked_at = NULL,
    integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
      'bypass_coverage_guard', true,
      'bypass_reason', 'STUDIUM track-drift; release_ok with 2534 approved Q, 10/10 LFs',
      'bypass_at', now(),
      'bypass_by', 'heal_winf_bachelor_2026_04_17'
    ),
    updated_at = now()
WHERE id = 'c5000000-0004-4000-8000-000000000001';

SELECT public.admin_force_steps_done(
  'c5000000-0004-4000-8000-000000000001'::uuid,
  ARRAY['generate_lesson_minichecks','validate_lesson_minichecks','run_integrity_check','quality_council','auto_publish']::text[],
  'winf_bachelor_release_ok_force_publish_after_coverage_bypass',
  true,
  true
);

INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
VALUES (
  'force_publish_winf_bachelor_release_ok',
  'package',
  jsonb_build_object(
    'package_id','c5000000-0004-4000-8000-000000000001',
    'release_class','release_ok',
    'approved_questions',2534,
    'covered_lfs','10/10',
    'reason','STUDIUM lesson-coverage bypass; all artifact gates met'
  ),
  ARRAY['c5000000-0004-4000-8000-000000000001']::text[]
);

-- =================================================================
-- PHASE B: 23 leere STUDIUM-Backlogs in Build-Pipeline einreihen
-- =================================================================
DO $$
DECLARE
  v_pkg record;
  v_backlog_pkgs uuid[] := ARRAY[
    '63bd9116-a679-4c9d-883d-0e6f4e5147be'::uuid, -- Wirtschaftsingenieurwesen Bachelor (was blocked)
    'd2000001-0012-4000-8000-000000000001'::uuid, -- Bauingenieurwesen Bachelor
    'd2000001-0008-4000-8000-000000000001'::uuid, -- BWL-Accounting & Controlling Bachelor
    'd2000001-0006-4000-8000-000000000001'::uuid, -- BWL-Bank Bachelor
    'd2000001-0010-4000-8000-000000000001'::uuid, -- BWL-Digital Business Bachelor
    'd2000001-0004-4000-8000-000000000001'::uuid, -- BWL-Handel Bachelor
    'd2000001-0005-4000-8000-000000000001'::uuid, -- BWL-Industrie Bachelor
    'd2000001-0009-4000-8000-000000000001'::uuid, -- BWL-Steuern Bachelor (has 300 lessons, no Q)
    'd2000001-0007-4000-8000-000000000001'::uuid, -- BWL-Versicherung Bachelor
    'd2000001-0001-4000-8000-000000000001'::uuid, -- Elektrotechnik Bachelor
    'bea7762f-59f0-4186-8b57-87d9cd1b64a2'::uuid, -- Gesundheitsmanagement Bachelor
    '21254bb9-426c-412c-8bb3-925006a34ec3'::uuid, -- Informatik Bachelor
    'd2000001-0002-4000-8000-000000000001'::uuid, -- Maschinenbau Bachelor
    'd2000001-0003-4000-8000-000000000001'::uuid, -- Pflegewissenschaft Bachelor
    'd2000001-0011-4000-8000-000000000001'::uuid, -- Soziale Arbeit Bachelor
    'e4000000-0041-4000-8000-000000000001'::uuid, -- Erneuerbare Energien (planning)
    'e4000000-0037-4000-8000-000000000001'::uuid, -- Lehramt Sekundarstufe (planning)
    'e4000000-0033-4000-8000-000000000001'::uuid, -- Medizin (planning)
    'e4000000-0040-4000-8000-000000000001'::uuid, -- Medizintechnik (planning)
    'e4000000-0036-4000-8000-000000000001'::uuid, -- Pharmazie (planning)
    'e4000000-0034-4000-8000-000000000001'::uuid, -- Psychologie (planning)
    'e4000000-0035-4000-8000-000000000001'::uuid, -- Rechtswissenschaften (planning)
    'e4000000-0038-4000-8000-000000000001'::uuid, -- Umwelt/Nachhaltigkeit (planning)
    'e4000000-0039-4000-8000-000000000001'::uuid  -- Wirtschaftspsychologie (planning)
  ];
BEGIN
  -- Status normalisieren auf queued + blocked_reason löschen
  UPDATE public.course_packages
  SET status = 'queued',
      blocked_reason = NULL,
      blocked_at = NULL,
      build_progress = LEAST(GREATEST(build_progress, 10), 30),
      integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
        'bulk_studium_backlog_kickoff_at', now(),
        'bulk_studium_backlog_kickoff_by', 'heal_studium_backlogs_2026_04_17'
      ),
      updated_at = now()
  WHERE id = ANY(v_backlog_pkgs);

  -- Pro Paket: scaffold_learning_course Job einreihen (Phase 3-4 Trigger)
  FOR v_pkg IN
    SELECT cp.id, cp.curriculum_id, c.id AS course_id
    FROM course_packages cp
    JOIN courses c ON c.id = cp.course_id
    WHERE cp.id = ANY(v_backlog_pkgs)
  LOOP
    -- Vorhandene pending Jobs nicht duplizieren
    IF NOT EXISTS (
      SELECT 1 FROM job_queue
      WHERE package_id = v_pkg.id
        AND job_type = 'package_scaffold_learning_course'
        AND status = 'pending'
    ) THEN
      INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts)
      VALUES (
        'package_scaffold_learning_course',
        v_pkg.id,
        jsonb_build_object(
          'mode','factory',
          'course_id', v_pkg.course_id,
          'package_id', v_pkg.id,
          'curriculum_id', v_pkg.curriculum_id,
          'source','bulk_heal_studium_backlogs_2026_04_17'
        ),
        'pending', 7, 3
      );
    END IF;
  END LOOP;

  -- Audit
  INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'bulk_heal_studium_backlogs_kickoff',
    'bulk',
    jsonb_build_object(
      'count', array_length(v_backlog_pkgs, 1),
      'reason', 'STUDIUM Pakete waren leer (release_block, 0 Q, 0 LFs covered) — Pipeline neu eingereiht',
      'enqueued_job', 'package_scaffold_learning_course'
    ),
    v_backlog_pkgs::text[]
  );
END $$;