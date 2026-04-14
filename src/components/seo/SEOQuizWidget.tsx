import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, XCircle, RotateCcw, Brain, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  title: string;
  subtitle?: string;
  /** certification slug from certification_catalog to pull real questions */
  certificationSlug?: string;
  /** fallback static questions if no DB data */
  fallbackQuestions?: QuizQuestion[];
  ctaText?: string;
  /** Explicit product link. If omitted, auto-resolved from certificationSlug via DB */
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

// Static AEVO fallback questions for SEO pages
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

      // Try seo_internal_link_suggestions first (cluster_to_product)
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

      // Fallback: derive from certification_catalog slug
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

      // Try to pull real exam questions from the system
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

  // Resolve CTA: explicit prop > SSOT auto-link > fallback /shop
  const resolvedCtaLink = ctaLink || autoProductLink || '/shop';
  const resolvedCtaText = ctaText || (autoProductLink ? 'Jetzt Kurs starten' : 'Vollständiges Training starten');

  const questions = dbQuestions ?? fallbackQuestions ?? (certificationSlug === 'aevo' ? AEVO_FALLBACK : []);
  const activeQuestions = questions.slice(0, maxQuestions);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [finished, setFinished] = useState(false);

  const handleAnswer = useCallback((idx: number) => {
    if (answered) return;
    setSelectedAnswer(idx);
    setAnswered(true);
    if (idx === activeQuestions[currentIndex]?.correctIndex) {
      setScore(s => s + 1);
    }
  }, [answered, currentIndex, activeQuestions]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= activeQuestions.length) {
      setFinished(true);
    } else {
      setCurrentIndex(i => i + 1);
      setSelectedAnswer(null);
      setAnswered(false);
    }
  }, [currentIndex, activeQuestions.length]);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setAnswered(false);
    setFinished(false);
  }, []);

  if (activeQuestions.length === 0) return null;

  const current = activeQuestions[currentIndex];
  const percentage = Math.round((score / activeQuestions.length) * 100);

  return (
    <Card className={`border-primary/20 ${className}`}>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-2"><Brain className="h-8 w-8 text-primary" /></div>
        <CardTitle className="text-xl">{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent>
        {finished ? (
          <div className="text-center space-y-6">
            <div className="text-5xl font-bold text-primary">{percentage}%</div>
            <p className="text-lg">
              {score} von {activeQuestions.length} Fragen richtig
            </p>
            <p className="text-muted-foreground">
              {percentage >= 80 ? 'Hervorragend! Du bist gut vorbereitet.' :
               percentage >= 50 ? 'Solide Grundlage – mit Training wirst du sicher bestehen.' :
               'Hier gibt es noch Potenzial. Gezieltes Training hilft!'}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild className="gradient-primary text-primary-foreground shadow-glow">
                <Link to={ctaLink}>{ctaText} <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw className="mr-2 h-4 w-4" /> Nochmal versuchen
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Progress */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Frage {currentIndex + 1} / {activeQuestions.length}</span>
              <span>{score} richtig</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${((currentIndex + (answered ? 1 : 0)) / activeQuestions.length) * 100}%` }}
              />
            </div>

            {/* Question */}
            <p className="font-medium text-lg">{current.question}</p>

            {/* Options */}
            <div className="space-y-2">
              {current.options.map((opt, idx) => {
                const isCorrect = idx === current.correctIndex;
                const isSelected = idx === selectedAnswer;
                let optionClass = 'border-border hover:border-primary/50 cursor-pointer';
                if (answered) {
                  if (isCorrect) optionClass = 'border-green-500 bg-green-500/10';
                  else if (isSelected) optionClass = 'border-destructive bg-destructive/10';
                  else optionClass = 'border-border opacity-50';
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(idx)}
                    disabled={answered}
                    className={`w-full text-left p-4 rounded-lg border transition-colors flex items-center gap-3 ${optionClass}`}
                  >
                    {answered && isCorrect && <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />}
                    {answered && isSelected && !isCorrect && <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />}
                    {!answered && <span className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />}
                    <span className="text-sm">{opt}</span>
                  </button>
                );
              })}
            </div>

            {/* Explanation */}
            {answered && current.explanation && (
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <p className="text-sm text-muted-foreground">{current.explanation}</p>
              </div>
            )}

            {/* Next */}
            {answered && (
              <div className="flex justify-end">
                <Button onClick={handleNext}>
                  {currentIndex + 1 >= activeQuestions.length ? 'Ergebnis anzeigen' : 'Nächste Frage'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
