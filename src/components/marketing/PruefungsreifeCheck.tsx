import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL } from '@/lib/seo';
import { trackConversion } from '@/lib/seo-tracking';

interface Question {
  text: string;
  level: 'subjektiv' | 'verhalten' | 'pruefungsnah';
  options: { label: string; score: number }[];
}

const QUESTIONS: Question[] = [
  // ── Ebene A: Subjektive Einschätzung ──
  {
    level: 'subjektiv',
    text: 'Wie sicher fühlst du dich aktuell bei typischen Aufgaben aus deiner Abschlussprüfung?',
    options: [
      { label: 'Sehr sicher – ich könnte die Aufgaben erklären', score: 3 },
      { label: 'Eher sicher – die Basics sitzen', score: 2 },
      { label: 'Eher unsicher – vieles fehlt noch', score: 1 },
      { label: 'Sehr unsicher – ich weiß kaum, was drankommt', score: 0 },
    ],
  },

  // ── Ebene B: Verhaltensbasiert ──
  {
    level: 'verhalten',
    text: 'Wie oft hast du in den letzten 14 Tagen mit prüfungsnahen Aufgaben trainiert?',
    options: [
      { label: 'An 8 oder mehr Tagen', score: 3 },
      { label: 'An 4 bis 7 Tagen', score: 2 },
      { label: 'An 1 bis 3 Tagen', score: 1 },
      { label: 'Gar nicht', score: 0 },
    ],
  },
  {
    level: 'verhalten',
    text: 'Hast du bereits unter Zeitdruck eine Prüfungssimulation gemacht?',
    options: [
      { label: 'Ja, mehrfach', score: 3 },
      { label: 'Ja, einmal', score: 2 },
      { label: 'Noch nicht, aber geplant', score: 1 },
      { label: 'Nein', score: 0 },
    ],
  },

  // ── Ebene C: Prüfungsnah ──
  {
    level: 'pruefungsnah',
    text: 'Ein Ausbildungsvertrag muss bestimmte Mindestinhalte haben. Welcher gehört NICHT dazu?',
    options: [
      { label: 'Beginn und Dauer der Ausbildung', score: 0 },
      { label: 'Höhe der Ausbildungsvergütung', score: 0 },
      { label: 'Name des zuständigen Berufsschullehrers', score: 3 },
      { label: 'Dauer der regelmäßigen täglichen Arbeitszeit', score: 0 },
    ],
  },
  {
    level: 'pruefungsnah',
    text: 'Was beschreibt das „kaufmännische Bestätigungsschreiben" korrekt?',
    options: [
      { label: 'Eine Auftragsbestätigung des Verkäufers nach Vertragsabschluss', score: 0 },
      { label: 'Ein Schreiben, das mündlich Vereinbartes schriftlich fixiert – Schweigen gilt als Zustimmung', score: 3 },
      { label: 'Die schriftliche Rechnung nach Lieferung', score: 0 },
      { label: 'Ein internes Memo zur Dokumentation von Besprechungen', score: 0 },
    ],
  },
];

type ResultLevel = 'green' | 'yellow' | 'red';

interface ResultData {
  level: ResultLevel;
  title: string;
  text: string;
  risks: string[];
  nextStep: string;
  icon: typeof CheckCircle;
}

function getResult(score: number): ResultData {
  const maxScore = QUESTIONS.length * 3;
  const pct = score / maxScore;

  if (pct >= 0.6) return {
    level: 'green',
    title: 'Gute Ausgangslage',
    text: 'Du wirkst bereits strukturiert vorbereitet. Mit weiterem gezieltem Training kannst du deine Sicherheit für die Prüfung noch deutlich erhöhen.',
    risks: [
      'Prüfungssimulation unter echtem Zeitdruck vertiefen',
      'Mündliches Fachgespräch aktiv trainieren',
    ],
    nextStep: 'Starte jetzt mit gezieltem Prüfungstraining für deine Ausbildung.',
    icon: CheckCircle,
  };
  if (pct >= 0.35) return {
    level: 'yellow',
    title: 'Basis vorhanden — aber noch Lücken',
    text: 'Einige Bereiche sind stabil, andere könnten dir in der Prüfung Probleme machen. Jetzt ist der richtige Zeitpunkt für gezieltes Training.',
    risks: [
      'Unsicherheit bei Zeitdruck',
      'Zu wenig prüfungsnahes Üben',
      'Lücken bei der Anwendung statt beim Wiedererkennen',
    ],
    nextStep: 'Starte jetzt mit gezieltem Prüfungstraining für deine Ausbildung.',
    icon: AlertTriangle,
  };
  return {
    level: 'red',
    title: 'Aktuell ist das Risiko noch hoch',
    text: 'Ohne systematische Vorbereitung kann es in der Prüfung eng werden. Die gute Nachricht: Du kannst jetzt gezielt an den entscheidenden Schwächen arbeiten.',
    risks: [
      'Prüfungsthemen und Rahmenplan noch nicht verinnerlicht',
      'Kaum Erfahrung mit prüfungsnahen Aufgabenformaten',
      'Mündliches Fachgespräch noch nicht vorbereitet',
    ],
    nextStep: 'Starte jetzt mit gezieltem Prüfungstraining für deine Ausbildung.',
    icon: XCircle,
  };
}

