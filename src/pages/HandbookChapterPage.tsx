import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PRICING } from '@/config/pricing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  ArrowRight, 
  BookOpen, 
  Clock, 
  CheckCircle,
  Lock,
  ChevronRight
} from 'lucide-react';
import { 
  useHandbookChapter, 
  useHandbookChapters,
  useHandbookProgress,
  useUpdateHandbookProgress,
  useExerciseResponses,
} from '@/hooks/handbook';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { HandbookSectionContent } from '@/components/handbook/HandbookSectionContent';
import { HandbookExercise } from '@/components/handbook/HandbookExercise';
import { SEOHead } from '@/components/seo/SEOHead';

export default function HandbookChapterPage() {
  const { chapterKey } = useParams<{ chapterKey: string }>();
  
  const { data: chapterData, isLoading } = useHandbookChapter(chapterKey);
  const { data: allChapters } = useHandbookChapters();
  const { data: progress } = useHandbookProgress();
  const exerciseIds = chapterData?.exercises.map(e => e.id);
  const { data: exerciseResponses } = useExerciseResponses(chapterData?.chapter?.id, exerciseIds);
  const { mutate: updateProgress } = useUpdateHandbookProgress();

  // Phase 3: product-based access check
  const { data: hasAccess } = useProductAccessByCurriculum(
    chapterData?.chapter?.curriculum_id ?? undefined,
    undefined
  );

  const chapter = chapterData?.chapter;
  const sections = chapterData?.sections || [];
  const exercises = chapterData?.exercises || [];

  // Find current chapter index and navigation
  const currentIndex = allChapters?.findIndex(c => c.chapter_key === chapterKey) ?? 0;
  const prevChapter = allChapters?.[currentIndex - 1];
  const nextChapter = allChapters?.[currentIndex + 1];

  // Track progress when chapter is opened
  useEffect(() => {
    if (chapter && hasAccess) {
      updateProgress({ chapterId: chapter.id });
    }
  }, [chapter, hasAccess, updateProgress]);

  const chapterProgress = progress?.find(p => p.chapter_id === chapter?.id);
  const isCompleted = !!chapterProgress?.completed_at;

  const handleMarkComplete = () => {
    if (chapter) {
      updateProgress({ chapterId: chapter.id, completed: true });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Kapitel nicht gefunden</h1>
        <Button asChild>
          <Link to="/handbuch">Zurück zum Handbuch</Link>
        </Button>
      </div>
    );
  }

  // Paywall for non-subscribers
  if (!hasAccess) {
    return (
      <>
        <SEOHead
          title={`${chapter.title} | Prüfungstraining-Handbuch | ExamFit.de`}
          description={chapter.description || 'Strategischer Prüfungsbegleiter'}
        />
        <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
          <div className="container mx-auto px-4 py-16">
            <div className="max-w-2xl mx-auto text-center">
              <div className="w-16 h-16 mx-auto mb-6 bg-muted rounded-full flex items-center justify-center">
                <Lock className="h-8 w-8 text-muted-foreground" />
              </div>
              <Badge variant="outline" className="mb-4">
                Kapitel {currentIndex + 1} von {allChapters?.length}
              </Badge>
              <h1 className="text-3xl font-bold mb-4">{chapter.title}</h1>
              <p className="text-lg text-muted-foreground mb-8">
                {chapter.description}
              </p>
              <div className="glass-card rounded-2xl p-8 border-2 border-primary/20">
                <h3 className="text-xl font-semibold mb-4">
                  Dieses Kapitel ist im Bundle enthalten
                </h3>
                <p className="text-muted-foreground mb-6">
                  Schalte das komplette Prüfungshandbuch frei – inklusive 
                  Prüfungssimulation, KI-Coach und mündlicher Prüfung.
                </p>
                <Button asChild size="lg" className="gap-2">
                  <Link to="/shop">
                    Prüfungstraining für {PRICING.defaultPrice} freischalten
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SEOHead
        title={`${chapter.title} | Prüfungstraining-Handbuch | ExamFit.de`}
        description={chapter.description || 'Prüfungstraining-Handbuch Kapitel'}
      />

      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/handbuch" className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Übersicht
                  </Link>
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  Kapitel {currentIndex + 1} von {allChapters?.length}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {chapter.estimated_reading_minutes} Min.
                </div>
                {isCompleted ? (
                  <Badge className="bg-green-100 text-green-700 border-green-300">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Abgeschlossen
                  </Badge>
                ) : (
                  <Button size="sm" onClick={handleMarkComplete}>
                    Als gelesen markieren
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-3xl mx-auto">
            {/* Chapter Title */}
            <div className="mb-8">
              <Badge variant="outline" className="mb-4">{chapter.subtitle}</Badge>
              <h1 className="text-4xl font-bold mb-4">{chapter.title}</h1>
              <p className="text-lg text-muted-foreground">{chapter.description}</p>
            </div>

            {/* Sections */}
            <div className="space-y-8 mb-12">
              {sections.map((section) => (
                <HandbookSectionContent key={section.id} section={section} />
              ))}
            </div>

            {/* Exercises */}
            {exercises.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <span className="text-2xl">✍️</span>
                    Übungen zum Kapitel
                  </h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <p className="text-center text-muted-foreground text-sm mb-6">
                  Diese Übungen helfen dir, das Gelernte zu reflektieren. Es gibt keine Punkte – 
                  nur dein persönlicher Denkprozess zählt.
                </p>
                {exercises.map((exercise, index) => (
                  <HandbookExercise
                    key={exercise.id}
                    exercise={exercise}
                    index={index}
                    chapterId={chapter.id}
                    savedResponse={exerciseResponses?.find(r => r.exercise_id === exercise.id)}
                  />
                ))}
              </div>
            )}

            {/* Navigation */}
            <div className="mt-16 pt-8 border-t">
              <div className="flex items-center justify-between">
                {prevChapter ? (
                  <Button variant="outline" asChild className="gap-2">
                    <Link to={`/handbuch/${prevChapter.chapter_key}`}>
                      <ArrowLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">{prevChapter.title}</span>
                      <span className="sm:hidden">Zurück</span>
                    </Link>
                  </Button>
                ) : (
                  <div />
                )}
                
                {nextChapter ? (
                  <Button asChild className="gap-2">
                    <Link to={`/handbuch/${nextChapter.chapter_key}`}>
                      <span className="hidden sm:inline">{nextChapter.title}</span>
                      <span className="sm:hidden">Weiter</span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button onClick={handleMarkComplete} className="gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Handbuch abschließen
                  </Button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
