import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Smile } from "lucide-react";
import { toast } from "sonner";
import { useTerminology } from "@/hooks/useProgramType";

type Prefs = {
  humor_enabled: boolean;
  humor_push_enabled: boolean;
  tone_preference: "auto" | "business" | "casual";
  modernity_range: string;
};

interface HumorSettingsProps {
  curriculumId?: string | null;
}

export function HumorSettings({ curriculumId }: HumorSettingsProps) {
  const [prefs, setPrefs] = useState<Prefs>({
    humor_enabled: true,
    humor_push_enabled: false,
    tone_preference: "auto",
    modernity_range: "45-80",
  });
  const [loading, setLoading] = useState(true);
  const { t } = useTerminology(curriculumId);

  useEffect(() => {
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) return;

        const { data } = await supabase
          .from("user_humor_preferences" as any)
          .select("humor_enabled, humor_push_enabled, tone_preference, modernity_range")
          .eq("user_id", userData.user.id)
          .maybeSingle();

        if (data) setPrefs(data as unknown as Prefs);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(next: Partial<Prefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/set-humor-preferences`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(merged),
        }
      );

      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      toast.success("Einstellung gespeichert");
    } catch {
      toast.error("Fehler beim Speichern");
    }
  }

  if (loading) return null;

  return (
    <Card className="glass-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Smile className="h-4 w-4 text-primary" />
          <span className="text-sm font-display font-semibold">Tageswitz Einstellungen</span>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="humor-toggle" className="text-sm">
            {t('humorSettingsLabel')}
          </Label>
          <Switch
            id="humor-toggle"
            checked={prefs.humor_enabled}
            onCheckedChange={(checked) => save({ humor_enabled: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="humor-push" className="text-sm">
            Push-Benachrichtigung (optional)
          </Label>
          <Switch
            id="humor-push"
            checked={prefs.humor_push_enabled}
            onCheckedChange={(checked) => save({ humor_push_enabled: checked })}
            disabled={!prefs.humor_enabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm">Tonalität</Label>
          <Select
            value={prefs.tone_preference}
            onValueChange={(v) => save({ tone_preference: v as Prefs["tone_preference"] })}
            disabled={!prefs.humor_enabled}
          >
            <SelectTrigger className="w-[160px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (gemischt)</SelectItem>
              <SelectItem value="business">Business-modern</SelectItem>
              <SelectItem value="casual">Locker-modern</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground opacity-60">
          Opt-out gilt sofort. Du kannst es jederzeit wieder aktivieren.
        </p>
      </CardContent>
    </Card>
  );
}
