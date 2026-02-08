import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, 
  Flame, 
  Clock, 
  CheckCircle2, 
  XCircle,
  RotateCcw,
  Trophy,
  Target,
  Zap,
  Loader2,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Card {
  card_id: string;
  question_id: string;
  question_text: string;
  options: string[];
  correct_answer: number;
  bloom_level: string;
  is_new: boolean;
  ease_factor: number;
  interval_days: number;
  repetition_count: number;
}

interface SessionState {
  id: string;
  cards: Card[];
  currentIndex: number;
  correct: number;
  incorrect: number;
  startTime: Date;
}

const BLOOM_COLORS: Record<string, string> = {
  remember: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
  understand: 'bg-green-500/20 text-green-600 border-green-500/30',
  apply: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
  analyze: 'bg-orange-500/20 text-orange-600 border-orange-500/30',
  evaluate: 'bg-purple-500/20 text-purple-600 border-purple-500/30',
  create: 'bg-pink-500/20 text-pink-600 border-pink-500/30',
};

const BLOOM_LABELS: Record<string, string> = {
  remember: 'K1 Erinnern',
  understand: 'K2 Verstehen',
  apply: 'K3 Anwenden',
  analyze: 'K4 Analysieren',
  evaluate: 'K5 Bewerten',
  create: 'K6 Erschaffen',
};

// Quality ratings for SM-2 algorithm
const QUALITY_RATINGS = [
  { value: 0, label: 'Komplett vergessen', color: 'destructive' as const },
  { value: 1, label: 'Falsch, aber erinnert', color: 'destructive' as const },
  { value: 2, label: 'Falsch, fast richtig', color: 'secondary' as const },
  { value: 3, label: 'Richtig, schwierig', color: 'secondary' as const },
  { value: 4, label: 'Richtig, leicht', color: 'default' as const },
  { value: 5, label: 'Perfekt!', color: 'default' as const },
];

