import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { Eye, ArrowRight, Gauge, BarChart3, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExamPreviewProps {
  curriculumId: string;
}

export function ExamPreview({ curriculumId }: ExamPreviewProps) {
  const { data: readiness } = useReadinessScore(curriculumId);

  const score = readiness?.overall_readiness || 0;
  const predicted = readiness?.predicted_exam_score || 0;
  const weakCount = readiness?.weak_areas?.length || 0;
  const strongCount = readiness?.strong_areas?.length || 0;

  // Simulated exam difficulty distribution
  const easyPct = 30;
  const mediumPct = 50;
  const hardPct = 20;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          Wenn du morgen Prüfung hättest…
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="text-sm text-muted-foreground mb-4">
          So sähe deine Prüfung aus – basierend auf deinem aktuellen Stand:
        </p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <Gauge className="h-4 w-4 mx-auto mb-1 text-primary" />
            <div className="text-xl font-bold">{Math.round(predicted)}%</div>
            <div className="text-[10px] text-muted-foreground">Progn. Ergebnis</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <BarChart3 className="h-4 w-4 mx-auto mb-1 text-green-500" />
            <div className="text-xl font-bold text-green-500">{strongCount}</div>
            <div className="text-[10px] text-muted-foreground">Starke Bereiche</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <ListChecks className="h-4 w-4 mx-auto mb-1 text-orange-500" />
            <div className="text-xl font-bold text-orange-500">{weakCount}</div>
            <div className="text-[10px] text-muted-foreground">Risiko-Bereiche</div>
          </div>
        </div>

        {/* Difficulty distribution */}
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2">Erwartete Schwierigkeitsverteilung:</p>
          <div className="flex rounded-full overflow-hidden h-2.5">
            <div className="bg-green-500" style={{ width: `${easyPct}%` }} />
            <div className="bg-yellow-500" style={{ width: `${mediumPct}%` }} />
            <div className="bg-red-500" style={{ width: `${hardPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Leicht {easyPct}%</span>
            <span>Mittel {mediumPct}%</span>
            <span>Schwer {hardPct}%</span>
          </div>
        </div>

        <Link to="/exam-simulation">
          <Button variant="outline" size="sm" className="w-full">
            Prüfung jetzt simulieren
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
