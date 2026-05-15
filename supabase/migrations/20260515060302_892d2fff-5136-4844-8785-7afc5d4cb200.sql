UPDATE seo_content_priority_queue q
   SET job_id = jq.id,
       generation_status = 'queued',
       last_enqueued_at = COALESCE(q.last_enqueued_at, jq.created_at)
  FROM job_queue jq
 WHERE jq.payload->>'enqueue_source' = 'wave3_seed_2026-05-15'
   AND (jq.payload->>'priority_queue_id')::uuid = q.id
   AND q.wave = 3
   AND q.generation_status = 'ready';