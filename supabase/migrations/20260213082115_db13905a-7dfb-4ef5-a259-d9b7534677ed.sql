
-- Fix search_path on all remaining non-SECURITY DEFINER functions
-- These are trigger/utility functions - adding search_path for hardening

ALTER FUNCTION public.cents_to_de_decimal SET search_path = public;
ALTER FUNCTION public.compliance_severity_rank SET search_path = public;
ALTER FUNCTION public.compute_question_hash SET search_path = public;
ALTER FUNCTION public.generate_invoice_number SET search_path = public;
ALTER FUNCTION public.guard_exam_question_blueprint_approved SET search_path = public;
ALTER FUNCTION public.guard_minicheck_items_approved SET search_path = public;
ALTER FUNCTION public.guard_publish_marketing SET search_path = public;
ALTER FUNCTION public.guard_publish_requires_seal SET search_path = public;
ALTER FUNCTION public.guard_publish_tutor_assets SET search_path = public;
ALTER FUNCTION public.month_start SET search_path = public;
ALTER FUNCTION public.next_package_queue_position SET search_path = public;
ALTER FUNCTION public.normalize_question_text SET search_path = public;
ALTER FUNCTION public.normalize_search_text SET search_path = public;
ALTER FUNCTION public.prevent_ledger_mutation SET search_path = public;
ALTER FUNCTION public.qa_severity_rank SET search_path = public;
ALTER FUNCTION public.search_berufe SET search_path = public;
ALTER FUNCTION public.search_public SET search_path = public;
ALTER FUNCTION public.set_updated_at SET search_path = public;
ALTER FUNCTION public.trg_compliance_findings_updated SET search_path = public;
ALTER FUNCTION public.trg_fill_exam_question_hash SET search_path = public;
ALTER FUNCTION public.update_sr_updated_at SET search_path = public;
