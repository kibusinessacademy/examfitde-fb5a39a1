import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ShieldCheck, Award, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const BADGE_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  platinum: { label: 'Platin', color: 'bg-purple-500/10 text-purple-700 border-purple-300', emoji: '💎' },
  gold: { label: 'Gold', color: 'bg-yellow-500/10 text-yellow-700 border-yellow-300', emoji: '🥇' },
  silver: { label: 'Silber', color: 'bg-gray-400/10 text-gray-600 border-gray-300', emoji: '🥈' },
  bronze: { label: 'Bronze', color: 'bg-orange-500/10 text-orange-700 border-orange-300', emoji: '🥉' },
};

function useQualityPublicData(certSlug: string) {
  return useQuery({
    queryKey: ['quality-public', certSlug],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('seo-quality-score', {
        body: { slug: certSlug },
      });
      if (error) throw error;
      return data?.data ?? null;
    },
    enabled: !!certSlug,
  });
}

const QualityScorePage = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useQualityPublicData(slug || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Qualitätsreport nicht verfügbar</h1>
        <p className="text-muted-foreground mb-8">
          Für diese Prüfung liegt noch kein veröffentlichter Qualitätsreport vor.
        </p>
        <Link to="/" className="text-primary hover:underline">Zurück zur Startseite</Link>
      </div>
    );
  }

  const summary = data.summary || {};
  const badgeCfg = BADGE_CONFIG[data.badge] || BADGE_CONFIG.bronze;
  const score = Number(data.score || 0);
  const certTitle = data.title?.replace(' Prüfung', '') || 'Zertifizierung';

  return (
    <>
      <Helmet>
        <title>{`Qualitätsscore: ${certTitle} | ExamFit`}</title>
        <meta name="description" content={`ExamFit Qualitäts-Score ${score}/100 (${badgeCfg.label}) für ${certTitle}. Transparente Qualitätsbewertung unserer Prüfungsvorbereitung.`} />
        <link rel="canonical" href={`https://berufos.com/${slug}`} />
      </Helmet>

      <article className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">ExamFit Quality Score</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold">{certTitle} – Qualitätsbewertung</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Transparente Qualitätsbewertung unserer Prüfungsvorbereitung, basierend auf objektiven Metriken.
          </p>
        </div>

        <Card className="border-2">
          <CardContent className="py-8">
            <div className="flex flex-col md:flex-row items-center justify-center gap-8">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor"
                    className={score >= 85 ? "text-emerald-500" : score >= 75 ? "text-yellow-500" : "text-destructive"}
                    strokeWidth="8" strokeDasharray={`${score * 2.64} 264`} strokeLinecap="round" />
                </svg>
                <span className="text-3xl font-bold">{score}</span>
              </div>

              <div className="text-center md:text-left space-y-2">
                <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full border text-lg font-semibold", badgeCfg.color)}>
                  <span className="text-2xl">{badgeCfg.emoji}</span>
                  <span>{badgeCfg.label}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Score-Version: V{data.score_version} · Aktualisiert: {new Date(data.updated_at).toLocaleDateString('de-DE')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            label="Blueprint-Abdeckung"
            value={`${(summary.blueprint_coverage_pct ?? 0).toFixed(0)}%`}
            progress={summary.blueprint_coverage_pct ?? 0}
            description="Anteil der Prüfungskompetenzen mit ausreichend Übungsfragen"
          />
          <MetricCard
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            label="Lernfeld-Abdeckung"
            value={`${(summary.lf_coverage_pct ?? 0).toFixed(0)}%`}
            progress={summary.lf_coverage_pct ?? 0}
            description="Verteilung der Fragen nach offiziellen Lernfeldern"
          />
          <MetricCard
            icon={<Award className="h-5 w-5 text-primary" />}
            label="Gesamtfragen"
            value={summary.total_questions ?? 0}
            description="Anzahl verfügbarer Übungsfragen"
          />
          <MetricCard
            icon={summary.duplicate_rate_pct <= 3
              ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              : <AlertTriangle className="h-5 w-5 text-yellow-500" />}
            label="Duplikat-Rate"
            value={`${(summary.duplicate_rate_pct ?? 0).toFixed(1)}%`}
            description="Anteil ähnlicher oder doppelter Fragen (niedriger = besser)"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Qualitätsregeln
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">
                ✓ {summary.rules_passed ?? 0} bestanden
              </Badge>
              {(summary.rules_warned ?? 0) > 0 && (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
                  ⚠ {summary.rules_warned} Hinweise
                </Badge>
              )}
              {(summary.rules_failed ?? 0) > 0 && (
                <Badge variant="outline" className="bg-destructive-bg-subtle text-destructive">
                  ✗ {summary.rules_failed} nicht bestanden
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Wie wird bewertet?</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none dark:prose-invert">
            <p>
              Der ExamFit Quality Score bewertet die Qualität unserer Prüfungsvorbereitung anhand objektiver, 
              automatisierter Metriken. Die Bewertung basiert auf:
            </p>
            <ul>
              <li><strong>Blueprint-Abdeckung (35%)</strong> – Jede prüfungsrelevante Kompetenz wird mit Übungsfragen abgedeckt</li>
              <li><strong>Duplikat-Kontrolle (15%)</strong> – Wir stellen sicher, dass Fragen einzigartig und vielfältig sind</li>
              <li><strong>Schwierigkeitsverteilung (10%)</strong> – Ausgewogene Mischung aus leichten, mittleren und schweren Fragen</li>
              <li><strong>MiniCheck-Präsenz (15%)</strong> – Jede Lektion enthält Verständnisfragen zur Selbstkontrolle</li>
              <li><strong>Prüfungsrelevanz (15%)</strong> – Alle Inhalte sind direkt aus dem offiziellen Rahmenplan abgeleitet</li>
              <li><strong>Tutor-Qualität (10%)</strong> – Der KI-Tutor referenziert ausschließlich geprüfte Lerninhalte</li>
            </ul>
            <h3>Badge-Stufen</h3>
            <ul>
              <li>💎 <strong>Platin</strong> – Score ≥ 92, keine kritischen Mängel</li>
              <li>🥇 <strong>Gold</strong> – Score ≥ 85, keine kritischen Mängel</li>
              <li>🥈 <strong>Silber</strong> – Score ≥ 75</li>
              <li>🥉 <strong>Bronze</strong> – Score &lt; 75</li>
            </ul>
          </CardContent>
        </Card>
      </article>
    </>
  );
};

function MetricCard({ icon, label, value, progress, description }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  progress?: number;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-medium">{label}</span>
          </div>
          <span className="text-lg font-bold">{value}</span>
        </div>
        {progress !== undefined && <Progress value={progress} className="h-2" />}
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default QualityScorePage;