const LEVEL_LABELS: Record<Question['level'], string> = {
  subjektiv: 'Selbsteinschätzung',
  verhalten: 'Lernverhalten',
  pruefungsnah: 'Prüfungswissen',
};

export default function PruefungsreifeCheck() {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [showResult, setShowResult] = useState(false);

  const handleAnswer = (score: number) => {
    const next = [...answers, score];
    setAnswers(next);

    trackConversion({
      event: 'exam_start',
      source: 'pruefungscheck',
      label: `question_${current + 1}_answered`,
      value: score,
    });

    if (current + 1 >= QUESTIONS.length) {
      setShowResult(true);
      trackConversion({
        event: 'exam_start',
        source: 'pruefungscheck',
        label: 'completed',
        value: next.reduce((a, b) => a + b, 0),
      });
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
  const currentQuestion = QUESTIONS[current];

  const colorMap: Record<ResultLevel, string> = {
    green: 'text-success border-success/30 bg-success/5',
    yellow: 'text-warning border-warning/30 bg-warning/5',
    red: 'text-destructive border-destructive/30 bg-destructive/5',
  };

  return (
    <>
      <SEOHead
        title="Prüfungsreife-Check – Wie bereit bist du? | ExamFit"
        description="Finde in 2 Minuten heraus, wie gut du auf deine IHK-Abschlussprüfung vorbereitet bist. Kostenloser Selbsttest mit echten Prüfungsfragen."
        canonical={`${SITE_URL}/pruefungsreife-check`}
      />

      <div className="min-h-screen flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-xl">
          {!showResult ? (
            <div className="glass-card rounded-2xl p-6 sm:p-8">
              {/* Progress */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-muted-foreground font-medium">
                  Frage {current + 1} von {QUESTIONS.length}
                </span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                  {LEVEL_LABELS[currentQuestion.level]}
                </span>
              </div>

              <div className="flex gap-1 mb-6">
                {QUESTIONS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i < current ? 'bg-primary' : i === current ? 'bg-accent' : 'bg-muted'
                    }`}
                  />
                ))}
              </div>

              <h2 className="text-lg sm:text-xl font-semibold mb-6">
                {currentQuestion.text}
              </h2>

              <div className="flex flex-col gap-3">
                {currentQuestion.options.map((opt, i) => (
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
              {/* Header */}
              <div className="text-center mb-6">
                <ResultIcon className={`h-12 w-12 mx-auto mb-3 ${colorMap[result.level].split(' ')[0]}`} />
                <h2 className="text-2xl font-display font-bold mb-2">{result.title}</h2>
                <p className="text-muted-foreground">{result.text}</p>
              </div>

              {/* Index */}
              <div className="mb-6 p-4 rounded-xl bg-muted/50">
                <div className="text-center">
                  <span className="text-3xl font-bold text-gradient">
                    {Math.round((totalScore / (QUESTIONS.length * 3)) * 100)} %
                  </span>
                  <p className="text-xs text-muted-foreground mt-1">Prüfungsreife-Index</p>
                </div>
              </div>

              {/* Risk areas */}
              <div className="mb-4 p-4 rounded-xl border border-border">
                <h3 className="text-sm font-semibold mb-3">Deine größten Risiken:</h3>
                <ul className="space-y-2">
                  {result.risks.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-warning mt-0.5">→</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Next step */}
              <div className="mb-6 p-4 rounded-xl bg-primary/5 border border-primary/20">
                <h3 className="text-sm font-semibold mb-1">Nächster sinnvoller Schritt:</h3>
                <p className="text-sm text-muted-foreground">{result.nextStep}</p>
              </div>

              {/* CTAs */}
              <div className="flex flex-col gap-3">
                <Link to="/shop">
                  <Button
                    size="lg"
                    className="w-full gradient-primary text-primary-foreground rounded-xl h-14 text-lg group"
                    onClick={() => trackConversion({ event: 'cta_click', source: 'pruefungscheck_result', label: 'shop_click' })}
                  >
                    Jetzt gezielt trainieren
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
