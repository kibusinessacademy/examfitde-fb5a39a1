
-- Automatic FI Handbook Sharing: when AE validate_handbook → done,
-- copy core LF chapters (1-7) to SI, DPA, DV curricula

CREATE OR REPLACE FUNCTION public.fn_share_fi_handbook_chapters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_curriculum_id uuid := 'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1'; -- FI AE
  target_ids uuid[] := ARRAY[
    '53d13046-88bf-42bf-9a2e-05d5e4a4f272'::uuid,  -- FI SI
    'e52eab02-5f89-46ba-b3d5-3b16948f5ec3'::uuid,  -- FI DPA
    'cdb12a5a-2c21-408a-8879-ef5afa52057d'::uuid   -- FI DV
  ];
  target_id uuid;
  src_chapter record;
  new_chapter_id uuid;
  src_section record;
  chapters_shared int := 0;
  max_core_sort_order int := 7; -- LF01-LF07 are shared core
BEGIN
  FOREACH target_id IN ARRAY target_ids LOOP
    FOR src_chapter IN
      SELECT * FROM handbook_chapters
      WHERE curriculum_id = source_curriculum_id
      AND sort_order <= max_core_sort_order
      ORDER BY sort_order
    LOOP
      -- Skip if chapter already exists for target curriculum at this sort_order
      IF EXISTS (
        SELECT 1 FROM handbook_chapters
        WHERE curriculum_id = target_id
        AND sort_order = src_chapter.sort_order
      ) THEN
        CONTINUE;
      END IF;

      -- Create chapter for target curriculum
      new_chapter_id := gen_random_uuid();
      INSERT INTO handbook_chapters (
        id, curriculum_id, chapter_key, title, subtitle, description,
        icon, sort_order, estimated_reading_minutes, is_premium, is_published
      ) VALUES (
        new_chapter_id,
        target_id,
        replace(src_chapter.chapter_key, split_part(src_chapter.chapter_key, '-', 2), left(target_id::text, 8)),
        src_chapter.title,
        src_chapter.subtitle,
        src_chapter.description,
        src_chapter.icon,
        src_chapter.sort_order,
        src_chapter.estimated_reading_minutes,
        src_chapter.is_premium,
        src_chapter.is_published
      );

      -- Copy all sections for this chapter
      FOR src_section IN
        SELECT * FROM handbook_sections
        WHERE chapter_id = src_chapter.id
        ORDER BY sort_order
      LOOP
        INSERT INTO handbook_sections (
          id, chapter_id, section_key, title, content_markdown, content_type,
          sort_order, metadata, competency_id, learning_field_id,
          basis_content, expanded_content, content_tier,
          basis_generated_at, expanded_at, expand_status,
          quality_score, depth_markers
        ) VALUES (
          gen_random_uuid(),
          new_chapter_id,
          src_section.section_key,
          src_section.title,
          src_section.content_markdown,
          src_section.content_type,
          src_section.sort_order,
          jsonb_build_object('shared_from', source_curriculum_id, 'shared_at', now(), 'original_section_id', src_section.id),
          src_section.competency_id,
          src_section.learning_field_id,
          src_section.basis_content,
          src_section.expanded_content,
          src_section.content_tier,
          src_section.basis_generated_at,
          src_section.expanded_at,
          src_section.expand_status,
          src_section.quality_score,
          src_section.depth_markers
        );
      END LOOP;

      chapters_shared := chapters_shared + 1;
    END LOOP;
  END LOOP;

  -- Log the sharing action
  INSERT INTO admin_actions (action, payload, scope)
  VALUES (
    'fi_handbook_sharing',
    jsonb_build_object(
      'source', source_curriculum_id,
      'targets', to_jsonb(target_ids),
      'chapters_shared', chapters_shared,
      'max_sort_order', max_core_sort_order
    ),
    'system'
  );

  RETURN chapters_shared;
END;
$$;

-- Trigger: auto-fire when AE validate_handbook step → done
CREATE OR REPLACE FUNCTION public.trg_fi_handbook_share_on_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ae_package_id uuid;
  shared int;
BEGIN
  -- Only fire on status change to 'done' for validate_handbook step
  IF NEW.step_key = 'validate_handbook' AND NEW.status = 'done' 
     AND (OLD.status IS DISTINCT FROM 'done') THEN
    
    -- Check if this package belongs to FI AE curriculum
    SELECT cp.id INTO ae_package_id
    FROM course_packages cp
    WHERE cp.id = NEW.package_id
    AND cp.curriculum_id = 'a8a6340d-fd50-445f-a55b-7d5a6c72e2e1';
    
    IF ae_package_id IS NOT NULL THEN
      shared := fn_share_fi_handbook_chapters();
      
      -- Also mark generate_handbook steps as 'done' for target packages
      -- if they have shared chapters now (skip redundant generation)
      UPDATE package_steps
      SET status = 'done',
          last_error = 'SHARED_FROM_FI_AE: ' || shared || ' chapters copied'
      WHERE step_key = 'generate_handbook'
        AND status IN ('queued', 'enqueued')
        AND package_id IN (
          SELECT cp.id FROM course_packages cp
          WHERE cp.curriculum_id IN (
            '53d13046-88bf-42bf-9a2e-05d5e4a4f272',
            'e52eab02-5f89-46ba-b3d5-3b16948f5ec3',
            'cdb12a5a-2c21-408a-8879-ef5afa52057d'
          )
          AND cp.status IN ('building','queued')
        )
        AND shared > 0;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach trigger to package_steps
DROP TRIGGER IF EXISTS trg_fi_handbook_share ON package_steps;
CREATE TRIGGER trg_fi_handbook_share
  AFTER UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION trg_fi_handbook_share_on_validate();
