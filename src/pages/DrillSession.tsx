import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDrillMiniChecks } from '@/hooks/useDrillMiniChecks';
import MiniCheckPlayer from '@/components/lesson/MiniCheckPlayer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Zap, Target } from 'lucide-react';
import { TutorPanel } from '@/components/tutor/TutorPanel';
import { AI_MODES } from '@/hooks/useAITutor';

interface Competency {
  id: string;
  title: string;
}

export default function DrillSession() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const curriculumId = searchParams.get('curriculum');
  const competencyId = searchParams.get('competency');

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [selectedCompetency, setSelectedCompetency] = useState<string | null>(competencyId);
  const [started, setStarted] = useState(!!competencyId);
  const [loadingComps, setLoadingComps] = useState(true);

  const { data: drillContent, isLoading: drillLoading, refetch } = useDrillMiniChecks(
    curriculumId ?? undefined,
    selectedCompetency,
    5,
    started
  );

  // Load competencies via SSOT RPC (no direct table reads)
  useEffect(() => {
    if (!curriculumId) return;

    async function loadCompetencies() {
      const { data: comps, error } = await supabase.rpc('list_curriculum_competencies', {
        p_curriculum_id: curriculumId!,
      });

      if (error) {
        console.error('Error loading competencies:', error);
      }

      setCompetencies((comps as Competency[]) || []);
      setLoadingComps(false);
    }

    loadCompetencies();
  }, [curriculumId]);

  const handleCompleted = (score: number, maxScore: number) => {
    // Drill completed — user can start another or go back
  };

  const handleStartRandom = () => {
    setSelectedCompetency(null);
    setStarted(true);
  };

  const handleStartCompetency = (compId: string) => {
    setSelectedCompetency(compId);
    setStarted(true);
  };

  const handleNewDrill = () => {
    setStarted(false);
    setSelectedCompetency(null);
  };

  if (!curriculumId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="glass-card max-w-md w-full">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Kein Curriculum angegeben.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Selection screen
  if (!started) {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="container mx-auto max-w-2xl">
          <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Button>

          <Card className="glass-card mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                5-Minuten-Training
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Trainiere gezielt deine Schwächen oder starte eine zufällige Session.
              </p>

              <Button onClick={handleStartRandom} className="w-full gradient-primary text-primary-foreground gap-2" data-testid="drill-start-random">
                <Zap className="h-4 w-4" />
                Zufälliges Training starten
              </Button>

              {loadingComps ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : competencies.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Oder nach Kompetenz:</p>
                  {competencies.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handleStartCompetency(c.id)}
                      className="w-full p-3 rounded-xl border border-border hover:border-primary/50 hover:bg-muted/30 text-left transition-all flex items-center gap-3"
                    >
                      <Target className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-sm">{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Drill session
  if (drillLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!drillContent) {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="container mx-auto max-w-2xl">
          <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Button>

          <Card className="glass-card">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">Drill-Fragen werden vorbereitet</h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Für dieses Curriculum werden gerade Übungsfragen erstellt. 
                Sobald genügend geprüfte Fragen vorliegen, kannst du hier trainieren.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <Button variant="outline" onClick={() => navigate(-1)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Zurück zum Dashboard
                </Button>
                <Button variant="outline" onClick={() => refetch()} className="gap-2">
                  <Zap className="h-4 w-4" />
                  Erneut prüfen
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="container mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" className="gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Button>
          <Button variant="outline" size="sm" onClick={handleNewDrill} className="gap-2">
            <Zap className="h-4 w-4" />
            Neues Training
          </Button>
        </div>

        <MiniCheckPlayer
          content={drillContent}
          lessonId={null}
          onCompleted={handleCompleted}
        />
      </div>

      {/* AI Tutor Panel — Loop C, Strict-RAG with curriculum context */}
      <TutorPanel
        mode={AI_MODES.PRACTICE}
        sessionType="practice"
        masteryCurriculumId={curriculumId ?? undefined}
        masteryUserId={user?.id}
      />
    </div>
  );
}
