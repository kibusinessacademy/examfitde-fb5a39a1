import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, Sparkles, Loader2, CheckCircle, BookOpen, AlertTriangle, RotateCcw } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Curriculum = Tables<'curricula'>;
type GenerationStep = 'select' | 'generating' | 'complete' | 'error';

interface CompLog {
  lfId: string;
  lfCode: string;
  compId: string;
  compCode: string;
  lessons: number;
  status: 'pending' | 'running' | 'done' | 'error';
}

export default function CourseCreate() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const preselectedCurriculumId = searchParams.get('curriculumId');

  const [step, setStep] = useState<GenerationStep>('select');
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState(preselectedCurriculumId || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [loadingCurricula, setLoadingCurricula] = useState(true);
  const [compLogs, setCompLogs] = useState<CompLog[]>([]);
  const [currentLabel, setCurrentLabel] = useState('');
  const [qcResult, setQcResult] = useState<any>(null);

  useEffect(() => { fetchCurricula(); }, []);

  const fetchCurricula = async () => {
    const { data, error } = await supabase.from('curricula').select('*').eq('status', 'frozen').order('title');
    if (!error && data) {
      setCurricula(data);
      if (preselectedCurriculumId) {
        const sel = data.find(c => c.id === preselectedCurriculumId);
        if (sel && !title) setTitle(`Kurs: ${sel.title}`);
      }
    }
    setLoadingCurricula(false);
  };

  /**
   * Fetch curriculum structure from edge function (SSOT-konform).
   * No direct DB reads for learning_fields/competencies.
   */
  const fetchStructure = async (curriculumId: string): Promise<CompLog[]> => {
    const { data, error } = await supabase.functions.invoke('get-curriculum-structure', {
      body: { curriculumId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const comps = (data?.competencies ?? []) as Array<{
      lfId: string; lfCode: string; compId: string; compCode: string;
    }>;

    if (!comps.length) throw new Error('Keine Kompetenzen gefunden');

    return comps.map(c => ({
      lfId: c.lfId,
      lfCode: c.lfCode,
      compId: c.compId,
      compCode: c.compCode,
      lessons: 0,
      status: 'pending' as const,
    }));
  };

  const STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;

  const processCompetencies = useCallback(async (
    courseId: string,
    curriculumId: string,
    comps: CompLog[],
  ) => {
    const totalSteps = comps.length * STEPS.length;
    let completedSteps = 0;

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      if (c.status === 'done') { completedSteps += STEPS.length; continue; }

      setCompLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'running' } : log));
      let stepsDone = 0;
      let hasError = false;

      for (const s of STEPS) {
        setCurrentLabel(`${c.lfCode} → ${c.compCode} / ${s}`);
        setProgress(Math.round((completedSteps / totalSteps) * 95));

        try {
          const { data, error } = await supabase.functions.invoke('generate-course-batch', {
            body: { courseId, curriculumId, learningFieldId: c.lfId, competencyId: c.compId, step: s },
          });
          if (error) throw error;
          if (data?.skipped) { /* already exists */ }
          stepsDone++;
        } catch (err) {
          console.error(`Error for ${c.compCode}/${s}:`, err);
          hasError = true;
        }
        completedSteps++;
      }

      setCompLogs(prev => prev.map((log, idx) =>
        idx === i ? { ...log, status: hasError ? 'error' : 'done', lessons: stepsDone } : log
      ));
    }

    // Finalize (includes Auto-QC: qc-snapshot + validate-content + ihk-quality-audit)
    setCurrentLabel('Finalize + Auto-QC...');
    const { data: finalData } = await supabase.functions.invoke('generate-course-batch', {
      body: { courseId, curriculumId },
    });
    setProgress(100);
    setQcResult(finalData?.qc ?? null);
  }, []);

  const handleGenerate = async () => {
    if (!selectedCurriculumId || !title.trim()) {
      toast({ title: 'Fehlende Angaben', description: 'Bitte wähle ein Curriculum und gib einen Titel ein.', variant: 'destructive' });
      return;
    }

    setIsGenerating(true);
    setStep('generating');
    setProgress(5);
    setQcResult(null);

    try {
      // 1) Create course row
      const { data: course, error: createError } = await supabase
        .from('courses')
        .insert({ curriculum_id: selectedCurriculumId, title: title.trim(), description: description.trim() || null, status: 'generating', created_by: user?.id })
        .select().single();
      if (createError) throw createError;
      setCreatedCourseId(course.id);

      // 2) Fetch structure from edge function (SSOT)
      const comps = await fetchStructure(selectedCurriculumId);
      setCompLogs(comps);

      // 3) Process all competencies
      await processCompetencies(course.id, selectedCurriculumId, comps);
      setStep('complete');
      toast({ title: 'Kurs generiert!', description: 'Auto-QC (Opus + IHK Audit) wurde ausgeführt.' });
    } catch (error) {
      console.error('Generation error:', error);
      setStep('error');
      toast({ title: 'Fehler', description: error instanceof Error ? error.message : 'Unbekannter Fehler', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!createdCourseId || !selectedCurriculumId) return;

    setIsRetrying(true);
    setStep('generating');
    setQcResult(null);

    try {
      // Re-process only errored competencies
      await processCompetencies(createdCourseId, selectedCurriculumId, compLogs);
      setStep('complete');
      toast({ title: 'Retry abgeschlossen', description: 'Fehlende Kompetenzen wurden nachgeneriert.' });
    } catch (error) {
      console.error('Retry error:', error);
      toast({ title: 'Fehler beim Retry', description: error instanceof Error ? error.message : 'Unbekannter Fehler', variant: 'destructive' });
      setStep('complete'); // stay on complete so they can retry again
    } finally {
      setIsRetrying(false);
    }
  };

  const selectedCurriculum = curricula.find(c => c.id === selectedCurriculumId);
  const doneLogs = compLogs.filter(l => l.status === 'done');
  const errorLogs = compLogs.filter(l => l.status === 'error');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Link to="/admin-v2/courses"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Kurs erstellen</h1>
          <p className="text-muted-foreground mt-1">LLM Council: GPT-5.2 Generator + Opus Validator + Auto-QC</p>
        </div>
      </div>

      {step === 'select' && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-accent" /> Kurs konfigurieren</CardTitle>
            <CardDescription>Wähle ein eingefrorenes Curriculum und gib dem Kurs einen Titel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Curriculum *</Label>
              {loadingCurricula ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade...</div>
              ) : curricula.length === 0 ? (
                <div className="p-4 rounded-xl bg-muted/30 text-center">
                  <p className="text-muted-foreground mb-3">Keine eingefrorenen Curricula.</p>
                  <Link to="/admin-v2/curricula/new"><Button variant="outline" size="sm">Importieren</Button></Link>
                </div>
              ) : (
                <Select value={selectedCurriculumId} onValueChange={setSelectedCurriculumId}>
                  <SelectTrigger className="bg-muted/50"><SelectValue placeholder="Curriculum auswählen..." /></SelectTrigger>
                  <SelectContent>{curricula.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
            {selectedCurriculum && (
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                <p className="font-medium text-foreground">{selectedCurriculum.title}</p>
                {selectedCurriculum.description && <p className="text-sm text-muted-foreground mt-1">{selectedCurriculum.description}</p>}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="title">Kurstitel *</Label>
              <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Fachinformatiker AE" className="bg-muted/50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Beschreibung</Label>
              <Textarea id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional..." className="bg-muted/50 min-h-[80px]" />
            </div>
            <Button onClick={handleGenerate} disabled={!selectedCurriculumId || !title.trim()} className="w-full gradient-accent text-accent-foreground shadow-glow-accent">
              <Sparkles className="h-4 w-4 mr-2" /> Kurs generieren
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'generating' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-8 space-y-6">
            <div className="text-center">
              <Sparkles className="h-12 w-12 text-accent mx-auto mb-4 animate-pulse" />
              <h3 className="text-xl font-display font-bold text-foreground mb-1">
                {isRetrying ? 'Retry läuft...' : 'Generierung läuft...'}
              </h3>
              <p className="text-sm text-muted-foreground font-mono">{currentLabel}</p>
            </div>
            <div className="max-w-md mx-auto">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1 text-center">
                {doneLogs.length}/{compLogs.length} Kompetenzen • {doneLogs.reduce((s, l) => s + l.lessons, 0)} Lektionen
              </p>
            </div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto text-xs">
              {compLogs.map((log, i) => (
                <div key={i} className={`flex justify-between px-2 py-1 rounded ${
                  log.status === 'done' ? 'text-green-400' : log.status === 'running' ? 'text-accent' : log.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  <span className="font-mono">{log.compCode}</span>
                  <span>
                    {log.status === 'running' && <Loader2 className="h-3 w-3 animate-spin inline" />}
                    {log.status === 'done' && `✅ ${log.lessons}`}
                    {log.status === 'error' && '❌'}
                    {log.status === 'pending' && '⏳'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'complete' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <div className="w-20 h-20 rounded-full gradient-accent flex items-center justify-center mx-auto mb-6 shadow-glow-accent">
              <CheckCircle className="h-10 w-10 text-accent-foreground" />
            </div>
            <h3 className="text-xl font-display font-bold text-foreground mb-2">Kurs generiert!</h3>
            <p className="text-muted-foreground mb-2">
              {doneLogs.length} Kompetenzen → {doneLogs.reduce((s, l) => s + l.lessons, 0)} Lektionen
            </p>

            {/* Auto-QC Results */}
            {qcResult && !qcResult.error && (
              <div className="inline-flex items-center gap-3 text-xs bg-muted/30 border border-border/50 rounded-lg px-4 py-2 mb-4">
                <span>QC Snapshot: {qcResult.snapshotOk ? '✅' : '⚠️'}</span>
                <span>Opus: {qcResult.validation?.decision ?? '—'} ({qcResult.validation?.score ?? '—'})</span>
                <span>IHK: {qcResult.audit?.grade ?? '—'} ({qcResult.audit?.score ?? '—'})</span>
              </div>
            )}
            {qcResult?.error && (
              <p className="text-xs text-warning mb-4">Auto-QC Fehler (nicht blockierend): {qcResult.error}</p>
            )}

            {errorLogs.length > 0 && (
              <div className="mb-4">
                <p className="text-sm text-destructive mb-3 flex items-center justify-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> {errorLogs.length} Fehler bei der Generierung
                </p>
                <Button
                  onClick={handleRetryFailed}
                  disabled={isRetrying}
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                >
                  {isRetrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  Fehlgeschlagene nachgenerieren ({errorLogs.length})
                </Button>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <Link to="/admin-v2/courses"><Button variant="outline">Übersicht</Button></Link>
              {createdCourseId && (
                <Link to={`/admin-v2/courses/${createdCourseId}/edit`}>
                  <Button className="gradient-accent text-accent-foreground">Bearbeiten</Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'error' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-6" />
            <h3 className="text-xl font-bold text-foreground mb-2">Fehler</h3>
            <Button onClick={() => setStep('select')} variant="outline">Zurück</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
