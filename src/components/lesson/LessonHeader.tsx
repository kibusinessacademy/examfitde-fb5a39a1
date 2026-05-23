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
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <header
      role="banner"
      aria-label="Lektions-Navigation"
      className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl"
    >
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back & Course Info */}
          <div className="flex items-center gap-3 min-w-0">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
            >
              <Link
                to={`/course/${courseId}`}
                aria-label={`Zurück zum Kurs: ${courseTitle}`}
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate" aria-label="Kurs">
                {courseTitle}
              </p>
              <h1 className="text-sm font-medium truncate" aria-label="Aktuelles Modul">
                {moduleTitle}
              </h1>
            </div>
          </div>

          {/* Center: Progress */}
          <div className="hidden md:flex items-center gap-3 flex-1 max-w-md">
            <Progress
              value={pct}
              className="h-2"
              aria-label={`Kursfortschritt ${pct} Prozent`}
            />
            <span
              className="text-sm text-muted-foreground whitespace-nowrap"
              aria-live="polite"
            >
              <span className="hidden lg:inline">Lektion </span>
              {currentIndex + 1} von {totalLessons}
            </span>
          </div>

          {/* Right: Home */}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
          >
            <Link to="/dashboard" aria-label="Zur Startseite">
              <Home className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
