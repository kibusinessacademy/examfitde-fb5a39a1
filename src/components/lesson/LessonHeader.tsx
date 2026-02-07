import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Home } from 'lucide-react';

interface LessonHeaderProps {
  courseId: string;
  courseTitle: string;
  moduleTitle: string;
  progress: number;
  currentIndex: number;
  totalLessons: number;
}

export default function LessonHeader({
  courseId,
  courseTitle,
  moduleTitle,
  progress,
  currentIndex,
  totalLessons,
}: LessonHeaderProps) {
  return (
    <div className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back & Course Info */}
          <div className="flex items-center gap-4 min-w-0">
            <Link to={`/course/${courseId}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{courseTitle}</p>
              <p className="text-sm font-medium truncate">{moduleTitle}</p>
            </div>
          </div>

          {/* Center: Progress */}
          <div className="hidden md:flex items-center gap-3 flex-1 max-w-md">
            <Progress value={progress} className="h-2" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {currentIndex + 1}/{totalLessons}
            </span>
          </div>

          {/* Right: Home */}
          <Link to="/dashboard">
            <Button variant="ghost" size="icon">
              <Home className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
