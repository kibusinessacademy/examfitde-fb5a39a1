import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
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
import { ArrowLeft, Sparkles, Loader2, CheckCircle, BookOpen, AlertTriangle } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Curriculum = Tables<'curricula'>;
type GenerationStep = 'select' | 'generating' | 'complete' | 'error';

interface CompLog {
  lfCode: string;
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
  const [loadingCurricula, setLoadingCurricula] = useState(true);
  const [compLogs, setCompLogs] = useState<CompLog[]>([]);
  const [currentLabel, setCurrentLabel] = useState('');

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

  const runGeneration = useCallback(async (courseId: string, curriculumId: string) => {
    // Get all learning fields with competencies
    const { data: lfs } = await supabase
      .from('learning_fields')
      .select('id, code, title, competencies(id, code, title)')
      .eq('curriculum_id', curriculumId)
      .order('sort_order');

    if (!lfs?.length) throw new Error('Keine Lernfelder gefunden');

    // Flatten to competency list
    const allComps: { lfId: string; lfCode: string; compId: string; compCode: string }[] = [];
    for (const lf of lfs) {
      const comps = (lf as any).competencies || [];
      for (const c of comps) {
        allComps.push({ lfId: lf.id, lfCode: lf.code || 'LF?', compId: c.id, compCode: c.code || '?' });
      }
    }

    if (!allComps.length) throw new Error('Keine Kompetenzen gefunden');

    setCompLogs(allComps.map(c => ({ lfCode: c.lfCode, compCode: c.compCode, lessons: 0, status: 'pending' })));

    // Process each competency sequentially
    for (let i = 0; i < allComps.length; i++) {
      const c = allComps[i];
      setCurrentLabel(`${c.lfCode} → ${c.compCode}`);
      setProgress(Math.round((i / allComps.length) * 95));
      setCompLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'running' } : log));

      try {
        const { data, error } = await supabase.functions.invoke('generate-course-batch', {
          body: { courseId, curriculumId, learningFieldId: c.lfId, competencyId: c.compId },
        });
        if (error) throw error;
        setCompLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'done', lessons: data?.lessonsCreated || 0 } : log));
      } catch (err) {
        console.error(`Error for ${c.compCode}:`, err);
        setCompLogs(prev => prev.map((log, idx) => idx === i ? { ...log, status: 'error' } : log));
      }
    }

    // Finalize
    await supabase.functions.invoke('generate-course-batch', { body: { courseId, curriculumId } });
    setProgress(100);
  }, []);

  const handleGenerate = async () => {
    if (!selectedCurriculumId || !title.trim()) {
      toast({ title: 'Fehlende Angaben', description: 'Bitte wähle ein Curriculum und gib einen Titel ein.', variant: 'destructive' });
      return;
    }

    setIsGenerating(true);
    setStep('generating');
    setProgress(5);

    try {
      const { data: course, error: createError } = await supabase
        .from('courses')
        .insert({ curriculum_id: selectedCurriculumId, title: title.trim(), description: description.trim() || null, status: 'generating', created_by: user?.id })
        .select().single();
      if (createError) throw createError;
      setCreatedCourseId(course.id);

      await runGeneration(course.id, selectedCurriculumId);
      setStep('complete');
      toast({ title: 'Kurs generiert!', description: 'Alle Kompetenzen wurden mit GPT-5.2 generiert.' });
    } catch (error) {
      console.error('Generation error:', error);
      setStep('error');
      toast({ title: 'Fehler', description: error instanceof Error ? error.message : 'Unbekannter Fehler', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
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
          <p className="text-muted-foreground mt-1">LLM Council: GPT-5.2 Generator + Opus Validator</p>
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
              <h3 className="text-xl font-display font-bold text-foreground mb-1">Generierung läuft...</h3>
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
            <p className="text-muted-foreground mb-4">
              {doneLogs.length} Kompetenzen → {doneLogs.reduce((s, l) => s + l.lessons, 0)} Lektionen
            </p>
            {errorLogs.length > 0 && (
              <p className="text-sm text-destructive mb-4 flex items-center justify-center gap-1">
                <AlertTriangle className="h-4 w-4" /> {errorLogs.length} Fehler – können nachgeneriert werden.
              </p>
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
