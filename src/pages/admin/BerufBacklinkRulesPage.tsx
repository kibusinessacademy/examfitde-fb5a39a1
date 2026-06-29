import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2, RefreshCw, Link2 } from "lucide-react";

interface BacklinkRule {
  id: string;
  beruf_id: string | null;
  beruf_slug: string | null;
  target_url: string;
  target_label: string | null;
  anchor_hint: string | null;
  priority: number;
  max_links_per_doc: number;
  link_type: string;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
}

interface Beruf { id: string; bezeichnung_kurz: string }

const LINK_TYPES = ["cluster_to_pillar", "cluster_to_product", "cluster_to_cluster", "rule_curated"];

export default function BerufBacklinkRulesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data: berufe } = useQuery({
    queryKey: ["backlink-rules-berufe"],
    queryFn: async (): Promise<Beruf[]> => {
      const { data, error } = await supabase
        .from("berufe")
        .select("id, bezeichnung_kurz")
        .eq("ist_aktiv", true)
        .order("bezeichnung_kurz")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const berufMap = useMemo(() => new Map((berufe ?? []).map((b) => [b.id, b.bezeichnung_kurz])), [berufe]);

  const { data: rules, isFetching, refetch } = useQuery({
    queryKey: ["backlink-rules"],
    queryFn: async (): Promise<BacklinkRule[]> => {
      const { data, error } = await supabase
        .from("seo_beruf_backlink_rules")
        .select("*")
        .order("priority", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as BacklinkRule[];
    },
  });

  const filtered = useMemo(() => {
    if (!filter.trim()) return rules ?? [];
    const f = filter.toLowerCase();
    return (rules ?? []).filter((r) =>
      r.target_url.toLowerCase().includes(f) ||
      (r.target_label ?? "").toLowerCase().includes(f) ||
      (berufMap.get(r.beruf_id ?? "") ?? "").toLowerCase().includes(f),
    );
  }, [rules, filter, berufMap]);

  const [draft, setDraft] = useState<Partial<BacklinkRule>>({
    priority: 50, max_links_per_doc: 1, link_type: "cluster_to_pillar", is_active: true,
  });
  const [saving, setSaving] = useState(false);

  async function createRule() {
    if (!draft.target_url) { toast.error("target_url ist Pflicht"); return; }
    setSaving(true);
    const { error } = await supabase.from("seo_beruf_backlink_rules").insert({
      beruf_id: draft.beruf_id ?? null,
      beruf_slug: draft.beruf_slug ?? null,
      target_url: draft.target_url,
      target_label: draft.target_label ?? null,
      anchor_hint: draft.anchor_hint ?? null,
      priority: draft.priority ?? 50,
      max_links_per_doc: draft.max_links_per_doc ?? 1,
      link_type: draft.link_type ?? "cluster_to_pillar",
      is_active: draft.is_active ?? true,
      notes: draft.notes ?? null,
    });
    setSaving(false);
    if (error) { toast.error("Speichern fehlgeschlagen", { description: error.message }); return; }
    toast.success("Regel angelegt");
    setDraft({ priority: 50, max_links_per_doc: 1, link_type: "cluster_to_pillar", is_active: true });
    qc.invalidateQueries({ queryKey: ["backlink-rules"] });
  }

  async function updateRule(id: string, patch: Partial<BacklinkRule>) {
    const { error } = await supabase.from("seo_beruf_backlink_rules").update(patch).eq("id", id);
    if (error) { toast.error("Update fehlgeschlagen", { description: error.message }); return; }
    qc.invalidateQueries({ queryKey: ["backlink-rules"] });
  }

  async function removeRule(id: string) {
    if (!confirm("Regel wirklich löschen?")) return;
    const { error } = await supabase.from("seo_beruf_backlink_rules").delete().eq("id", id);
    if (error) { toast.error("Löschen fehlgeschlagen", { description: error.message }); return; }
    toast.success("Regel gelöscht");
    qc.invalidateQueries({ queryKey: ["backlink-rules"] });
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Link2 className="h-7 w-7" /> Beruf-Backlink-Regeln</h1>
          <p className="text-muted-foreground">
            Steuere pro Beruf, welche /berufe-Kategorien und Kursseiten der interne Linker
            bevorzugt verlinkt. Niedrige Priorität = höhere Rangfolge.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Neue Regel</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Beruf">
              <select
                className="h-10 rounded-md border border-border-strong bg-surface px-2 text-sm"
                value={draft.beruf_id ?? ""}
                onChange={(e) => setDraft({ ...draft, beruf_id: e.target.value || null })}
              >
                <option value="">— global (alle Berufe) —</option>
                {(berufe ?? []).map((b) => <option key={b.id} value={b.id}>{b.bezeichnung_kurz}</option>)}
              </select>
            </Field>
            <Field label="Ziel-URL (z.B. /berufe/it oder /shop/aevo)">
              <Input value={draft.target_url ?? ""} onChange={(e) => setDraft({ ...draft, target_url: e.target.value })} placeholder="/berufe/..." />
            </Field>
            <Field label="Label / Linktitel">
              <Input value={draft.target_label ?? ""} onChange={(e) => setDraft({ ...draft, target_label: e.target.value })} />
            </Field>
            <Field label="Anker-Text Hint">
              <Input value={draft.anchor_hint ?? ""} onChange={(e) => setDraft({ ...draft, anchor_hint: e.target.value })} />
            </Field>
            <Field label="Link-Typ">
              <select
                className="h-10 rounded-md border border-border-strong bg-surface px-2 text-sm"
                value={draft.link_type ?? "cluster_to_pillar"}
                onChange={(e) => setDraft({ ...draft, link_type: e.target.value })}
              >
                {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Priorität (1-100)">
              <Input type="number" min={1} max={100} value={draft.priority ?? 50}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
            </Field>
            <Field label="Max Links / Dokument">
              <Input type="number" min={1} max={5} value={draft.max_links_per_doc ?? 1}
                onChange={(e) => setDraft({ ...draft, max_links_per_doc: Number(e.target.value) })} />
            </Field>
            <Field label="Aktiv">
              <div className="h-10 flex items-center">
                <Switch checked={draft.is_active ?? true} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
              </div>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={createRule} disabled={saving || !draft.target_url}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Regel anlegen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Aktive Regeln ({filtered.length})</CardTitle>
          <Input
            placeholder="Filter: Beruf, URL, Label …"
            className="max-w-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Beruf</TableHead>
              <TableHead>Ziel-URL</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead className="text-right">Prio</TableHead>
              <TableHead className="text-right">Max</TableHead>
              <TableHead>Aktiv</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.beruf_id ? berufMap.get(r.beruf_id) ?? "—" : <Badge variant="outline">global</Badge>}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[18rem] truncate" title={r.target_url}>{r.target_url}</TableCell>
                  <TableCell className="text-xs">{r.target_label ?? "—"}</TableCell>
                  <TableCell className="text-xs"><Badge variant="secondary">{r.link_type}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Input
                      type="number" className="w-16 h-7 text-right"
                      defaultValue={r.priority}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== r.priority) updateRule(r.id, { priority: v });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Input
                      type="number" className="w-14 h-7 text-right"
                      defaultValue={r.max_links_per_doc}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== r.max_links_per_doc) updateRule(r.id, { max_links_per_doc: v });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={r.is_active} onCheckedChange={(v) => updateRule(r.id, { is_active: v })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => removeRule(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">Noch keine Regeln.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
