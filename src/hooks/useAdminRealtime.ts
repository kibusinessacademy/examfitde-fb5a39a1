import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ═══════════════════════════════════════════════════════════
// Gold Pattern: Realtime Events + RPC Aggregates
// Events trigger re-fetch of KPIs (not raw state)
// ═══════════════════════════════════════════════════════════

export interface AdminKPIs {
  active_leases: number;
  running_steps: number;
  queued_packages: number;
  building_packages: number;
  failed_packages: number;
  done_packages: number;
  blocked_packages: number;
  // Extended from ops_health_summary
  health_score: number;
  traffic_light: 'green' | 'yellow' | 'red';
  failed_1h: number;
  stuck_jobs: number;
  daily_cost: number;
  auto_heal_allowed: boolean;
}

const DEFAULT_KPIS: AdminKPIs = {
  active_leases: 0, running_steps: 0, queued_packages: 0,
  building_packages: 0, failed_packages: 0, done_packages: 0,
  blocked_packages: 0, health_score: 100, traffic_light: 'green',
  failed_1h: 0, stuck_jobs: 0, daily_cost: 0, auto_heal_allowed: true,
};

export function useAdminKPIs() {
  const [kpis, setKpis] = useState<AdminKPIs>(DEFAULT_KPIS);
  const [loading, setLoading] = useState(true);
  const refreshRef = useRef(0);

  const fetchKPIs = useCallback(async () => {
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [healthRes, pipelineRes, costRes] = await Promise.all([
        (supabase as any).from('ops_health_summary').select('*').single(),
        (supabase as any).from('pipeline_health').select('*').single(),
        (supabase as any).from('llm_cost_events').select('cost_eur').gte('ts', todayStart.toISOString()),
      ]);

      const h = healthRes.data;
      const p = pipelineRes.data;
      const costs = (costRes.data || []) as { cost_eur: number }[];
      const dailyLlmCost = costs.reduce((s, c) => s + (c.cost_eur || 0), 0);

      setKpis({
        active_leases: p?.active_leases ?? 0,
        running_steps: p?.running_steps ?? 0,
        queued_packages: p?.queued_packages ?? 0,
        building_packages: p?.building_packages ?? 0,
        failed_packages: p?.failed_packages ?? 0,
        done_packages: p?.done_packages ?? 0,
        blocked_packages: p?.blocked_packages ?? 0,
        health_score: h?.health_score ?? 0,
        traffic_light: h?.traffic_light ?? 'red',
        failed_1h: h?.failed_1h ?? 0,
        stuck_jobs: h?.stuck_jobs ?? 0,
        daily_cost: dailyLlmCost + (h?.daily_autofix_cost ?? 0),
        auto_heal_allowed: h?.auto_heal_allowed ?? true,
      });
    } catch (e) {
      console.error('[AdminKPIs] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling fallback (30s)
  useEffect(() => {
    fetchKPIs();
    const interval = setInterval(fetchKPIs, 30_000);
    return () => clearInterval(interval);
  }, [fetchKPIs]);

  // Realtime subscriptions — trigger KPI re-fetch on changes
  useEffect(() => {
    const channel = supabase
      .channel('admin-kpi-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => fetchKPIs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_steps' }, () => fetchKPIs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_leases' }, () => fetchKPIs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_alerts' }, () => {
        refreshRef.current++;
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchKPIs]);

  return { kpis, loading, refetch: fetchKPIs, alertVersion: refreshRef.current };
}

// ═══════════════════════════════════════════════════════════
// Realtime Alerts
// ═══════════════════════════════════════════════════════════

export interface OpsAlert {
  id: string;
  source: string;
  severity: string;
  message: string;
  payload: any;
  created_at: string;
  acknowledged_at: string | null;
}

export function useRealtimeAlerts(limit = 30) {
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('ops_alerts')
      .select('*')
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    setAlerts(data || []);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-alerts-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ops_alerts' }, (payload) => {
        const newAlert = payload.new as OpsAlert;
        setAlerts(prev => [newAlert, ...prev].slice(0, limit));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ops_alerts' }, (payload) => {
        const updated = payload.new as OpsAlert;
        if (updated.acknowledged_at) {
          setAlerts(prev => prev.filter(a => a.id !== updated.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [limit]);

  const acknowledge = async (id: string) => {
    await (supabase as any).from('ops_alerts').update({ acknowledged_at: new Date().toISOString() }).eq('id', id);
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  return { alerts, loading, acknowledge, refetch: fetchAlerts };
}

// ═══════════════════════════════════════════════════════════
// Realtime Pipeline Steps (for active package)
// ═══════════════════════════════════════════════════════════

export interface PipelineStep {
  id: string;
  package_id: string;
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  last_error: string | null;
  runner_id: string | null;
}

export function useRealtimePipeline() {
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [activePackage, setActivePackage] = useState<any>(null);
  const [allPackages, setAllPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPipeline = useCallback(async () => {
    // Get ALL building packages
    const { data: pkgs } = await (supabase as any)
      .from('course_packages')
      .select('id,title,status,build_progress,pipeline_mode,created_at,updated_at')
      .eq('status', 'building')
      .order('updated_at', { ascending: false })
      .limit(10);

    const pkg = pkgs?.[0] ?? null;
    setActivePackage(pkg);
    setAllPackages(pkgs || []);

    if (pkgs?.length) {
      const pkgIds = pkgs.map((p: any) => p.id);
      const { data: stepsData } = await (supabase as any)
        .from('package_steps')
        .select('*')
        .in('package_id', pkgIds)
        .order('created_at', { ascending: true });
      setSteps(stepsData || []);
    } else {
      setSteps([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-pipeline-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_steps' }, () => fetchPipeline())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => fetchPipeline())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchPipeline]);

  return { steps, activePackage, allPackages, loading, refetch: fetchPipeline };
}
