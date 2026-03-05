create or replace function public.audit_track_plausibility(p_limit int default 50)
returns table (
  package_id uuid,
  title text,
  track text,
  status text,
  lessons_total bigint,
  lessons_placeholder bigint,
  didaktik_steps bigint,
  verdict text
)
language sql
stable
security definer
set search_path = public
as $$
  with pkg as (
    select cp.id as package_id, cp.course_id, cp.title, cp.track::text as track, cp.status
    from course_packages cp
    where cp.status not in ('archived', 'cancelled')
  ),
  lc as (
    select cp.id as package_id,
      count(l.id) as lessons_total,
      count(*) filter (where l.content is null or l.content::text ilike '%_placeholder%') as lessons_placeholder
    from course_packages cp
    join courses c on c.id = cp.course_id
    join modules m on m.course_id = c.id
    join lessons l on l.module_id = m.id
    where cp.status not in ('archived', 'cancelled')
    group by cp.id
  ),
  sc as (
    select ps.package_id,
      count(*) filter (where ps.step_key in (
        'generate_learning_content','validate_learning_content',
        'generate_glossary','generate_handbook','validate_handbook',
        'generate_lesson_minichecks','validate_lesson_minichecks'
      )) as didaktik_steps
    from package_steps ps
    group by ps.package_id
  ),
  scored as (
    select
      p.package_id,
      p.title,
      p.track,
      p.status,
      coalesce(lc.lessons_total, 0) as lessons_total,
      coalesce(lc.lessons_placeholder, 0) as lessons_placeholder,
      coalesce(sc.didaktik_steps, 0) as didaktik_steps,
      case
        when p.track = 'EXAM_FIRST' and coalesce(lc.lessons_total, 0) > 220
          then 'RED_FLAG: exam_first_too_many_lessons'
        when p.track = 'EXAM_FIRST' and coalesce(lc.lessons_placeholder, 0) > 200
          then 'RED_FLAG: exam_first_mass_placeholders'
        when p.track = 'EXAM_FIRST' and coalesce(sc.didaktik_steps, 0) > 2
          then 'RED_FLAG: exam_first_has_didaktik_steps'
        when p.track = 'AUSBILDUNG_VOLL' and coalesce(lc.lessons_total, 0) < 80
          and p.status not in ('planning', 'queued')
          then 'RED_FLAG: voll_too_few_lessons'
        else 'OK'
      end as verdict
    from pkg p
    left join lc on lc.package_id = p.package_id
    left join sc on sc.package_id = p.package_id
  )
  select * from scored
  order by
    case when scored.verdict <> 'OK' then 0 else 1 end,
    scored.lessons_total desc nulls last
  limit p_limit;
$$;

revoke all on function public.audit_track_plausibility(int) from public;