import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Trophy, XCircle, BarChart3, BookOpen, FileText, Star, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExamResult } from '@/hooks/useExamSimulation';
import { LessonRecommendations } from './LessonRecommendations';
import { BadgeShareSection } from './BadgeShareSection';
import { useTerminology } from '@/hooks/useProgramType';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface ResultsScreenProps {
  result: ExamResult;
  sessionId?: string;
  onRestart: () => void;
  curriculumId?: string;
}

function ResultScoreRing({ percentage, passed, size = 140 }: { percentage: number; passed: boolean; size?: number }) {
  const sw = 10;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const [offset, setOffset] = useState(circ);
  const color = passed ? 'hsl(var(--primary))' : 'hsl(var(--destructive))';

  useEffect(() => {
    const t = setTimeout(() => setOffset(circ - (percentage / 100) * circ), 400);
    return () => clearTimeout(t);
  }, [percentage, circ]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={sw} opacity={0.2} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 180 }}
          className="text-4xl font-display font-bold"
        >{percentage.toFixed(1)}%</motion.span>
      </div>
    </div>
  );
}

function ConfettiBurst() {
  const particles = Array.from({ length: 20 }, (_, i) => i);
  const colors = ['hsl(var(--primary))', '#FFD700', '#34D399', '#F472B6', '#60A5FA'];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map(i => {
        const angle = (i / particles.length) * 360;
        const dist = 50 + Math.random() * 70;
        const x = Math.cos((angle * Math.PI) / 180) * dist;
        const y = Math.sin((angle * Math.PI) / 180) * dist;
        return (
          <motion.div key={i} className="absolute left-1/2 top-1/3 rounded-full"
            style={{ width: 5 + Math.random() * 4, height: 5 + Math.random() * 4, backgroundColor: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x, y, opacity: 0, scale: 0.2 }}
            transition={{ duration: 0.9 + Math.random() * 0.3, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

export function ResultsScreen({ result, sessionId, onRestart, curriculumId }: ResultsScreenProps) {
  const { t } = useTerminology(curriculumId);

  const getTier = () => {
    const p = result.score_percentage;
    if (p >= 90) return { label: 'Herausragend', icon: Star, message: 'Du beherrschst den Stoff souverän!', color: 'text-yellow-500' };
    if (p >= 75) return { label: 'Sehr gut', icon: Trophy, message: 'Starke Leistung – bereit für die echte Prüfung.', color: 'text-primary' };
    if (p >= 50) return { label: 'Bestanden', icon: TrendingUp, message: 'Solides Ergebnis – gezieltes Training macht dich sicherer.', color: 'text-primary' };
    return { label: 'Noch nicht bestanden', icon: XCircle, message: 'Kein Problem – trainiere gezielt deine Schwächen.', color: 'text-destructive' };
  };

  const tier = getTier();
  const TierIcon = tier.icon;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Main Result Card */}
      <Card className={cn("glass-card text-center overflow-hidden relative", result.passed ? "border-primary/30" : "border-destructive/30")} data-testid="exam-result-card">
        {result.passed && <ConfettiBurst />}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
        <CardContent className="relative pt-8 pb-6 space-y-4">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="flex justify-center"
          >
            <ResultScoreRing percentage={result.score_percentage} passed={result.passed} />
          </motion.div>
          
          <motion.div
            initial={{ y: 15, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="space-y-2"
          >
            <div className="flex items-center justify-center gap-2">
              <TierIcon className={cn("h-5 w-5", tier.color)} />
              <Badge variant="secondary" className="text-sm font-semibold">{tier.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{tier.message}</p>
            <p className="text-sm text-muted-foreground" data-testid="exam-result-score">
              {result.correct_answers} von {result.total_questions} richtig
              <span className="mx-2">·</span>
              Mindestens {result.pass_threshold}% benötigt
            </p>
          </motion.div>
        </CardContent>
      </Card>
      
      {/* Badge & Share */}
      <motion.div initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.7 }}>
        <BadgeShareSection scorePercent={result.score_percentage} passed={result.passed} sessionId={sessionId} />
      </motion.div>

      {/* Lesson Recommendations */}
      {sessionId && !result.passed && (
        <motion.div initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8 }}>
          <LessonRecommendations sessionId={sessionId} />
        </motion.div>
      )}
      
      {/* Breakdown by Difficulty */}
      <motion.div initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.9 }}>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Auswertung nach Schwierigkeit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(result.breakdown.by_difficulty).map(([difficulty, stats], idx) => {
                const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                const labels: Record<string, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
                return (
                  <motion.div
                    key={difficulty}
                    initial={{ x: -15, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 1.0 + idx * 0.1 }}
                  >
                    <div className="flex justify-between text-sm mb-1">
                      <span>{labels[difficulty] || difficulty}</span>
                      <span className="font-medium">{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      
      {/* Breakdown by Learning Field */}
      {Object.keys(result.breakdown.by_learning_field).length > 1 && (
        <motion.div initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.1 }}>
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Auswertung nach Lernfeld
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(result.breakdown.by_learning_field)
                  .filter(([code]) => code !== 'unknown')
                  .map(([code, stats], idx) => {
                    const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                    return (
                      <motion.div
                        key={code}
                        initial={{ x: -15, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 1.2 + idx * 0.08 }}
                      >
                        <div className="flex justify-between text-sm mb-1">
                          <span>Lernfeld {code}</span>
                          <span className="font-medium">{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </motion.div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
      
      {/* Actions */}
      <motion.div
        initial={{ y: 15, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.3 }}
        className="flex gap-3"
      >
        <Button variant="outline" className="flex-1 h-11" onClick={onRestart}>
          {t('newExam')}
        </Button>
        {sessionId && (
          <Button variant="outline" className="flex-1 h-11 gap-2" asChild>
            <Link to={`/exam-results/${sessionId}`}>
              <FileText className="h-4 w-4" />
              Analyse
            </Link>
          </Button>
        )}
        <Button className="flex-1 h-11 gradient-primary text-primary-foreground shadow-glow-sm" onClick={() => window.location.href = '/dashboard'}>
          Dashboard
        </Button>
      </motion.div>
    </div>
  );
}
