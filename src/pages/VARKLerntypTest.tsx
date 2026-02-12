import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Eye, 
  Ear, 
  BookOpen, 
  Hand,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PageExplainer from '@/components/admin/PageExplainer';

type VARKType = 'visual' | 'auditory' | 'reading' | 'kinesthetic';

interface VARKQuestion {
  id: number;
  question: string;
  context: string;
  options: {
    text: string;
    type: VARKType;
  }[];
}

const VARK_INFO = {
  visual: {
    name: 'Visuell',
    icon: Eye,
    color: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
    description: 'Du lernst am besten durch Bilder, Diagramme und visuelle Darstellungen.',
    tips: [
      'Nutze Mindmaps und Flowcharts',
      'Markiere Texte farbig',
      'Schau dir Videos und Animationen an',
      'Erstelle eigene Skizzen und Schaubilder',
    ],
  },
  auditory: {
    name: 'Auditiv',
    icon: Ear,
    color: 'bg-green-500/20 text-green-600 border-green-500/30',
    description: 'Du lernst am besten durch Zuhören, Diskussionen und verbale Erklärungen.',
    tips: [
      'Höre Podcasts und Audiobooks',
      'Erkläre den Stoff laut dir selbst',
      'Nutze Lerngruppen für Diskussionen',
      'Nimm Zusammenfassungen auf und höre sie ab',
    ],
  },
  reading: {
    name: 'Lesen/Schreiben',
    icon: BookOpen,
    color: 'bg-purple-500/20 text-purple-600 border-purple-500/30',
    description: 'Du lernst am besten durch Lesen und Schreiben von Texten.',
    tips: [
      'Schreibe eigene Zusammenfassungen',
      'Erstelle Karteikarten mit Texten',
      'Lies Fachliteratur und Artikel',
      'Führe ein Lerntagebuch',
    ],
  },
  kinesthetic: {
    name: 'Kinästhetisch',
    icon: Hand,
    color: 'bg-orange-500/20 text-orange-600 border-orange-500/30',
    description: 'Du lernst am besten durch praktisches Tun und Ausprobieren.',
    tips: [
      'Übe praktische Aufgaben',
      'Nutze Rollenspiele und Simulationen',
      'Bewege dich beim Lernen',
      'Baue Modelle oder nutze Lernspiele',
    ],
  },
};

