
-- Drop all affected views first, then recreate
DROP VIEW IF EXISTS public.ops_package_content_depth CASCADE;
DROP VIEW IF EXISTS public.ops_package_qc_matrix CASCADE;
DROP VIEW IF EXISTS public.ops_learner_visible_readiness CASCADE;
DROP VIEW IF EXISTS public.ops_artifact_build_progress CASCADE;
DROP VIEW IF EXISTS public.ops_package_downstream_missing CASCADE;
