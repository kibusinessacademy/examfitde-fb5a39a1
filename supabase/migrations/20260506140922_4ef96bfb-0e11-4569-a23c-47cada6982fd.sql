
CREATE OR REPLACE FUNCTION public.admin_repair_grant_entitlement_drift(
  p_caller_id uuid DEFAULT NULL, p_dry_run boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_repaired int := 0; v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  FOR r IN
    SELECT g.user_id, g.curriculum_id, g.product_id
    FROM public.learner_course_grants g
    WHERE g.status='active'
      AND NOT EXISTS (SELECT 1 FROM public.entitlements e
                      WHERE e.user_id=g.user_id AND e.curriculum_id=g.curriculum_id)
    LIMIT 200
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO public.entitlements(
        user_id, curriculum_id, product_id, valid_from, valid_until,
        source, source_type, has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer)
      VALUES (r.user_id, r.curriculum_id, r.product_id, now(), now()+interval '12 months',
        'web', 'admin_grant', true, true, true, true);
      v_repaired := v_repaired+1;
    END IF;
    v_rows := v_rows || jsonb_build_object('user_id',r.user_id,'curriculum_id',r.curriculum_id);
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('system_audit_repair_entitlement_drift','system',
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'repaired',v_repaired,'rows',v_rows));
  RETURN jsonb_build_object('repaired',v_repaired,'dry_run',p_dry_run,'rows',v_rows);
END; $$;
