-- Cancel failed glossary jobs (pipeline will re-enqueue as needed)
UPDATE job_queue 
SET status = 'cancelled', last_error = 'cancelled: corrupt glossary purged, threshold fixed to 1'
WHERE job_type = 'package_generate_glossary' 
  AND status = 'failed';