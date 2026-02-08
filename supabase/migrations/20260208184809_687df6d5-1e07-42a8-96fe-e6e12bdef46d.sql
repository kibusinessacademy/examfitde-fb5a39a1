-- Fix azav_dashboard_stats view - restore missing fields
DROP VIEW IF EXISTS public.azav_dashboard_stats;
CREATE VIEW public.azav_dashboard_stats
WITH (security_invoker=true) AS
SELECT 
    -- QM Documents stats
    ( SELECT count(*) AS count
           FROM qm_documents) AS total_documents,
    ( SELECT count(*) AS count
           FROM qm_documents
          WHERE (status = 'approved'::text)) AS approved_qm_docs,
    ( SELECT count(*) AS count
           FROM qm_documents
          WHERE (status = 'draft'::text)) AS draft_qm_docs,
    ( SELECT count(*) AS count
           FROM qm_documents
          WHERE ((next_review_date IS NOT NULL) AND (next_review_date < CURRENT_DATE))) AS overdue_reviews,
    -- Massnahmen stats  
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen) AS total_massnahmen,
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen
          WHERE (zulassung_status = 'approved'::text)) AS approved_massnahmen,
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen
          WHERE (zulassung_status = 'active'::text OR zulassung_status = 'approved'::text)) AS active_massnahmen,
    ( SELECT count(*) AS count
           FROM azav_massnahmen_zulassungen
          WHERE ((zulassung_bis IS NOT NULL) AND (zulassung_bis < (now() + '30 days'::interval)))) AS expiring_soon,
    -- Audit stats
    ( SELECT count(*) AS count
           FROM azav_audit_log
          WHERE (audit_date >= (CURRENT_DATE - '30 days'::interval))) AS recent_audits,
    ( SELECT count(*) AS count
           FROM azav_audit_log
          WHERE (audit_date >= (CURRENT_DATE - '365 days'::interval))) AS audits_this_year,
    -- Compliance rate
    ( SELECT round((avg(
                CASE
                    WHEN (result = 'passed'::text) THEN 100
                    WHEN (result = 'partial'::text) THEN 50
                    ELSE 0
                END))::numeric, 1) AS round
           FROM azav_compliance_results
          WHERE (check_date >= (CURRENT_DATE - '90 days'::interval))) AS compliance_rate,
    -- Evidence packs
    ( SELECT count(*) AS count
           FROM course_evidence_packs
          WHERE (generated_at >= (CURRENT_DATE - '30 days'::interval))) AS recent_evidence_packs;