const VARK_QUESTIONS: VARKQuestion[] = [
  {
    id: 1,
    question: 'Du musst einen neuen Prozess lernen. Wie gehst du am liebsten vor?',
    context: 'Lernstrategie',
    options: [
      { text: 'Ich schaue mir ein Diagramm oder Flowchart an', type: 'visual' },
      { text: 'Ich lasse es mir von jemandem erklären', type: 'auditory' },
      { text: 'Ich lese die schriftliche Anleitung', type: 'reading' },
      { text: 'Ich probiere es einfach aus', type: 'kinesthetic' },
    ],
  },
  {
    id: 2,
    question: 'Wie merkst du dir am besten einen wichtigen Termin?',
    context: 'Gedächtnis',
    options: [
      { text: 'Ich stelle mir den Tag bildlich vor', type: 'visual' },
      { text: 'Ich sage mir das Datum mehrmals vor', type: 'auditory' },
      { text: 'Ich schreibe es mir auf', type: 'reading' },
      { text: 'Ich verbinde es mit einer Aktivität', type: 'kinesthetic' },
    ],
  },
  {
    id: 3,
    question: 'Du erklärst jemandem den Weg. Wie machst du das?',
    context: 'Kommunikation',
    options: [
      { text: 'Ich zeichne eine Karte oder Skizze', type: 'visual' },
      { text: 'Ich beschreibe den Weg mündlich', type: 'auditory' },
      { text: 'Ich schreibe die Wegbeschreibung auf', type: 'reading' },
      { text: 'Ich gehe ein Stück mit und zeige den Weg', type: 'kinesthetic' },
    ],
  },
  {
    id: 4,
    question: 'Du kaufst ein neues Gerät. Wie lernst du es zu bedienen?',
    context: 'Problemlösung',
    options: [
      { text: 'Ich schaue mir Bilder und Videos an', type: 'visual' },
      { text: 'Ich frage jemanden, der es kennt', type: 'auditory' },
      { text: 'Ich lese das Handbuch', type: 'reading' },
      { text: 'Ich probiere alle Funktionen aus', type: 'kinesthetic' },
    ],
  },
  {
    id: 5,
    question: 'Du lernst für eine Prüfung. Was hilft dir am meisten?',
    context: 'Prüfungsvorbereitung',
    options: [
      { text: 'Farbige Markierungen und Mindmaps', type: 'visual' },
      { text: 'Den Stoff laut zusammenfassen', type: 'auditory' },
      { text: 'Zusammenfassungen schreiben', type: 'reading' },
      { text: 'Übungsaufgaben praktisch lösen', type: 'kinesthetic' },
    ],
  },
  {
    id: 6,
    question: 'Du musst eine Präsentation vorbereiten. Was betonst du?',
    context: 'Präsentation',
    options: [
      { text: 'Anschauliche Grafiken und Bilder', type: 'visual' },
      { text: 'Interessante Geschichten und Beispiele', type: 'auditory' },
      { text: 'Detaillierte Handouts und Texte', type: 'reading' },
      { text: 'Praktische Demonstrationen', type: 'kinesthetic' },
    ],
  },
  {
    id: 7,
    question: 'Was lenkt dich beim Lernen am meisten ab?',
    context: 'Konzentration',
    options: [
      { text: 'Unordnung oder visuelles Chaos', type: 'visual' },
      { text: 'Geräusche und Gespräche', type: 'auditory' },
      { text: 'Schlecht formatierte Texte', type: 'reading' },
      { text: 'Langes Stillsitzen', type: 'kinesthetic' },
    ],
  },
  {
    id: 8,
    question: 'Du triffst dich mit Freunden. Woran erinnerst du dich am besten?',
    context: 'Erinnerung',
    options: [
      { text: 'Wie alle aussahen, die Umgebung', type: 'visual' },
      { text: 'Was besprochen wurde', type: 'auditory' },
      { text: 'Die Namen und Details', type: 'reading' },
      { text: 'Das Gefühl und die Aktivitäten', type: 'kinesthetic' },
    ],
  },
  {
    id: 9,
    question: 'Du lernst eine neue Software. Was nutzt du?',
    context: 'Technologie',
    options: [
      { text: 'Video-Tutorials', type: 'visual' },
      { text: 'Webinare oder telefonische Hilfe', type: 'auditory' },
      { text: 'Schriftliche Dokumentation', type: 'reading' },
      { text: 'Trial and Error - einfach loslegen', type: 'kinesthetic' },
    ],
  },
  {
    id: 10,
    question: 'Was für ein Buch würdest du am ehesten lesen?',
    context: 'Präferenzen',
    options: [
      { text: 'Bildband oder illustriertes Buch', type: 'visual' },
      { text: 'Hörbuch oder Podcast-Transkript', type: 'auditory' },
      { text: 'Fachbuch mit viel Text', type: 'reading' },
      { text: 'Praxis-Ratgeber mit Übungen', type: 'kinesthetic' },
    ],
  },
  {
    id: 11,
    question: 'Du planst einen Urlaub. Wie informierst du dich?',
    context: 'Planung',
    options: [
      { text: 'Bilder und Videos vom Reiseziel', type: 'visual' },
      { text: 'Empfehlungen von Freunden', type: 'auditory' },
      { text: 'Reiseführer und Artikel lesen', type: 'reading' },
      { text: 'Einfach losfahren und erkunden', type: 'kinesthetic' },
    ],
  },
  {
    id: 12,
    question: 'Wie gibst du am liebsten Feedback?',
    context: 'Feedback',
    options: [
      { text: 'Mit Beispielbildern oder Skizzen', type: 'visual' },
      { text: 'Im persönlichen Gespräch', type: 'auditory' },
      { text: 'Schriftlich per E-Mail', type: 'reading' },
      { text: 'Durch Zeigen und Vormachen', type: 'kinesthetic' },
    ],
  },
];

