import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCoursePackages, useCoursePackageDetail } from '@/hooks/useCoursePackages';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Rocket, CheckCircle2, XCircle, Clock, Play, Package, Brain, Wrench, Shield, Download, ChevronRight, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  planning: { label: 'Planung', color: 'bg-muted text-muted-foreground', icon: Clock },
  council_review: { label: 'Council Review', color: 'bg-warning/20 text-warning', icon: Brain },
  building: { label: 'Build läuft', color: 'bg-primary/20 text-primary', icon: Wrench },
  qa: { label: 'QA', color: 'bg-accent/20 text-accent-foreground', icon: Shield },
  published: { label: 'Veröffentlicht', color: 'bg-success/20 text-success', icon: CheckCircle2 },
  failed: { label: 'Fehlgeschlagen', color: 'bg-destructive/20 text-destructive', icon: XCircle },
};

const STEP_STATUS_ICON: Record<string, any> = {
  pending: Clock,
  running: Loader2,
  done: CheckCircle2,
  failed: XCircle,
  skipped: AlertTriangle,
};

const COMPONENT_LABELS: Record<string, string> = {
  learning_course: '📚 Lernkurs (H5P + Steps + MiniChecks)',
  exam_trainer: '📝 Prüfungstrainer (1000+ Fragen + Simulation)',
  oral_exam: '🎤 Oral-Exam-Trainer',
  ai_tutor: '🤖 AI Tutor',
  handbook: '📖 Ausbildungsberuf-Handbuch',
};

const COUNCIL_LABELS: Record<string, string> = {
  didactic: '🎓 Didactic Council',
  exam: '📝 Exam Council',
  question_quality: '✅ Question Quality Council',
  oral: '🎤 Oral Council',
  tutor: '🤖 Tutor Council',
  handbook: '📖 Handbook Council',
  seo_commercial: '📈 SEO/Commercial Council',
};

const TABS = [
  { key: 'planning', label: '📋 Planung', icon: Clock },
  { key: 'councils', label: '🧠 Councils', icon: Brain },
  { key: 'build', label: '🚀 Build', icon: Rocket },
  { key: 'quality', label: '📊 Quality', icon: Shield },
  { key: 'export', label: '📦 Export', icon: Download },
] as const;

// ========== Types ==========
interface BuildState {
  package?: Record<string, unknown>;
  steps?: Array<Record<string, unknown>>;
  approved_plan?: Record<string, unknown>;
}

// ========== Status Timeline ==========
function StatusTimeline({ pkg }: { pkg: any }) {
  const steps = [
    { key: 'planning', label: 'SSOT Ready', done: !!pkg.certification_id },
    { key: 'council_review', label: 'Council Approved', done: pkg.council_approved },
    { key: 'building', label: 'Built', done: ['qa', 'published'].includes(pkg.status) },
    { key: 'qa', label: 'Integrity Passed', done: pkg.integrity_passed },
    { key: 'published', label: 'Published', done: pkg.status === 'published' },
  ];

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1 shrink-0">
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
            step.done ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
          )}>
            {step.done ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {step.label}
          </div>
          {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        </div>
      ))}
    </div>
  );
}

