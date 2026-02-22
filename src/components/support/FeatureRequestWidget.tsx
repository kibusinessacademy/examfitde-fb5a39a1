import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Lightbulb } from "lucide-react";
import { toast } from "sonner";

export function FeatureRequestWidget({ certificationId }: { certificationId?: string }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    if (sending || title.trim().length < 4 || message.trim().length < 10) return;
    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { toast.error("Bitte zuerst anmelden."); return; }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-ticket`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            type: "FEATURE_REQUEST",
            priority: "LOW",
            title,
            message,
            certification_id: certificationId ?? null,
            page_path: window.location.pathname,
          }),
        }
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "submit failed");

      toast.success(json.duplicate ? "Schon erfasst – danke!" : "Danke! Wunsch eingegangen.");
      setTitle("");
      setMessage("");
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Senden.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-primary" />
          Feature vorschlagen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Welche Produkterweiterung würdest du dir wünschen?
        </p>

        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Kurzer Titel (z.B. 'Prüfungssimulation: Lesezeichen')"
        />

        <Textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Beschreibe kurz: Nutzen, wo es helfen würde, gewünschtes Verhalten."
        />

        <div className="flex justify-end">
          <Button
            onClick={submit}
            disabled={sending || title.trim().length < 4 || message.trim().length < 10}
          >
            {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Senden
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
