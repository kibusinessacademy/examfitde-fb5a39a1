import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const LANGS = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "uk", label: "Українська" },
  { code: "ru", label: "Русский" },
];
const ENTITIES = ["course", "lesson", "question"] as const;

export default function I18nBackfillPage() {
  const [lang, setLang] = useState("en");
  const [entity, setEntity] = useState<string>("course");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const append = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 100));

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("translate-content", { body });
      if (error) throw error;
      append(`✓ ${JSON.stringify(body)} → ${JSON.stringify(data)}`);
      toast.success("OK");
    } catch (e) {
      const msg = (e as Error).message;
      append(`✗ ${msg}`);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl">
      <h1 className="text-3xl font-bold">i18n Backfill</h1>
      <p className="text-muted-foreground">
        Generiert vorgefertigte Übersetzungen für Kurse, Lektionen und Prüfungsfragen
        (Lovable AI Gateway · gemini-2.5-flash).
      </p>

      <Card>
        <CardHeader><CardTitle>1. Übersetzungs-Jobs einplanen</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 flex-wrap items-end">
            <div className="space-y-1">
              <label className="text-sm">Zielsprache</label>
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm">Entität</label>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={busy}
              onClick={() => call({ mode: "enqueue_backfill", language: lang, entity_type: entity, limit: 500 })}
            >
              Jobs einplanen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Job-Queue abarbeiten</CardTitle></CardHeader>
        <CardContent>
          <Button disabled={busy} onClick={() => call({ mode: "drain_jobs", limit: 10 })}>
            10 Jobs abarbeiten
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Mehrfach klicken, bis alle Jobs durch sind. Cron-Anbindung folgt in PR-4.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Log</CardTitle></CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted p-3 rounded max-h-96 overflow-auto whitespace-pre-wrap">
            {log.length === 0 ? "—" : log.join("\n")}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