export default function VARKLerntypTest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, VARKType>>({});
  const [isComplete, setIsComplete] = useState(false);
  const [results, setResults] = useState<{
    scores: Record<VARKType, number>;
    primary: VARKType;
    secondary: VARKType | null;
    isMultimodal: boolean;
  } | null>(null);

  const question = VARK_QUESTIONS[currentQuestion];
  const progress = ((currentQuestion) / VARK_QUESTIONS.length) * 100;

  const handleAnswer = (type: VARKType) => {
    const newAnswers = { ...answers, [question.id]: type };
    setAnswers(newAnswers);

    if (currentQuestion < VARK_QUESTIONS.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    } else {
      calculateResults(newAnswers);
    }
  };

  const calculateResults = async (allAnswers: Record<number, VARKType>) => {
    const scores: Record<VARKType, number> = {
      visual: 0,
      auditory: 0,
      reading: 0,
      kinesthetic: 0,
    };

    Object.values(allAnswers).forEach(type => {
      scores[type]++;
    });

    // Convert to percentages
    const total = Object.values(scores).reduce((sum, s) => sum + s, 0);
    const percentages: Record<VARKType, number> = {
      visual: Math.round((scores.visual / total) * 100),
      auditory: Math.round((scores.auditory / total) * 100),
      reading: Math.round((scores.reading / total) * 100),
      kinesthetic: Math.round((scores.kinesthetic / total) * 100),
    };

    // Find primary and secondary
    const sorted = Object.entries(percentages)
      .sort(([, a], [, b]) => b - a) as [VARKType, number][];
    
    const primary = sorted[0][0];
    const secondary = sorted[1][1] >= 20 ? sorted[1][0] : null;
    const isMultimodal = sorted.filter(([, score]) => score >= 20).length >= 2;

    setResults({
      scores: percentages,
      primary,
      secondary,
      isMultimodal,
    });
    setIsComplete(true);

    // Save to database
    if (user) {
      try {
        await supabase.from('vark_assessments').upsert({
          user_id: user.id,
          visual_score: percentages.visual,
          auditory_score: percentages.auditory,
          reading_score: percentages.reading,
          kinesthetic_score: percentages.kinesthetic,
          primary_type: primary,
          secondary_type: secondary,
          is_multimodal: isMultimodal,
          completed_at: new Date().toISOString(),
          questions_answered: Object.keys(allAnswers).length,
          raw_responses: allAnswers,
        }, { onConflict: 'user_id' });
        
        toast.success('Dein Lerntyp wurde gespeichert!');
      } catch (error) {
        console.error('Failed to save VARK results:', error);
      }
    }
  };

  const handleRestart = () => {
    setCurrentQuestion(0);
    setAnswers({});
    setIsComplete(false);
    setResults(null);
  };

  // Results Screen
  if (isComplete && results) {
    const primaryInfo = VARK_INFO[results.primary];
    const PrimaryIcon = primaryInfo.icon;

    return (
      <div className="container max-w-4xl py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <div className={cn("h-20 w-20 rounded-full flex items-center justify-center", primaryInfo.color)}>
                <PrimaryIcon className="h-10 w-10" />
              </div>
            </div>
            <CardTitle className="text-2xl flex items-center justify-center gap-2">
              <Sparkles className="h-6 w-6 text-yellow-500" />
              Dein Lerntyp: {primaryInfo.name}
              {results.isMultimodal && (
                <Badge variant="secondary">Multimodal</Badge>
              )}
            </CardTitle>
            <CardDescription>{primaryInfo.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Score Bars */}
            <div className="space-y-4">
              {(Object.entries(results.scores) as [VARKType, number][])
                .sort(([, a], [, b]) => b - a)
                .map(([type, score]) => {
                  const info = VARK_INFO[type];
                  const Icon = info.icon;
                  return (
                    <div key={type} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="font-medium">{info.name}</span>
                        </div>
                        <span className="font-bold">{score}%</span>
                      </div>
                      <Progress value={score} className="h-3" />
                    </div>
                  );
                })}
            </div>

            {/* Learning Tips */}
            <div className={cn("p-4 rounded-lg border", primaryInfo.color)}>
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Lerntipps für deinen Typ
              </h3>
              <ul className="space-y-2">
                {primaryInfo.tips.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-primary">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* Secondary type tips if multimodal */}
            {results.secondary && (
              <div className={cn("p-4 rounded-lg border", VARK_INFO[results.secondary].color)}>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  {(() => {
                    const SecIcon = VARK_INFO[results.secondary!].icon;
                    return <SecIcon className="h-4 w-4" />;
                  })()}
                  Zusätzliche Tipps ({VARK_INFO[results.secondary].name})
                </h3>
                <ul className="space-y-2">
                  {VARK_INFO[results.secondary].tips.slice(0, 2).map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-primary">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleRestart}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Nochmal machen
              </Button>
              <Button className="flex-1" onClick={() => navigate('/dashboard')}>
                Zum Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Question Screen
  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Sparkles className="h-8 w-8 text-primary" />
          VARK Lerntyp-Test
        </h1>
        <p className="text-muted-foreground mt-2">
          Finde heraus, wie du am besten lernst
        </p>
      </div>

      <PageExplainer
        title="Was ist der VARK-Lerntyp-Test?"
        description="Der VARK-Test identifiziert deinen bevorzugten Lernstil: Visuell, Auditiv, Lesen/Schreiben oder Kinästhetisch. Das System nutzt dein Ergebnis, um Lernempfehlungen besser auf dich abzustimmen."
        actions={[
          '12 Fragen beantworten → Dein Lerntyp wird automatisch bestimmt',
          'Ergebnis zeigt Prozentwerte für alle 4 Typen',
          'Personalisierte Lerntipps basierend auf deinem Lerntyp',
        ]}
        tips={[
          'Es gibt keinen "besseren" Lerntyp – jeder Typ hat eigene Stärken',
          'Multimodale Lerner nutzen mehrere Kanäle – das ist besonders effektiv',
          'Dein Ergebnis wird gespeichert und beeinflusst zukünftige Empfehlungen',
        ]}
      />

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Badge variant="outline">{question.context}</Badge>
          <span className="text-sm text-muted-foreground">
            Frage {currentQuestion + 1} / {VARK_QUESTIONS.length}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <Card className="glass-card">
        <CardContent className="pt-6 space-y-6">
          <p className="text-lg font-medium">{question.question}</p>

          <div className="space-y-3">
            {question.options.map((option, idx) => {
              const info = VARK_INFO[option.type];
              const Icon = info.icon;
              const isSelected = answers[question.id] === option.type;

              return (
                <button
                  key={idx}
                  onClick={() => handleAnswer(option.type)}
                  className={cn(
                    "w-full text-left p-4 rounded-lg border transition-all flex items-start gap-3",
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  )}
                >
                  <Icon className="h-5 w-5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <span>{option.text}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <Button
          variant="outline"
          onClick={() => setCurrentQuestion(prev => prev - 1)}
          disabled={currentQuestion === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Zurück
        </Button>
        
        <span className="text-sm text-muted-foreground">
          {Object.keys(answers).length} beantwortet
        </span>

        {currentQuestion < VARK_QUESTIONS.length - 1 && answers[question.id] && (
          <Button
            onClick={() => setCurrentQuestion(prev => prev + 1)}
          >
            Weiter
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
