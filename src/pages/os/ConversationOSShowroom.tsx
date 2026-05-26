import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Clock, ArrowRight, MessagesSquare } from "lucide-react";

type Scenario = {
  id: string;
  scenario_key: string;
  domain: string;
  persona: string;
  scenario_kind: string;
  title: string;
  short_pitch: string;
  difficulty: "easy" | "medium" | "hard" | "expert" | string;
  time_limit_minutes: number;
  painpoint_keys: string[];
  target_roles: string[];
  is_premium: boolean;
};

const DOMAIN_LABEL: Record<string, string> = {
  hr: "HR & People",
  leadership: "Führung",
  sales: "Vertrieb",
  service: "Service",
  medical: "Medizin",
  compliance: "Compliance",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Einsteiger",
  medium: "Fortgeschritten",
  hard: "Anspruchsvoll",
  expert: "Experten",
};

export default function ConversationOSShowroom() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc(
        "public_list_conversation_os_scenarios" as any,
        { _limit: 60 }
      );
      if (cancelled) return;
      if (!error && data) setScenarios(data as Scenario[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const domains = useMemo(() => {
    const set = new Set(scenarios.map((s) => s.domain));
    return ["all", ...Array.from(set)];
  }, [scenarios]);

  const filtered = useMemo(
    () => (tab === "all" ? scenarios : scenarios.filter((s) => s.domain === tab)),
    [scenarios, tab]
  );

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>ConversationOS · KI-gestützte Gesprächs-Simulation für Beruf & Führung</title>
        <meta
          name="description"
          content="Trainieren Sie Bewerbungs-, Gehalts-, Kündigungs-, Feedback- und Vertriebsgespräche mit KI. 12 Premium-Szenarien für HR, Führung, Sales, Service, Medizin, Compliance."
        />
        <link rel="canonical" href="https://berufos.com/os/conversation" />
      </Helmet>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-br from-background via-background to-primary/5">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-4 gap-1">
              <Sparkles className="h-3 w-3" /> Premium · BerufOS Phase A.1
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
              ConversationOS — die schwierigsten Gespräche Ihres Berufs sicher führen.
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Trennungs-, Gehalts-, Feedback-, Konflikt-, Bewerbungs-, Coaching-, Vertriebs-
              und Aufklärungsgespräche — als realitätsnahe KI-Simulation mit strukturiertem
              Rubric-Feedback. Auf Basis von 16.000+ produktiven Examiner-Blueprints.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <a href="#szenarien">
                  Szenarien entdecken <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/suites">Für Teams & Unternehmen</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Szenarien-Grid */}
      <section id="szenarien" className="container mx-auto px-4 py-12 md:py-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">
              12 Premium-Gesprächsszenarien
            </h2>
            <p className="text-muted-foreground mt-1">
              Jedes Szenario folgt einem evidenzbasierten Modell (STAR, WWW+B, GROW, SPIKES, MEDDPICC).
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto">
            {domains.map((d) => (
              <TabsTrigger key={d} value={d}>
                {d === "all" ? "Alle" : DOMAIN_LABEL[d] ?? d}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={tab} className="mt-6">
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="h-56 animate-pulse bg-muted/30" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground">Noch keine Szenarien in dieser Kategorie.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map((s) => (
                  <ScenarioCard key={s.id} s={s} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      {/* Foundation strip */}
      <section className="border-t border-border bg-muted/30">
        <div className="container mx-auto px-4 py-12 grid gap-8 md:grid-cols-3">
          <FoundationStat label="Produktive Examiner-Blueprints" value="16.362" />
          <FoundationStat label="Bewertungsdimensionen pro Szenario" value="5" />
          <FoundationStat label="Coaching-Modelle (STAR · WWW+B · GROW · SPIKES)" value="4+" />
        </div>
      </section>
    </div>
  );
}

function ScenarioCard({ s }: { s: Scenario }) {
  return (
    <Card className="group flex flex-col h-full transition-all hover:shadow-elev-2 hover:-translate-y-0.5">
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <Badge variant="outline" className="gap-1">
            <MessagesSquare className="h-3 w-3" />
            {DOMAIN_LABEL[s.domain] ?? s.domain}
          </Badge>
          {s.is_premium && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" /> Premium
            </Badge>
          )}
        </div>
        <CardTitle className="text-lg leading-snug">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <p className="text-sm text-muted-foreground mb-4 flex-1">{s.short_pitch}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {s.time_limit_minutes} Min
          </span>
          <span>·</span>
          <span>{DIFFICULTY_LABEL[s.difficulty] ?? s.difficulty}</span>
        </div>
        {s.target_roles?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {s.target_roles.slice(0, 3).map((r) => (
              <Badge key={r} variant="outline" className="text-xs font-normal">
                {r}
              </Badge>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" className="w-full mt-auto" disabled>
          Demo startet in Cut 1 <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}

function FoundationStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-bold text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
