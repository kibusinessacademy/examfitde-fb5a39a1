import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Package,
  XCircle, Wrench, Activity, DollarSign, Rocket,
  Play, RefreshCw, RotateCcw, Loader2, Radio, Layers, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const MAX_SLOTS = 5;
const REFRESH_INTERVAL = 30_000;

interface SlotInfo {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  current_step: string | null;
  priority: number;
  updated_at: string;
}

interface PipelineStepInfo {
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  job_id: string | null;
}

interface QueueStats {
  queued: number;
  building: number;
  failed: number;
  published: number;
  blocked: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs24h: number;
  failedJobs24h: number;
  dailyCost: number;
}

export default function CommandPage() {
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [stepsMap, setStepsMap] = useState<Record<string, PipelineStepInfo[]>>({});
  const [stats, setStats] = useState<QueueStats>({
    queued: 0, building: 0, failed: 0, published: 0, blocked: 0,
    pendingJobs: 0, processingJobs: 0, completedJobs24h: 0, failedJobs24h: 0, dailyCost: 0,
  });
  const [failedPkgs, setFailedPkgs] = useState<SlotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const sb = supabase as any;
      const now24h = new Date(Date.now() - 86400_000).toISOString();
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);

      const [pkgRes, failedRes, statsRes, jobStatsRes, costRes] = await Promise.all([
        sb.from('course_packages')
          .select('id, title, status, build_progress, current_step, priority, updated_at')
          .eq('status', 'building')
          .order('priority', { ascending: true })
          .limit(MAX_SLOTS),
        sb.from('course_packages')
          .select('id, title, status, build_progress, current_step, priority, updated_at')
          .eq('status', 'failed')
          .order('updated_at', { ascending: false })
          .limit(5),
        sb.from('course_packages')
          .select('status'),
        sb.from('job_queue')
          .select('status, completed_at'),
        sb.from('ai_usage_log')
          .select('cost_eur')
          .gte('created_at', todayStart.toISOString()),
      ]);

      const activeSlots = (pkgRes.data || []) as SlotInfo[];
      setSlots(activeSlots);
      setFailedPkgs((failedRes.data || []) as SlotInfo[]);

      // Load steps for active packages
      if (activeSlots.length > 0) {
        const { data: stepsData } = await sb.from('package_steps')
          .select('package_id, step_key, status, attempts, max_attempts, job_id')
          .in('package_id', activeSlots.map(s => s.id))
          .order('created_at', { ascending: true });
        
        const map: Record<string, PipelineStepInfo[]> = {};
        for (const step of (stepsData || [])) {
          if (!map[step.package_id]) map[step.package_id] = [];
          map[step.package_id].push(step);
        }
        setStepsMap(map);
      }

      // Compute stats
      const allPkgs = (statsRes.data || []) as { status: string }[];
      const allJobs = (jobStatsRes.data || []) as { status: string; completed_at: string | null }[];
      const costs = (costRes.data || []) as { cost_eur: number }[];

      setStats({
        queued: allPkgs.filter(p => p.status === 'queued').length,
        building: allPkgs.filter(p => p.status === 'building').length,
        failed: allPkgs.filter(p => p.status === 'failed').length,
        published: allPkgs.filter(p => p.status === 'published').length,
        blocked: allPkgs.filter(p => p.status === 'blocked').length,
        pendingJobs: allJobs.filter(j => j.status === 'pending').length,
        processingJobs: allJobs.filter(j => j.status === 'processing').length,
        completedJobs24h: allJobs.filter(j => j.status === 'completed' && j.completed_at && j.completed_at >= now24h).length,
        failedJobs24h: allJobs.filter(j => j.status === 'failed' && j.completed_at && j.completed_at >= now24h).length,
        dailyCost: costs.reduce((sum, c) => sum + (c.cost_eur || 0), 0),
      });

      setLastRefresh(new Date());
    } catch (e) { console.error('[Command] Load error:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  // Realtime subscription for instant updates
  useEffect(() => {
    const channel = supabase
      .channel('command-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_packages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_steps' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const triggerRunner = async () => {
    setActing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pipeline-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      toast.success('Pipeline-Runner getriggert');
      setTimeout(load, 2000);
    } catch (e: any) { toast.error(e.message); }
    setActing(false);
  };

  const retryAllFailed = async () => {
    setActing(true);
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString(), scheduled_at: null, locked_at: null, locked_by: null })
      .eq('status', 'failed');
    toast.success('Failed Jobs zurückgesetzt');
    load();
    setActing(false);
  };

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    </div>
  );

  const slotsUsed = slots.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Produktions-Leitstelle</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Echtzeit · Auto-Refresh {REFRESH_INTERVAL / 1000}s · Letztes Update: {lastRefresh.toLocaleTimeString('de-DE')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={triggerRunner} disabled={acting}>
            <Play className="h-3.5 w-3.5 mr-1" /> Runner starten
          </Button>
          <Button variant="outline" size="sm" onClick={retryAllFailed} disabled={acting || stats.failedJobs24h === 0}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Failed retrien
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <MiniKPI label="Slots" value={`${slotsUsed}/${MAX_SLOTS}`} alert={slotsUsed === 0} icon={<Radio className="h-3 w-3" />} />
        <MiniKPI label="Queue" value={stats.queued} icon={<Layers className="h-3 w-3" />} />
        <MiniKPI label="Published" value={stats.published} color="text-emerald-500" icon={<CheckCircle2 className="h-3 w-3" />} />
        <MiniKPI label="Failed" value={stats.failed} alert={stats.failed > 0} icon={<XCircle className="h-3 w-3" />} />
        <MiniKPI label="Jobs aktiv" value={stats.processingJobs} icon={<Activity className="h-3 w-3" />} />
        <MiniKPI label="Jobs wartend" value={stats.pendingJobs} icon={<Clock className="h-3 w-3" />} />
        <MiniKPI label="Jobs ✓ 24h" value={stats.completedJobs24h} color="text-emerald-500" />
        <MiniKPI label="Kosten" value={`€${stats.dailyCost.toFixed(1)}`} icon={<DollarSign className="h-3 w-3" />} />
      </div>

      {/* ═══ SLOT UTILIZATION ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              Slot-Auslastung ({slotsUsed}/{MAX_SLOTS})
            </span>
            <SlotMeter used={slotsUsed} total={MAX_SLOTS} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {Array.from({ length: MAX_SLOTS }).map((_, i) => {
              const slot = slots[i];
              if (!slot) return <EmptySlot key={i} index={i} />;
              const steps = stepsMap[slot.id] || [];
              return <ActiveSlot key={slot.id} slot={slot} steps={steps} index={i} />;
            })}
          </div>
        </CardContent>
      </Card>

      {/* Failed Packages */}
      {failedPkgs.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" /> Fehlgeschlagen ({failedPkgs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {failedPkgs.map(pkg => (
              <Link key={pkg.id} to={`/admin/studio/${pkg.id}`} className="block">
                <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-destructive/5 border border-destructive/10 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <span className="text-sm truncate">{pkg.title || pkg.id.slice(0, 12)}</span>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Quick Links */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/studio/new"><Rocket className="h-3.5 w-3.5 mr-1" /> Neues Paket</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/ops"><Activity className="h-3.5 w-3.5 mr-1" /> Ops Details</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/business"><DollarSign className="h-3.5 w-3.5 mr-1" /> Finanzen</Link>
        </Button>
      </div>
    </div>
  );
}

// ═══ Sub-Components ═══

const STEP_LABELS: Record<string, string> = {
  scaffold_learning_course: 'Scaffold',
  auto_seed_exam_blueprints: 'Blueprints',
  generate_exam_pool: 'Prüfungen',
  generate_oral_exam: 'Mündlich',
  build_ai_tutor_index: 'Tutor',
  generate_handbook: 'Handbuch',
  run_integrity_check: 'Integrität',
  quality_council: 'QA',
  auto_publish: 'Publish',
};

function SlotMeter({ used, total }: { used: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={cn(
          "w-3 h-3 rounded-sm transition-colors",
          i < used ? "bg-primary" : "bg-muted"
        )} />
      ))}
    </div>
  );
}

