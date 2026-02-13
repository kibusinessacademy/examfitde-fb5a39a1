import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Layers, Play, Pause, Rocket, CheckCircle2, Clock,
  AlertTriangle, Loader2, BarChart3, RefreshCw, Target, BookOpen
} from 'lucide-react';
import { toast } from 'sonner';
import PageExplainer from '@/components/admin/PageExplainer';
import TrackBadge from '@/components/admin/TrackBadge';
import { CERT_TYPE_LABELS, type CertificationType } from '@/hooks/useTrackConfig';

const CurriculumHealthDashboard = lazy(() => import('@/components/admin/CurriculumHealthDashboard'));
const DeepAuditPanel = lazy(() => import('@/components/admin/DeepAuditPanel'));
const MassRolloutDashboard = lazy(() => import('@/components/admin/MassRolloutDashboard'));
const CEOStrategicDashboard = lazy(() => import('@/components/admin/CEOStrategicDashboard'));
const DominanceDashboard = lazy(() => import('@/components/admin/DominanceDashboard'));
const CertificationDominanceBoard = lazy(() => import('@/components/admin/CertificationDominanceBoard'));
const CurriculumIngestPage = lazy(() => import('@/pages/admin/v4/CurriculumIngestPage'));
const CertificationCatalogPage = lazy(() => import('@/pages/admin/v4/CertificationCatalogPage'));

const tabs = [
  { path: '/admin/scale', label: 'Berufe-Status' },
  { path: '/admin/scale/catalog', label: '📋 Zertifizierungs-Katalog' },
  { path: '/admin/scale/curriculum', label: 'Curriculum Health' },
  { path: '/admin/scale/curriculum-ingest', label: '📥 Rahmenplan-Ingest' },
  { path: '/admin/scale/deep-audit', label: 'Deep Audit' },
  { path: '/admin/scale/rollout', label: '🌐 Total Coverage' },
  { path: '/admin/scale/dominance', label: '🌍 Cluster-Dominanz' },
  { path: '/admin/scale/einzeldominanz', label: '🎯 Einzeldominanz' },
  { path: '/admin/scale/ceo', label: '👑 CEO Command' },
  { path: '/admin/scale/reporting', label: 'Reporting' },
];

const STATUS_PIPELINE = [
  'not_started', 'scaffolded', 'exam_done', 'oral_done',
  'tutor_done', 'handbook_done', 'integrity_passed', 'published'
] as const;

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Nicht gestartet', color: 'bg-muted text-muted-foreground' },
  scaffolded: { label: 'Scaffolded', color: 'bg-primary/20 text-primary' },
  exam_done: { label: 'Exam ✓', color: 'bg-info/20 text-info' },
  oral_done: { label: 'Oral ✓', color: 'bg-info/20 text-info' },
  tutor_done: { label: 'Tutor ✓', color: 'bg-info/20 text-info' },
  handbook_done: { label: 'Handbuch ✓', color: 'bg-info/20 text-info' },
  integrity_passed: { label: 'Integrität ✓', color: 'bg-warning/20 text-warning' },
  published: { label: 'Live', color: 'bg-success/20 text-success' },
  planning: { label: 'Planung', color: 'bg-muted text-muted-foreground' },
  building: { label: 'Build', color: 'bg-primary/20 text-primary' },
  failed: { label: 'Fehler', color: 'bg-destructive/20 text-destructive' },
};

function mapPackageStatus(pkg: any): string {
  if (pkg.status === 'published') return 'published';
  if (pkg.integrity_passed) return 'integrity_passed';
  // Check build steps if available
  const steps = pkg.build_steps_summary || {};
  if (steps.generate_handbook === 'done') return 'handbook_done';
  if (steps.build_ai_tutor_index === 'done') return 'tutor_done';
  if (steps.generate_oral_exam === 'done') return 'oral_done';
  if (steps.generate_exam_pool === 'done') return 'exam_done';
  if (steps.scaffold_learning_course === 'done') return 'scaffolded';
  if (pkg.status === 'building') return 'scaffolded';
  return 'not_started';
}

