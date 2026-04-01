
-- Cancel all pending/processing jobs EXCEPT the 4 repair_exam_pool_quality jobs for the target packages
UPDATE job_queue 
SET status = 'cancelled', updated_at = now()
WHERE status IN ('pending', 'processing')
AND id NOT IN (
  '871765c0-3ab3-4c29-8914-9472ca119cc0',
  'bffa6be1-1c8f-49dd-a8ae-944bb26dec3a',
  '7246e8e9-8c24-42a1-98df-ff94280ff18c',
  'ca1e0203-8209-4348-88b2-7dbd2d81504b'
);
