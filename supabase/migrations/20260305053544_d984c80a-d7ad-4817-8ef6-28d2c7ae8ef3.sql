
DROP FUNCTION IF EXISTS public.check_trigger_bindings();
DROP FUNCTION IF EXISTS public.check_publish_integrity();

CREATE FUNCTION public.check_trigger_bindings()
RETURNS TABLE(expected_trigger text, expected_table text, enabled boolean, is_bound boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT etb.expected_trigger, etb.expected_table, etb.enabled,
    EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname='public' AND c.relname=etb.expected_table AND t.tgname=etb.expected_trigger AND t.tgenabled!='D') AS is_bound
  FROM expected_trigger_bindings etb WHERE etb.enabled=true ORDER BY etb.expected_table, etb.expected_trigger;
$$;

CREATE FUNCTION public.check_publish_integrity()
RETURNS TABLE(package_id uuid, curriculum_id uuid, approved_q bigint, integrity_passed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cp.id, c.curriculum_id, (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id=c.curriculum_id AND eq.status='approved'), cp.integrity_passed
  FROM course_packages cp JOIN courses c ON c.id=cp.course_id WHERE cp.status='published' AND (cp.integrity_passed IS NULL OR cp.integrity_passed=false) ORDER BY cp.updated_at DESC;
$$;
