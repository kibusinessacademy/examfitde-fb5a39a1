/**
 * Community Workflow Submission Dialog — User reicht strukturierten Workflow ein
 * (kein freier Promptblob). Nach Submit läuft AI-Precheck async.
 */
import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { createSubmission } from "@/lib/berufs-ki/submissions";
import { CATEGORY_LABEL } from "@/lib/berufs-ki/copy";
import type { WorkflowCategory } from "@/lib/berufs-ki/types";
import { useOsBeruf } from "@/lib/os/os-identity";

const CATEGORIES: WorkflowCategory[] = [
  "kommunikation", "analyse", "dokumentation", "organisation", "fach", "lernhilfe",
];

export default function SubmissionDialog({ trigger }: { trigger?: React.ReactNode }) {
  const beruf = useOsBeruf();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [category, setCategory] = useState<WorkflowCategory>("kommunikation");
  const [steps, setSteps] = useState("");
  const [inputs, setInputs] = useState("");
  const [outputs, setOutputs] = useState("");
  const [risks, setRisks] = useState("");

  async function submit() {
    if (!title.trim() || !goal.trim() || !steps.trim()) {
      toast.error("Titel, Ziel und Workflow-Schritte sind Pflicht.");
      return;
    }
    setBusy(true);
    try {
      const inputFields = inputs
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((label, i) => ({ key: `feld_${i + 1}`, label, type: "textarea" as const }));
      const outSections = outputs
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      await createSubmission({
        title: title.trim(),
        goal: goal.trim(),
        beruf_slug: beruf?.slug ?? null,
        category,
        proposed_inputs: { fields: inputFields },
        proposed_outputs: { sections: outSections },
        workflow_steps: steps.trim(),
        risks: risks.trim() || undefined,
      });
      toast.success("Eingereicht — AI-Precheck läuft. Du bekommst Bescheid, sobald der Review fertig ist.");
      setOpen(false);
      setTitle(""); setGoal(""); setSteps(""); setInputs(""); setOutputs(""); setRisks("");
    } catch (e) {
      toast.error((e as Error).message ?? "Einsendung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Workflow einreichen
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workflow einreichen</DialogTitle>
          <DialogDescription>
            Strukturierter Workflow — kein Prompt-Blob. AI prüft Duplikat, Governance & Qualität, bevor ein Admin reviewed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Titel</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Reklamationsbrief professionell beantworten" />
          </div>
          <div className="space-y-1">
            <Label>Ziel des Workflows</Label>
            <Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Was soll am Ende stehen? Welche Arbeit wird gespart?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Kategorie</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as WorkflowCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Berufsfeld</Label>
              <Input value={beruf?.label ?? ""} disabled placeholder="aus Profil" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Workflow-Schritte</Label>
            <Textarea rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="1. Eingabe analysieren&#10;2. Tonalität wählen&#10;3. Antwortgliederung&#10;4. Validierung" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Inputs (eine pro Zeile)</Label>
              <Textarea rows={3} value={inputs} onChange={(e) => setInputs(e.target.value)} placeholder="Originaltext der Reklamation&#10;Gewünschter Ton" />
            </div>
            <div className="space-y-1">
              <Label>Output-Sektionen</Label>
              <Textarea rows={3} value={outputs} onChange={(e) => setOutputs(e.target.value)} placeholder="Antwortbrief&#10;Gesprächsleitfaden Telefon&#10;Risikohinweise" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Risiken / Compliance-Hinweise (optional)</Label>
            <Textarea rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} placeholder="z.B. keine Preiszusagen, keine personenbezogenen Daten verarbeiten" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Einreichen & AI-Precheck starten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
