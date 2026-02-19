import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PipelinePackage {
  id: string;
  name: string;
  status: string;
  build_progress: number;
  current_step: number | null;
  steps_done: number;
  steps_running: number;
  steps_failed: number;
  lessons: number;
  q_approved: number;
  q_total: number;
  oral_sets: number;
  hb_chapters: number;
  tutor_index: number;
  updated_at: string;
  step_status_json: Record<string, string> | null;
  /** Pipeline step statuses for accurate checkmarks */
  step_generate_handbook: string;
  step_validate_handbook: string;
  step_build_tutor: string;
  step_validate_tutor: string;
  step_generate_oral: string;
  step_validate_oral: string;
  step_generate_exam_pool: string;
  step_validate_exam_pool: string;
}

export interface CommandKPIs {
  total_packages: number;
  building: number;
  queued: number;
  published: number;
  failed: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_failed: number;
  jobs_completed_today: number;
  cost_today_eur: number;
  cost_mtd_eur: number;
  budget_eur: number;
  total_lessons: number;
  total_questions: number;
  total_approved: number;
}

export function useCommandData() {
  const [packages, setPackages] = useState<PipelinePackage[]>([]);
  const [kpis, setKpis] = useState<CommandKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = useCallback(async () => {
    try {
      const sb = supabase as any;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      // Parallel queries for all data
      const [
        statusRes,
        buildingRes,
        jobStatusRes,
        jobsTodayRes,
        costTodayRes,
        costMtdRes,
        budgetRes,
      ] = await Promise.all([
        sb.from('course_packages').select('status').then((r: any) => {
          const data = r.data || [];
          return {
            total: data.length,
            building: data.filter((d: any) => d.status === 'building').length,
            queued: data.filter((d: any) => d.status === 'queued').length,
            published: data.filter((d: any) => d.status === 'published' || d.status === 'done').length,
            failed: data.filter((d: any) => d.status === 'failed' || d.status === 'quality_gate_failed').length,
          };
        }),
        // Get building packages with content metrics via individual queries
        sb.from('course_packages')
          .select('id, title, status, build_progress, current_step, step_status_json, updated_at, course_id, curriculum_id')
          .eq('status', 'building')
          .order('build_progress', { ascending: false })
          .order('updated_at', { ascending: false }),
        sb.from('job_queue').select('status'),
        sb.from('job_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('completed_at', todayStart.toISOString()),
        sb.from('llm_cost_events').select('cost_eur').gte('ts', todayStart.toISOString()),
        sb.from('llm_cost_events').select('cost_eur').gte('ts', monthStart.toISOString()),
        sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
      ]);

      const statuses = await statusRes;
      const buildPkgs = buildingRes.data || [];
      const jobData = (jobStatusRes.data || []) as { status: string }[];

      // Count job statuses
      const jobsPending = jobData.filter(j => j.status === 'pending').length;
      const jobsProcessing = jobData.filter(j => j.status === 'processing').length;
      const jobsFailed = jobData.filter(j => j.status === 'failed').length;

      // Cost calculations
      const costToday = ((costTodayRes.data || []) as { cost_eur: number }[]).reduce((s, c) => s + (c.cost_eur || 0), 0);
      const costMtd = ((costMtdRes.data || []) as { cost_eur: number }[]).reduce((s, c) => s + (c.cost_eur || 0), 0);
      const budgetRow = (budgetRes.data || [])[0];

      // Now get content metrics for building packages
      const enrichedPackages: PipelinePackage[] = [];

      // Batch queries for content metrics
      const courseIds = buildPkgs.map((p: any) => p.course_id).filter(Boolean);
      const curriculumIds = buildPkgs.map((p: any) => p.curriculum_id).filter(Boolean);
      const packageIds = buildPkgs.map((p: any) => p.id);

      // Use RPC for reliable question counts (avoids 1000-row limit and head:true issues)
      const questionCountsByCurriculum: Record<string, { total: number; approved: number }> = {};
      if (curriculumIds.length > 0) {
        const qcRes = await sb.rpc('get_package_question_counts', { p_curriculum_ids: curriculumIds });
        for (const row of (qcRes.data || [])) {
          questionCountsByCurriculum[row.curriculum_id] = {
            total: Number(row.total) || 0,
            approved: Number(row.approved) || 0,
          };
        }
      }

      // Use per-course lesson counts to avoid 1000-row limit
      const lessonCountsByCourse: Record<string, number> = {};
      const lessonCountPromises = courseIds.map(async (courseId: string) => {
        const { count } = await sb.from('lessons').select('id', { count: 'exact', head: true })
          .eq('module_id', sb.from('modules').select('id').eq('course_id', courseId));
        // Fallback: count via modules join
        const modRes = await sb.from('modules').select('id').eq('course_id', courseId);
        const moduleIds = (modRes.data || []).map((m: any) => m.id);
        if (!moduleIds.length) { lessonCountsByCourse[courseId] = 0; return; }
        const lessonRes = await sb.from('lessons').select('id', { count: 'exact', head: true }).in('module_id', moduleIds);
        lessonCountsByCourse[courseId] = lessonRes.count || 0;
      });

      const [oralRes, handbookRes, tutorRes, stepsRes] = await Promise.all([
        packageIds.length > 0
          ? sb.from('oral_exam_sessionsets').select('id, package_id').in('package_id', packageIds)
          : Promise.resolve({ data: [] }),
        curriculumIds.length > 0
          ? sb.from('handbook_chapters').select('id, curriculum_id').in('curriculum_id', curriculumIds)
          : Promise.resolve({ data: [] }),
        packageIds.length > 0
          ? sb.from('ai_tutor_context_index').select('id, package_id').in('package_id', packageIds)
          : Promise.resolve({ data: [] }),
        packageIds.length > 0
          ? sb.from('package_steps').select('package_id, step_key, status').in('package_id', packageIds)
          : Promise.resolve({ data: [] }),
        ...lessonCountPromises,
      ]);

      const orals = oralRes.data || [];
      const chapters = handbookRes.data || [];
      const tutors = tutorRes.data || [];
      const steps = stepsRes.data || [];

      let totalLessons = 0;
      let totalQuestions = 0;
      let totalApproved = 0;

      for (const pkg of buildPkgs) {
        const pkgLessons = lessonCountsByCourse[pkg.course_id] || 0;
        const qCounts = questionCountsByCurriculum[pkg.curriculum_id] || { total: 0, approved: 0 };
        const pkgQTotal = qCounts.total;
        const pkgQApproved = qCounts.approved;
        const pkgOral = orals.filter((o: any) => o.package_id === pkg.id).length;
        const pkgHb = chapters.filter((h: any) => h.curriculum_id === pkg.curriculum_id).length;
        const pkgTutor = tutors.filter((t: any) => t.package_id === pkg.id).length;
        const pkgSteps = steps.filter((s: any) => s.package_id === pkg.id);
        const stepMap = Object.fromEntries(pkgSteps.map((s: any) => [s.step_key, s.status]));

        totalLessons += pkgLessons;
        totalQuestions += pkgQTotal;
        totalApproved += pkgQApproved;

        enrichedPackages.push({
          id: pkg.id,
          name: (pkg.title || pkg.id.slice(0, 12)).replace('ExamFit – ', ''),
          status: pkg.status,
          build_progress: pkg.build_progress || 0,
          current_step: pkg.current_step,
          steps_done: pkgSteps.filter((s: any) => s.status === 'done').length,
          steps_running: pkgSteps.filter((s: any) => s.status === 'running').length,
          steps_failed: pkgSteps.filter((s: any) => s.status === 'failed').length,
          lessons: pkgLessons,
          q_approved: pkgQApproved,
          q_total: pkgQTotal,
          oral_sets: pkgOral,
          hb_chapters: pkgHb,
          tutor_index: pkgTutor,
          updated_at: pkg.updated_at,
          step_status_json: pkg.step_status_json,
          step_generate_handbook: stepMap['generate_handbook'] || 'queued',
          step_validate_handbook: stepMap['validate_handbook'] || 'queued',
          step_build_tutor: stepMap['build_ai_tutor_index'] || 'queued',
          step_validate_tutor: stepMap['validate_tutor_index'] || 'queued',
          step_generate_oral: stepMap['generate_oral_exam'] || 'queued',
          step_validate_oral: stepMap['validate_oral_exam'] || 'queued',
          step_generate_exam_pool: stepMap['generate_exam_pool'] || 'queued',
          step_validate_exam_pool: stepMap['validate_exam_pool'] || 'queued',
        });
      }

      setPackages(enrichedPackages);
      setKpis({
        total_packages: statuses.total,
        building: statuses.building,
        queued: statuses.queued,
        published: statuses.published,
        failed: statuses.failed,
        jobs_pending: jobsPending,
        jobs_processing: jobsProcessing,
        jobs_failed: jobsFailed,
        jobs_completed_today: jobsTodayRes.count || 0,
        cost_today_eur: costToday,
        cost_mtd_eur: costMtd,
        budget_eur: budgetRow?.budget_eur ?? 200,
        total_lessons: totalLessons,
        total_questions: totalQuestions,
        total_approved: totalApproved,
      });
      setLastRefresh(new Date());
    } catch (e) {
      console.error('[CommandData] Error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel('command-data-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_steps' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return { packages, kpis, loading, lastRefresh, refetch: load };
}
