
-- 1) Audit Runs
create table if not exists public.content_quality_audit_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'published_packages',
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  package_count integer not null default 0,
  artifact_count integer not null default 0,
  finding_count integer not null default 0,
  critical_count integer not null default 0,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  info_count integer not null default 0,
  meta jsonb not null default '{}'::jsonb
);

alter table public.content_quality_audit_runs enable row level security;

create policy "Admins can manage audit runs"
  on public.content_quality_audit_runs for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 2) Findings
create table if not exists public.content_quality_audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.content_quality_audit_runs(id) on delete cascade,
  package_id uuid not null,
  curriculum_id uuid,
  course_id uuid,
  artifact_type text not null,
  artifact_id uuid not null,
  severity text not null default 'info',
  status text not null default 'open',
  title text,
  excerpt text,
  generic_phrase_count integer not null default 0,
  spelling_error_count integer not null default 0,
  generic_ratio numeric(6,4) not null default 0,
  generic_phrases jsonb not null default '[]'::jsonb,
  spelling_errors jsonb not null default '[]'::jsonb,
  detector_version text not null default 'v1',
  auto_reheal_eligible boolean not null default false,
  reheal_job_id uuid,
  resolved_at timestamptz,
  ignored_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cqaf_package on public.content_quality_audit_findings(package_id);
create index idx_cqaf_severity on public.content_quality_audit_findings(severity);
create index idx_cqaf_status on public.content_quality_audit_findings(status);
create index idx_cqaf_artifact_type on public.content_quality_audit_findings(artifact_type);

alter table public.content_quality_audit_findings enable row level security;

create policy "Admins can manage audit findings"
  on public.content_quality_audit_findings for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 3) Package Summary
create table if not exists public.package_content_quality_summary (
  package_id uuid primary key,
  last_audit_run_id uuid references public.content_quality_audit_runs(id) on delete set null,
  last_scanned_at timestamptz,
  open_findings integer not null default 0,
  critical_count integer not null default 0,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  info_count integer not null default 0,
  handbook_critical_count integer not null default 0,
  lesson_critical_count integer not null default 0,
  overall_severity text not null default 'info',
  reheal_recommended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.package_content_quality_summary enable row level security;

create policy "Admins can manage quality summary"
  on public.package_content_quality_summary for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 4) Updated-at triggers
create or replace function public.set_content_quality_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_cqaf_updated_at
  before update on public.content_quality_audit_findings
  for each row execute function public.set_content_quality_updated_at();

create trigger trg_pcqs_updated_at
  before update on public.package_content_quality_summary
  for each row execute function public.set_content_quality_updated_at();

-- 5) Admin Views
create or replace view public.v_admin_content_quality_packages as
select
  cp.id as package_id,
  cp.curriculum_id,
  cp.course_id,
  cp.status as package_status,
  coalesce(
    (select c.title from public.courses c where c.id = cp.course_id limit 1),
    cp.title
  ) as package_title,
  cp.track,
  pqs.last_scanned_at,
  coalesce(pqs.open_findings, 0) as open_findings,
  coalesce(pqs.critical_count, 0) as critical_count,
  coalesce(pqs.error_count, 0) as error_count,
  coalesce(pqs.warning_count, 0) as warning_count,
  coalesce(pqs.info_count, 0) as info_count,
  coalesce(pqs.handbook_critical_count, 0) as handbook_critical_count,
  coalesce(pqs.lesson_critical_count, 0) as lesson_critical_count,
  coalesce(pqs.overall_severity, 'info') as overall_severity,
  coalesce(pqs.reheal_recommended, false) as reheal_recommended
from public.course_packages cp
left join public.package_content_quality_summary pqs on pqs.package_id = cp.id;

create or replace view public.v_admin_content_quality_findings as
select
  f.id,
  f.audit_run_id,
  f.package_id,
  f.curriculum_id,
  f.course_id,
  f.artifact_type,
  f.artifact_id,
  f.severity,
  f.status,
  f.title,
  f.excerpt,
  f.generic_phrase_count,
  f.spelling_error_count,
  f.generic_ratio,
  f.generic_phrases,
  f.spelling_errors,
  f.auto_reheal_eligible,
  f.reheal_job_id,
  f.created_at,
  f.updated_at
from public.content_quality_audit_findings f;

notify pgrst, 'reload schema';
