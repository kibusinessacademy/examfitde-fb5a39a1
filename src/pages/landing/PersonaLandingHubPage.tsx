import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import { PERSONA_SEO_CONFIGS, type SeoPersonaType } from "@/lib/landing/personaSeoConfig";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowRight } from "lucide-react";

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
      <div className="container py-16 max-w-5xl space-y-8">
        <h1 className="text-4xl font-bold">{config.intentLabel}</h1>
        <p className="text-lg text-muted-foreground">
          Alle Prüfungstrainings für {config.intentLabel} – finde deins und starte sofort.
        </p>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {certs.map(cert => (
              <Link key={cert.slug} to={`/${config.routePrefix}/${cert.slug}`} className="group">
                <Card className="hover:border-primary/30 transition-colors">
                  <CardContent className="py-4 flex items-center justify-between">
                    <span className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-2">
                      {cert.title}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
