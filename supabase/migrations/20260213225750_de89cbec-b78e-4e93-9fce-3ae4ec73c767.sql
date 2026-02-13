
-- Fix 1: Add security_invoker=on to certification_cost_summary view
CREATE OR REPLACE VIEW public.certification_cost_summary
WITH (security_invoker = on)
AS
SELECT jc.package_id,
    jc.certification_id,
    jc.curriculum_id,
    COALESCE(cp.title, jc.package_id::text) AS certification_name,
    count(*) AS total_jobs,
    sum(jc.cost_eur)::numeric(10,2) AS total_cost_eur,
    sum(jc.tokens_input) AS total_tokens_input,
    sum(jc.tokens_output) AS total_tokens_output,
    sum(
        CASE
            WHEN jc.job_type = ANY (ARRAY['package_generate_exam_pool'::text, 'seed_exam_questions'::text, 'generate_blueprint_questions'::text, 'assessment_questions_generate'::text]) THEN jc.cost_eur
            ELSE 0::numeric
        END)::numeric(10,2) AS cost_exam_generation,
    sum(
        CASE
            WHEN jc.job_type = ANY (ARRAY['package_generate_oral_exam'::text, 'tutor_oral_exam_propose'::text]) THEN jc.cost_eur
            ELSE 0::numeric
        END)::numeric(10,2) AS cost_oral_generation,
    sum(
        CASE
            WHEN jc.job_type = 'package_generate_handbook'::text THEN jc.cost_eur
            ELSE 0::numeric
        END)::numeric(10,2) AS cost_handbook,
    sum(
        CASE
            WHEN jc.job_type = ANY (ARRAY['qc_worker_full'::text, 'quality_gate_7'::text, 'run_quality_checks'::text, 'package_run_integrity_check'::text]) THEN jc.cost_eur
            ELSE 0::numeric
        END)::numeric(10,2) AS cost_qa,
    sum(
        CASE
            WHEN jc.job_type <> ALL (ARRAY['package_generate_exam_pool'::text, 'seed_exam_questions'::text, 'generate_blueprint_questions'::text, 'assessment_questions_generate'::text, 'package_generate_oral_exam'::text, 'tutor_oral_exam_propose'::text, 'package_generate_handbook'::text, 'qc_worker_full'::text, 'quality_gate_7'::text, 'run_quality_checks'::text, 'package_run_integrity_check'::text]) THEN jc.cost_eur
            ELSE 0::numeric
        END)::numeric(10,2) AS cost_other,
    min(jc.created_at) AS first_cost_at,
    max(jc.created_at) AS last_cost_at
   FROM job_costs jc
     LEFT JOIN course_packages cp ON cp.id = jc.package_id
  GROUP BY jc.package_id, jc.certification_id, jc.curriculum_id, COALESCE(cp.title, jc.package_id::text);

-- Fix 2: Tighten profiles RLS - remove overly broad "admins_read_all_profiles" ALL policy 
-- and ensure clean separation of concerns
-- The existing policies are actually correct:
-- profiles_select_own: user_id = auth.uid()
-- profiles_update_own: user_id = auth.uid()  
-- profiles_admin_select_all: has_role(auth.uid(), 'admin')
-- profiles_admin_update_all: has_role(auth.uid(), 'admin')
-- profiles_insert_own: user_id = auth.uid()
-- deny_anon_profiles: false (blocks anon)

-- However, the "admins_read_all_profiles" ALL policy is redundant and overly broad
-- (it grants SELECT+INSERT+UPDATE+DELETE to admins). Remove it and keep the specific ones.
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.profiles;

-- Add explicit DELETE denial for non-service-role to prevent profile deletion
CREATE POLICY "no_profile_delete"
ON public.profiles
FOR DELETE
USING (false);