// ========== Package List ==========
function PackageList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: packages, isLoading, createPackage } = useCoursePackages();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [certId, setCertId] = useState('');

  const { data: curricula } = useQuery({
    queryKey: ['curricula-list'],
    queryFn: async () => {
      const { data } = await supabase.from('curricula').select('id, title, version').order('title');
      return data || [];
    },
  });

  const handleCreate = () => {
    if (!certId || !title) return;
    createPackage.mutate({ certificationId: certId, title }, {
      onSuccess: (pkg) => onSelect(pkg.id),
    });
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Course Studio</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">ExamFit-Produktpakete erstellen & verwalten</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Neues Paket
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Ausbildungsberuf / Zertifizierung</label>
                <Select value={certId} onValueChange={setCertId}>
                  <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                  <SelectContent>
                    {(curricula || []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.title} (v{c.version})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Paketname</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Kaufleute für Büromanagement 2025" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={!certId || !title || createPackage.isPending} size="sm">
                {createPackage.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Package className="h-4 w-4 mr-1" />}
                Paket erstellen
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Abbrechen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(packages || []).length === 0 && !showCreate ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Noch keine Produktpakete erstellt.</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> Erstes Paket erstellen</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {(packages || []).map((pkg) => {
            const statusInfo = STATUS_MAP[pkg.status] || STATUS_MAP.planning;
            const StatusIcon = statusInfo.icon;
            return (
              <Card key={pkg.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => onSelect(pkg.id)}>
                <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm truncate">{pkg.title || 'Unbenannt'}</h3>
                      <Badge variant="outline" className={cn("text-xs shrink-0", statusInfo.color)}>
                        <StatusIcon className="h-3 w-3 mr-1" />{statusInfo.label}
                      </Badge>
                    </div>
                    {pkg.build_progress > 0 && (
                      <Progress value={pkg.build_progress} className="h-1.5 mt-2" />
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========== Package Detail (Wizard Tabs) ==========
function PackageDetail({ packageId, onBack }: { packageId: string; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<string>('planning');
  const {
    package: pkg,
    packageLoading,
    buildSteps,
    councils,
    startBuild,
    initCouncils,
    approveCouncils,
    invalidate,
  } = useCoursePackageDetail(packageId);

  if (packageLoading || !pkg) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">← Zurück</Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{pkg.title || 'Produktpaket'}</h1>
          <StatusTimeline pkg={pkg} />
        </div>
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-3 py-2 text-xs sm:text-sm rounded-t-md transition-colors whitespace-nowrap",
                activeTab === tab.key
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'planning' && <PlanningTab pkg={pkg} />}
      {activeTab === 'councils' && <CouncilsTab pkg={pkg} councils={councils} initCouncils={initCouncils} approveCouncils={approveCouncils} />}
      {activeTab === 'build' && <BuildTab pkg={pkg} packageId={packageId} buildSteps={buildSteps} startBuild={startBuild} invalidate={invalidate} />}
      {activeTab === 'quality' && <QualityTab pkg={pkg} />}
      {activeTab === 'export' && <ExportTab pkg={pkg} packageId={packageId} />}
    </div>
  );
}

// ========== Planning Tab ==========
function PlanningTab({ pkg }: { pkg: any }) {
  const { data: curriculum } = useQuery({
    queryKey: ['curriculum-detail', pkg.certification_id],
    queryFn: async () => {
      if (!pkg.certification_id) return null;
      const { data } = await supabase.from('curricula').select('*').eq('id', pkg.certification_id).single();
      return data;
    },
    enabled: !!pkg.certification_id,
  });

  const components = pkg.components || {};

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">SSOT / Curriculum</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {curriculum ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Titel:</span> <strong>{curriculum.title}</strong></div>
              <div><span className="text-muted-foreground">Version:</span> <strong>{curriculum.version}</strong></div>
              <div><span className="text-muted-foreground">Status:</span>{' '}
                <Badge variant="outline" className={curriculum.status === 'frozen' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}>
                  {curriculum.status || 'draft'}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Kein Curriculum verknüpft.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Paket-Komponenten</CardTitle>
          <CardDescription className="text-xs">Standard: Alle Module aktiv. Einzelne bei Bedarf deaktivieren.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(COMPONENT_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm">{label}</span>
                <Switch checked={components[key] !== false} disabled />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ========== Councils Tab ==========
function CouncilsTab({ pkg, councils, initCouncils, approveCouncils }: {
  pkg: any; councils: any[]; initCouncils: any; approveCouncils: any;
}) {
  return (
    <div className="space-y-4">
      {councils.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Brain className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">Councils noch nicht initialisiert.</p>
            <Button onClick={() => initCouncils.mutate()} disabled={initCouncils.isPending} size="sm">
              {initCouncils.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Brain className="h-4 w-4 mr-1" />}
              Councils einberufen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3">
            {councils.map(c => {
              const label = COUNCIL_LABELS[c.council_type] || c.council_type;
              const decisionColor = c.decision === 'approve' ? 'bg-success/20 text-success'
                : c.decision === 'changes_required' ? 'bg-warning/20 text-warning'
                : c.decision === 'rejected' ? 'bg-destructive/20 text-destructive'
                : 'bg-muted text-muted-foreground';
              return (
                <Card key={c.id}>
                  <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <span className="text-sm font-medium flex-1">{label}</span>
                    <Badge variant="outline" className={cn("text-xs", decisionColor)}>
                      {c.decision || c.status}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {!pkg.council_approved && (
            <Button onClick={() => approveCouncils.mutate()} disabled={approveCouncils.isPending} className="w-full sm:w-auto">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Council-Freigabe erteilen
            </Button>
          )}

          {pkg.council_approved && (
            <Badge className="bg-success/20 text-success"><CheckCircle2 className="h-3 w-3 mr-1" /> Council freigegeben</Badge>
          )}
        </>
      )}
    </div>
  );
}

// ========== Build Tab (Server-Side + Live Logs) ==========
function BuildTab({ pkg, packageId, buildSteps, startBuild, invalidate }: {
  pkg: any; packageId: string; buildSteps: any[]; startBuild: any; invalidate: () => void;
}) {
  const { toast } = useToast();
  const [buildState, setBuildState] = useState<BuildState | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollingRef = useRef(false);

  const isBuilding = pkg.status === 'building';
  const displaySteps = buildState?.steps?.length ? buildState.steps : buildSteps;
  const completedSteps = displaySteps.filter((s: any) => s.status === 'done').length;
  const totalSteps = displaySteps.length || 9;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : pkg.build_progress;

  const fetchBuildState = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_course_package_build_state', { p_package_id: packageId });
    if (error) throw error;
    const state = data as unknown as BuildState;
    setBuildState(state);
    return state;
  }, [packageId]);

  const startPolling = useCallback(async () => {
    pollingRef.current = true;
    setPolling(true);
    try {
      for (let i = 0; i < 600 && pollingRef.current; i++) {
        const s = await fetchBuildState();
        const status = (s?.package as Record<string, unknown>)?.status;
        if (status === 'published' || status === 'failed' || status === 'qa') break;
        await new Promise(r => setTimeout(r, 2000));
      }
    } finally {
      pollingRef.current = false;
      setPolling(false);
      invalidate();
    }
  }, [fetchBuildState, invalidate]);

  // Auto-poll if currently building
  useEffect(() => {
    if (isBuilding && !polling) {
      startPolling();
    }
    return () => { pollingRef.current = false; };
  }, [isBuilding]);

  const handleServerBuild = async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('build-course-package', {
        body: {
          packageId,
          courseId: pkg.course_id,
          curriculumId: pkg.certification_id,
          certificationId: pkg.certification_id,
          options: {
            include_learning_course: pkg.components?.learning_course !== false,
            include_exam_pool: pkg.components?.exam_trainer !== false,
            include_oral_exam: pkg.components?.oral_exam !== false,
            include_ai_tutor: pkg.components?.ai_tutor !== false,
            include_handbook: pkg.components?.handbook !== false,
            exam_target: 1000,
          },
        },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });

      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.code === 'PACKAGE_LOCKED') {
        toast({ title: 'Build läuft bereits', description: 'Es läuft bereits ein Build für dieses Paket.', variant: 'destructive' });
        return;
      }

      toast({ title: 'Build gestartet', description: 'Server-Pipeline läuft...' });
      await startPolling();
      toast({ title: 'Build abgeschlossen' });
    } catch (e: any) {
      toast({ title: 'Build-Fehler', description: e?.message || 'Unbekannt', variant: 'destructive' });
    } finally {
      setBusy(false);
      invalidate();
    }
  };

  return (
    <div className="space-y-4">
      {/* Big Build Button */}
      {!isBuilding && buildSteps.length === 0 && !polling && (
        <Card className="border-primary/30">
          <CardContent className="py-8 text-center">
            <Rocket className="h-12 w-12 text-primary mx-auto mb-3" />
            <h3 className="font-bold text-lg mb-2">ExamFit-Produktpaket erstellen</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Startet die vollständige Server-Pipeline: Lernkurs, Prüfungstrainer, Oral-Exam, AI Tutor, Handbuch + Integritätsprüfung.
            </p>
            <Button onClick={handleServerBuild} disabled={busy} size="lg">
              {busy ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Rocket className="h-5 w-5 mr-2" />}
              🚀 Produktpaket erstellen (Server-Pipeline)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {(isBuilding || displaySteps.length > 0 || polling) && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Build-Fortschritt</span>
              <span className="text-muted-foreground">{completedSteps}/{totalSteps} Steps • {progress}%</span>
            </div>
            <Progress value={progress} className="h-3" />
          </div>

          <div className="space-y-2">
            {displaySteps.map((step: any) => {
              const Icon = STEP_STATUS_ICON[step.status] || Clock;
              const isRunning = step.status === 'running';
              return (
                <div key={step.id || step.step_key} className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-sm",
                  step.status === 'done' && "border-success/30 bg-success/5",
                  step.status === 'failed' && "border-destructive/30 bg-destructive/5",
                  isRunning && "border-primary/30 bg-primary/5",
                  step.status === 'pending' && "border-border",
                )}>
                  <Icon className={cn("h-4 w-4 shrink-0", isRunning && "animate-spin text-primary", step.status === 'done' && "text-success", step.status === 'failed' && "text-destructive")} />
                  <span className="flex-1 font-medium">{step.step_label || step.step_key}</span>
                  {step.duration_ms && <span className="text-xs text-muted-foreground">{(step.duration_ms / 1000).toFixed(1)}s</span>}
                  {step.error_message && <span className="text-xs text-destructive truncate max-w-[200px]">{step.error_message}</span>}
                </div>
              );
            })}
          </div>

          {/* Live Logs Panel */}
          {buildState?.steps?.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Live Logs</CardTitle>
                <CardDescription className="text-xs">Echtzeit-Status aus der Server-Pipeline</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-64 overflow-y-auto">
                {(buildState.steps as any[]).filter((s: any) => s.log).map((s: any) => (
                  <div key={s.step_key} className="p-2 border rounded text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{s.step_label || s.step_key}</span>
                      <Badge variant={s.status === 'failed' ? 'destructive' : s.status === 'running' ? 'secondary' : 'outline'} className="text-[10px]">
                        {s.status}
                      </Badge>
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-muted-foreground">{JSON.stringify(s.log, null, 2)}</pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex gap-2">
            {(isBuilding || polling) && (
              <Button variant="outline" size="sm" onClick={() => fetchBuildState()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Aktualisieren
              </Button>
            )}

            {pkg.status === 'failed' && !busy && (
              <Button onClick={handleServerBuild} disabled={busy}>
                <RefreshCw className="h-4 w-4 mr-2" /> Erneut versuchen
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ========== Quality Tab ==========
function QualityTab({ pkg }: { pkg: any }) {
  const qualityAreas = [
    { key: 'learning_course', label: '📚 Lernkurs', metrics: ['Soll/Ist Lessons', 'MiniCheck Coverage', 'H5P Status'] },
    { key: 'exam_trainer', label: '📝 Prüfungstrainer', metrics: ['#Fragen', 'Blueprint Coverage', 'Difficulty Mix', 'Dupe-Rate'] },
    { key: 'simulation', label: '🎯 Simulation', metrics: ['Presets vorhanden', 'Zeit/Gewichtung', 'Auswertung'] },
    { key: 'oral_exam', label: '🎤 Oral Exam', metrics: ['#Szenarien', 'Rubric vollständig', 'Fragen-Funnel'] },
    { key: 'ai_tutor', label: '🤖 AI Tutor', metrics: ['SSOT-Bindung', 'Mode-Set aktiv', 'Referenzen'] },
    { key: 'handbook', label: '📖 Handbuch', metrics: ['Outline', 'Glossar', 'FAQ', 'Prüfungsfallen'] },
  ];

  return (
    <div className="space-y-4">
      {pkg.integrity_passed && (
        <Badge className="bg-success/20 text-success text-sm"><CheckCircle2 className="h-4 w-4 mr-1" /> Integrität bestanden</Badge>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {qualityAreas.map(area => (
          <Card key={area.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{area.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {area.metrics.map(m => (
                  <li key={m} className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {m}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {pkg.integrity_passed && (
        <Button className="w-full sm:w-auto">
          <CheckCircle2 className="h-4 w-4 mr-2" /> Paket veröffentlichen
        </Button>
      )}
    </div>
  );
}

// ========== Export Tab (Server-Side ZIP + Persistent Link) ==========
function ExportTab({ pkg, packageId }: { pkg: any; packageId: string }) {
  const { toast } = useToast();
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Restore persisted export link on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const { data } = await supabase.rpc('get_course_package_export_link', { p_package_id: packageId });
        const result = data as Record<string, unknown> | null;
        if (result?.downloadUrl) {
          setExportUrl(result.downloadUrl as string);
        }
      } catch (_e) { /* ignore */ }
    };
    restore();
  }, [packageId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-course-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) {
        setExportUrl(resData.downloadUrl as string);
        toast({ title: 'Export erstellt', description: 'ZIP-Download bereit.' });
      }
    } catch (e: any) {
      toast({ title: 'Export-Fehler', description: e?.message || 'Unbekannt', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const exports = [
    { key: 'zip', label: 'ZIP Package Export', desc: 'Komplett: Lernkurs + Fragen + Oral + Tutor + Handbuch + Plan + Steps', icon: '📦', action: handleExport, actionLabel: 'Exportieren', loading: exporting },
    { key: 'jsx', label: 'JSX Export', desc: 'React/Content Pack', icon: '⚛️' },
    { key: 'json', label: 'JSON SSOT Snapshot', desc: 'Curriculum + Plan + Blueprints + Coverage', icon: '🗂' },
    { key: 'h5p', label: 'H5P Batch Export', desc: 'Alle H5P-Inhalte als ZIP', icon: '🎮' },
    { key: 'csv', label: 'Questions CSV/QTI', desc: 'Fragenpool als CSV oder QTI-Format', icon: '📊' },
    { key: 'handbook', label: 'Handbuch PDF/MD', desc: 'Handbuch als PDF oder Markdown', icon: '📖' },
  ];

  return (
    <div className="space-y-4">
      {exportUrl && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Letzter Export bereit</p>
              <p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p>
            </div>
            <Button size="sm" asChild>
              <a href={exportUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" /> Herunterladen
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {exports.map(exp => (
          <Card key={exp.key} className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{exp.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">{exp.label}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{exp.desc}</p>
                  {exp.action ? (
                    <Button variant="outline" size="sm" className="mt-2" onClick={exp.action} disabled={exp.loading || pkg.status === 'planning'}>
                      {exp.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                      {exp.actionLabel}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="mt-2" disabled={pkg.status !== 'published'}>
                      <Download className="h-3 w-3 mr-1" /> Exportieren
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ========== Main Page ==========
export default function CourseStudioPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <PackageDetail packageId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return <PackageList onSelect={setSelectedId} />;
}
