-- Phase 3: blocked-mode-only view (supplements job_artifact_blocks which shows ALL retries)
create or replace view public.job_artifact_blocked_mode as
select *
from public.job_artifact_blocks
where artifact_blocked = true
order by blocked_since asc nulls last;