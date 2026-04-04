import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { loadLandingData } from "@/lib/landing/loadLandingData";
import { buildLandingMessaging } from "@/lib/landing/buildLandingMessaging";
import { buildSeoMeta } from "@/lib/landing/buildSeoMeta";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrackingEvents } from "@/lib/tracking/track";
import { startProductCheckout } from "@/lib/checkout/startProductCheckout";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Shield,
  Zap,
  Target,
  FileCheck,
  BarChart3,
  Brain,
  Mic,
  BookOpen,
  GraduationCap,
  Sparkles,
  AlertTriangle,
} from "lucide-react";

const MODULE_META: Record<string, { icon: typeof Target; label: string; descriptions: Record<string, string> }> = {
  exam_trainer: {
    icon: Target,
    label: "Prüfungstrainer",
    descriptions: {
      FORTBILDUNG: "Prüfungsnahe Fragen auf IHK-Fortbildungsniveau mit sofortigem Feedback.",
      ZERTIFIKAT: "Originalnahe Prüfungsfragen im echten Prüfungsformat.",
      AZUBI: "Trainiere mit prüfungsnahen Fragen zu allen Handlungsfeldern.",
      default: "Prüfungsnahe Fragen statt bloßer Theorie.",
    },
  },
  exam_simulation: {
    icon: FileCheck,
    label: "Prüfungssimulation",
    descriptions: {
      FORTBILDUNG: "Realistische Prüfungssimulation mit Zeitlimit und Bestehensindikator.",
      ZERTIFIKAT: "Prüfungssimulation im Originalformat – so realistisch wie die echte Prüfung.",
      AZUBI: "Simuliere die schriftliche Prüfung unter realen Bedingungen.",
      default: "Simulation mit Zeitdruck und Bewertung.",
    },
  },
  mini_checks: {
    icon: BarChart3,
    label: "MiniChecks",
    descriptions: {
      FORTBILDUNG: "Regelmäßige Kompetenz-Checks zeigen deinen Fortschritt.",
      ZERTIFIKAT: "Schnelle Selbsttests zu jedem Themengebiet.",
      default: "Gezielte MiniChecks für Schwächenarbeit.",
    },
  },
  ai_tutor: {
    icon: Brain,
    label: "KI-Prüfungscoach",
    descriptions: {
      FORTBILDUNG: "KI-gestützte Schwächenanalyse und individuelle Lernempfehlungen.",
      ZERTIFIKAT: "KI-Prüfungsdecoder: Versteht Trickfragen und erklärt Framework-Logik.",
      AZUBI: "KI-Coach erklärt Fehler und hilft bei der Prüfungsargumentation.",
      default: "KI-Tutor erklärt Fehler und nächste Schritte.",
    },
  },
  oral_exam: {
    icon: Mic,
    label: "Mündliche Simulation",
    descriptions: {
      FORTBILDUNG: "Übe mündliche Prüfungssituationen mit sofortigem KI-Feedback.",
      AZUBI: "Simuliere das Fachgespräch mit KI-Feedback zu Struktur und Argumentation.",
      default: "Mündliche Prüfungssimulation mit Feedback.",
    },
  },
  handbook: {
    icon: BookOpen,
    label: "Prüfungshandbuch",
    descriptions: {
      FORTBILDUNG: "Strukturiertes Prüfungswissen für alle Handlungsfelder.",
      default: "Kompakte Zusammenfassung aller prüfungsrelevanten Themen.",
    },
  },
};

function getModuleDescription(moduleKey: string, landingType: string): string {
  const meta = MODULE_META[moduleKey];
  if (!meta) return "";
  return meta.descriptions[landingType] ?? meta.descriptions.default ?? "";
}

