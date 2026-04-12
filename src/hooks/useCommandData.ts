import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PipelinePackage {
  id: string;
  name: string;
  status: string;
  build_progress: number;
  current_step: number | null;
  updated_at: string;
  step_status_json: Record<string, string> | null;
  content_meta?: {
    remaining?: number;
    generated?: number;
    last_error?: string;
    dispatch_blocked_reason?: string;
    needs_regen?: number;
    active_lesson_jobs?: number;
  } | null;
}

export interface BuildingMetrics {
  active_by_jobs: number;
  active_by_leases: number;
  status_building: number;
  zombies: number;
}

export interface TransientOps {
  exhausted24h: number;
  exhaustedByJobType: Array<{ job_type: string; cnt: number }>;
  activeCooldowns: Array<{
    provider: string;
    model: string;
    reason: string | null;
    until_at: string;
  }>;
}

export interface CommandKPIs {
  total_packages: number;
  building: number;
  queued: number;
  published: number;
  done: number;
  failed: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_failed: number;
  jobs_completed_today: number;
  cost_today_eur: number;
  cost_mtd_eur: number;
  budget_eur: number;
  building_metrics: BuildingMetrics;
}

interface CommandData {
  packages: PipelinePackage[];
  kpis: CommandKPIs;
  transientOps: TransientOps;
}

const RELEVANT_EXHAUSTION_JOB_TYPES = new Set([
  'lesson_generate_content',
  'package_generate_learning_content',
  'package_generate_exam_pool',
  'package_generate_handbook',
  'package_generate_oral_exam',
  'package_generate_lesson_minichecks',
]);

