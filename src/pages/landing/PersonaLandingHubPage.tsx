import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import { PERSONA_SEO_CONFIGS, type SeoPersonaType } from "@/lib/landing/personaSeoConfig";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowRight, Sparkles } from "lucide-react";

interface Props {
  personaType: SeoPersonaType;
}

export default function PersonaLandingHubPage({ personaType }: Props) {
  const config = PERSONA_SEO_CONFIGS[personaType];
  const [certs, setCerts] = useState<Array<{ slug: string; title: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("certifications")
        .select("slug, title")
        .order("title");
      setCerts(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <SEOHead
        title={`${config.intentLabel} – Alle Trainings | ExamFit`}
        description={`Alle ExamFit-Trainings für ${config.intentLabel}. Finde dein Prüfungstraining und bestehe sicher.`}
        canonical={`${SITE_URL}/${config.routePrefix}`}
      />
      <div data-density="comfortable" className="bg-background">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border-subtle">
          <div
            className="absolute inset-0 -z-10 opacity-60"
            style={{
              background:
                "radial-gradient(ellipse at top, hsl(168 64% 90%) 0%, transparent 60%), radial-gradient(ellipse at bottom right, hsl(181 61% 90%) 0%, transparent 50%)",
            }}
            aria-hidden
          />
          <div
            className="absolute inset-0 -z-10 opacity-0 dark:opacity-40"
            style={{
              background:
                "radial-gradient(ellipse at top, hsl(168 64% 20%) 0%, transparent 60%), radial-gradient(ellipse at bottom right, hsl(181 64% 12%) 0%, transparent 50%)",
            }}
            aria-hidden
          />
          <div className="container max-w-5xl py-20 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-petrol-200 dark:border-petrol-700 bg-mint-50 dark:bg-petrol-900/40 px-3 py-1 text-xs font-medium text-petrol-700 dark:text-mint-300 shadow-elev-1">
              <Sparkles className="h-3 w-3" />
              {config.intentLabel}
            </div>
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight text-text-primary leading-[1.1]">
              {config.intentLabel}
              <span className="block text-petrol-600 dark:text-mint-400 mt-1">
                Bestehen statt Pauken.
              </span>
            </h1>
            <p className="max-w-2xl text-lg text-text-secondary leading-relaxed">
              Alle Prüfungstrainings für {config.intentLabel} – finde deins und starte sofort.
            </p>
          </div>
        </section>

        {/* Trainings-Grid */}
        <section className="container max-w-5xl py-12 space-y-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-display font-semibold text-text-primary">
              Alle Trainings
            </h2>
            {!loading && (
              <span className="text-sm text-text-tertiary tabular-nums">
                {certs.length} verfügbar
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-petrol-600 dark:text-mint-400" />
              <p className="text-sm text-text-secondary">Lade Trainings…</p>
            </div>
          ) : certs.length === 0 ? (
            <Card variant="sunken" className="p-8 text-center">
              <p className="text-sm text-text-secondary">
                Aktuell keine Trainings verfügbar.
              </p>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {certs.map((cert) => (
                <Link
                  key={cert.slug}
                  to={`/${config.routePrefix}/${cert.slug}`}
                  className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
                >
                  <Card variant="interactive" className="h-full">
                    <CardContent className="py-4 px-4 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-text-primary group-hover:text-petrol-600 dark:group-hover:text-mint-300 transition-colors duration-base ease-out-expo line-clamp-2">
                        {cert.title}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-petrol-600 dark:group-hover:text-mint-300 transition-all duration-base ease-out-expo group-hover:translate-x-0.5" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
