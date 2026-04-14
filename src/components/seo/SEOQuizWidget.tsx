import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, XCircle, RotateCcw, Brain, ShoppingCart, Trophy, Clock, Zap, TrendingUp, Star, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  title: string;
  subtitle?: string;
  certificationSlug?: string;
  fallbackQuestions?: QuizQuestion[];
  ctaText?: string;
  ctaLink?: string;
  maxQuestions?: number;
  className?: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

// Static AEVO fallback questions
const AEVO_FALLBACK: QuizQuestion[] = [
  {
    id: 'aevo-1',
    question: 'Wie viele Multiple-Choice-Fragen umfasst die schriftliche AEVO-Prüfung?',
    options: ['40 Fragen', '60 Fragen', '80 Fragen', '100 Fragen'],
    correctIndex: 2,
    explanation: 'Die schriftliche AEVO-Prüfung besteht aus 80 Multiple-Choice-Fragen in 180 Minuten.',
  },
  {
    id: 'aevo-2',
    question: 'Welche Methode wird in der AEVO-Prüfung am häufigsten für die praktische Unterweisung verwendet?',
    options: ['Projektmethode', '4-Stufen-Methode', 'Frontalunterricht', 'Brainstorming'],
    correctIndex: 1,
    explanation: 'Die 4-Stufen-Methode (Vorbereiten, Vormachen, Nachmachen, Üben) ist die klassische Unterweisungsmethode.',
  },
  {
    id: 'aevo-3',
    question: 'Wie viele Handlungsfelder umfasst die AEVO?',
    options: ['2 Handlungsfelder', '3 Handlungsfelder', '4 Handlungsfelder', '5 Handlungsfelder'],
    correctIndex: 2,
    explanation: 'Die AEVO umfasst 4 Handlungsfelder: Ausbildung planen, vorbereiten, durchführen und abschließen.',
  },
  {
    id: 'aevo-4',
    question: 'Was ist die Mindestbestehensquote bei der schriftlichen AEVO-Prüfung?',
    options: ['30%', '40%', '50%', '60%'],
    correctIndex: 2,
    explanation: 'Bei der AEVO-Klausur müssen mindestens 50% der Punkte erreicht werden.',
  },
  {
    id: 'aevo-5',
    question: 'Wie lange dauert die praktische AEVO-Prüfung insgesamt (Präsentation + Fachgespräch)?',
    options: ['15 Minuten', '20 Minuten', '30 Minuten', '45 Minuten'],
    correctIndex: 2,
    explanation: 'Die praktische Prüfung besteht aus 15 Min. Präsentation + 15 Min. Fachgespräch = 30 Min. insgesamt.',
  },
];

/** Auto-resolve product link from certification slug via SSOT */
function useProductLinkForCert(certificationSlug?: string) {
  return useQuery({
    queryKey: ['seo-quiz-product-link', certificationSlug],
    queryFn: async () => {
      if (!certificationSlug) return null;
      const { data: linkSuggestion } = await supabase
        .from('seo_internal_link_suggestions')
        .select('target_url')
        .ilike('source_url', `%${certificationSlug}%`)
        .eq('link_type', 'cluster_to_product')
        .eq('status', 'active')
        .order('priority', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (linkSuggestion?.target_url) return linkSuggestion.target_url;
      return `/pruefungstraining/${certificationSlug}`;
    },
    enabled: !!certificationSlug,
    staleTime: 1000 * 60 * 60,
  });
}

function useSEOQuizQuestions(certificationSlug?: string, maxQuestions = 5) {
  return useQuery({
    queryKey: ['seo-quiz', certificationSlug, maxQuestions],
    queryFn: async () => {
      if (!certificationSlug) return null;
      const { data: cert } = await supabase
        .from('certification_catalog')
        .select('linked_certification_id')
        .eq('slug', certificationSlug)
        .single();
      if (!cert?.linked_certification_id) return null;
      const { data: questions } = await supabase
        .from('exam_questions')
        .select('id, question_text, options, correct_answer_index, explanation')
        .eq('certification_id', cert.linked_certification_id)
        .eq('status', 'approved')
        .limit(maxQuestions);
      if (!questions || questions.length < 3) return null;
      return questions.map((q: any) => ({
        id: q.id,
        question: q.question_text,
        options: (q.options as string[]) || [],
        correctIndex: q.correct_answer_index ?? 0,
        explanation: q.explanation,
      })) as QuizQuestion[];
    },
    enabled: !!certificationSlug,
    staleTime: 1000 * 60 * 30,
  });
}

/* ---------- Score Ring Component ---------- */
function ScoreRing({ percentage, size = 120 }: { percentage: number; size?: number }) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(circumference - (percentage / 100) * circumference);
    }, 300);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  const color = percentage >= 80 ? 'hsl(var(--primary))' : percentage >= 50 ? 'hsl(45, 93%, 47%)' : 'hsl(var(--destructive))';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{percentage}%</span>
      </div>
    </div>
  );
}

