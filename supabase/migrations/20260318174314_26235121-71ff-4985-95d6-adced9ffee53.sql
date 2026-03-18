
-- ============================================================
-- SSOT Layer 1: Kanonische Package-Baseline View
-- ============================================================
create or replace view public.ops_package_baseline_v1 as
with pkg as (
  select
    cp.id as package_id,
    cp.course_id,
    cp.curriculum_id,
    cp.status as package_status,
    cp.build_progress,
    cp.integrity_passed,
    cp.integrity_report
  from public.course_packages cp
),
expected_competencies as (
  select
    p.package_id,
    c.id as competency_id
  from pkg p
  join public.learning_fields lf
    on lf.curriculum_id = p.curriculum_id
  join public.competencies c
    on c.learning_field_id = lf.id
),
approved_exam_questions as (
  select
    p.package_id,
    eq.id,
    eq.competency_id,
    eq.learning_field_id
  from pkg p
  join public.learning_fields lf2
    on lf2.curriculum_id = p.curriculum_id
  join public.exam_questions eq
    on eq.learning_field_id = lf2.id
  where eq.qc_status in ('approved', 'tier1_passed')
),
competency_coverage as (
  select
    ec.package_id,
    count(distinct ec.competency_id) as competencies_total,
    count(distinct aq.competency_id) filter (
      where aq.competency_id is not null
    ) as competencies_covered
  from expected_competencies ec
  left join approved_exam_questions aq
    on aq.package_id = ec.package_id
   and aq.competency_id = ec.competency_id
  group by ec.package_id
),
lesson_counts as (
  select
    p.package_id,
    count(distinct l.id) as lessons_total
  from pkg p
  join public.modules m
    on m.course_id = p.course_id
  join public.lessons l
    on l.module_id = m.id
  group by p.package_id
),
approved_question_counts as (
  select
    aq.package_id,
    count(*) as approved_questions
  from approved_exam_questions aq
  group by aq.package_id
),
oral_counts as (
  select
    p.package_id,
    count(*) as oral_blueprints
  from pkg p
  join public.oral_exam_blueprints oeb
    on oeb.curriculum_id = p.curriculum_id
  group by p.package_id
),
handbook_counts as (
  select
    p.package_id,
    count(*) as handbook_sections
  from pkg p
  join public.handbook_chapters hc2
    on hc2.curriculum_id = p.curriculum_id
  join public.handbook_sections hs
    on hs.chapter_id = hc2.id
  group by p.package_id
),
tutor_index_counts as (
  select
    p.package_id,
    count(*) as tutor_indices
  from pkg p
  join public.ai_tutor_context_index tci
    on tci.package_id = p.package_id
  group by p.package_id
)
select
  p.package_id,
  p.curriculum_id,
  p.course_id,
  p.package_status,
  p.build_progress,
  p.integrity_passed,
  coalesce(lc.lessons_total, 0)::int as lessons_total,
  coalesce(aqc.approved_questions, 0)::int as approved_questions,
  coalesce(oc.oral_blueprints, 0)::int as oral_blueprints,
  coalesce(hc.handbook_sections, 0)::int as handbook_sections,
  coalesce(tic.tutor_indices, 0)::int as tutor_indices,
  coalesce(cc.competencies_total, 0)::int as competencies_total,
  coalesce(cc.competencies_covered, 0)::int as competencies_covered,
  case
    when coalesce(cc.competencies_total, 0) = 0 then 0
    else round((cc.competencies_covered::numeric / cc.competencies_total::numeric) * 100, 1)
  end as competency_coverage_pct
from pkg p
left join lesson_counts lc on lc.package_id = p.package_id
left join approved_question_counts aqc on aqc.package_id = p.package_id
left join oral_counts oc on oc.package_id = p.package_id
left join handbook_counts hc on hc.package_id = p.package_id
left join tutor_index_counts tic on tic.package_id = p.package_id
left join competency_coverage cc on cc.package_id = p.package_id;

-- ============================================================
-- SSOT Layer 2: Effective Gate State View
-- ============================================================
create or replace view public.ops_package_effective_state_v1 as
select
  b.package_id,
  b.curriculum_id,
  b.course_id,
  b.package_status,
  b.build_progress,
  b.integrity_passed,
  b.lessons_total,
  b.approved_questions,
  b.oral_blueprints,
  b.handbook_sections,
  b.tutor_indices,
  b.competencies_total,
  b.competencies_covered,
  b.competency_coverage_pct,
  case
    when b.integrity_passed = true then 'passed'
    when b.package_status in ('quality_gate_failed', 'blocked', 'stuck') then 'failed'
    else 'pending'
  end as effective_quality_gate_state,
  (b.integrity_passed = true) as should_show_pass_banner,
  (b.integrity_passed is distinct from true) as should_show_fail_banner,
  case
    when b.integrity_passed = true then false
    when b.competency_coverage_pct < 40 then false
    else true
  end as autofix_allowed
from public.ops_package_baseline_v1 b;
