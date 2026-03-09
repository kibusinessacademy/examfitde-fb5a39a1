
-- Forensik-Reset: Verkäufer Paket 59b6e214 – 4/5 Handbook-Kapitel leer trotz done-Status
-- Root Cause: generate_handbook hat nur Kapitel 1 befüllt, dann done gemeldet

-- 1) Reset generate_handbook → queued für Neugenerierung
UPDATE package_steps 
SET status = 'queued', job_id = NULL, started_at = NULL, last_heartbeat_at = NULL, 
    last_error = 'Forensik-Reset: 4/5 Kapitel leer trotz done-Status', meta = '{}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'generate_handbook';

-- 2) Reset validate_handbook → queued
UPDATE package_steps 
SET status = 'queued', job_id = NULL, started_at = NULL, last_heartbeat_at = NULL, 
    last_error = NULL, meta = '{}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND step_key = 'validate_handbook';

-- 3) Cancel pending validate job
UPDATE job_queue 
SET status = 'cancelled', last_error = 'Forensik: cancelled for handbook re-generation'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04' 
  AND job_type = 'package_validate_handbook' 
  AND status IN ('pending', 'processing');
