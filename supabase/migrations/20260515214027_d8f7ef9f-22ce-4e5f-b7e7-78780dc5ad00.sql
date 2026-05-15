-- Persist thin_content_risk evaluation (live, set-returning function)
WITH r AS (
  SELECT * FROM admin_seo_thin_content_guard_evaluate(false, 20)
)
INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
SELECT 'seo_thin_content_guard_persist_run', 'system', 'success',
       jsonb_build_object(
         'count', (SELECT COUNT(*) FROM r),
         'low',    (SELECT COUNT(*) FROM r WHERE new_risk='low'),
         'medium', (SELECT COUNT(*) FROM r WHERE new_risk='medium'),
         'high',   (SELECT COUNT(*) FROM r WHERE new_risk='high'),
         'rows', (SELECT jsonb_agg(jsonb_build_object(
                    'curriculum', curriculum_title, 'intent', intent_key,
                    'prev', prev_risk, 'new', new_risk, 'enqueuable', enqueuable))
                  FROM r)
       );