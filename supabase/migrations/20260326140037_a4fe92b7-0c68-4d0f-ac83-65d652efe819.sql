
INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload)
VALUES
  ('package_run_integrity_check', '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1', 'pending', 1, 5, 
   jsonb_build_object('curriculum_id', '2b9715cb-6cea-40ab-8a34-16cec0b1e74c')),
  ('package_run_integrity_check', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'pending', 1, 5, 
   jsonb_build_object('curriculum_id', '2c01d31e-e7ed-4b82-b04e-d5094d1dc179'));
