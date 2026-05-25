/**
 * Admin: Berufs-KI Workflows — CRUD + Aktivierung + Lauf-Stats.
 *
 * SSOT: berufs_ki_workflow_definitions (RLS via has_role admin).
 * Liste via admin_berufs_ki_list_workflows (RPC).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Power, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  adminGetWorkflowFull,
  adminListWorkflows,
  adminToggleWorkflow,
  adminUpsertWorkflow,
  type AdminWorkflowUpsert,
} from "@/lib/berufs-ki/api";
import { CATEGORY_LABEL } from "@/lib/berufs-ki/copy";
import type { AdminWorkflowSummary, WorkflowCategory } from "@/lib/berufs-ki/types";

const CATEGORIES: WorkflowCategory[] = [
  "kommunikation",
  "analyse",
  "dokumentation",
  "organisation",
  "fach",
  "lernhilfe",
];

const TIERS = ["free", "pro", "business"] as const;
const RISKS = ["low", "medium", "high"] as const;

interface DraftState extends Omit<AdminWorkflowUpsert, "input_schema"> {
  input_schema_json: string;
}

const EMPTY_DRAFT: DraftState = {
  slug: "",
  title: "",
  description: "",
  category: "kommunikation",
  tier_required: "free",
  risk_level: "low",
  system_prompt: "Du bist ein erfahrener Profi. Antworte deutsch, fachlich korrekt, ohne Halluzinationen.",
  user_prompt_template: "Beruf: {{beruf}}\nAufgabe: {{aufgabe}}",
  input_schema_json: JSON.stringify(
    {
      fields: [
        { key: "beruf", label: "Beruf / Rolle", type: "text", required: true },
        { key: "aufgabe", label: "Aufgabe", type: "textarea", required: true },
      ],
    },
    null,
    2,
  ),
  curriculum_id: null,
  competency_id: null,
  learning_field_id: null,
  blueprint_id: null,
  is_active: true,
  model_recommendation: "google/gemini-2.5-pro",
};

export default function BerufsKIWorkflowsPage() {
  const [rows, setRows] = useState<AdminWorkflowSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await adminListWorkflows();
      setRows(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        r.category.includes(q),
    );
  }, [rows, filter]);

  function openCreate() {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  async function openEdit(id: string) {
    setEditingId(id);
    try {
      const wf = (await adminGetWorkflowFull(id)) as Record<string, unknown>;
      setDraft({
        slug: String(wf.slug ?? ""),
        title: String(wf.title ?? ""),
        description: String(wf.description ?? ""),
        category: (wf.category as WorkflowCategory) ?? "kommunikation",
        subcategory: (wf.subcategory as string | null) ?? null,
        curriculum_id: (wf.curriculum_id as string | null) ?? null,
        learning_field_id: (wf.learning_field_id as string | null) ?? null,
        competency_id: (wf.competency_id as string | null) ?? null,
        blueprint_id: (wf.blueprint_id as string | null) ?? null,
        tier_required: (wf.tier_required as "free" | "pro" | "business") ?? "free",
        risk_level: (wf.risk_level as "low" | "medium" | "high") ?? "low",
        compliance_level: (wf.compliance_level as "standard" | "sensitive" | "regulated") ?? "standard",
        model_recommendation: String(wf.model_recommendation ?? "google/gemini-2.5-pro"),
        system_prompt: String(wf.system_prompt ?? ""),
        user_prompt_template: String(wf.user_prompt_template ?? ""),
        input_schema_json: JSON.stringify(wf.input_schema ?? { fields: [] }, null, 2),
        is_active: Boolean(wf.is_active ?? true),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleSave() {
    if (!draft) return;
    let parsedSchema: { fields: Array<Record<string, unknown>> };
    try {
      parsedSchema = JSON.parse(draft.input_schema_json);
      if (!Array.isArray(parsedSchema?.fields)) throw new Error("input_schema.fields fehlt");
    } catch (e) {
      toast.error("input_schema JSON ungültig: " + (e as Error).message);
      return;
    }
    setSaving(true);
    try {
      const payload: AdminWorkflowUpsert = {
        ...draft,
        id: editingId ?? undefined,
        input_schema: parsedSchema,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payload as any).input_schema_json;
      await adminUpsertWorkflow(payload);
      toast.success(editingId ? "Workflow aktualisiert." : "Workflow erstellt.");
      setDraft(null);
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: AdminWorkflowSummary) {
    try {
      await adminToggleWorkflow(row.id, !row.is_active);
      toast.success(row.is_active ? "Deaktiviert." : "Aktiviert.");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Berufs-KI · Workflows
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Workflow-Registry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SSOT für alle Berufs-KI Workflows. Bindung an Lernpaket, Lernfeld, Kompetenz, Blueprint.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Neuer Workflow
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {rows ? `${rows.length} Workflows` : "—"}
            </CardTitle>
            <Input
              placeholder="Suchen…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>SSOT-Bindung</TableHead>
                <TableHead className="text-right">Läufe 24h</TableHead>
                <TableHead className="text-right">OK-Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">{r.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{CATEGORY_LABEL[r.category]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.tier_required === "free" ? "secondary" : "default"}>
                      {r.tier_required}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.curriculum_id ? <div>📦 {r.curriculum_id.slice(0, 8)}…</div> : <span className="text-muted-foreground">—</span>}
                    {r.competency_id && <div>🎯 {r.competency_id.slice(0, 8)}…</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.runs_24h}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.runs_total ? `${Math.round(r.ok_rate * 100)}%` : "—"}
                  </TableCell>
                  <TableCell>
                    {r.is_active ? (
                      <Badge variant="default">aktiv</Badge>
                    ) : (
                      <Badge variant="outline">inaktiv</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => handleToggle(r)}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(r.id)}>
                        Bearbeiten
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                    Keine Workflows.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Workflow bearbeiten" : "Neuer Workflow"}</DialogTitle>
            <DialogDescription>
              SSOT-Bindung optional, aber empfohlen. Pro/Business-Workflows brauchen aktive Entitlement-Prüfung.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    value={draft.slug}
                    onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                    placeholder="z.B. pro-kundenmail-antworten"
                  />
                </div>
                <div>
                  <Label htmlFor="title">Titel</Label>
                  <Input
                    id="title"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="desc">Beschreibung</Label>
                <Textarea
                  id="desc"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Kategorie</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: v as WorkflowCategory })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tier</Label>
                  <Select
                    value={draft.tier_required}
                    onValueChange={(v) => setDraft({ ...draft, tier_required: v as "free" | "pro" | "business" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIERS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Risiko</Label>
                  <Select
                    value={draft.risk_level ?? "low"}
                    onValueChange={(v) => setDraft({ ...draft, risk_level: v as "low" | "medium" | "high" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RISKS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="curr">Curriculum ID (Lernpaket)</Label>
                  <Input
                    id="curr"
                    value={draft.curriculum_id ?? ""}
                    onChange={(e) => setDraft({ ...draft, curriculum_id: e.target.value || null })}
                    placeholder="UUID oder leer"
                  />
                </div>
                <div>
                  <Label htmlFor="lf">Lernfeld ID</Label>
                  <Input
                    id="lf"
                    value={draft.learning_field_id ?? ""}
                    onChange={(e) => setDraft({ ...draft, learning_field_id: e.target.value || null })}
                    placeholder="UUID oder leer"
                  />
                </div>
                <div>
                  <Label htmlFor="comp">Kompetenz ID</Label>
                  <Input
                    id="comp"
                    value={draft.competency_id ?? ""}
                    onChange={(e) => setDraft({ ...draft, competency_id: e.target.value || null })}
                  />
                </div>
                <div>
                  <Label htmlFor="bp">Blueprint ID</Label>
                  <Input
                    id="bp"
                    value={draft.blueprint_id ?? ""}
                    onChange={(e) => setDraft({ ...draft, blueprint_id: e.target.value || null })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="sys">System Prompt</Label>
                <Textarea
                  id="sys"
                  value={draft.system_prompt}
                  onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                  rows={4}
                />
              </div>

              <div>
                <Label htmlFor="usr">User Prompt Template (mit {"{{key}}"} Platzhaltern)</Label>
                <Textarea
                  id="usr"
                  value={draft.user_prompt_template}
                  onChange={(e) => setDraft({ ...draft, user_prompt_template: e.target.value })}
                  rows={5}
                />
              </div>

              <div>
                <Label htmlFor="schema">Input Schema (JSON)</Label>
                <Textarea
                  id="schema"
                  value={draft.input_schema_json}
                  onChange={(e) => setDraft({ ...draft, input_schema_json: e.target.value })}
                  rows={8}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Speichern" : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
