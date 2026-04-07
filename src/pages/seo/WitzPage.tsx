import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/seo/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Smile, ArrowRight } from "lucide-react";
import { HumorShareButtons } from "@/components/dashboard/HumorShareButtons";
import { Loader2 } from "lucide-react";

const SITE_URL = "https://examfitde.lovable.app";

type HumorItem = {
  id: string;
  text: string;
  humor_type: string;
  tone: string;
  certification_id: string;
};

export default function WitzPage() {
  const { humorId } = useParams<{ humorId: string }>();
  const [humor, setHumor] = useState<HumorItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!humorId) return;
    (async () => {
      const { data } = await supabase
        .from("humor_items")
        .select("id, text, humor_type, tone, certification_id")
        .eq("id", humorId)
        .eq("status", "approved" as any)
        .maybeSingle();
      setHumor(data as HumorItem | null);
      setLoading(false);
    })();
  }, [humorId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!humor) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <Smile className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-display font-bold">Witz nicht gefunden</h1>
        <p className="text-muted-foreground text-center">Dieser Witz existiert nicht mehr oder ist nicht verfügbar.</p>
        <Link to="/">
          <Button>Zur Startseite</Button>
        </Link>
      </div>
    );
  }

  const pageUrl = `${SITE_URL}/witz/${humor.id}`;
  const ogDescription = humor.text.length > 150 ? humor.text.slice(0, 147) + "…" : humor.text;

  return (
    <>
      <SEOHead
        title="Witz des Tages – ExamFit Prüfungshumor"
        description={ogDescription}
        canonical={pageUrl}
        type="article"
        structuredData={[{
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          "name": "Witz des Tages",
          "text": humor.text,
          "publisher": { "@type": "Organization", "name": "ExamFit" },
          "url": pageUrl,
        }]}
      />

      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="max-w-lg w-full">
            <Card className="glass-card border-primary/10 overflow-hidden">
              <CardContent className="p-6 sm:p-8">
                <div className="flex items-center gap-2 mb-4">
                  <Smile className="h-5 w-5 text-primary" />
                  <span className="font-display font-semibold">Witz des Tages</span>
                </div>

                <p className="text-lg leading-relaxed mb-6">{humor.text}</p>

                <div className="flex items-center gap-2 mb-6">
                  <HumorShareButtons humorId={humor.id} humorText={humor.text} />
                </div>

                <div className="border-t border-border pt-6">
                  <p className="text-sm text-muted-foreground mb-3">
                    Mehr als nur Witze – ExamFit ist dein intelligentes Prüfungstrainings-System.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Link to="/pruefungsreife-check">
                      <Button className="gradient-primary text-primary-foreground rounded-xl group w-full sm:w-auto">
                        Prüfungsreife kostenlos testen
                        <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </Link>
                    <Link to="/shop">
                      <Button variant="outline" className="rounded-xl w-full sm:w-auto">
                        Prüfungstraining ansehen
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>

            <p className="text-center text-xs text-muted-foreground mt-4">
              © ExamFit – Intelligentes Prüfungstraining
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