/* ---------- Confetti Burst ---------- */
function ConfettiBurst() {
  const particles = Array.from({ length: 24 }, (_, i) => i);
  const colors = ['hsl(var(--primary))', '#FFD700', '#34D399', '#F472B6', '#60A5FA'];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map(i => {
        const angle = (i / particles.length) * 360;
        const distance = 60 + Math.random() * 80;
        const x = Math.cos((angle * Math.PI) / 180) * distance;
        const y = Math.sin((angle * Math.PI) / 180) * distance;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: 6 + Math.random() * 4,
              height: 6 + Math.random() * 4,
              backgroundColor: colors[i % colors.length],
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x, y, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.8 + Math.random() * 0.4, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

/* ---------- Result Tiers ---------- */
function getResultTier(percentage: number) {
  if (percentage >= 90) return {
    icon: Trophy, label: 'Prüfungs-Profi', color: 'text-yellow-500',
    message: 'Hervorragend! Du beherrschst den Stoff souverän.',
    ctaMessage: 'Du bist auf einem sehr guten Weg – sichere dir jetzt deinen Vorsprung!',
    urgency: true,
  };
  if (percentage >= 70) return {
    icon: TrendingUp, label: 'Auf gutem Weg', color: 'text-primary',
    message: 'Solide Leistung! Mit gezieltem Training bestehst du sicher.',
    ctaMessage: 'Trainiere deine Lücken und geh mit Sicherheit in die Prüfung.',
    urgency: false,
  };
  if (percentage >= 50) return {
    icon: Zap, label: 'Grundlagen vorhanden', color: 'text-amber-500',
    message: 'Gute Basis, aber es gibt noch Lücken. Das Training schließt sie.',
    ctaMessage: 'Starte jetzt dein Training – wir zeigen dir, wo du nacharbeiten musst.',
    urgency: false,
  };
  return {
    icon: Brain, label: 'Trainingsstart empfohlen', color: 'text-destructive',
    message: 'Kein Problem – genau dafür ist das Training da.',
    ctaMessage: 'Starte jetzt und werde Schritt für Schritt prüfungssicher.',
    urgency: false,
  };
}

/* ---------- Main Widget ---------- */
export function SEOQuizWidget({
  title,
  subtitle,
  certificationSlug,
  fallbackQuestions,
  ctaText,
  ctaLink,
  maxQuestions = 5,
  className = '',
}: Props) {
  const { data: dbQuestions } = useSEOQuizQuestions(certificationSlug, maxQuestions);
  const { data: autoProductLink } = useProductLinkForCert(certificationSlug);

  const resolvedCtaLink = ctaLink || autoProductLink || '/shop';
  const resolvedCtaText = ctaText || (autoProductLink ? 'Jetzt Kurs sichern' : 'Vollständiges Training starten');

  const questions = dbQuestions ?? fallbackQuestions ?? (certificationSlug === 'aevo' ? AEVO_FALLBACK : []);
  const activeQuestions = questions.slice(0, maxQuestions);

  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [finished, setFinished] = useState(false);
  const [streak, setStreak] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const timerRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer
  useEffect(() => {
    if (started && !finished) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [started, finished]);

  const handleAnswer = useCallback((idx: number) => {
    if (answered) return;
    setSelectedAnswer(idx);
    setAnswered(true);
    const isCorrect = idx === activeQuestions[currentIndex]?.correctIndex;
    if (isCorrect) {
      setScore(s => s + 1);
      setStreak(s => s + 1);
    } else {
      setStreak(0);
    }
  }, [answered, currentIndex, activeQuestions]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= activeQuestions.length) {
      setFinished(true);
      if (intervalRef.current) clearInterval(intervalRef.current);
      const pct = Math.round(((score + (selectedAnswer === activeQuestions[currentIndex]?.correctIndex ? 0 : 0)) / activeQuestions.length) * 100);
      if (pct >= 70) setShowConfetti(true);
    } else {
      setCurrentIndex(i => i + 1);
      setSelectedAnswer(null);
      setAnswered(false);
    }
  }, [currentIndex, activeQuestions, score, selectedAnswer]);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setAnswered(false);
    setFinished(false);
    setStarted(false);
    setStreak(0);
    setElapsed(0);
    setShowConfetti(false);
  }, []);

  if (activeQuestions.length === 0) return null;

  const current = activeQuestions[currentIndex];
  const percentage = Math.round((score / activeQuestions.length) * 100);
  const tier = getResultTier(percentage);
  const TierIcon = tier.icon;
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  /* ---- Landing State ---- */
  if (!started) {
    return (
      <Card className={`border-primary/20 overflow-hidden ${className}`}>
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          <CardContent className="relative pt-8 pb-8 text-center space-y-5">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center"
            >
              <Brain className="h-8 w-8 text-primary" />
            </motion.div>
            <div>
              <h3 className="text-xl font-bold mb-1">{title}</h3>
              {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
            </div>
            <div className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> ca. 2 Min.</span>
              <span className="flex items-center gap-1"><Zap className="h-3.5 w-3.5" /> {activeQuestions.length} Fragen</span>
              <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5" /> Sofort-Auswertung</span>
            </div>
            <Button
              size="lg"
              className="gradient-primary text-primary-foreground shadow-glow h-12 px-8 text-base"
              onClick={() => setStarted(true)}
            >
              Quiz starten <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Users className="h-3 w-3" /> Bereits von über 3.000 Lernenden genutzt
            </p>
          </CardContent>
        </div>
      </Card>
    );
  }

  /* ---- Result State ---- */
  if (finished) {
    return (
      <Card className={`border-primary/20 overflow-hidden ${className}`}>
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
          {showConfetti && <ConfettiBurst />}
          <CardContent className="relative pt-8 pb-8 space-y-6">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="flex flex-col items-center gap-4"
            >
              <ScoreRing percentage={percentage} />
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <TierIcon className={`h-5 w-5 ${tier.color}`} />
                  <Badge variant="secondary" className="text-xs font-semibold">{tier.label}</Badge>
                </div>
                <p className="text-sm font-medium">
                  {score} von {activeQuestions.length} richtig · {formatTime(elapsed)}
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-center space-y-1"
            >
              <p className="text-sm text-muted-foreground">{tier.message}</p>
              <p className="text-sm font-medium text-foreground">{tier.ctaMessage}</p>
            </motion.div>

            <motion.div
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="space-y-3"
            >
              <Button asChild size="lg" className="w-full gradient-primary text-primary-foreground shadow-glow h-13 text-base">
                <Link to={resolvedCtaLink}>
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  {resolvedCtaText}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              {tier.urgency && (
                <p className="text-xs text-center text-primary font-medium animate-pulse">
                  🔥 Du bist auf einem guten Weg – jetzt den letzten Schritt gehen
                </p>
              )}
              <Button variant="ghost" size="sm" onClick={handleReset} className="w-full text-muted-foreground">
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Nochmal versuchen
              </Button>
            </motion.div>
          </CardContent>
        </div>
      </Card>
    );
  }

  /* ---- Quiz State ---- */
  return (
    <Card className={`border-primary/20 overflow-hidden ${className}`}>
      <CardContent className="pt-6 pb-6 space-y-5">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-mono">
              {currentIndex + 1}/{activeQuestions.length}
            </Badge>
            {streak >= 2 && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-1">
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">
                  🔥 {streak}er Serie
                </Badge>
              </motion.div>
            )}
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatTime(elapsed)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={false}
            animate={{ width: `${((currentIndex + (answered ? 1 : 0)) / activeQuestions.length) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>

        {/* Question */}
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p className="font-semibold text-base leading-relaxed">{current.question}</p>
          </motion.div>
        </AnimatePresence>

        {/* Options */}
        <div className="space-y-2">
          {current.options.map((opt, idx) => {
            const isCorrect = idx === current.correctIndex;
            const isSelected = idx === selectedAnswer;

            let classes = 'border-border hover:border-primary/40 hover:bg-primary/5 cursor-pointer';
            if (answered) {
              if (isCorrect) classes = 'border-green-500 bg-green-500/10 ring-1 ring-green-500/20';
              else if (isSelected) classes = 'border-destructive bg-destructive/10 ring-1 ring-destructive/20';
              else classes = 'border-border opacity-40';
            }

            return (
              <motion.button
                key={idx}
                onClick={() => handleAnswer(idx)}
                disabled={answered}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
                className={`w-full text-left p-3.5 rounded-xl border-2 transition-all flex items-center gap-3 ${classes}`}
              >
                {!answered && (
                  <span className="w-7 h-7 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center text-xs font-semibold text-muted-foreground flex-shrink-0">
                    {String.fromCharCode(65 + idx)}
                  </span>
                )}
                {answered && isCorrect && <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />}
                {answered && isSelected && !isCorrect && <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />}
                {answered && !isSelected && !isCorrect && <span className="w-5 h-5 flex-shrink-0" />}
                <span className="text-sm">{opt}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Explanation */}
        <AnimatePresence>
          {answered && current.explanation && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="p-4 rounded-xl bg-muted/60 border border-border">
                <div className="flex items-start gap-2">
                  <Brain className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground leading-relaxed">{current.explanation}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Next */}
        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-end"
          >
            <Button onClick={handleNext} className="h-10 px-6">
              {currentIndex + 1 >= activeQuestions.length ? 'Ergebnis anzeigen' : 'Weiter'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
