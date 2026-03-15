import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminVisiblePackages } from '@/hooks/useAdminVisiblePackages';
import { dedupeVisiblePackages } from '@/lib/admin/dedupeVisiblePackages';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  ArrowRight, CheckCircle2, Clock, XCircle, Wrench, Shield,
  Brain, Package, Rocket, Plus, Filter, Search, AlertTriangle,
  Zap, Eye, RefreshCw, Ban
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PageExplainer from '@/components/admin/PageExplainer';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  all: { label: 'Alle', color: 'bg-muted text-muted-foreground', icon: Filter },
  published: { label: 'Live', color: 'bg-success/20 text-success', icon: CheckCircle2 },
  building: { label: 'Build läuft', color: 'bg-primary/20 text-primary', icon: Wrench },
  queued: { label: 'Queued', color: 'bg-muted text-muted-foreground', icon: Clock },
  blocked: { label: 'Blockiert', color: 'bg-warning/20 text-warning', icon: Ban },
  planning: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: Clock },
  quality_gate_failed: { label: 'QG Failed', color: 'bg-destructive/20 text-destructive', icon: XCircle },
  failed: { label: 'Fehlgeschlagen', color: 'bg-destructive/20 text-destructive', icon: XCircle },
  council_review: { label: 'Council Review', color: 'bg-warning/20 text-warning', icon: Brain },
  qa: { label: 'QA', color: 'bg-accent/20 text-accent-foreground', icon: Shield },
  stuck: { label: 'Festgefahren', color: 'bg-destructive/20 text-destructive', icon: AlertTriangle },
};

const FILTER_OPTIONS = [
  'all', 'published', 'building', 'stuck', 'blocked', 'queued', 'planning', 'failed', 'quality_gate_failed', 'qa', 'council_review',
] as const;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function isStuck(pkg: { status: string; updated_at: string; build_progress: number }): boolean {
  if (pkg.status !== 'building') return false;
  const elapsed = Date.now() - new Date(pkg.updated_at).getTime();
  return elapsed > TWO_HOURS_MS;
}