export default function DynamicProductLandingPage() {
  const { slug = "", landingType = "FORTBILDUNG" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadLandingData>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const result = await loadLandingData(slug, landingType);
        if (mounted) setData(result);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [slug, landingType]);

  const messaging = useMemo(() => {
    if (!data?.certification || !data?.modules || !data?.pricing) return null;
    return buildLandingMessaging({
      title: data.certification.title,
      landingType,
      validationProfile: data.certification.validation_profile ?? "",
      modules: {
        examTrainer: data.modules.exam_trainer,
        examSimulation: data.modules.exam_simulation,
        miniChecks: data.modules.mini_checks,
        aiTutor: data.modules.ai_tutor,
        oralExam: data.modules.oral_exam,
        handbook: data.modules.handbook,
      },
      price: Number(data.pricing.one_time_price),
    });
  }, [data, landingType]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Lade Landingpage…</div>
      </div>
    );
  }

  if (error || !data || !messaging) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Produkt nicht gefunden</h1>
          <p className="text-muted-foreground">{error ?? "Keine Daten verfügbar."}</p>
          <Link to="/shop"><Button>Zum Shop</Button></Link>
        </div>
      </div>
    );
  }

  const price = Number(data.pricing!.one_time_price).toFixed(2).replace('.', ',');
  const compareAt = data.pricing!.compare_at_price
    ? Number(data.pricing!.compare_at_price).toFixed(2).replace('.', ',')
    : null;
  const accessMonths = data.pricing!.access_months;
  const headline = data.profile?.hero_headline ?? messaging.heroHeadline;
  const subline = data.profile?.hero_subline ?? messaging.heroSubline;
  const primaryCta = data.profile?.primary_cta ?? messaging.primaryCta;
  const secondaryCta = data.profile?.secondary_cta ?? messaging.secondaryCta;
  const uspItems = data.profile?.usp_items?.length ? data.profile.usp_items : messaging.uspItems;
  const painPoints = data.profile?.target_pain_points ?? [];
  const faqs = (data.profile?.faq_seed ?? []) as Array<{ question: string; answer: string }>;

  const seo = buildSeoMeta({
    title: data.certification.title,
    landingType,
    price: Number(data.pricing!.one_time_price),
    seoTitle: data.profile?.seo_title,
    seoDescription: data.profile?.seo_description,
  });

  // Collect active modules
  const activeModules = Object.entries(data.modules!)
    .filter(([key, val]) => val === true && MODULE_META[key])
    .map(([key]) => key);

  return (
    <>
      <SEOHead
        title={seo.title}
        description={seo.description}
        canonical={`${SITE_URL}/landing/${landingType}/${slug}`}
        type="product"
        price={Number(data.pricing!.one_time_price)}
        currency="EUR"
        availability="InStock"
      />

      <div className="min-h-screen">
        {/* ═══ HERO ═══ */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                {landingType === "ZERTIFIKAT" ? "Zertifizierungs-Training" :
                 landingType === "FORTBILDUNG" ? "IHK-Prüfungstraining" :
                 landingType === "BETRIEB" ? "Für Unternehmen" :
                 landingType === "INSTITUTION" ? "Für Bildungseinrichtungen" :
                 "Prüfungstraining"}
              </span>
            </div>

            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              {headline}
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              {subline}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link to="/shop">
                <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg">
                  {primaryCta}
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/pruefungsreife-check">
                <Button size="lg" variant="outline" className="rounded-xl h-14 px-8 text-lg border-border hover:bg-muted/50">
                  {secondaryCta}
                </Button>
              </Link>
            </div>

            {/* Trust bar */}
            <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> {accessMonths} Monate Zugang</span>
              <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Kein Abo</span>
              <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> {price} € einmalig</span>
            </div>
          </div>
        </section>

        {/* ═══ PRICE ANCHOR ═══ */}
        {compareAt && (
          <section className="py-12 bg-muted/30">
            <div className="container max-w-3xl text-center">
              <p className="text-muted-foreground mb-2">Klassische Vorbereitungskurse</p>
              <p className="text-3xl font-bold line-through text-muted-foreground/60">{compareAt} €</p>
              <p className="text-muted-foreground mt-4">ExamFit Prüfungstraining</p>
              <p className="text-5xl font-display font-bold text-gradient">{price} €</p>
              <p className="text-sm text-muted-foreground mt-1">einmalig · {accessMonths} Monate · Kein Abo</p>
            </div>
          </section>
        )}

        {/* ═══ PAIN POINTS + SOLUTION ═══ */}
        {painPoints.length > 0 && (
          <section className="py-16 px-4">
            <div className="container max-w-5xl grid gap-6 md:grid-cols-3">
              <Card className="p-6 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <h2 className="text-xl font-semibold">Warum Nutzer scheitern</h2>
                <ul className="space-y-2 text-muted-foreground">
                  {painPoints.map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <span className="text-destructive mt-1">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-6 md:col-span-2 space-y-4">
                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                  <GraduationCap className="h-5 w-5 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-semibold">Was ExamFit anders macht</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {activeModules.map((key) => {
                    const meta = MODULE_META[key];
                    if (!meta) return null;
                    const Icon = meta.icon;
                    return (
                      <div key={key} className="flex items-start gap-3 p-3 rounded-xl bg-muted/50">
                        <Icon className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="font-medium text-sm">{meta.label}</div>
                          <div className="text-xs text-muted-foreground">{getModuleDescription(key, landingType)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* ═══ MODULE CARDS ═══ */}
        <section className="py-16 px-4 bg-muted/30">
          <div className="container max-w-5xl">
            <h2 className="text-3xl font-bold text-center mb-4">
              Was dein Training enthält
            </h2>
            <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
              Alle Module sind speziell auf die {data.certification.title}-Prüfung zugeschnitten.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeModules.map((key) => {
                const meta = MODULE_META[key];
                if (!meta) return null;
                const Icon = meta.icon;
                const isCoreOral = key === "oral_exam";
                return (
                  <Card key={key} className={`p-6 space-y-3 ${isCoreOral ? 'border-primary/50 ring-1 ring-primary/20' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isCoreOral ? 'gradient-primary' : 'bg-muted'}`}>
                        <Icon className={`h-5 w-5 ${isCoreOral ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                      </div>
                      {isCoreOral && <Badge className="bg-primary/10 text-primary border-0 text-xs">Core Feature</Badge>}
                    </div>
                    <h3 className="font-semibold text-lg">{meta.label}</h3>
                    <p className="text-sm text-muted-foreground">
                      {getModuleDescription(key, landingType)}
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══ USPs ═══ */}
        <section className="py-16 px-4">
          <div className="container max-w-3xl">
            <h2 className="text-3xl font-bold text-center mb-8">Deine Vorteile mit ExamFit</h2>
            <div className="space-y-4">
              {[
                ...uspItems,
                `Nur ${price} € statt ${compareAt ? compareAt + ' €' : 'teurer Kurse'}`,
                'Flexible Vorbereitung – lerne wann und wo du willst',
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 p-4 glass-card rounded-xl">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ FAQ ═══ */}
        {faqs.length > 0 && (
          <section className="py-16 bg-muted/30">
            <div className="container max-w-3xl">
              <h2 className="text-3xl font-bold text-center mb-12">Häufige Fragen</h2>
              <div className="space-y-4">
                {faqs.map((faq, i) => (
                  <details key={i} className="glass-card rounded-2xl p-6 group cursor-pointer">
                    <summary className="font-semibold list-none flex items-center justify-between">
                      {faq.question}
                      <svg className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </summary>
                    <p className="mt-3 text-muted-foreground">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ═══ BOTTOM CTA ═══ */}
        <section className="py-16 px-4">
          <div className="container max-w-2xl text-center space-y-6">
            <h2 className="text-3xl font-bold">Bereit für deine Prüfung?</h2>
            <p className="text-muted-foreground">
              Starte jetzt dein Training – {price} € für {accessMonths} Monate.
            </p>
            <Link to="/shop">
              <Button size="lg" className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-10 text-lg">
                {primaryCta}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
