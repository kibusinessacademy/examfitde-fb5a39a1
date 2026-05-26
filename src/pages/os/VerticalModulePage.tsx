import { useEffect, useState } from "react";
import { useLocation, Link, Navigate, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Clock, Sparkles, CheckCircle2, Target, Users, MessagesSquare, Play } from "lucide-react";

type ScenarioRow = {
  id: string;
  scenario_key: string;
  title: string;
  short_pitch: string;
  domain: string;
  difficulty: string;
  time_limit_minutes: number;
  persona: string;
};

type ModuleDetail = {
  module_key: string;
  display_name: string;
  tagline: string;
  buyer_persona: string;
  primary_outcome: string;
  outcomes: string[];
  trains: string[];
  route_slug: string;
  hero_eyebrow: string | null;
  scenarios: ScenarioRow[];
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Einsteiger",
  medium: "Fortgeschritten",
  hard: "Anspruchsvoll",
  expert: "Experten",
};

const DIFFICULTY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  easy: "secondary",
  medium: "default",
  hard: "default",
  expert: "destructive",
};

export default function VerticalModulePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const moduleSlug = location.pathname.replace(/^\/os\//, "").replace(/\/$/, "");
  const [data, setData] = useState<ModuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioRow | null>(null);
  const [position, setPosition] = useState("");
  const [branche, setBranche] = useState("");
  const [seniority, setSeniority] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!moduleSlug) return;
    (async () => {
      setLoading(true);
      const { data: rows, error } = await supabase.rpc("public_get_conversation_os_module", {
        _route_slug: moduleSlug,
      });
      if (error || !rows || (rows as any[]).length === 0) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const r = (rows as any[])[0];
      setData({
        ...r,
        outcomes: Array.isArray(r.outcomes) ? r.outcomes : [],
        trains: Array.isArray(r.trains) ? r.trains : [],
        scenarios: Array.isArray(r.scenarios) ? r.scenarios : [],
      });
      setLoading(false);
    })();
  }, [moduleSlug]);

  if (notFound) return <Navigate to="/os/conversation" replace />;
  if (loading || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-16 max-w-5xl">
          <div className="h-12 w-2/3 bg-muted rounded animate-pulse mb-4" />
          <div className="h-6 w-1/2 bg-muted rounded animate-pulse mb-8" />
          <div className="grid md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{data.display_name} – {data.tagline}</title>
        <meta name="description" content={`${data.tagline} ${data.primary_outcome} Für ${data.buyer_persona}.`} />
        <link rel="canonical" href={`https://berufos.com/os/${data.route_slug}`} />
      </Helmet>

      <div className="border-b border-border">
        <div className="container mx-auto px-4 py-4 max-w-5xl">
          <Button asChild variant="ghost" size="sm">
            <Link to="/os/conversation">
              <ArrowLeft className="h-3 w-3 mr-1" /> Alle Module
            </Link>
          </Button>
        </div>
      </div>

      <header className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="container mx-auto px-4 py-16 max-w-5xl">
          {data.hero_eyebrow && (
            <Badge variant="secondary" className="mb-4">{data.hero_eyebrow}</Badge>
          )}
          <div className="flex items-center gap-2 mb-3">
            <MessagesSquare className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              ConversationOS · {data.display_name}
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-tight">
            {data.tagline}
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mb-8">{data.primary_outcome}</p>

          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link to="/auth">Modul testen</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#szenarien">Szenarien ansehen</a>
            </Button>
          </div>

          <div className="mt-10 pt-6 border-t border-border flex items-start gap-3">
            <Users className="h-5 w-5 text-muted-foreground mt-1" />
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Für</p>
              <p className="text-base text-foreground">{data.buyer_persona}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="container mx-auto px-4 py-16 max-w-5xl">
        <div className="grid md:grid-cols-2 gap-10">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-bold text-foreground">Outcomes</h2>
            </div>
            <ul className="space-y-3">
              {data.outcomes.map((o, idx) => (
                <li key={idx} className="flex gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span className="text-foreground">{o}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-2xl font-bold text-foreground">Trainiert</h2>
            </div>
            <ul className="space-y-3">
              {data.trains.map((t, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
                  <span className="text-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="szenarien" className="border-t border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16 max-w-5xl">
          <h2 className="text-3xl font-bold text-foreground mb-3">
            {data.scenarios.length} {data.scenarios.length === 1 ? "Szenario" : "Szenarien"} live
          </h2>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Jedes Szenario hat einen Charakterbrief, definierte Painpoints und eine eigene Scoring-Rubrik.
            Wiederholbar, vergleichbar, audit-fähig.
          </p>

          {data.scenarios.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Dieses Modul wird gerade ausgebaut. Erste Szenarien sind in Vorbereitung.
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {data.scenarios.map((s) => {
                const isLive = data.route_slug === 'hr-interview' || data.route_slug === 'examfit-oral';
                const card = (
                  <Card key={s.scenario_key} className={`border-border h-full ${isLive ? 'hover:border-primary/40 hover:shadow-md transition-all cursor-pointer' : ''}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={DIFFICULTY_VARIANT[s.difficulty] ?? "default"} className="text-xs">
                          {DIFFICULTY_LABEL[s.difficulty] ?? s.difficulty}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {s.time_limit_minutes} Min
                        </span>
                        {isLive && <Badge variant="default" className="text-xs ml-auto">Live</Badge>}
                      </div>
                      <CardTitle className="text-lg text-foreground leading-snug">{s.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground leading-relaxed">{s.short_pitch}</p>
                    </CardContent>
                  </Card>
                );
                return isLive ? (
                  <button
                    key={s.scenario_key}
                    type="button"
                    onClick={() => { setSelectedScenario(s); }}
                    className="text-left"
                  >
                    {card}
                  </button>
                ) : card;
              })}
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="container mx-auto px-4 py-16 max-w-3xl text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Bereit, {data.display_name} zu testen?
          </h2>
          <p className="text-muted-foreground mb-8">
            Premium-Niveau ab dem ersten Gespräch. Keine Setup-Zeit, keine generischen Prompts.
          </p>
          <Button size="lg" asChild>
            <Link to="/auth">Jetzt starten</Link>
          </Button>
        </div>
      </section>

      <Dialog open={!!selectedScenario} onOpenChange={(o) => !o && setSelectedScenario(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Szenario starten</DialogTitle>
            <DialogDescription>
              {selectedScenario?.title} · Optional: Position und Branche eingeben, damit der Charakter realistisch in deinem Hiring-Kontext reagiert.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ctx-position">Gesuchte Position <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input id="ctx-position" placeholder="z. B. Senior Backend Engineer (Go)" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={120} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ctx-branche">Branche</Label>
                <Input id="ctx-branche" placeholder="z. B. SaaS, Maschinenbau" value={branche} onChange={(e) => setBranche(e.target.value)} maxLength={80} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ctx-sen">Seniorität</Label>
                <Input id="ctx-sen" placeholder="z. B. Senior, Lead" value={seniority} onChange={(e) => setSeniority(e.target.value)} maxLength={40} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ctx-notes">Zusatz-Kontext <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Textarea id="ctx-notes" placeholder="z. B. Remote-Stelle, Salary-Band 75–90k, Team von 6 Engineers" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelectedScenario(null)}>Abbrechen</Button>
            <Button
              onClick={() => {
                if (!selectedScenario) return;
                const ctx = {
                  position: position.trim() || undefined,
                  branche: branche.trim() || undefined,
                  seniority: seniority.trim() || undefined,
                  notes: notes.trim() || undefined,
                };
                try {
                  sessionStorage.setItem(`conv_os_ctx_${selectedScenario.id}`, JSON.stringify(ctx));
                } catch { /* */ }
                navigate(`/os/${data.route_slug}/run/${selectedScenario.id}`);
              }}
            >
              <Play className="h-4 w-4 mr-2" /> Training starten
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
