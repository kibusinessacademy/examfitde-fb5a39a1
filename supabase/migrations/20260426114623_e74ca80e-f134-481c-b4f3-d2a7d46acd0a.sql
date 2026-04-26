-- 1) Backfill total_questions in package_steps meta für das betroffene Paket
UPDATE public.package_steps
SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
  'total_questions', (
    SELECT COUNT(*)::int
    FROM public.exam_questions eq
    JOIN public.course_packages cp ON cp.curriculum_id = eq.curriculum_id
    WHERE cp.id = 'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid
  ),
  'total_questions_backfilled_at', now()::text,
  'total_questions_backfill_reason', 'artifact_resolver_loop_cap_repair'
)
WHERE package_id = 'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'::uuid
  AND step_key = 'generate_exam_pool';

-- 2) Block-Meta in der Job-Queue für dieses Paket zurücksetzen, damit cockpit nicht mehr "missing" anzeigt
UPDATE public.job_queue
SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'artifact_blocked', false,
      'artifact_block_count', 0,
      'artifact_storm', false,
      'blocked_by_artifact', null,
      'blocked_by_producer', null,
      'last_missing_artifact', null,
      'artifact_unblocked_by', 'admin_total_questions_backfill',
      'artifact_unblocked_at', now()::text
    )
WHERE (payload->>'package_id') = 'ba96f6d9-c638-4bf3-aaca-3465ac363e8b'
  AND status = 'pending'
  AND (meta->>'blocked_by_artifact' = 'exam_questions' 
       OR meta->>'artifact_blocked' = 'true');