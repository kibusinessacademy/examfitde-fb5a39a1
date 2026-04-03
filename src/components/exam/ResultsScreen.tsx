import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Trophy, XCircle, BarChart3, BookOpen, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExamResult } from '@/hooks/useExamSimulation';
import { LessonRecommendations } from './LessonRecommendations';
import { BadgeShareSection } from './BadgeShareSection';
import { useTerminology } from '@/hooks/useProgramType';

interface ResultsScreenProps {
  result: ExamResult;
  sessionId?: string;
  onRestart: () => void;
  curriculumId?: string;
}

export function ResultsScreen({ result, sessionId, onRestart, curriculumId }: ResultsScreenProps) {
  const { t } = useTerminology(curriculumId);
  const passedClass = result.passed 
    ? "border-primary/50" 
    : "border-destructive/50";
  const passedBgClass = result.passed 
    ? "bg-primary/20" 
    : "bg-destructive/20";
  const passedIconClass = result.passed 
    ? "text-primary" 
    : "text-destructive";

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Main Result Card */}
      <Card className={cn("glass-card text-center", passedClass)} data-testid="exam-result-card">
        <CardContent className="pt-8 pb-6">
          <div className={cn(
            "w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-4",
            passedBgClass
          )}>
            {result.passed ? (
              <Trophy className={cn("h-10 w-10", passedIconClass)} />
            ) : (
              <XCircle className={cn("h-10 w-10", passedIconClass)} />
            )}
          </div>
          
          <h2 className="text-2xl font-display font-bold mb-2">
            {result.passed ? 'Bestanden!' : 'Nicht bestanden'}
          </h2>
          
          <div className="text-4xl font-bold mb-2" data-testid="exam-result-score">
            {result.score_percentage.toFixed(1)}%
          </div>
          
          <p className="text-muted-foreground">
            {result.correct_answers} von {result.total_questions} richtig
            <span className="mx-2">•</span>
            Mindestens {result.pass_threshold}% benötigt
          </p>
        </CardContent>
      </Card>
      
      {/* Badge & Share – Growth Loop */}
      <BadgeShareSection scorePercent={result.score_percentage} passed={result.passed} sessionId={sessionId} />

      {/* Lesson Recommendations - P0.3 */}
      {sessionId && !result.passed && (
        <LessonRecommendations sessionId={sessionId} />
      )}
      
      {/* Breakdown by Difficulty */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Auswertung nach Schwierigkeit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(result.breakdown.by_difficulty).map(([difficulty, stats]) => {
              const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
              const difficultyLabels: Record<string, string> = {
                easy: 'Leicht',
                medium: 'Mittel',
                hard: 'Schwer',
              };
              
              return (
                <div key={difficulty}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{difficultyLabels[difficulty] || difficulty}</span>
                    <span>{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      
      {/* Breakdown by Learning Field */}
      {Object.keys(result.breakdown.by_learning_field).length > 1 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Auswertung nach Lernfeld
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(result.breakdown.by_learning_field)
                .filter(([code]) => code !== 'unknown')
                .map(([code, stats]) => {
                  const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  
                  return (
                    <div key={code}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Lernfeld {code}</span>
                        <span>{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Actions */}
      <div className="flex gap-4">
        <Button variant="outline" className="flex-1" onClick={onRestart}>
          {t('newExam')}
        </Button>
        {sessionId && (
          <Button variant="outline" className="flex-1 gap-2" asChild>
            <Link to={`/exam-results/${sessionId}`}>
              <FileText className="h-4 w-4" />
              Detaillierte Analyse
            </Link>
          </Button>
        )}
        <Button className="flex-1" onClick={() => window.location.href = '/dashboard'}>
          Zum Dashboard
        </Button>
      </div>
    </div>
  );
}