/* ── Berufe Status ── */
function BerufeStatus() {
  const [packages, setPackages] = useState<any[]>([]);
  const [berufe, setBerufe] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [trackFilter, setTrackFilter] = useState<string>('all');
  const [certTypeFilter, setCertTypeFilter] = useState<string>('all');

  const load = async () => {
    const [pkgRes, berufRes] = await Promise.all([
      (supabase as any).from('course_packages')
        .select('id, title, status, integrity_passed, certification_id, build_progress, created_at, track, certification_type, feature_flags')
        .order('title'),
      (supabase as any).from('berufe')
        .select('id, bezeichnung_kurz, ist_aktiv')
        .eq('ist_aktiv', true)
        .order('bezeichnung_kurz'),
    ]);
    setPackages(pkgRes.data || []);
    setBerufe(berufRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleBatchGenerate = async (count: number) => {
    setGenerating(true);
    toast.info(`Batch-Generierung für ${count} Curricula wird gestartet…`);
    try {
      const { data, error } = await supabase.functions.invoke('batch-curriculum-pipeline', {
        body: { action: 'run', limit: count },
      });
      if (error) throw error;
      toast.success(`${data.queued} Pakete in Warteschlange, ${data.errors} Fehler`);
      load();
    } catch (err: any) {
      toast.error(`Fehler: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handlePublishAllPassed = async () => {
    const passedPkgs = packages.filter(p => p.integrity_passed && p.status !== 'published');
    if (passedPkgs.length === 0) {
      toast.info('Keine Pakete zum Veröffentlichen bereit');
      return;
    }
    for (const pkg of passedPkgs) {
      await (supabase as any).from('course_packages')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', pkg.id);
    }
    toast.success(`${passedPkgs.length} Pakete veröffentlicht`);
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  // Map berufe to packages
  const berufMap = new Map(packages.map(p => [p.certification_id, p]));
  const statusCounts = STATUS_PIPELINE.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as Record<string, number>);
  
  const berufList = berufe.map(b => {
    const pkg = berufMap.get(b.id);
    const status = pkg ? mapPackageStatus(pkg) : 'not_started';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    return { ...b, pkg, pipelineStatus: status };
  });

  // Also count packages not linked to a beruf
  for (const pkg of packages) {
    if (!berufe.find(b => b.id === pkg.certification_id)) {
      const status = mapPackageStatus(pkg);
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
  }

  const totalBerufe = berufe.length;
  const publishedCount = statusCounts.published || 0;
  const progressPct = totalBerufe > 0 ? Math.round((publishedCount / totalBerufe) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-foreground">Fortschritt: {publishedCount}/{totalBerufe} Berufe live</p>
              <p className="text-xs text-muted-foreground mt-0.5">{progressPct}% der Ausbildungsberufe abgedeckt</p>
            </div>
            <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
          <Progress value={progressPct} className="h-2" />
        </CardContent>
      </Card>

      {/* Status Distribution */}
      <div className="flex flex-wrap gap-2">
        {STATUS_PIPELINE.map(s => {
          const cfg = STATUS_LABELS[s];
          return (
            <Badge key={s} variant="outline" className={cn("text-xs", cfg.color)}>
              {cfg.label}: {statusCounts[s] || 0}
            </Badge>
          );
        })}
      </div>

      {/* Track Filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground">Track:</span>
        {['all', 'AUSBILDUNG_VOLL', 'EXAM_FIRST'].map(t => (
          <Button key={t} size="sm" variant={trackFilter === t ? 'default' : 'outline'} className="text-xs h-7"
            onClick={() => setTrackFilter(t)}>
            {t === 'all' ? 'Alle' : t === 'AUSBILDUNG_VOLL' ? '📚 Vollprodukt' : '🎯 Exam-First'}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">Typ:</span>
        <select value={certTypeFilter} onChange={e => setCertTypeFilter(e.target.value)}
          className="text-xs h-7 rounded border border-border bg-background px-2">
          <option value="all">Alle Typen</option>
          {Object.entries(CERT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Batch Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => handleBatchGenerate(5)} disabled={generating}>
          <Play className="h-3.5 w-3.5 mr-1" /> Nächste 5 generieren
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleBatchGenerate(10)} disabled={generating}>
          <Play className="h-3.5 w-3.5 mr-1" /> Nächste 10
        </Button>
        <Button size="sm" variant="outline" onClick={handlePublishAllPassed}>
          <Rocket className="h-3.5 w-3.5 mr-1" /> Alle bestandenen veröffentlichen
        </Button>
      </div>

      {/* Beruf List */}
      <div className="space-y-1">
        {berufList
          .filter(b => {
            if (trackFilter !== 'all' && b.pkg?.track !== trackFilter && trackFilter !== 'all') {
              // If no pkg, only show in 'all'
              if (!b.pkg && trackFilter !== 'all') return false;
              if (b.pkg && b.pkg.track !== trackFilter) return false;
            }
            if (certTypeFilter !== 'all' && b.pkg?.certification_type !== certTypeFilter) {
              if (!b.pkg && certTypeFilter !== 'all') return false;
              if (b.pkg && b.pkg.certification_type !== certTypeFilter) return false;
            }
            return true;
          })
          .map(b => {
          const cfg = STATUS_LABELS[b.pipelineStatus] || STATUS_LABELS.not_started;
          const stepIdx = STATUS_PIPELINE.indexOf(b.pipelineStatus as any);
          const stepPct = ((stepIdx + 1) / STATUS_PIPELINE.length) * 100;
          return (
            <Card key={b.id}>
              <CardContent className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-foreground truncate">{b.bezeichnung_kurz}</p>
                    <Badge variant="outline" className={cn("text-[10px]", cfg.color)}>{cfg.label}</Badge>
                    {b.pkg && <TrackBadge track={b.pkg.track} certType={b.pkg.certification_type} />}
                  </div>
                  {b.pipelineStatus !== 'not_started' && (
                    <Progress value={stepPct} className="h-1 mt-1.5 max-w-48" />
                  )}
                </div>
                {b.pkg && (
                  <Link to={`/admin/studio/${b.pkg.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs h-7">Details</Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ── Reporting ── */
function ScaleReporting() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('course_packages')
        .select('id, title, status, created_at, published_at')
        .order('created_at', { ascending: false });
      setPackages(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const published = packages.filter(p => p.status === 'published');
  const failed = packages.filter(p => p.status === 'failed');
  const avgDuration = published.length > 0
    ? Math.round(published.reduce((sum, p) => {
        if (!p.published_at || !p.created_at) return sum;
        return sum + (new Date(p.published_at).getTime() - new Date(p.created_at).getTime()) / (1000 * 60);
      }, 0) / published.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Publishes gesamt</p>
            <p className="text-2xl font-bold text-success">{published.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fehlerrate</p>
            <p className="text-2xl font-bold text-destructive">
              {packages.length > 0 ? Math.round((failed.length / packages.length) * 100) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Dauer</p>
            <p className="text-2xl font-bold text-foreground">{avgDuration} min</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In Pipeline</p>
            <p className="text-2xl font-bold text-primary">
              {packages.filter(p => !['published', 'failed', 'planning'].includes(p.status)).length}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ScalePage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/scale')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Skalierung – 300 Berufe</h1>
        <p className="text-sm text-muted-foreground">Status, Batch-Aktionen, Reporting</p>
      </div>

      <PageExplainer
        title="Wie funktioniert die Skalierung?"
        description="Die Massenproduktions-Zentrale. Hier steuerst du die automatische Erstellung von Kurspaketen für alle 300+ Ausbildungsberufe. Jeder Beruf durchläuft die Pipeline: Scaffolding → Exam → Oral → Tutor → Handbook → Integrity → Publish."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops' },
          { label: 'Business' },
          { label: 'Growth' },
          { label: 'Scale', active: true },
        ]}
        actions={[
          '"Berufe-Status" – Alle Berufe mit Pipeline-Fortschritt. Batch-Generierung: 5 oder 10 auf einmal starten',
      '"Alle bestandenen veröffentlichen" – Publiziert alle Pakete mit bestandenem Integrity-Check',
          '"Total Coverage" – Marktabdeckung: Base (600Q) → Optimize (850Q) → Authority (1200Q). Ziel: 95% aller Berufe ≥ Base',
          '"Reporting" – KPIs: Publishes, Fehlerrate, Ø Build-Dauer, aktive Pipeline-Jobs',
        ]}
        tips={[
          'Batch-Generierung nutzt Rate-Limits und Budget-Caps pro Tag',
          'Curricula müssen Status "frozen" haben bevor ein Build gestartet werden kann',
          'Der Fortschrittsbalken zeigt den Anteil live geschalteter Berufe',
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
        <Routes>
          <Route index element={<BerufeStatus />} />
          <Route path="catalog" element={<CertificationCatalogPage />} />
          <Route path="curriculum" element={<CurriculumHealthDashboard />} />
          <Route path="curriculum-ingest" element={<CurriculumIngestPage />} />
          <Route path="deep-audit" element={<DeepAuditPanel />} />
          <Route path="rollout" element={<MassRolloutDashboard />} />
          <Route path="dominance" element={<DominanceDashboard />} />
          <Route path="einzeldominanz" element={<CertificationDominanceBoard />} />
          <Route path="ceo" element={<CEOStrategicDashboard />} />
          <Route path="reporting" element={<ScaleReporting />} />
        </Routes>
      </Suspense>
    </div>
  );
}
