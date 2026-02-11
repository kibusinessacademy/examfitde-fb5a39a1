import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWeaknessAssignments } from '@/hooks/useExamReadiness';
import { AlertTriangle, BookOpen, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeaknessLoopWidgetProps {
  curriculumId: string;
}

export function WeaknessLoopWidget({ curriculumId }: WeaknessLoopWidgetProps) {
  const { data: weaknesses, isLoading } = useWeaknessAssignments(curriculumId);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[100px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!weaknesses || weaknesses.length === 0) return null;

  return (
    <Card className="glass-card border-l-4 border-l-orange-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Nachtraining erforderlich
          <Badge variant="destructive" className="ml-auto">{weaknesses.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Bevor du erneut simulierst, trainiere diese Kompetenzen:
        </p>
        {weaknesses.slice(0, 5).map((w) => {
          const comp = w.competency as { id: string; title: string; code: string } | null;
          return (
            <div key={w.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{comp?.title || 'Unbekannt'}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{comp?.code}</span>
                  <span>•</span>
                  <span className="text-orange-500 font-medium">{w.score_at_detection}% bei Erkennung</span>
                </div>
              </div>
              <Badge variant={w.status === 'training' ? 'secondary' : 'outline'} className="ml-2 flex-shrink-0">
                {w.status === 'training' ? 'In Arbeit' : 'Offen'}
              </Badge>
            </div>
          );
        })}
        {weaknesses.length > 5 && (
          <p className="text-xs text-muted-foreground text-center">
            + {weaknesses.length - 5} weitere Schwächen
          </p>
        )}
        <div className="flex gap-2">
          <Link to="/courses" className="flex-1">
            <Button variant="outline" className="w-full gap-2">
              <BookOpen className="h-4 w-4" />
              Schwächen trainieren
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
