import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Info, Shield, Clock, Moon, Smartphone, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePushSubscription } from "@/hooks/usePushSubscription";

interface Prefs {
  channel_push: boolean;
  channel_email: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  fatigue_suppress: boolean;
  exam_window_escalation: boolean;
  timezone: string;
}

const DEFAULTS: Prefs = {
  channel_push: true,
  channel_email: true,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  fatigue_suppress: true,
  exam_window_escalation: true,
  timezone: "Europe/Berlin",
};

export default function AppNotificationsPage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const push = usePushSubscription();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("learner_notification_prefs")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setPrefs({ ...DEFAULTS, ...(data as unknown as Prefs) });
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase
      .from("learner_notification_prefs")
      .upsert({ user_id: user.id, ...prefs }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast.error("Speichern fehlgeschlagen"); return; }
    toast.success("Einstellungen gespeichert");
  };

  if (loading) {
    return <div className="container py-8 text-muted-foreground">Lädt…</div>;
  }

  return (
    <>
      <Helmet>
        <title>Benachrichtigungen — ExamFit</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="container py-6 space-y-6 max-w-2xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Benachrichtigungen</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Lege fest, wann und wie ExamFit dich an deine Prüfungsvorbereitung erinnern darf.
          </p>
        </header>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Erinnerungen sind prüfungszentriert und respektieren deine Ruhezeiten.
            Wir senden niemals manipulative Streak-Pushes — nur Empfehlungen,
            die deiner Vorbereitung helfen.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4" /> Push auf diesem Gerät
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {push.status === "unsupported" && (
              <p className="text-xs text-muted-foreground">
                Dein Browser unterstützt keine Web-Push-Benachrichtigungen. Auf iOS funktioniert Push
                nur, wenn ExamFit als Web-App zum Home-Bildschirm hinzugefügt wurde.
              </p>
            )}
            {push.status === "denied" && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Du hast Benachrichtigungen für diese Seite blockiert. Aktiviere sie in den
                  Browser-Einstellungen unter „Website-Berechtigungen“.
                </AlertDescription>
              </Alert>
            )}
            {push.status === "subscribed" && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Push ist auf diesem Gerät aktiv.</span>
                </div>
                <Button size="sm" variant="outline" onClick={push.unsubscribe} disabled={push.busy}>
                  Push abmelden
                </Button>
              </div>
            )}
            {(push.status === "prompt" || push.status === "idle" || push.status === "error") && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Push-Benachrichtigungen auf diesem Gerät aktivieren.</p>
                  <p className="text-xs text-muted-foreground">
                    Du kannst es jederzeit wieder abschalten.
                  </p>
                </div>
                <Button size="sm" onClick={push.subscribe} disabled={push.busy}>
                  {push.busy ? "…" : "Aktivieren"}
                </Button>
              </div>
            )}
            {push.error && (
              <p className="text-xs text-destructive">{push.error}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Badge variant="outline" className="text-[10px]">Max. 3 Pushes / Tag</Badge>
              <Badge variant="outline" className="text-[10px]">Ruhezeiten aktiv</Badge>
              <Badge variant="outline" className="text-[10px]">Erschöpfungsschutz</Badge>
            </div>
          </CardContent>
        </Card>

        <Accordion type="single" collapsible className="rounded-md border bg-card">
          <AccordionItem value="why" className="border-b-0">
            <AccordionTrigger className="px-4 text-sm">
              Warum bekomme ich Erinnerungen?
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 text-xs text-muted-foreground space-y-2">
              <p>
                ExamFit sendet nur Erinnerungen, die nachweisbar deinem Prüfungserfolg helfen —
                niemals manipulative „Streak-Pushes“ oder künstlicher Stress.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Prüfungs-Countdown:</strong> wenn deine Prüfungsphase es erfordert.</li>
                <li><strong>Schwächen-Erinnerungen:</strong> bei unbehandelten Lücken in Kernkompetenzen.</li>
                <li><strong>Rescue-Hinweise:</strong> wenn ein Lernziel kurz vor dem Verlust steht.</li>
                <li><strong>Streak-Recovery:</strong> dezent, nicht beschämend.</li>
              </ul>
              <p>
                Maximal 3 Pushes pro 24h. Ruhezeiten werden respektiert. In der finalen
                Prüfungsphase dürfen sie nur überschrieben werden, wenn du das oben erlaubst.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Kanäle
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="push">Push-Benachrichtigungen</Label>
                <p className="text-xs text-muted-foreground">Auf Mobilgeräten und im Browser.</p>
              </div>
              <Switch id="push" checked={prefs.channel_push}
                onCheckedChange={(v) => setPrefs(p => ({ ...p, channel_push: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="email">E-Mail-Erinnerungen</Label>
                <p className="text-xs text-muted-foreground">Zusammenfassungen & wichtige Hinweise.</p>
              </div>
              <Switch id="email" checked={prefs.channel_email}
                onCheckedChange={(v) => setPrefs(p => ({ ...p, channel_email: v }))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Moon className="h-4 w-4" /> Ruhezeiten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qs">Von</Label>
                <Input id="qs" type="time" value={prefs.quiet_hours_start}
                  onChange={(e) => setPrefs(p => ({ ...p, quiet_hours_start: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="qe">Bis</Label>
                <Input id="qe" type="time" value={prefs.quiet_hours_end}
                  onChange={(e) => setPrefs(p => ({ ...p, quiet_hours_end: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              In dieser Zeit erhältst du keine Push-Benachrichtigungen — auch nicht bei aktiven Streaks.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" /> Intelligente Steuerung
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label htmlFor="fatigue">Erschöpfungsschutz</Label>
                <p className="text-xs text-muted-foreground">
                  Wenn dein Lernrhythmus signalisiert, dass eine Pause sinnvoll ist,
                  unterdrückt ExamFit nicht-kritische Erinnerungen.
                </p>
              </div>
              <Switch id="fatigue" checked={prefs.fatigue_suppress}
                onCheckedChange={(v) => setPrefs(p => ({ ...p, fatigue_suppress: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label htmlFor="exam">Prüfungsphase darf Ruhezeiten überschreiben</Label>
                <p className="text-xs text-muted-foreground">
                  Nur in der finalen Prüfungsphase und nur für kritische Erinnerungen.
                </p>
              </div>
              <Switch id="exam" checked={prefs.exam_window_escalation}
                onCheckedChange={(v) => setPrefs(p => ({ ...p, exam_window_escalation: v }))} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? "Speichert…" : "Speichern"}
          </Button>
        </div>
      </div>
    </>
  );
}
