
UPDATE public.handbook_sections
SET 
  basis_content = REPLACE(REPLACE(basis_content, 'mangeldes', 'mangelndes'), 'folgendermassen', 'folgendermaßen'),
  expanded_content = REPLACE(REPLACE(expanded_content, 'mangeldes', 'mangelndes'), 'folgendermassen', 'folgendermaßen')
WHERE id = 'd177061b-0252-4f5f-8eac-aefdc5ea56ab';

-- Also resolve the audit finding
UPDATE public.content_quality_audit_findings
SET status = 'resolved', resolved_at = now()
WHERE artifact_id = 'd177061b-0252-4f5f-8eac-aefdc5ea56ab' AND status = 'open';
