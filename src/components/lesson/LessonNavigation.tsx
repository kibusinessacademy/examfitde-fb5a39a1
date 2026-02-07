import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';

interface Lesson {
  id: string;
  title: string;
}

interface LessonNavigationProps {
  prevLesson: Lesson | null;
  nextLesson: Lesson | null;
  courseId: string;
  isCompleted: boolean;
  completing: boolean;
  onComplete: () => void;
  onNavigate: (lesson: Lesson) => void;
}

export default function LessonNavigation({
  prevLesson,
  nextLesson,
  courseId,
  isCompleted,
  completing,
  onComplete,
  onNavigate,
}: LessonNavigationProps) {
  return (
    <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
      <div>
        {prevLesson && (
          <Button variant="outline" onClick={() => onNavigate(prevLesson)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Vorherige</span>
          </Button>
        )}
      </div>

      <div className="flex-1 flex justify-center">
        {!isCompleted ? (
          <Button 
            onClick={onComplete}
            disabled={completing}
            className="gradient-primary text-primary-foreground shadow-glow"
          >
            {completing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Als abgeschlossen markieren
          </Button>
        ) : (
          <Badge className="bg-success/20 text-success border-0 py-2 px-4">
            <CheckCircle className="h-4 w-4 mr-2" />
            Abgeschlossen
          </Badge>
        )}
      </div>

      <div>
        {nextLesson ? (
          <Button 
            onClick={() => onNavigate(nextLesson)}
            className={isCompleted ? 'gradient-primary text-primary-foreground shadow-glow-sm' : ''}
            variant={isCompleted ? 'default' : 'outline'}
          >
            <span className="hidden sm:inline">Nächste</span>
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : isCompleted ? (
          <Link to={`/course/${courseId}`}>
            <Button className="gradient-accent text-accent-foreground">
              Modul beenden
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
