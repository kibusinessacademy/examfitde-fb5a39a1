import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { Eye, ArrowRight, Gauge, BarChart3, ListChecks, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface ExamPreviewProps {
  curriculumId: string;
}

export function ExamPreview({ curriculumId }: ExamPreviewProps) {
  const { data: readiness } = useReadinessScore(curriculumId);

  const score = readiness?.overall_readiness || 0;
  const predicted = readiness?.predicted_exam_score || 0;
  const weakCount = readiness?.weak_areas?.length || 0;
  const strongCount = readiness?.strong_areas?.length || 0;

  const easyPct = score >= 70 ? 35 : score >= 40 ? 25 : 20;
  const hardPct = score >= 70 ? 15 : score >= 40 ? 25 : 35;
  const mediumPct = 100 - easyPct - hardPct;

  const wouldPass = predicted >= 50;

  return (
    <Card className="glass-card overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/3 via-transparent to-accent/3 pointer-events-none" />
      <CardHeader className="relative pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Wenn du morgen Prüfung hättest…
          </CardTitle>
          <Badge variant={wouldPass ? 'default' : 'destructive'} className="text-[10px]">
            {wouldPass ? 'Bestanden' : 'Nicht bestanden'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="relative p-4 pt-0">
        <p className="text-sm text-muted-foreground mb-4">
          So sähe deine Prüfung aus – basierend auf deinem aktuellen Stand:
        </p>

        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3 mb-4"
        >
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <Gauge className="h-4 w-4 mx-auto mb-1 text-primary" />
            <div className="text-xl font-bold">{Math.round(predicted)}%</div>
            <div className="text-[10px] text-muted-foreground">Progn. Ergebnis</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <BarChart3 className="h-4 w-4 mx-auto mb-1 text-green-500" />
            <div className="text-xl font-bold text-green-500">{strongCount}</div>
            <div className="text-[10px] text-muted-foreground">Starke Bereiche</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-muted/50 border border-border/50">
            <ListChecks className="h-4 w-4 mx-auto mb-1 text-orange-500" />
            <div className="text-xl font-bold text-orange-500">{weakCount}</div>
            <div className="text-[10px] text-muted-foreground">Risiko-Bereiche</div>
          </div>
        </motion.div>

        {/* Difficulty distribution */}
        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mb-4"
        >
          <p className="text-xs text-muted-foreground mb-2">Erwartete Schwierigkeitsverteilung:</p>
          <div className="flex rounded-full overflow-hidden h-3">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${easyPct}%` }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="bg-green-500"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${mediumPct}%` }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="bg-yellow-500"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${hardPct}%` }}
              transition={{ delay: 0.6, duration: 0.6 }}
              className="bg-destructive"
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Leicht {easyPct}%</span>
            <span>Mittel {mediumPct}%</span>
            <span>Schwer {hardPct}%</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Link to="/exam-simulation">
            <Button className="w-full gradient-primary text-primary-foreground shadow-glow-sm h-10 gap-2">
              <Sparkles className="h-4 w-4" />
              Prüfung jetzt simulieren
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </motion.div>
      </CardContent>
    </Card>
  );
}