function EmptySlot({ index }: { index: number }) {
  return (
    <div className="border border-dashed border-border rounded-lg p-3 flex flex-col items-center justify-center min-h-[120px] opacity-40">
      <Package className="h-5 w-5 text-muted-foreground mb-1" />
      <span className="text-[10px] text-muted-foreground">Slot {index + 1} frei</span>
    </div>
  );
}

function ActiveSlot({ slot, steps, index }: { slot: SlotInfo; steps: PipelineStepInfo[]; index: number }) {
  const doneSteps = steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const totalSteps = steps.length || 9;
  const activeStep = steps.find(s => s.status === 'enqueued' || s.status === 'running');
  const failedStep = steps.find(s => s.status === 'failed');

  return (
    <Link to={`/admin/studio/${slot.id}`} className="block">
      <div className={cn(
        "border rounded-lg p-3 min-h-[120px] hover:shadow-md transition-all",
        failedStep ? "border-destructive/30 bg-destructive/5" : "border-primary/30 bg-primary/5"
      )}>
        <div className="flex items-center justify-between mb-2">
          <Badge variant="outline" className="text-[9px] px-1">Slot {index + 1}</Badge>
          {activeStep && (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          )}
        </div>
        <p className="text-xs font-medium truncate mb-2">{slot.title || slot.id.slice(0, 12)}</p>
        
        {/* Step progress mini-bar */}
        <div className="flex gap-0.5 mb-1.5">
          {steps.map(s => (
            <div key={s.step_key} className={cn(
              "h-1 flex-1 rounded-full",
              s.status === 'done' || s.status === 'skipped' ? 'bg-emerald-500' :
              s.status === 'enqueued' || s.status === 'running' ? 'bg-primary animate-pulse' :
              s.status === 'failed' ? 'bg-destructive' :
              'bg-muted'
            )} title={`${STEP_LABELS[s.step_key] || s.step_key}: ${s.status}`} />
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground">
          {doneSteps}/{totalSteps} Steps
          {activeStep && <> · <span className="text-primary">{STEP_LABELS[activeStep.step_key] || activeStep.step_key}</span></>}
          {failedStep && <> · <span className="text-destructive">{STEP_LABELS[failedStep.step_key]} ❌</span></>}
        </p>
        {activeStep && activeStep.attempts > 1 && (
          <p className="text-[9px] text-muted-foreground">Attempt {activeStep.attempts}/{activeStep.max_attempts}</p>
        )}
      </div>
    </Link>
  );
}

function MiniKPI({ label, value, color, alert: isAlert, icon }: { 
  label: string; value: any; color?: string; alert?: boolean; icon?: React.ReactNode 
}) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2",
      isAlert ? "border-destructive/50 bg-destructive/5" : "border-border"
    )}>
      <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-lg font-bold", isAlert ? "text-destructive" : color || "text-foreground")}>{value}</p>
    </div>
  );
}
