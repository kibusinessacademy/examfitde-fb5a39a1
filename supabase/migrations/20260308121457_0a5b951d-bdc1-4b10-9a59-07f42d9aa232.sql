DO $$
DECLARE
  v_item RECORD;
  v_pkg_id UUID;
  v_course_id UUID;
BEGIN
  FOR v_item IN 
    SELECT pwi.id AS item_id, pwi.curriculum_id, cur.title
    FROM production_wave_items pwi
    JOIN curricula cur ON cur.id = pwi.curriculum_id
    WHERE pwi.wave_id = 'caf55ec5-b1b4-4df5-9f69-6b3371ff666f'
      AND pwi.package_id IS NULL
  LOOP
    SELECT id INTO v_course_id FROM courses WHERE curriculum_id = v_item.curriculum_id LIMIT 1;
    
    INSERT INTO course_packages (curriculum_id, course_id, title, status, build_progress, track)
    VALUES (v_item.curriculum_id, v_course_id, 'ExamFit – ' || v_item.title, 'queued', 0, 'AUSBILDUNG_VOLL')
    RETURNING id INTO v_pkg_id;
    
    UPDATE production_wave_items SET package_id = v_pkg_id, status = 'queued' WHERE id = v_item.item_id;
  END LOOP;
END $$;