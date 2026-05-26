import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, MessagesSquare, Sparkles, ShieldCheck, Layers } from "lucide-react";

type ModuleRow = {
  module_key: string;
  display_name: string;
  tagline: string;
  buyer_persona: string;
  primary_outcome: string;
  outcomes: string[];
  trains: string[];
  route_slug: string;
  hero_eyebrow: string | null;
  scenario_count: number;
};

export default function ConversationOSShowroom() {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("public_list_conversation_os_modules");
      if (!error && data) {
        setModules(
          (data as any[]).map((m) => ({
            ...m,
            outcomes: Array.isArray(m.outcomes) ? m.outcomes : [],
            trains: Array.isArray(m.trains) ? m.trains : [],
          })),
        );
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>ConversationOS – Plattform für berufliche Gesprächskompetenz</title>
        <meta
          name="description"
          content="Sechs vertikale Module für trainierbare Gesprächskompetenz: Bewerbungsgespräche, Führung, Medizin, Vertrieb, Support, Compliance. Standardisierte Szenarien, messbare Rubriken, Premium-Niveau."
        />
        <link rel="canonical" href="https://berufos.com/os/conversation" />
      </Helmet>

      <header className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-6xl">
          <div className="flex items-center gap-2 mb-4">
            <MessagesSquare className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              ConversationOS · Plattform
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 max-w-4xl">
            Operationalisierte Gesprächskompetenz.
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mb-8 leading-relaxed">
            Eine Engine. Sechs vertikale Module. Jedes Modul trainiert die Gespräche, die Ihre Rolle
            wirklich führen muss — mit Rubrics, Difficulty und Mastery.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <Stat icon={<Layers className="h-4 w-4" />} label="Vertikale Module" value="6" />
            <Stat icon={<MessagesSquare className="h-4 w-4" />} label="Szenarien live" value={String(modules.reduce((a, m) => a + (m.scenario_count || 0), 0))} />
            <Stat icon={<Sparkles className="h-4 w-4" />} label="Foundation Blueprints" value="16.362" />
            <Stat icon={<ShieldCheck className="h-4 w-4" />} label="Premium SSOT" value="Audit-ready" />
          </div>
        </div>
      </header>

      <section className="container mx-auto px-4 py-16 max-w-6xl">
        <div className="mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
            Wählen Sie Ihr Modul.
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl">
            Niemand kauft „AI-Gesprächstrainer". Sie kaufen bessere Bewerbungsgespräche, sichere
            Patientengespräche, höhere Sales-Conversion. Jede Vertikale ist eigenständig kaufbar.
          </p>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-72 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {modules.map((m) => (
              <Card key={m.module_key} className="group hover:shadow-lg transition-shadow border-border">
                <CardHeader className="pb-4">
                  {m.hero_eyebrow && (
                    <Badge variant="secondary" className="w-fit mb-2 text-xs">
                      {m.hero_eyebrow}
                    </Badge>
                  )}
                  <CardTitle className="text-2xl text-foreground">{m.display_name}</CardTitle>
                  <p className="text-lg text-foreground mt-1 leading-snug">{m.tagline}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Für</p>
                    <p className="text-sm text-foreground">{m.buyer_persona}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Trainiert</p>
                    <ul className="text-sm text-foreground space-y-1">
                      {m.trains.slice(0, 3).map((t, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span className="text-primary">·</span>
                          <span>{t}</span>
                        </li>
                      ))}
                      {m.trains.length > 3 && (
                        <li className="text-muted-foreground text-xs pl-3">
                          +{m.trains.length - 3} weitere
                        </li>
                      )}
                    </ul>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                      {m.scenario_count} {m.scenario_count === 1 ? "Szenario" : "Szenarien"} live
                    </span>
                    <Button asChild size="sm" className="group-hover:translate-x-1 transition-transform">
                      <Link to={`/os/${m.route_slug}`}>
                        Modul ansehen <ArrowRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 max-w-4xl">
          <h2 className="text-2xl font-bold text-foreground mb-6">Warum kein generischer Chatbot reicht</h2>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <FeatureRow title="Standardisierte Szenarien" body="Blueprint-Architektur wie bei Prüfungs-Engines: gleiches Szenario, vergleichbare Ergebnisse." />
            <FeatureRow title="Rubric-basiertes Scoring" body="Empathie, Struktur, Argumentation, Standhaftigkeit — gewichtet, nachvollziehbar, wiederholbar." />
            <FeatureRow title="Difficulty + Mastery" body="Vom Einsteiger bis Experten-Stress-Interview. Härtegrad steigt mit Können." />
            <FeatureRow title="Branchenspezifische Personas" body="Charakterbriefs aus echten Curricula, Kompetenzen und Painpoints abgeleitet." />
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-md bg-primary/10 text-primary mt-0.5">{icon}</div>
      <div>
        <div className="text-2xl font-bold text-foreground leading-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FeatureRow({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