export default function SpacedRepetitionSession() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [phase, setPhase] = useState<'setup' | 'learning' | 'rating' | 'results'>('setup');
  const [selectedCurriculum, setSelectedCurriculum] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [responseStartTime, setResponseStartTime] = useState<Date | null>(null);

  // Fetch curricula
  const { data: curricula } = useQuery({
    queryKey: ['curricula-for-sr'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title')
        .eq('status', 'frozen')
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  // Fetch streak
  const { data: streakData } = useQuery({
    queryKey: ['learning-streak', selectedCurriculum],
    queryFn: async () => {
      if (!selectedCurriculum || !user) return null;
      const { data, error } = await supabase
        .from('user_learning_streaks')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', selectedCurriculum)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!selectedCurriculum && !!user,
  });

  // Start session mutation
  const startSessionMutation = useMutation({
    mutationFn: async (curriculumId: string) => {
      const { data, error } = await supabase.functions.invoke('spaced-repetition', {
        body: { action: 'start_session', curriculum_id: curriculumId, max_cards: 20 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.cards.length === 0) {
        toast.info('Keine Karten zum Lernen verfügbar. Initialisiere neue Karten...');
        initializeCardsMutation.mutate(selectedCurriculum!);
        return;
      }
      
      setSession({
        id: data.session.id,
        cards: data.cards,
        currentIndex: 0,
        correct: 0,
        incorrect: 0,
        startTime: new Date(),
      });
      setPhase('learning');
      setResponseStartTime(new Date());
    },
    onError: (error) => {
      toast.error('Fehler beim Starten der Session');
      console.error(error);
    },
  });

  // Initialize cards mutation
  const initializeCardsMutation = useMutation({
    mutationFn: async (curriculumId: string) => {
      const { data, error } = await supabase.functions.invoke('spaced-repetition', {
        body: { action: 'initialize_cards', curriculum_id: curriculumId, limit: 50 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.created} neue Lernkarten erstellt`);
      if (data.created > 0) {
        startSessionMutation.mutate(selectedCurriculum!);
      }
    },
  });

  // Submit review mutation
  const submitReviewMutation = useMutation({
    mutationFn: async ({ cardId, quality, responseTime }: { cardId: string; quality: number; responseTime: number }) => {
      const { data, error } = await supabase.functions.invoke('spaced-repetition', {
        body: {
          action: 'submit_review',
          card_id: cardId,
          quality_rating: quality,
          response_time_ms: responseTime,
          session_id: session?.id,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      const isCorrect = variables.quality >= 3;
      
      setSession(prev => {
        if (!prev) return prev;
        const newSession = {
          ...prev,
          currentIndex: prev.currentIndex + 1,
          correct: isCorrect ? prev.correct + 1 : prev.correct,
          incorrect: isCorrect ? prev.incorrect : prev.incorrect + 1,
        };
        
        if (newSession.currentIndex >= newSession.cards.length) {
          finishSession();
        }
        
        return newSession;
      });
      
      setSelectedAnswer(null);
      setShowAnswer(false);
      setPhase('learning');
      setResponseStartTime(new Date());
    },
  });

  // Finish session
  const finishSession = async () => {
    if (!session || !selectedCurriculum) return;
    
    try {
      const { data } = await supabase.functions.invoke('spaced-repetition', {
        body: {
          action: 'finish_session',
          session_id: session.id,
          curriculum_id: selectedCurriculum,
        },
      });
      
      setPhase('results');
      toast.success(data.streak?.streak_continued ? '🔥 Streak fortgesetzt!' : 'Session abgeschlossen!');
    } catch (error) {
      console.error(error);
    }
  };

  const currentCard = session?.cards[session.currentIndex];
  const progress = session ? ((session.currentIndex) / session.cards.length) * 100 : 0;

  const handleAnswerClick = (index: number) => {
    if (showAnswer) return;
    setSelectedAnswer(index);
    setShowAnswer(true);
  };

  const handleRating = (quality: number) => {
    if (!currentCard || !responseStartTime) return;
    
    const responseTime = Date.now() - responseStartTime.getTime();
    submitReviewMutation.mutate({
      cardId: currentCard.card_id,
      quality,
      responseTime,
    });
  };

  const handleRestart = () => {
    setSession(null);
    setPhase('setup');
    setSelectedAnswer(null);
    setShowAnswer(false);
  };

  // Setup Phase
  if (phase === 'setup') {
    return (
      <div className="container max-w-4xl py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Brain className="h-8 w-8 text-primary" />
            Spaced Repetition Lernen
          </h1>
          <p className="text-muted-foreground mt-2">
            Optimales Lernen mit dem SM-2 Algorithmus und Bloom's Taxonomy
          </p>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Lernsession starten
            </CardTitle>
            <CardDescription>
              Wähle dein Curriculum und starte mit dem intelligenten Wiederholungssystem
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Streak Display */}
            {streakData && (
              <div className="flex items-center gap-4 p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
                <Flame className="h-10 w-10 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {streakData.current_streak} Tage Streak
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Längste Serie: {streakData.longest_streak} Tage
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-2 block">
                Ausbildungsberuf / Curriculum
              </label>
              <div className="grid gap-2">
                {curricula?.map(curriculum => (
                  <Button
                    key={curriculum.id}
                    variant={selectedCurriculum === curriculum.id ? 'default' : 'outline'}
                    className="justify-start h-auto py-3"
                    onClick={() => setSelectedCurriculum(curriculum.id)}
                  >
                    {curriculum.title}
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                So funktioniert's:
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• SM-2 Algorithmus optimiert deine Wiederholungsintervalle</li>
                <li>• Bloom's Taxonomy passt die Schwierigkeit an</li>
                <li>• Tägliches Lernen baut deine Streak auf</li>
                <li>• Bewerte deine Antworten ehrlich für beste Ergebnisse</li>
              </ul>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!selectedCurriculum || startSessionMutation.isPending}
              onClick={() => selectedCurriculum && startSessionMutation.mutate(selectedCurriculum)}
            >
              {startSessionMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Brain className="h-4 w-4 mr-2" />
              )}
              Lernen starten
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Learning Phase
  if ((phase === 'learning' || phase === 'rating') && session && currentCard) {
    return (
      <div className="container max-w-4xl py-8">
        {/* Progress Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Badge className={BLOOM_COLORS[currentCard.bloom_level] || ''}>
                {BLOOM_LABELS[currentCard.bloom_level] || currentCard.bloom_level}
              </Badge>
              {currentCard.is_new && (
                <Badge variant="secondary">Neu</Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {session.currentIndex + 1} / {session.cards.length}
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Stats Row */}
        <div className="flex gap-4 mb-6">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">{session.correct}</span>
          </div>
          <div className="flex items-center gap-2 text-red-600">
            <XCircle className="h-4 w-4" />
            <span className="font-medium">{session.incorrect}</span>
          </div>
        </div>

        {/* Question Card */}
        <Card className="glass-card">
          <CardContent className="pt-6 space-y-6">
            <div className="text-lg font-medium">
              {currentCard.question_text}
            </div>

            {/* Answer Options */}
            <div className="space-y-3">
              {(currentCard.options as any[]).map((option: any, idx: number) => {
                const isSelected = selectedAnswer === idx;
                const isCorrect = idx === currentCard.correct_answer;
                const showStatus = showAnswer;
                
                let optionClass = 'border-border hover:border-primary/50';
                if (showStatus && isCorrect) {
                  optionClass = 'border-green-500 bg-green-500/10';
                } else if (showStatus && isSelected && !isCorrect) {
                  optionClass = 'border-red-500 bg-red-500/10';
                } else if (isSelected) {
                  optionClass = 'border-primary bg-primary/5';
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswerClick(idx)}
                    disabled={showAnswer}
                    className={cn(
                      "w-full text-left p-4 rounded-lg border transition-all",
                      optionClass
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-sm font-medium flex-shrink-0">
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span>{typeof option === 'string' ? option : option.text || option.label || JSON.stringify(option)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Rating Section (after answer shown) */}
            {showAnswer && (
              <div className="space-y-4 pt-4 border-t">
                <p className="text-sm font-medium text-center">
                  Wie gut konntest du die Antwort?
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {QUALITY_RATINGS.filter(r => r.value >= 0 && r.value <= 5).map(rating => (
                    <Button
                      key={rating.value}
                      variant={rating.color}
                      size="sm"
                      onClick={() => handleRating(rating.value)}
                      disabled={submitReviewMutation.isPending}
                      className="h-auto py-2 flex-col"
                    >
                      <span className="text-lg font-bold">{rating.value}</span>
                      <span className="text-xs opacity-80">{rating.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Results Phase
  if (phase === 'results' && session) {
    const accuracy = session.cards.length > 0 
      ? Math.round((session.correct / session.cards.length) * 100) 
      : 0;

    return (
      <div className="container max-w-4xl py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              {accuracy >= 70 ? (
                <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Trophy className="h-10 w-10 text-green-600" />
                </div>
              ) : (
                <div className="h-20 w-20 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <Brain className="h-10 w-10 text-yellow-600" />
                </div>
              )}
            </div>
            <CardTitle className="text-2xl">Session abgeschlossen!</CardTitle>
            <CardDescription>Hier ist deine Zusammenfassung</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="text-3xl font-bold">{session.cards.length}</p>
                <p className="text-sm text-muted-foreground">Karten</p>
              </div>
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <p className="text-3xl font-bold text-green-600">{session.correct}</p>
                <p className="text-sm text-muted-foreground">Richtig</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="text-3xl font-bold">{accuracy}%</p>
                <p className="text-sm text-muted-foreground">Genauigkeit</p>
              </div>
            </div>

            {streakData && (
              <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 text-center">
                <Flame className="h-8 w-8 text-orange-500 mx-auto mb-2" />
                <p className="text-2xl font-bold text-orange-600">
                  {streakData.current_streak} Tage Streak
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleRestart}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Neue Session
              </Button>
              <Button className="flex-1" onClick={() => navigate('/dashboard')}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Zum Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
