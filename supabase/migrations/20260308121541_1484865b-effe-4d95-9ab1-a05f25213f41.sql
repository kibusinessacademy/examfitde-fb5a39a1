UPDATE production_waves 
SET status = 'active', started_at = now() 
WHERE id = 'caf55ec5-b1b4-4df5-9f69-6b3371ff666f' AND status = 'draft';