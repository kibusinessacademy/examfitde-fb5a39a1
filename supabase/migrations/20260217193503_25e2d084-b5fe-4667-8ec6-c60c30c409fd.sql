
-- Auto-provisioning function: creates missing courses + course_packages for ALL curricula
CREATE OR REPLACE FUNCTION public.auto_provision_all_curricula()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur RECORD;
  v_course_id uuid;
  v_pkg_id uuid;
  v_courses_created int := 0;
  v_packages_created int := 0;
  v_jobs_queued int := 0;
  v_skipped int := 0;
  v_beruf_name text;
  v_cert_type certification_type;
  v_track product_track;
BEGIN
  FOR v_cur IN
    SELECT c.id AS curriculum_id,
           c.title AS curriculum_title,
           c.certification_type AS c_cert_type,
           c.track AS c_track,
           c.beruf_id,
           c.status AS c_status,
           b.bezeichnung_kurz AS beruf_name,
           co.id AS existing_course_id,
           cp.id AS existing_package_id
    FROM curricula c
    LEFT JOIN berufe b ON b.id = c.beruf_id
    LEFT JOIN courses co ON co.curriculum_id = c.id
    LEFT JOIN course_packages cp ON cp.curriculum_id = c.id
    WHERE c.status = 'frozen'  -- only frozen (ready) curricula
    ORDER BY c.created_at
  LOOP
    -- Determine beruf name
    v_beruf_name := COALESCE(v_cur.beruf_name, replace(replace(v_cur.curriculum_title, 'Rahmenlehrplan ', ''), 'Ausbildungsrahmenplan ', ''));
    
    -- Map certification_type
    v_cert_type := COALESCE(v_cur.c_cert_type::certification_type, 'ausbildung'::certification_type);
    v_track := COALESCE(v_cur.c_track::product_track, 'AUSBILDUNG_VOLL'::product_track);

    -- Step 1: Create course if missing
    IF v_cur.existing_course_id IS NULL THEN
      INSERT INTO courses (curriculum_id, title, description, status)
      VALUES (
        v_cur.curriculum_id,
        v_beruf_name || ' – IHK Prüfungsvorbereitung',
        'Vollständiges IHK-Prüfungstraining für ' || v_beruf_name || '. Blueprint-gestützt, simulationsoptimiert.',
        'draft'::course_status
      )
      RETURNING id INTO v_course_id;
      v_courses_created := v_courses_created + 1;
    ELSE
      v_course_id := v_cur.existing_course_id;
    END IF;

    -- Step 2: Create course_package if missing
    IF v_cur.existing_package_id IS NULL THEN
      INSERT INTO course_packages (
        curriculum_id, course_id, title, status,
        certification_type, track, pipeline_mode, priority
      )
      VALUES (
        v_cur.curriculum_id,
        v_course_id,
        'ExamFit – ' || v_beruf_name,
        'queued',
        v_cert_type,
        v_track,
        'factory'::pipeline_mode,
        100
      )
      RETURNING id INTO v_pkg_id;
      v_packages_created := v_packages_created + 1;

      -- Step 3: Queue setup job
      INSERT INTO job_queue (job_type, payload, status, priority)
      VALUES (
        'setup_course_package',
        jsonb_build_object(
          'package_id', v_pkg_id,
          'curriculum_id', v_cur.curriculum_id,
          'course_id', v_course_id
        ),
        'pending',
        100
      );
      v_jobs_queued := v_jobs_queued + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'courses_created', v_courses_created,
    'packages_created', v_packages_created,
    'jobs_queued', v_jobs_queued,
    'skipped_already_exists', v_skipped,
    'provisioned_at', now()
  );
END;
$$;
