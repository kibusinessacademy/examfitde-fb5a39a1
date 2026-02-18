import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCoursePackages } from '@/hooks/useCoursePackages';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowRight, CheckCircle2, Clock, XCircle, Wrench, Shield,
  Brain, Package, Rocket, Plus, Filter
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PageExplainer from '@/components/admin/PageExplainer';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  all: { label: 'Alle', color: 'bg-muted text-muted-foreground', icon: Filter },
  planning: { label: 'Draft', color: 'bg-muted text-muted-foreground', icon: Clock },
  queued: { label: 'Queued', color: 'bg-muted text-muted-foreground', icon: Clock },
  council_review: { label: 'Council Review', color: 'bg-warning/20 text-warning', icon: Brain },
  building: { label: 'Build läuft', color: 'bg-primary/20 text-primary', icon: Wrench },
  qa: { label: 'QA', color: 'bg-accent/20 text-accent-foreground', icon: Shield },
  published: { label: 'Live', color: 'bg-success/20 text-success', icon: CheckCircle2 },
  failed: { label: 'Fehlgeschlagen', color: 'bg-destructive/20 text-destructive', icon: XCircle },
};

const FILTER_OPTIONS = ['all', 'building', 'published', 'queued', 'planning', 'failed', 'qa', 'council_review'] as const;

export default function CoursePackagesList() {
  const { data: packages, isLoading } = useCoursePackages();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (packages || []).forEach(p => {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return counts;
  }, [packages]);

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

  const filtered = (packages || []).filter(p => statusFilter === 'all' || p.status === statusFilter);

  const sorted = [...filtered].sort((a, b) => {
    const priority: Record<string, number> = { failed: 0, building: 1, qa: 2, council_review: 3, planning: 4, queued: 5, published: 6 };
    const pa = priority[a.status] ?? 4;
    const pb = priority[b.status] ?? 4;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Kurspakete</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {packages?.length || 0} Pakete · {packages?.filter(p => p.status === 'published').length || 0} live
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/admin/studio/new">
            <Plus className="h-4 w-4 mr-1" /> Neues Paket
          </Link>
        </Button>
      </div>

      {/* Status Filter Chips */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(status => {
          const cfg = STATUS_CONFIG[status];
          const count = status === 'all' ? (packages?.length || 0) : (statusCounts[status] || 0);
          const isActive = statusFilter === status;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              )}
            >
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
          'Status-Badges zeigen: Draft, Council Review, Build läuft, QA, Live, Fehlgeschlagen',
          'Council OK / Integrity OK zeigen die Freigabe-Status',
        ]}
        tips={[
          'Pakete mit Status "Fehlgeschlagen" stehen immer ganz oben',
          'Der Build-Fortschritt zeigt den aktuellen Stand der 7-Step-Pipeline',
        ]}
      />

      {sorted.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Noch keine Kurspakete erstellt.</p>
            <Button asChild>
              <Link to="/admin/studio/new">
                <Rocket className="h-4 w-4 mr-2" /> Erstes Kurspaket erstellen
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map(pkg => {
            const cfg = STATUS_CONFIG[pkg.status] || STATUS_CONFIG.planning;
            const StatusIcon = cfg.icon;
            return (
              <Link key={pkg.id} to={`/admin/studio/${pkg.id}`} className="block group">
                <Card className={cn(
                  "transition-all hover:shadow-md border-l-4",
                  pkg.status === 'failed' ? 'border-l-destructive' :
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
                            {pkg.title || pkg.id.substring(0, 12)}
                          </p>
                          <Badge variant="outline" className={cn("text-xs", cfg.color)}>{cfg.label}</Badge>
                        </div>
                        {pkg.build_progress > 0 && pkg.build_progress < 100 && (
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={pkg.build_progress} className="h-1.5 flex-1 max-w-48" />
                            <span className="text-xs text-muted-foreground">{pkg.build_progress}%</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {pkg.council_approved && (
                            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> Council OK</span>
                          )}
                          {pkg.integrity_passed && (
                            <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-success" /> Integrity OK</span>
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
