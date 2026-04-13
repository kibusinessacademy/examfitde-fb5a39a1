import { Link } from 'react-router-dom';
import { PRICING } from '@/config/pricing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  BookOpen, 
  CheckCircle, 
  Clock, 
  GraduationCap,
  ArrowRight,
  Target,
  Shield,
  Sparkles
} from 'lucide-react';
import { useHandbookChapters, useHandbookProgress } from '@/hooks/handbook';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { HandbookChapterCard } from '@/components/handbook/HandbookChapterCard';
import { SEOHead } from '@/components/seo/SEOHead';
import PageExplainer from '@/components/admin/PageExplainer';

export default function HandbookPage() {
  const { data: chapters, isLoading: chaptersLoading } = useHandbookChapters();
  const { data: progress } = useHandbookProgress();

  // Phase 3: product-based access — handbook is available with any product entitlement
  const { data: hasHandbookAccess } = useProductAccessByCurriculum(
    chapters?.[0]?.curriculum_id ?? undefined,
    undefined
  );

  const completedCount = progress?.filter(p => p.completed_at).length || 0;
  const totalChapters = chapters?.length || 0;
  const overallProgress = totalChapters > 0 ? (completedCount / totalChapters) * 100 : 0;

  const totalReadingTime = chapters?.reduce((sum, ch) => sum + (ch.estimated_reading_minutes ?? 0), 0) || 0;

  if (chaptersLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title="Prüfungstraining-Handbuch | ExamFit.de"
        description="Dein strategischer Begleiter zur IHK-Prüfung. Lerne, wie die IHK denkt, vermeide typische Fehler und bestehe mit System."
      />

      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
        {/* Hero Section */}
        <section className="relative py-16 lg:py-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-primary/5" />
          <div className="container mx-auto px-4 relative">
            <div className="max-w-4xl mx-auto text-center">
              <Badge variant="outline" className="mb-4 gap-2">
                <BookOpen className="h-3.5 w-3.5" />
                Strategischer Prüfungsbegleiter
              </Badge>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
                <span className="text-gradient">Prüfungstraining-Handbuch</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Nicht nur lernen – <strong>richtig lernen</strong>. Verstehe, wie die IHK prüft, 
                vermeide typische Fehler und gehe strategisch in deine Prüfung.
              </p>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto mb-8">
                <div className="text-center p-4 bg-card rounded-xl border">
                  <div className="text-2xl font-bold text-primary">{totalChapters}</div>
                  <div className="text-xs text-muted-foreground">Kapitel</div>
                </div>
                <div className="text-center p-4 bg-card rounded-xl border">
                  <div className="text-2xl font-bold text-primary">{totalReadingTime}</div>
                  <div className="text-xs text-muted-foreground">Min. Lesezeit</div>
                </div>
                <div className="text-center p-4 bg-card rounded-xl border">
                  <div className="text-2xl font-bold text-primary">∞</div>
                  <div className="text-xs text-muted-foreground">Übungen</div>
                </div>
              </div>

              {!hasHandbookAccess && (
                <Button asChild size="lg" className="gap-2">
                  <Link to="/shop">
                    <Sparkles className="h-4 w-4" />
                    Im Bundle freischalten
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Progress Overview (if logged in & has access) */}
        {hasHandbookAccess && (
          <section className="container mx-auto px-4 -mt-8 mb-12">
            <div className="max-w-2xl mx-auto glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <GraduationCap className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Dein Fortschritt</h3>
                    <p className="text-sm text-muted-foreground">
                      {completedCount} von {totalChapters} Kapiteln abgeschlossen
                    </p>
                  </div>
                </div>
                <Badge variant={overallProgress === 100 ? "default" : "secondary"}>
                  {Math.round(overallProgress)}%
                </Badge>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>
          </section>
        )}

        <div className="container mx-auto px-4 mb-8">
          <PageExplainer
            title="Was ist das Prüfungshandbuch?"
            description="Das Handbuch ist dein strategischer Begleiter: Es erklärt nicht nur Inhalte, sondern wie die IHK denkt und prüft. Lerne typische Fehler zu vermeiden und gehe mit einem klaren Plan in deine Prüfung."
            workflow={[
              { label: 'Kapitel lesen', active: true },
              { label: 'Übungen machen' },
              { label: 'Strategie anwenden' },
              { label: 'Prüfung bestehen' },
            ]}
            actions={[
              'Kapitel aufklappen → Lies die Abschnitte und mache die interaktiven Übungen',
              'Fortschrittsbalken → Zeigt, wie viele Kapitel du bereits abgeschlossen hast',
            ]}
            tips={[
              'Das Handbuch ist Teil deines Trainings-Bundles – kein Zusatzkauf nötig',
              'Beginne mit den Grundlagen-Kapiteln zur Prüfungslogik',
              'Die Übungen helfen dir, das Gelesene direkt anzuwenden',
            ]}
          />
        </div>

        {/* Value Proposition */}
        <section className="container mx-auto px-4 mb-16">
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="text-center p-6 bg-card rounded-xl border">
              <div className="w-12 h-12 mx-auto mb-4 bg-primary/10 rounded-xl flex items-center justify-center">
                <Target className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Prüfungslogik verstehen</h3>
              <p className="text-sm text-muted-foreground">
                Lerne, wie die IHK Fragen stellt und bewertet – nicht nur den Stoff.
              </p>
            </div>
            <div className="text-center p-6 bg-card rounded-xl border">
              <div className="w-12 h-12 mx-auto mb-4 bg-primary/10 rounded-xl flex items-center justify-center">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Fehler vermeiden</h3>
              <p className="text-sm text-muted-foreground">
                Die häufigsten Denkfehler erkennen, bevor du sie machst.
              </p>
            </div>
            <div className="text-center p-6 bg-card rounded-xl border">
              <div className="w-12 h-12 mx-auto mb-4 bg-primary/10 rounded-xl flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Strategisch vorgehen</h3>
              <p className="text-sm text-muted-foreground">
                30-Tage-Plan und Zeitmanagement für maximale Effizienz.
              </p>
            </div>
          </div>
        </section>

        {/* Chapters Grid */}
        <section className="container mx-auto px-4 pb-20">
          <h2 className="text-2xl font-bold text-center mb-8">Alle Kapitel</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {chapters?.map((chapter, index) => (
              <HandbookChapterCard
                key={chapter.id}
                chapter={chapter}
                progress={progress?.find(p => p.chapter_id === chapter.id)}
                hasAccess={hasHandbookAccess ?? false}
                index={index}
              />
            ))}
          </div>
        </section>

        {/* CTA for non-subscribers */}
        {!hasHandbookAccess && (
          <section className="container mx-auto px-4 pb-20">
            <div className="max-w-2xl mx-auto text-center glass-card rounded-2xl p-8 border-2 border-primary/20">
              <h3 className="text-2xl font-bold mb-4">
                Bereit für deine IHK-Prüfung?
              </h3>
              <p className="text-muted-foreground mb-6">
                Das Prüfungshandbuch ist Teil des Prüfungstrainings – 
                inklusive Prüfungssimulation, KI-Coach und mündlicher Prüfung.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg" className="gap-2">
                  <Link to="/shop">
                    Bundle für {PRICING.defaultPrice} sichern
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/preise">Alle Preise vergleichen</Link>
                </Button>
              </div>
              <div className="flex items-center justify-center gap-4 mt-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Einmalzahlung
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  12 Monate Zugang
                </span>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
