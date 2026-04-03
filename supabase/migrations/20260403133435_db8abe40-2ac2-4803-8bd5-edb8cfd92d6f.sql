
-- Reset generation status
UPDATE lessons
SET generation_status = 'pending',
    generation_job_id = NULL,
    generation_claimed_at = NULL
WHERE id IN (
  'ff9a091d-80db-4bc9-b794-b986abec3c79',
  '6ad19e51-11db-4af0-a412-24045089e0dc',
  '19ea990a-62ce-4cbd-8e04-f5b37dd64004',
  'ab1368ec-4289-4563-8ecf-373e066a7231',
  'f280c62f-00ad-440e-bfd2-92c278f68475',
  'eb868afb-bdaa-400d-b249-b1ab03b8b02f',
  '8bce82b0-b345-476d-8405-ab6cb18477f1'
);

-- Write placeholder content via fixed helper
SELECT pipeline_write_lesson_content('ff9a091d-80db-4bc9-b794-b986abec3c79', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);
SELECT pipeline_write_lesson_content('6ad19e51-11db-4af0-a412-24045089e0dc', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);
SELECT pipeline_write_lesson_content('19ea990a-62ce-4cbd-8e04-f5b37dd64004', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);
SELECT pipeline_write_lesson_content('ab1368ec-4289-4563-8ecf-373e066a7231', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);
SELECT pipeline_write_lesson_content('f280c62f-00ad-440e-bfd2-92c278f68475', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);
SELECT pipeline_write_lesson_content('eb868afb-bdaa-400d-b249-b1ab03b8b02f', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);
SELECT pipeline_write_lesson_content('8bce82b0-b345-476d-8405-ab6cb18477f1', '{"html":"<p>Pending</p>","_placeholder":true}'::jsonb);

-- Reset content shards
UPDATE package_content_shards
SET status = 'pending',
    lesson_generated_count = 0,
    started_at = NULL,
    claimed_by_job_id = NULL,
    last_error = NULL
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001';

-- Reset pipeline steps
UPDATE package_steps
SET status = 'queued',
    started_at = NULL,
    finished_at = NULL,
    attempts = 0,
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{allow_regression}', 'true')
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND step_key IN ('fanout_learning_content', 'finalize_learning_content', 'generate_learning_content');

-- Clean up stale jobs
DELETE FROM job_queue
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND job_type IN ('lesson_generate_content_shard', 'package_finalize_learning_content', 'package_fanout_learning_content')
  AND status IN ('completed', 'failed', 'pending');
