
-- 1. Alias table
create table if not exists public.course_title_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_title text not null unique,
  canonical_title text not null,
  is_blocked boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_course_title_aliases_alias
  on public.course_title_aliases (lower(alias_title));

-- 2. Normalize helper
create or replace function public.normalize_course_title(input_text text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(replace(replace(replace(coalesce(input_text, ''), '–', '-'), '—', '-'), '  ', ' ')), '\s+', ' ', 'g'));
$$;

-- 3. Drop old views
drop view if exists public.v_ops_course_name_collisions cascade;
drop view if exists public.v_ops_invalid_course_titles cascade;
drop view if exists public.v_admin_visible_course_packages cascade;
drop view if exists public.v_course_display_ssot cascade;

-- 4. SSOT display view
create view public.v_course_display_ssot as
with base as (
  select
    cp.id as package_id, cp.course_id, cp.curriculum_id, cp.status,
    cp.build_progress, cp.integrity_passed, cp.council_approved,
    cp.council_approved_at, cp.published_at, cp.created_at, cp.updated_at,
    cp.components, cp.created_by, cp.priority, cp.title as pkg_title,
    c.id as course_row_id, c.title as raw_course_title,
    cu.title as raw_curriculum_title,
    b.id as beruf_id, b.bezeichnung_kurz as beruf_display_name,
    coalesce(
      nullif(trim(b.bezeichnung_kurz), ''),
      nullif(trim(cu.title), ''),
      nullif(trim(c.title), ''),
      cp.title
    ) as initial_title
  from public.course_packages cp
  left join public.courses c on c.id = cp.course_id
  left join public.curricula cu on cu.id = cp.curriculum_id
  left join public.berufe b on b.id = cu.beruf_id
  where cp.status <> 'archived'
),
aliased as (
  select base.*,
    coalesce(a.canonical_title, base.initial_title) as canonical_title
  from base
  left join public.course_title_aliases a
    on public.normalize_course_title(a.alias_title) = public.normalize_course_title(base.initial_title)
)
select
  package_id, package_id as id,
  course_id, curriculum_id, status, build_progress, integrity_passed,
  council_approved, council_approved_at, published_at, created_at, updated_at,
  components, created_by, priority,
  course_row_id, raw_course_title, raw_curriculum_title,
  beruf_id, beruf_display_name, initial_title,
  canonical_title, canonical_title as title,
  public.normalize_course_title(canonical_title) as canonical_title_norm
from aliased;

-- 5. Admin deduplicated view
create view public.v_admin_visible_course_packages as
with ranked as (
  select s.*,
    row_number() over (
      partition by coalesce(s.beruf_id::text, s.curriculum_id::text, s.canonical_title_norm)
      order by
        case s.status
          when 'published' then 1 when 'building' then 2 when 'queued' then 3
          when 'blocked' then 4 when 'council_review' then 5 when 'qa' then 6
          when 'planning' then 7 when 'quality_gate_failed' then 8 when 'failed' then 9
          else 99
        end,
        s.published_at desc nulls last, s.updated_at desc nulls last, s.created_at desc
    ) as rn
  from public.v_course_display_ssot s
)
select package_id, id, course_id, curriculum_id, status, build_progress,
  integrity_passed, council_approved, council_approved_at, published_at,
  created_at, updated_at, components, created_by, priority,
  beruf_id, canonical_title, canonical_title as title, canonical_title_norm,
  raw_course_title, raw_curriculum_title, beruf_display_name
from ranked where rn = 1;

-- 6. Integrity views
create view public.v_ops_course_name_collisions as
select canonical_title_norm, count(*) as cnt,
  array_agg(package_id order by created_at desc) as package_ids,
  array_agg(canonical_title order by created_at desc) as canonical_titles
from public.v_course_display_ssot
group by canonical_title_norm having count(*) > 1;

create view public.v_ops_invalid_course_titles as
select package_id, status, raw_course_title, raw_curriculum_title,
  canonical_title, canonical_title_norm, created_at
from public.v_course_display_ssot
where public.normalize_course_title(coalesce(raw_course_title, raw_curriculum_title, ''))
      <> canonical_title_norm;

-- 7. Seed aliases
insert into public.course_title_aliases (alias_title, canonical_title, is_blocked) values
  ('Verkäufer', 'Verkäufer/-in', true),
  ('Bankkaufmann', 'Bankkaufmann/-frau', false),
  ('Kaufmann im Einzelhandel', 'Kaufmann/-frau im Einzelhandel', false),
  ('Fachinformatiker Systemintegration', 'Fachinformatiker/-in Systemintegration', false),
  ('Fachinformatiker Anwendungsentwicklung', 'Fachinformatiker/-in Anwendungsentwicklung', false)
on conflict (alias_title) do update set canonical_title = excluded.canonical_title, is_blocked = excluded.is_blocked;

-- 8. Fix source data
update public.courses set title = 'Verkäufer/-in'
where public.normalize_course_title(title) = public.normalize_course_title('Verkäufer');

update public.courses set title = 'Bankkaufmann/-frau'
where public.normalize_course_title(title) = public.normalize_course_title('Bankkaufmann');

-- 9. Reset bogus council flags
update public.course_packages set council_approved = false
where council_approved = true and council_approved_at is null;