export default function CoursePackagesList() {
  const { data: rawPackages, isLoading } = useAdminVisiblePackages();
  const packages = dedupeVisiblePackages(rawPackages || []);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  // Recovery mutation for failed packages
  const recoverMutation = useMutation({
    mutationFn: () => runAdminOpsAction('recover_failed_packages'),
    onSuccess: (data: any) => {
      toast.success(`${data.recovered || 0} fehlgeschlagene Pakete wiederhergestellt`);
      queryClient.invalidateQueries({ queryKey: ['course-packages'] });
    },
    onError: (err: Error) => toast.error(`Recovery fehlgeschlagen: ${err.message}`),
  });

  // Load real step-based progress for all packages (SSOT from package_steps)
  const { data: stepProgress } = useQuery({
    queryKey: ['package-step-progress'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('package_steps')
        .select('package_id, status, meta');
      if (error) throw error;
      const map: Record<string, { total: number; done: number; running: number; failed: number }> = {};
      for (const row of (data || [])) {
        if (!map[row.package_id]) map[row.package_id] = { total: 0, done: 0, running: 0, failed: 0 };
        const entry = map[row.package_id];
        entry.total++;
        // SSOT: Only use status field, never meta.ok (Forensic Rigor Policy)
        if (row.status === 'done' || row.status === 'skipped') entry.done++;
        else if (row.status === 'running') entry.running++;
        else if (row.status === 'failed') entry.failed++;
      }
      return map;
    },
    refetchInterval: 15000,
  });

  const stuckIds = useMemo(() => {
    const ids = new Set<string>();
    (packages || []).forEach(p => {
      if (isStuck(p)) ids.add(p.id);
    });
    return ids;
  }, [packages]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (packages || []).forEach(p => {
      const effective = stuckIds.has(p.id) ? 'stuck' : p.status;
      counts[effective] = (counts[effective] || 0) + 1;
    });
    return counts;
  }, [packages, stuckIds]);

  const filtered = useMemo(() => {
    let list = packages || [];

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter === 'stuck') {
      list = list.filter(p => stuckIds.has(p.id));
    } else if (statusFilter !== 'all') {
      list = list.filter(p => p.status === statusFilter && !stuckIds.has(p.id));
    }

    return list;
  }, [packages, statusFilter, searchQuery, stuckIds]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // Stuck always first
      const aStuck = stuckIds.has(a.id) ? -1 : 0;
      const bStuck = stuckIds.has(b.id) ? -1 : 0;
      if (aStuck !== bStuck) return aStuck - bStuck;

      const priority: Record<string, number> = {
        failed: 0, quality_gate_failed: 1, building: 2, qa: 3,
        council_review: 4, planning: 5, queued: 6, published: 7,
      };
      const pa = priority[a.status] ?? 5;
      const pb = priority[b.status] ?? 5;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filtered, stuckIds]);

  const publishedCount = (packages || []).filter(p => p.status === 'published').length;
  const stuckCount = stuckIds.size;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Kurspakete</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {packages?.length || 0} Pakete · {publishedCount} live
            {stuckCount > 0 && (
              <span className="text-destructive font-medium"> · {stuckCount} festgefahren</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(statusCounts['failed'] || 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => recoverMutation.mutate()}
              disabled={recoverMutation.isPending}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <RefreshCw className={cn("h-4 w-4 mr-1", recoverMutation.isPending && "animate-spin")} />
              {statusCounts['failed']} Failed wiederherstellen
            </Button>
          )}
          <Button asChild size="sm">
            <Link to="/admin/studio/new">
              <Plus className="h-4 w-4 mr-1" /> Neues Paket
            </Link>
          </Button>
        </div>
      </div>

      {/* Stuck Alert Banner */}
      {stuckCount > 0 && statusFilter !== 'stuck' && (
        <button
          onClick={() => setStatusFilter('stuck')}
          className="w-full flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm hover:bg-destructive/15 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="font-medium">
            {stuckCount} {stuckCount === 1 ? 'Kurs steckt' : 'Kurse stecken'} seit über 2 Stunden im Build fest
          </span>
          <Eye className="h-4 w-4 ml-auto shrink-0" />
        </button>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Kurs suchen (Name oder ID)…"
          className="pl-9"
        />
      </div>

      {/* Status Filter Chips */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(status => {
          const cfg = STATUS_CONFIG[status];
          const count = status === 'all'
            ? (packages?.length || 0)
            : (statusCounts[status] || 0);
          if (status !== 'all' && count === 0) return null;
          const isActive = statusFilter === status;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                isActive
                  ? status === 'stuck'
                    ? "bg-destructive text-destructive-foreground border-destructive shadow-sm"
                    : "bg-primary text-primary-foreground border-primary shadow-sm"
                  : status === 'stuck'
                    ? "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
                    : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              )}
            >
              <cfg.icon className="h-3 w-3" />
              {cfg.label}
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold min-w-[20px] text-center",
                isActive ? "bg-primary-foreground/20" : "bg-muted"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <PageExplainer
        title="Wie funktioniert die Paketübersicht?"
        description="Die Paketübersicht zeigt alle erstellten Kurspakete, sortiert nach Dringlichkeit. Jedes Paket repräsentiert einen kompletten Ausbildungsberuf mit Lernkurs, Prüfungsfragen, Simulation, Mündliche, AI Tutor und Handbuch."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio', active: true },
          { label: 'Quality' },
          { label: 'Ops' },
          { label: 'Business' },
          { label: 'Growth' },
          { label: 'Scale' },
        ]}
        actions={[
          '"Neues Paket" – Erstellt ein neues Kurspaket für einen Ausbildungsberuf',
          'Klick auf ein Paket → Öffnet den Course Workspace mit Build-Pipeline, Modulstatus und Council',
          '"Festgefahren"-Filter zeigt Kurse, die seit >2h keine Build-Fortschritte machen',
          'Textsuche filtert nach Kursname oder ID',
        ]}
        tips={[
          'Pakete mit Status "Fehlgeschlagen" stehen immer ganz oben',
          'Festgefahrene Builds (>2h) werden rot markiert und erfordern manuelle Prüfung',
        ]}
      />

      {sorted.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery || statusFilter !== 'all'
                ? 'Keine Kurspakete für diese Filter gefunden.'
                : 'Noch keine Kurspakete erstellt.'}
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button asChild>
                <Link to="/admin/studio/new">
                  <Rocket className="h-4 w-4 mr-2" /> Erstes Kurspaket erstellen
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map(pkg => {
            const stuck = stuckIds.has(pkg.id);
            const effectiveStatus = stuck ? 'stuck' : pkg.status;
            const cfg = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.planning;
            const StatusIcon = cfg.icon;

            const stuckMinutes = stuck
              ? Math.round((Date.now() - new Date(pkg.updated_at).getTime()) / 60000)
              : 0;
            const stuckHours = Math.floor(stuckMinutes / 60);
            const stuckMins = stuckMinutes % 60;

            return (
              <Link key={pkg.id} to={`/admin/studio/${pkg.id}`} className="block group">
                <Card className={cn(
                  "transition-all hover:shadow-md border-l-4",
                  stuck ? 'border-l-destructive bg-destructive/5' :
                  pkg.status === 'failed' || pkg.status === 'quality_gate_failed' ? 'border-l-destructive' :
                  pkg.status === 'published' ? 'border-l-success' :
                  pkg.status === 'building' ? 'border-l-primary' :
                  pkg.status === 'qa' ? 'border-l-warning' :
                  'border-l-muted-foreground'
                )}>
                  <CardContent className="py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn("p-2 rounded-lg shrink-0", cfg.color)}>
                        <StatusIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-foreground truncate">
                            {pkg.canonical_title || pkg.title || pkg.id.substring(0, 12)}
                          </p>
                          <Badge variant="outline" className={cn("text-xs", cfg.color)}>
                            {cfg.label}
                          </Badge>
                          {stuck && (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {stuckHours}h {stuckMins}m ohne Fortschritt
                            </Badge>
                          )}
                        </div>
                        {(() => {
                          const sp = stepProgress?.[pkg.id];
                          const pct = sp ? Math.round((sp.done / Math.max(sp.total, 1)) * 100) : pkg.build_progress;
                          if (pct <= 0 || pct >= 100) return null;
                          return (
                            <div className="flex items-center gap-2 mt-1">
                              <Progress value={pct} className="h-1.5 flex-1 max-w-48" />
                              <span className="text-xs text-muted-foreground font-mono">
                                {sp ? `${sp.done}/${sp.total}` : `${pct}%`}
                              </span>
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="font-mono text-[10px] opacity-60" title={pkg.id}>
                            {pkg.id.substring(0, 8)}
                          </span>
                          {pkg.council_approved_at && pkg.status === 'published' && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-success" /> Council OK
                            </span>
                          )}
                          {pkg.integrity_passed && (
                            <span className="flex items-center gap-1">
                              <Shield className="h-3 w-3 text-success" /> Integrity OK
                            </span>
                          )}
                          {pkg.published_at && (
                            <span className="flex items-center gap-1">
                              <Zap className="h-3 w-3 text-success" />
                              Live seit {new Date(pkg.published_at).toLocaleDateString('de-DE')}
                            </span>
                          )}
                          <span>{new Date(pkg.created_at).toLocaleDateString('de-DE')}</span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