async function fetchCommandData(): Promise<CommandData> {
  const sb = supabase as any;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const h24Ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    statusRes,
    buildingRes,
    jobStatusRes,
    jobsTodayRes,
    costTodayRes,
    costMtdRes,
    budgetRes,
    buildingMetricsRes,
    contentStepMetaRes,
    transientRes,
    cooldownRes,
  ] = await Promise.all([
    sb.from('course_packages').select('status').then((r: any) => {
      const data = r.data || [];
      return {
        total: data.length,
        building: data.filter((d: any) => d.status === 'building').length,
        queued: data.filter((d: any) => d.status === 'queued').length,
        published: data.filter((d: any) => d.status === 'published').length,
        done: data.filter((d: any) => d.status === 'done').length,
        failed: data.filter((d: any) => d.status === 'failed' || d.status === 'quality_gate_failed' || d.status === 'publish_failed').length,
      };
    }),
    sb.from('course_packages')
      .select('id, title, status, build_progress, current_step, step_status_json, updated_at')
      .eq('status', 'building')
      .order('build_progress', { ascending: false })
      .order('updated_at', { ascending: false }),
    sb.from('job_queue').select('status'),
    sb.from('job_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('completed_at', todayStart.toISOString()),
    sb.rpc('get_ai_cost_summary').then((r: any) => r.data ?? { cost_today: 0, cost_mtd: 0 }),
    Promise.resolve({ data: null }), // placeholder, cost now from RPC above
    sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
    sb.rpc('get_building_metrics'),
    sb.from('package_steps')
      .select('package_id, meta, last_error')
      .eq('step_key', 'generate_learning_content'),
    sb.from('job_queue')
      .select('job_type, last_error, meta')
      .eq('status', 'failed')
      .gte('updated_at', h24Ago)
      .ilike('last_error', '%TRANSIENT_EXHAUSTED%'),
    sb.from('llm_provider_cooldowns')
      .select('provider, model, reason, until_at')
      .gt('until_at', new Date().toISOString())
      .order('until_at', { ascending: true })
      .limit(20),
  ]);

  const statuses = await statusRes;
  const buildPkgs = buildingRes.data || [];
  const jobData = (jobStatusRes.data || []) as { status: string }[];

  const jobsPending = jobData.filter(j => j.status === 'pending').length;
  const jobsProcessing = jobData.filter(j => j.status === 'processing').length;
  const jobsFailed = jobData.filter(j => j.status === 'failed').length;

  const costSummary = costTodayRes as any;
  const costToday = Number(costSummary?.cost_today) || 0;
  const costMtd = Number(costSummary?.cost_mtd) || 0;
  const budgetRow = (budgetRes.data || [])[0];

  const contentMetaByPkg = new Map<string, {
    remaining?: number; generated?: number; last_error?: string;
    dispatch_blocked_reason?: string; needs_regen?: number; active_lesson_jobs?: number;
  }>();
  for (const row of (contentStepMetaRes.data || []) as any[]) {
    const meta = row.meta as Record<string, unknown> | null;
    contentMetaByPkg.set(row.package_id, {
      remaining: meta?.remaining != null ? Number(meta.remaining) : (meta?.needs_regen != null ? Number(meta.needs_regen) : undefined),
      generated: meta?.generated != null ? Number(meta.generated) : undefined,
      last_error: row.last_error || undefined,
      dispatch_blocked_reason: meta?.dispatch_blocked_reason as string | undefined,
      needs_regen: meta?.needs_regen != null ? Number(meta.needs_regen) : undefined,
      active_lesson_jobs: meta?.active_lesson_jobs != null ? Number(meta.active_lesson_jobs) : undefined,
    });
  }

  const exhaustedRows = ((transientRes.data || []) as any[]).filter((row) =>
    RELEVANT_EXHAUSTION_JOB_TYPES.has(row.job_type) || !RELEVANT_EXHAUSTION_JOB_TYPES.size
  );

  const exhaustedByJobTypeMap = new Map<string, number>();
  for (const row of exhaustedRows) {
    const jt = row.job_type || 'unknown';
    exhaustedByJobTypeMap.set(jt, (exhaustedByJobTypeMap.get(jt) || 0) + 1);
  }
  const exhaustedByJobType = Array.from(exhaustedByJobTypeMap.entries())
    .map(([job_type, cnt]) => ({ job_type, cnt }))
    .sort((a, b) => b.cnt - a.cnt);

  const activeCooldowns = ((cooldownRes.data || []) as any[]).map((r) => ({
    provider: r.provider as string,
    model: r.model as string,
    reason: (r.reason as string) || null,
    until_at: r.until_at as string,
  }));

  const enrichedPackages: PipelinePackage[] = buildPkgs.map((pkg: any) => ({
    id: pkg.id,
    name: (pkg.title || pkg.id.slice(0, 12)).replace('ExamFit – ', ''),
    status: pkg.status,
    build_progress: pkg.build_progress || 0,
    current_step: pkg.current_step,
    updated_at: pkg.updated_at,
    step_status_json: pkg.step_status_json,
    content_meta: contentMetaByPkg.get(pkg.id) || null,
  }));

  const bm = buildingMetricsRes?.data as BuildingMetrics | null;

  return {
    packages: enrichedPackages,
    kpis: {
      total_packages: statuses.total,
      building: statuses.building,
      queued: statuses.queued,
      published: statuses.published,
      done: statuses.done,
      failed: statuses.failed,
      jobs_pending: jobsPending,
      jobs_processing: jobsProcessing,
      jobs_failed: jobsFailed,
      jobs_completed_today: jobsTodayRes.count || 0,
      cost_today_eur: costToday,
      cost_mtd_eur: costMtd,
      budget_eur: budgetRow?.budget_eur ?? 200,
      building_metrics: bm ?? { active_by_jobs: 0, active_by_leases: 0, status_building: 0, zombies: 0 },
    },
    transientOps: {
      exhausted24h: exhaustedRows.length,
      exhaustedByJobType,
      activeCooldowns,
    },
  };
}

export function useCommandData() {
  const qc = useQueryClient();

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['command-data'],
    queryFn: fetchCommandData,
    refetchInterval: 30_000,
    staleTime: 15_000,
    // Keep previous data during refetch to prevent flash of zeros
    placeholderData: (prev) => prev,
    retry: 1,
  });

  // Realtime invalidation on course_packages changes
  useEffect(() => {
    const ch = supabase
      .channel('command-data-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => {
        qc.invalidateQueries({ queryKey: ['command-data'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const refetchAll = useCallback(() => { refetch(); }, [refetch]);

  return {
    packages: data?.packages ?? [],
    kpis: data?.kpis ?? null,
    transientOps: data?.transientOps ?? null,
    loading: isLoading,
    lastRefresh: new Date(dataUpdatedAt),
    refetch: refetchAll,
  };
}
