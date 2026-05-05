UPDATE seo_content_pages s
SET status='published', updated_at=now()
FROM course_packages cp
WHERE s.curriculum_id = cp.curriculum_id
  AND cp.status='published'
  AND COALESCE(cp.integrity_passed,false)=true
  AND s.status='draft';

CREATE OR REPLACE FUNCTION public.admin_seo_publish_drift_heal()
RETURNS TABLE(curriculum_id uuid, pages_published int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT cp.curriculum_id
    FROM course_packages cp
    WHERE cp.status='published' AND COALESCE(cp.integrity_passed,false)=true
  ),
  upd AS (
    UPDATE seo_content_pages s
    SET status='published', updated_at=now()
    FROM eligible e
    WHERE s.curriculum_id = e.curriculum_id AND s.status='draft'
    RETURNING s.curriculum_id, s.id
  )
  SELECT u.curriculum_id, COUNT(*)::int
  FROM upd u GROUP BY u.curriculum_id;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, payload)
  VALUES('seo_publish_drift_heal','system','ok', jsonb_build_object('triggered_at', now()));
END $$;

REVOKE ALL ON FUNCTION public.admin_seo_publish_drift_heal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_publish_drift_heal() TO authenticated, service_role;