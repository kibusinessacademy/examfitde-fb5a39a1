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
    text: 'Wie sicher fühlst du dich, wenn du an typische Prüfungsaufgaben denkst?',
    options: [
      { label: 'Sehr sicher – ich könnte die Aufgaben erklären', score: 3 },
      { label: 'Ganz okay – die Basics sitzen', score: 2 },
      { label: 'Unsicher – vieles fehlt noch', score: 1 },
      { label: 'Gar nicht – ich weiß kaum, was drankommt', score: 0 },
    ],
  },
  {
    level: 'subjektiv',
    text: 'Kennst du deine persönlichen Schwächen in den Prüfungsthemen?',
    options: [
      { label: 'Ja, genau – ich arbeite gezielt daran', score: 3 },
      { label: 'Ungefähr – so ein Gefühl halt', score: 2 },
      { label: 'Nicht wirklich', score: 1 },
      { label: 'Ich weiß nicht mal, welche Themen drankommen', score: 0 },
    ],
  },

  // ── Ebene B: Verhaltensbasiert ──
  {
    level: 'verhalten',
    text: 'Wie oft hast du in den letzten 14 Tagen mit echten Prüfungsaufgaben geübt?',
    options: [
      { label: 'Mehrmals pro Woche, unter Zeitdruck', score: 3 },
      { label: '1–2 Mal, ohne Timer', score: 2 },
      { label: 'Nur einzelne Aufgaben nebenbei', score: 1 },
      { label: 'Noch gar nicht', score: 0 },
    ],
  },
  {
    level: 'verhalten',
    text: 'Wie bereitest du dich auf die mündliche Prüfung (Fachgespräch) vor?',
    options: [
      { label: 'Ich übe regelmäßig laut mit jemandem', score: 3 },
      { label: 'Ich lese mögliche Fragen durch', score: 2 },
      { label: 'Noch gar nicht – keine Ahnung, wie', score: 1 },
      { label: 'Mündliche Prüfung? Muss ich das auch?', score: 0 },
    ],
  },
  {
    level: 'verhalten',
    text: 'Wie viel Zeit bleibt dir noch bis zur Prüfung?',
    options: [
      { label: 'Mehr als 3 Monate', score: 3 },
      { label: '1–3 Monate', score: 2 },
      { label: 'Weniger als 4 Wochen', score: 1 },
      { label: 'Die Prüfung ist nächste Woche 😱', score: 0 },
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

function getResult(score: number): { level: ResultLevel; title: string; text: string; weaknesses: string[]; icon: typeof CheckCircle } {
  const maxScore = QUESTIONS.length * 3;
  const pct = score / maxScore;

  if (pct >= 0.65) return {
    level: 'green',
    title: 'Gute Ausgangslage!',
    text: 'Du hast eine solide Basis. Gezieltes Training kann dir helfen, verbleibende Unsicherheiten systematisch abzubauen.',
    weaknesses: [
      'Prüfungssimulation unter Zeitdruck trainieren',
      'Mündliches Fachgespräch regelmäßig üben',
    ],
    icon: CheckCircle,
  };
  if (pct >= 0.35) return {
    level: 'yellow',
    title: 'Noch Luft nach oben.',
    text: 'Du hast eine Basis, aber einige Lücken könnten in der Prüfung zum Problem werden. Gezieltes Training jetzt zahlt sich direkt aus.',
    weaknesses: [
      'Wissenslücken in Kernthemen identifizieren',
      'Prüfungsnahe Aufgaben regelmäßig üben',
      'Mündliche Prüfung aktiv vorbereiten',
    ],
    icon: AlertTriangle,
  };
  return {
    level: 'red',
    title: 'Achtung – hoher Handlungsbedarf!',
    text: 'Ohne strukturierte Vorbereitung wird es eng. Aber: Mit gezieltem Training kannst du dich in wenigen Wochen deutlich verbessern.',
    weaknesses: [
      'Prüfungsthemen und Rahmenplan durcharbeiten',
      'Schwächen systematisch identifizieren und trainieren',
      'Prüfungssimulationen unter realen Bedingungen üben',
      'Mündliches Fachgespräch von Grund auf vorbereiten',
    ],
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

              {/* Weakness areas */}
              <div className="mb-6 p-4 rounded-xl border border-border">
                <h3 className="text-sm font-semibold mb-3">Deine möglichen Schwächenfelder:</h3>
                <ul className="space-y-2">
                  {result.weaknesses.map((w) => (
                    <li key={w} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-warning mt-0.5">→</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-3">
                <Link to="/shop">
                  <Button
                    size="lg"
                    className="w-full gradient-primary text-primary-foreground rounded-xl h-14 text-lg group"
                    onClick={() => trackConversion({ event: 'cta_click', source: 'pruefungscheck_result', label: 'shop_click' })}
                  >
                    Gezielt trainieren – 39 €
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
