import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL } from '@/lib/seo';

interface Question {
  text: string;
  options: { label: string; score: number }[];
}

const QUESTIONS: Question[] = [
  {
    text: 'Wie sicher fühlst du dich bei den Kernthemen deiner Abschlussprüfung?',
    options: [
      { label: 'Sehr sicher – ich kann alles erklären', score: 3 },
      { label: 'Ganz okay – die Basics sitzen', score: 2 },
      { label: 'Unsicher – vieles fehlt noch', score: 1 },
      { label: 'Gar nicht – ich weiß kaum, was drankommt', score: 0 },
    ],
  },
  {
    text: 'Hast du schon eine vollständige Prüfungssimulation gemacht?',
    options: [
      { label: 'Ja, mehrfach unter Zeitdruck', score: 3 },
      { label: 'Einmal, aber ohne Timer', score: 2 },
      { label: 'Nein, nur einzelne Aufgaben', score: 1 },
      { label: 'Nein, noch nie', score: 0 },
    ],
  },
  {
    text: 'Wie bereitest du dich auf die mündliche Prüfung vor?',
    options: [
      { label: 'Ich übe regelmäßig mit jemandem', score: 3 },
      { label: 'Ich lese Fragen durch', score: 2 },
      { label: 'Noch gar nicht – keine Ahnung, wie', score: 1 },
      { label: 'Mündliche Prüfung? Muss ich das auch?', score: 0 },
    ],
  },
  {
    text: 'Wie viel Zeit hast du noch bis zur Prüfung?',
    options: [
      { label: 'Mehr als 3 Monate', score: 3 },
      { label: '1–3 Monate', score: 2 },
      { label: 'Weniger als 4 Wochen', score: 1 },
      { label: 'Die Prüfung ist nächste Woche 😱', score: 0 },
    ],
  },
  {
    text: 'Kennst du deine persönlichen Schwächen in den Prüfungsthemen?',
    options: [
      { label: 'Ja, genau – ich arbeite gezielt daran', score: 3 },
      { label: 'Ungefähr – so ein Gefühl halt', score: 2 },
      { label: 'Nicht wirklich', score: 1 },
      { label: 'Ich weiß nicht mal, welche Themen dran kommen', score: 0 },
    ],
  },
];

type ResultLevel = 'green' | 'yellow' | 'red';

function getResult(score: number): { level: ResultLevel; title: string; text: string; icon: typeof CheckCircle } {
  const maxScore = QUESTIONS.length * 3;
  const pct = score / maxScore;

  if (pct >= 0.7) return {
    level: 'green',
    title: 'Gute Ausgangslage!',
    text: 'Du bist auf einem soliden Weg. Mit gezieltem Training kannst du deine Bestehensquote weiter absichern und Schwächen systematisch eliminieren.',
    icon: CheckCircle,
  };
  if (pct >= 0.4) return {
    level: 'yellow',
    title: 'Noch Luft nach oben.',
    text: 'Du hast eine Basis, aber einige Lücken könnten in der Prüfung zum Problem werden. Gezieltes Training jetzt zahlt sich direkt aus.',
    icon: AlertTriangle,
  };
  return {
    level: 'red',
    title: 'Achtung – hoher Handlungsbedarf!',
    text: 'Ohne systematische Vorbereitung wird es eng. Die gute Nachricht: Mit ExamFit kannst du dich in wenigen Wochen prüfungsfit machen.',
    icon: XCircle,
  };
}

export default function PruefungsreifeCheck() {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [showResult, setShowResult] = useState(false);

  const handleAnswer = (score: number) => {
    const next = [...answers, score];
    setAnswers(next);
    if (current + 1 >= QUESTIONS.length) {
      setShowResult(true);
    } else {
      setCurrent(current + 1);
    }
  };

  const reset = () => {
    setCurrent(0);
    setAnswers([]);
    setShowResult(false);
  };

  const totalScore = answers.reduce((a, b) => a + b, 0);
  const result = getResult(totalScore);
  const ResultIcon = result.icon;

  const colorMap: Record<ResultLevel, string> = {
    green: 'text-success border-success/30 bg-success/5',
    yellow: 'text-warning border-warning/30 bg-warning/5',
    red: 'text-destructive border-destructive/30 bg-destructive/5',
  };

  return (
    <>
      <SEOHead
        title="Prüfungsreife-Check – Wie bereit bist du? | ExamFit"
        description="Finde in 2 Minuten heraus, wie gut du auf deine IHK-Abschlussprüfung vorbereitet bist. Kostenloser Selbsttest von ExamFit."
        canonical={`${SITE_URL}/pruefungsreife-check`}
      />

      <div className="min-h-screen flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-xl">
          {!showResult ? (
            <div className="glass-card rounded-2xl p-6 sm:p-8">
              {/* Progress */}
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs text-muted-foreground font-medium">
                  Frage {current + 1} von {QUESTIONS.length}
                </span>
                <div className="flex gap-1">
                  {QUESTIONS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 w-6 rounded-full transition-colors ${
                        i < current ? 'bg-primary' : i === current ? 'bg-accent' : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <h2 className="text-lg sm:text-xl font-semibold mb-6">
                {QUESTIONS[current].text}
              </h2>

              <div className="flex flex-col gap-3">
                {QUESTIONS[current].options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleAnswer(opt.score)}
                    className="text-left px-4 py-3 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-sm"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={`glass-card rounded-2xl p-6 sm:p-8 border-2 ${colorMap[result.level]}`}>
              <div className="text-center mb-6">
                <ResultIcon className={`h-12 w-12 mx-auto mb-3 ${colorMap[result.level].split(' ')[0]}`} />
                <h2 className="text-2xl font-display font-bold mb-2">{result.title}</h2>
                <p className="text-muted-foreground">{result.text}</p>
              </div>

              <div className="mb-6 p-4 rounded-xl bg-muted/50">
                <div className="text-center">
                  <span className="text-3xl font-bold text-gradient">
                    {Math.round((totalScore / (QUESTIONS.length * 3)) * 100)} %
                  </span>
                  <p className="text-xs text-muted-foreground mt-1">Prüfungsreife-Index</p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Link to="/shop">
                  <Button size="lg" className="w-full gradient-primary text-primary-foreground rounded-xl h-14 text-lg group">
                    Jetzt gezielt trainieren – 39 €
                    <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Test wiederholen
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
