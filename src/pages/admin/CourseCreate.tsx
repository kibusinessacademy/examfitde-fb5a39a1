import { useState, useEffect } from 'react';
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
import { ArrowLeft, Sparkles, Loader2, CheckCircle, BookOpen } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Curriculum = Tables<'curricula'>;

type GenerationStep = 'select' | 'generating' | 'complete';

export default function CourseCreate() {
  const { user } = useAuth();
  const navigate = useNavigate();
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

  useEffect(() => {
    fetchCurricula();
  }, []);

  const fetchCurricula = async () => {
    const { data, error } = await supabase
      .from('curricula')
      .select('*')
      .eq('status', 'frozen')
      .order('title');

    if (!error && data) {
      setCurricula(data);
      
      // Auto-fill title if curriculum is preselected
      if (preselectedCurriculumId) {
        const selected = data.find(c => c.id === preselectedCurriculumId);
        if (selected && !title) {
          setTitle(`Kurs: ${selected.title}`);
        }
      }
    }
    setLoadingCurricula(false);
  };

  const handleGenerate = async () => {
    if (!selectedCurriculumId || !title.trim()) {
      toast({
        title: 'Fehlende Angaben',
        description: 'Bitte wähle ein Curriculum aus und gib einen Titel ein.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);
    setStep('generating');
    setProgress(10);

    try {
      // 1. Create course record
      const { data: course, error: createError } = await supabase
        .from('courses')
        .insert({
          curriculum_id: selectedCurriculumId,
          title: title.trim(),
          description: description.trim() || null,
          status: 'generating',
          created_by: user?.id,
        })
        .select()
        .single();

      if (createError) throw createError;
      setCreatedCourseId(course.id);
      setProgress(30);

      // 2. Fetch learning fields and competencies for the curriculum
      const { data: learningFields, error: lfError } = await supabase
        .from('learning_fields')
        .select(`
          *,
          competencies (*)
        `)
        .eq('curriculum_id', selectedCurriculumId)
        .order('sort_order');

      if (lfError) throw lfError;
      setProgress(50);

      // 3. Create modules for each learning field
      let totalDuration = 0;
      for (let i = 0; i < (learningFields?.length || 0); i++) {
        const lf = learningFields![i];
        
        const { data: module, error: modError } = await supabase
          .from('modules')
          .insert({
            course_id: course.id,
            learning_field_id: lf.id,
            title: lf.title,
            description: lf.description,
            sort_order: i,
          })
          .select()
          .single();

        if (modError) throw modError;

        // 4. Create lessons for each competency (using 5-step didactic model)
        const competencies = (lf as any).competencies || [];
        const lessonSteps: Array<'einstieg' | 'verstehen' | 'anwenden' | 'wiederholen' | 'mini_check'> = 
          ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'];

        for (let j = 0; j < competencies.length; j++) {
          const comp = competencies[j];
          
          // Create one lesson per step for each competency
          for (let k = 0; k < lessonSteps.length; k++) {
            const stepName = lessonSteps[k];
            const stepTitles: Record<string, string> = {
              einstieg: 'Einstieg',
              verstehen: 'Verstehen',
              anwenden: 'Anwenden',
              wiederholen: 'Wiederholen',
              mini_check: 'Mini-Check',
            };

            await supabase.from('lessons').insert({
              module_id: module.id,
              competency_id: comp.id,
              title: `${comp.code} - ${stepTitles[stepName]}`,
              step: stepName,
              duration_minutes: 10,
              sort_order: j * 5 + k,
            });

            totalDuration += 10;
          }
        }

        setProgress(50 + Math.round((i / learningFields!.length) * 40));
      }

      // 5. Update course with estimated duration and status
      await supabase
        .from('courses')
        .update({
          estimated_duration: Math.round(totalDuration / 60),
          status: 'draft',
        })
        .eq('id', course.id);

      setProgress(100);
      setStep('complete');

      toast({
        title: 'Kurs erstellt',
        description: 'Der Kurs wurde erfolgreich generiert. Du kannst ihn jetzt bearbeiten.',
      });

    } catch (error) {
      console.error('Course generation error:', error);
      toast({
        title: 'Fehler bei der Generierung',
        description: error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten.',
        variant: 'destructive',
      });
      setStep('select');
    } finally {
      setIsGenerating(false);
    }
  };

  const selectedCurriculum = curricula.find(c => c.id === selectedCurriculumId);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin-v2/courses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Kurs erstellen</h1>
          <p className="text-muted-foreground mt-1">Generiere einen Kurs basierend auf einem Curriculum</p>
        </div>
      </div>

      {/* Select Step */}
      {step === 'select' && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-accent" />
              Kurs konfigurieren
            </CardTitle>
            <CardDescription>
              Wähle ein eingefrorenes Curriculum und gib dem Kurs einen Titel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Curriculum *</Label>
              {loadingCurricula ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lade Curricula...
                </div>
              ) : curricula.length === 0 ? (
                <div className="p-4 rounded-xl bg-muted/30 text-center">
                  <p className="text-muted-foreground mb-3">Keine eingefrorenen Curricula verfügbar.</p>
                  <Link to="/admin-v2/curricula/new">
                    <Button variant="outline" size="sm">
                      Curriculum importieren
                    </Button>
                  </Link>
                </div>
              ) : (
                <Select value={selectedCurriculumId} onValueChange={setSelectedCurriculumId}>
                  <SelectTrigger className="bg-muted/50">
                    <SelectValue placeholder="Curriculum auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {curricula.map((curriculum) => (
                      <SelectItem key={curriculum.id} value={curriculum.id}>
                        {curriculum.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedCurriculum && (
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                <p className="font-medium text-foreground">{selectedCurriculum.title}</p>
                {selectedCurriculum.description && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedCurriculum.description}</p>
                )}
                <p className="text-sm text-muted-foreground mt-2">
                  Version: {selectedCurriculum.version || '1.0'}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title">Kurstitel *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Fachinformatiker AE - Komplettpaket"
                className="bg-muted/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optionale Beschreibung des Kurses..."
                className="bg-muted/50 min-h-[100px]"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!selectedCurriculumId || !title.trim() || isGenerating}
              className="w-full gradient-accent text-accent-foreground shadow-glow-accent"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Kurs generieren
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Generating Step */}
      {step === 'generating' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <Sparkles className="h-16 w-16 text-accent mx-auto mb-6 animate-pulse" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              Kurs wird generiert...
            </h3>
            <p className="text-muted-foreground mb-6">
              Module und Lektionen werden basierend auf dem Curriculum erstellt.
            </p>
            <div className="max-w-md mx-auto">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground mt-2">{progress}%</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Complete Step */}
      {step === 'complete' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <div className="w-20 h-20 rounded-full gradient-accent flex items-center justify-center mx-auto mb-6 shadow-glow-accent">
              <CheckCircle className="h-10 w-10 text-accent-foreground" />
            </div>
            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              Kurs erfolgreich erstellt!
            </h3>
            <p className="text-muted-foreground mb-6">
              Der Kurs mit allen Modulen und Lektionen wurde generiert.
            </p>
            <div className="flex gap-3 justify-center">
              <Link to="/admin-v2/courses">
                <Button variant="outline">Zur Übersicht</Button>
              </Link>
              {createdCourseId && (
                <Link to={`/admin-v2/courses/${createdCourseId}/edit`}>
                  <Button className="gradient-accent text-accent-foreground">
                    Kurs bearbeiten
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
