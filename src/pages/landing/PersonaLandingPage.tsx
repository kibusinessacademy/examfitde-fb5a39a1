import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { SITE_URL, generateCourseSchema, generateFAQSchema, generateBreadcrumbSchema } from "@/lib/seo";
import { PERSONA_SEO_CONFIGS, type SeoPersonaType } from "@/lib/landing/personaSeoConfig";
import { PRICING } from "@/config/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConversionCard } from "@/features/conversion/components/ConversionCard";
import { TrackingEvents } from "@/lib/tracking/track";
import { startProductCheckout } from "@/lib/checkout/startProductCheckout";
import { toast } from "sonner";
import {
  Target, ArrowRight, CheckCircle, Clock, Shield, Zap,
  BookOpen, Brain, BarChart3, Mic, FileCheck,
  AlertTriangle, Sparkles, GraduationCap,
} from "lucide-react";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface PersonaLandingProps {
  personaType: SeoPersonaType;
}

export default function PersonaLandingPage({ personaType }: PersonaLandingProps) {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const config = PERSONA_SEO_CONFIGS[personaType];

  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [certData, setCertData] = useState<any>(null);
  const [seoContent, setSeoContent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);

        // Load certification by slug
        const { data: cert, error: certErr } = await supabase
          .from("certifications")
          .select("id, slug, title, track, certification_type, validation_profile, oral_component, learning_field_count, min_question_target")
          .eq("slug", slug)
          .single();
        if (certErr || !cert) throw new Error("Prüfungstraining nicht gefunden");

        // Load SEO content + pricing + modules in parallel
        const [{ data: seoPage }, { data: pricing }, { data: modules }] = await Promise.all([
          supabase
            .from("seo_content_pages")
            .select("title, meta_description, content_md, faq_json")
            .eq("slug", `${config.routePrefix}/${slug}`)
            .eq("status", "done")
            .maybeSingle(),
          supabase
            .from("product_pricing_configs")
            .select("one_time_price, access_months, compare_at_price")
            .eq("certification_id", cert.id)
            .maybeSingle(),
          supabase
            .from("product_module_configs")
            .select("exam_trainer, exam_simulation, mini_checks, ai_tutor, oral_exam, handbook")
            .eq("certification_id", cert.id)
            .maybeSingle(),
        ]);

        if (mounted) {
          setCertData({ ...cert, pricing, modules });
          setSeoContent(seoPage);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [slug, config.routePrefix]);

  // Track landing view
  useEffect(() => {
    if (!loading && certData) {
      TrackingEvents.landingView(slug, personaType);
    }
  }, [loading, slug, personaType, certData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !certData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Prüfungstraining nicht gefunden</h1>
          <p className="text-muted-foreground">{error}</p>
          <Link to="/pruefungstraining"><Button>Zur Übersicht</Button></Link>
        </div>
      </div>
    );
  }

  const title = certData.title;
  const price = Number(certData.pricing?.one_time_price ?? 39).toFixed(2).replace(".", ",");
  const accessMonths = certData.pricing?.access_months ?? 12;
  const questions = certData.min_question_target ?? 600;
  const chamber = certData.chamber_type ?? "IHK";
  const hero = config.heroTemplate(title, price);
  const meta = config.metaTemplate(title, price);
  const canonicalUrl = `${SITE_URL}/${config.routePrefix}/${slug}`;

  const faqs = (seoContent?.faq_json as Array<{ q: string; a: string }>) ?? [];
  const faqsForSchema = faqs.map(f => ({ question: f.q, answer: f.a }));

  const breadcrumbItems = [
    { name: "Start", url: SITE_URL },
    { name: config.intentLabel, url: `${SITE_URL}/${config.routePrefix}` },
    { name: title },
  ];

  const structuredData = [
    generateCourseSchema({
      id: certData.id,
      name: `${config.intentLabel}: ${title}`,
      description: seoContent?.meta_description ?? meta.description,
      url: canonicalUrl,
      price: Number(certData.pricing?.one_time_price ?? 39),
      educationalLevel: config.jsonLdEducationalLevel,
      numberOfLessons: questions,
      hasCertificate: true,
    }),
    ...(faqsForSchema.length > 0 ? [generateFAQSchema(faqsForSchema)] : []),
    generateBreadcrumbSchema(breadcrumbItems),
  ];

  const handleCheckout = async () => {
    if (checkoutLoading) return;
    setCheckoutLoading(true);
    try {
      await TrackingEvents.ctaPrimaryClick(slug, config.ctaPrimary, price);
      const result = await startProductCheckout(slug);
      if (!result.ok) {
        toast.error(result.error ?? "Checkout konnte nicht gestartet werden.");
      } else if (result.already_entitled) {
        toast.info("Du hast bereits Zugriff auf dieses Produkt.");
        navigate("/dashboard");
      }
    } catch {
      toast.error("Ein Fehler ist aufgetreten. Bitte versuche es erneut.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const activeModules = certData.modules
    ? Object.entries(certData.modules).filter(([_, v]) => v === true).map(([k]) => k)
    : [];

  const MODULE_ICONS: Record<string, typeof Target> = {
    exam_trainer: Target,
    exam_simulation: FileCheck,
    mini_checks: BarChart3,
    ai_tutor: Brain,
    oral_exam: Mic,
    handbook: BookOpen,
  };

  const MODULE_LABELS: Record<string, string> = {
    exam_trainer: "Prüfungstrainer",
    exam_simulation: "Prüfungssimulation",
    mini_checks: "MiniChecks",
    ai_tutor: "KI-Prüfungscoach",
    oral_exam: "Mündliche Simulation",
    handbook: "Prüfungshandbuch",
  };

  return (
    <>
      <SEOHead
        title={seoContent?.title ?? meta.title}
        description={seoContent?.meta_description ?? meta.description}
        canonical={canonicalUrl}
        type="product"
        price={Number(certData.pricing?.one_time_price ?? 39)}
        currency="EUR"
        availability="InStock"
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* ═══ HERO ═══ */}
        <section className="py-20 px-4 relative">
          <div className="container mx-auto text-center max-w-4xl">
            <Breadcrumbs
              items={[
                { label: "Start", href: "/" },
                { label: config.intentLabel, href: `/${config.routePrefix}` },
                { label: title },
              ]}
              className="justify-center mb-8"
            />

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6 animate-fade-in">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">{config.intentLabel}</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-display font-bold mb-6 animate-fade-in">
              {hero.headline}
            </h1>

            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto animate-fade-in">
              {hero.subline}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in">
              <Button
                size="lg"
                className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg"
                onClick={handleCheckout}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? "Wird geladen…" : config.ctaPrimary}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-xl h-14 px-8 text-lg"
                onClick={() => navigate("/pruefungsreife-check")}
              >
                {config.ctaSecondary}
              </Button>
            </div>

            <div className="flex flex-wrap justify-center gap-6 mt-10 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> {accessMonths} Monate Zugang</span>
              <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Kein Abo</span>
              <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> {price} € einmalig</span>
            </div>
          </div>
        </section>

        {/* ═══ STATS ═══ */}
        <section className="py-12 bg-muted/30">
          <div className="container max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: BookOpen, label: "Prüfungsaufgaben", value: `${questions}+` },
              { icon: Brain, label: "KI-Coach", value: "Inklusive" },
              { icon: Clock, label: "Zugang", value: `${accessMonths} Monate` },
              { icon: BarChart3, label: "Preis", value: `${price} €` },
            ].map(stat => (
              <Card key={stat.label} className="text-center">
                <CardContent className="py-4 space-y-1">
                  <stat.icon className="h-6 w-6 mx-auto text-primary" />
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ═══ MODULE CARDS ═══ */}
        {activeModules.length > 0 && (
          <section className="py-16 px-4">
            <div className="container max-w-5xl">
              <h2 className="text-3xl font-bold text-center mb-4">Was dein Training enthält</h2>
              <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
                Alle Module sind speziell auf die {title}-Prüfung zugeschnitten.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeModules.map(key => {
                  const Icon = MODULE_ICONS[key] ?? Target;
                  return (
                    <Card key={key} className="p-6 space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <h3 className="font-semibold text-lg">{MODULE_LABELS[key] ?? key}</h3>
                    </Card>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ═══ AI-GENERATED CONTENT ═══ */}
        {seoContent?.content_md && (
          <section className="py-16 px-4 bg-muted/30">
            <div className="container max-w-4xl prose prose-lg dark:prose-invert">
              <ReactMarkdown>{seoContent.content_md}</ReactMarkdown>
            </div>
          </section>
        )}

        {/* ═══ FAQ ═══ */}
        {faqs.length > 0 && (
          <section className="py-16 px-4">
            <div className="container max-w-3xl">
              <h2 className="text-3xl font-bold text-center mb-12">Häufige Fragen</h2>
              <div className="space-y-4">
                {faqs.map((faq, i) => (
                  <details key={i} className="glass-card rounded-2xl p-6 group cursor-pointer">
                    <summary className="font-semibold list-none flex items-center justify-between">
                      {faq.q}
                      <svg className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </summary>
                    <p className="mt-3 text-muted-foreground">{faq.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ═══ CONVERSION CARD ═══ */}
        <section className="py-16 px-4">
          <div className="container max-w-2xl">
            <ConversionCard
              headline={`Bereit für deine ${personaType === "studium" ? "Klausur" : "Prüfung"} ${title}?`}
              subline={`Starte jetzt – ${price} € für ${accessMonths} Monate ${config.intentLabel}.`}
              cta={config.ctaPrimary}
              onClick={handleCheckout}
            />
          </div>
        </section>

        {/* ═══ CROSS-LINKS ═══ */}
        <nav className="container max-w-5xl py-8 border-t space-y-3">
          <h2 className="text-lg font-semibold">Weitere Prüfungstrainings</h2>
          <div className="flex flex-wrap gap-2">
            <Link to="/pruefungstraining" className="text-sm text-primary hover:underline">Alle Trainings</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining-azubis" className="text-sm text-primary hover:underline">Für Azubis</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining-sachkunde" className="text-sm text-primary hover:underline">Sachkunde</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining-fachwirt" className="text-sm text-primary hover:underline">Fachwirt</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/pruefungstraining-studium" className="text-sm text-primary hover:underline">Studium</Link>
          </div>
        </nav>
      </div>
    </>
  );
}
