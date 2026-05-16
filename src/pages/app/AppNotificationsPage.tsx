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
