
DO $$
DECLARE
  v_name text;
BEGIN
  -- Drop global UNIQUE constraint(s) on chapter_key alone
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'handbook_chapters'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attnum)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['chapter_key']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.handbook_chapters DROP CONSTRAINT %I', v_name);
    RAISE NOTICE 'Dropped global UNIQUE constraint: %', v_name;
  END LOOP;

  -- Drop any leftover global UNIQUE index on chapter_key alone
  FOR v_name IN
    SELECT i.relname
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'handbook_chapters'
      AND ix.indisunique
      AND NOT ix.indisprimary
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attnum)
        FROM unnest(ix.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      ) = ARRAY['chapter_key']::text[]
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid)
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_name);
    RAISE NOTICE 'Dropped global UNIQUE index: %', v_name;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'handbook_chapters'
      AND con.conname = 'handbook_chapters_curriculum_chapter_key_unique'
  ) THEN
    ALTER TABLE public.handbook_chapters
      ADD CONSTRAINT handbook_chapters_curriculum_chapter_key_unique
      UNIQUE (curriculum_id, chapter_key);
  END IF;
END $$;

COMMENT ON CONSTRAINT handbook_chapters_curriculum_chapter_key_unique
  ON public.handbook_chapters
  IS 'P0 fix: scoped from global chapter_key to (curriculum_id, chapter_key) to prevent cross-curriculum HTTP 500 loops in package_generate_handbook.';
