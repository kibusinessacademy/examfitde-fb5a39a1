import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PipelinePackage {
  id: string;
  name: string;
  status: string;
  build_progress: number;
  current_step: number | null;
  updated_at: string;
  /** SSOT – all step statuses live here */
  step_status_json: Record<string, string> | null;
  /** Content step meta (remaining/generated hollow lessons) */
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
      ] = await Promise.all([
        sb.from('course_packages').select('status').then((r: any) => {
          const data = r.data || [];
          return {
            total: data.length,
            building: data.filter((d: any) => d.status === 'building').length,
            queued: data.filter((d: any) => d.status === 'queued').length,
            published: data.filter((d: any) => d.status === 'published').length,
            done: data.filter((d: any) => d.status === 'done').length,
            failed: data.filter((d: any) => d.status === 'failed' || d.status === 'quality_gate_failed').length,
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
        sb.from('llm_cost_events').select('cost_eur').gte('ts', todayStart.toISOString()),
        sb.from('llm_cost_events').select('cost_eur').gte('ts', monthStart.toISOString()),
        sb.from('ai_cost_budgets').select('budget_eur, spent_eur').order('month', { ascending: false }).limit(1),
        sb.rpc('get_building_metrics'),
        // Content step meta for remaining/generated display
        sb.from('package_steps')
          .select('package_id, meta, last_error')
          .eq('step_key', 'generate_learning_content'),
      ]);

      const statuses = await statusRes;
      const buildPkgs = buildingRes.data || [];
      const jobData = (jobStatusRes.data || []) as { status: string }[];

      const jobsPending = jobData.filter(j => j.status === 'pending').length;
      const jobsProcessing = jobData.filter(j => j.status === 'processing').length;
      const jobsFailed = jobData.filter(j => j.status === 'failed').length;

      const costToday = ((costTodayRes.data || []) as { cost_eur: number }[]).reduce((s, c) => s + (c.cost_eur || 0), 0);
      const costMtd = ((costMtdRes.data || []) as { cost_eur: number }[]).reduce((s, c) => s + (c.cost_eur || 0), 0);
      const budgetRow = (budgetRes.data || [])[0];

      // Build content meta lookup from package_steps
      const contentMetaByPkg = new Map<string, { remaining?: number; generated?: number; last_error?: string }>();
      for (const row of (contentStepMetaRes.data || []) as any[]) {
        const meta = row.meta as Record<string, unknown> | null;
        contentMetaByPkg.set(row.package_id, {
          remaining: meta?.remaining != null ? Number(meta.remaining) : undefined,
          generated: meta?.generated != null ? Number(meta.generated) : undefined,
          last_error: row.last_error || undefined,
        });
      }

      // Map packages — step_status_json is the SSOT, no extra queries needed
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

      setPackages(enrichedPackages);
      const bm = buildingMetricsRes?.data as BuildingMetrics | null;
      setKpis({
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

  useEffect(() => {
    const ch = supabase
      .channel('command-data-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return { packages, kpis, loading, lastRefresh, refetch: load };
}
