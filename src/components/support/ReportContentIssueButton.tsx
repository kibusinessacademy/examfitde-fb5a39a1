import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ContentIssueContext = {
  certification_id?: string | null;
  curriculum_id?: string | null;
  package_id?: string | null;
  competence_id?: string | null;
  lesson_id?: string | null;
  question_id?: string | null;
  blueprint_id?: string | null;
  page_path?: string | null;
};

export function ReportContentIssueButton({ context }: { context: ContentIssueContext }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    if (sending || message.trim().length < 10) return;
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
            type: "CONTENT_ISSUE",
            priority: "MEDIUM",
            title: "Inhalt unklar / fehlerhaft gemeldet",
            message,
            ...context,
          }),
        }
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "submit failed");

      toast.success(json.duplicate ? "Schon gemeldet – danke!" : "Danke! Ticket erstellt.");
      setOpen(false);
      setMessage("");
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Senden.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground gap-1"
        onClick={() => setOpen(true)}
      >
        <AlertTriangle className="h-3 w-3" />
        Inhalt melden
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Inhalt melden</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Was ist unklar, falsch oder missverständlich? Bitte kurz beschreiben.
          </p>

          <Textarea
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Beispiel: Die Erklärung zu … widerspricht … / Antwort B wirkt falsch, weil …"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Abbrechen
            </Button>
            <Button onClick={submit} disabled={sending || message.trim().length < 10}>
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
