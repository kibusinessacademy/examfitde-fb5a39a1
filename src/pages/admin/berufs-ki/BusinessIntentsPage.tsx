import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listBusinessIntents,
  registerBusinessIntent,
  type BusinessIntent,
  type BusinessIntentRiskLevel,
  type BusinessIntentGovernanceLevel,
} from "@/lib/berufs-ki/outcome";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Target, AlertTriangle, Shield, Building2 } from "lucide-react";

const RISK_TONE: Record<BusinessIntentRiskLevel, string> = {
  low: "bg-status-success-subtle text-status-success-foreground",
  medium: "bg-status-warning-subtle text-status-warning-foreground",
  high: "bg-status-danger-subtle text-status-danger-foreground",
  critical: "bg-destructive text-destructive-foreground",
};

const GOV_TONE: Record<BusinessIntentGovernanceLevel, string> = {
  standard: "bg-muted text-muted-foreground",
  sensitive: "bg-status-warning-subtle text-status-warning-foreground",
  regulated: "bg-status-danger-subtle text-status-danger-foreground",
  board_approval: "bg-primary text-primary-foreground",
};

function IntentDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    intent_key: "",
    vertical_key: "",
    title: "",
    goal: "",
    monetary_impact_eur: "",
    risk_level: "medium" as BusinessIntentRiskLevel,
    governance_level: "standard" as BusinessIntentGovernanceLevel,
    desired_transformation: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      registerBusinessIntent({
        intent_key: form.intent_key.trim(),
        vertical_key: form.vertical_key.trim(),
        title: form.title.trim(),
        goal: form.goal.trim(),
        monetary_impact_eur: form.monetary_impact_eur ? Number(form.monetary_impact_eur) : null,
        risk_level: form.risk_level,
        governance_level: form.governance_level,
        desired_transformation: form.desired_transformation.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: "Business Intent registriert", description: form.intent_key });
      setOpen(false);
      setForm({ intent_key: "", vertical_key: "", title: "", goal: "", monetary_impact_eur: "",
        risk_level: "medium", governance_level: "standard", desired_transformation: "" });
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const valid = form.intent_key.length >= 3 && form.vertical_key && form.title && form.goal.trim().length >= 8;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Neues Business Intent</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Business Intent registrieren</DialogTitle>
          <CardDescription>"Warum existiert dieses Projekt?" — die SSOT-Frage, an die jedes Outcome-Bundle gebunden wird.</CardDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="intent_key">Intent Key *</Label>
              <Input id="intent_key" placeholder="z.B. buergerportal_hotline_reduktion"
                value={form.intent_key} onChange={(e) => setForm({ ...form, intent_key: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vertical_key">Vertical Key *</Label>
              <Input id="vertical_key" placeholder="z.B. public_administration"
                value={form.vertical_key} onChange={(e) => setForm({ ...form, vertical_key: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Titel *</Label>
            <Input id="title" placeholder="Kurztitel des Geschäftsziels"
              value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal">Geschäftsziel * (mind. 8 Zeichen)</Label>
            <Textarea id="goal" rows={3}
              placeholder="z.B. Hotline-Aufwand um 30% reduzieren, Antragsdauer halbieren, Bürgerzufriedenheit erhöhen."
              value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="monetary">Monetärer Impact (EUR)</Label>
              <Input id="monetary" type="number" placeholder="z.B. 250000"
                value={form.monetary_impact_eur} onChange={(e) => setForm({ ...form, monetary_impact_eur: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Risiko-Level</Label>
              <Select value={form.risk_level} onValueChange={(v: BusinessIntentRiskLevel) => setForm({ ...form, risk_level: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Governance-Level</Label>
              <Select value={form.governance_level} onValueChange={(v: BusinessIntentGovernanceLevel) => setForm({ ...form, governance_level: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="sensitive">Sensitive</SelectItem>
                  <SelectItem value="regulated">Regulated</SelectItem>
                  <SelectItem value="board_approval">Board Approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transform">Gewünschte Transformation</Label>
            <Textarea id="transform" rows={2}
              placeholder="z.B. Vom reaktiven Behördenkontakt zum proaktiven, self-service-orientierten Bürgerportal."
              value={form.desired_transformation} onChange={(e) => setForm({ ...form, desired_transformation: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Registriere…" : "Registrieren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntentCard({ intent }: { intent: BusinessIntent }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg truncate">{intent.title}</CardTitle>
            <CardDescription className="font-mono text-xs mt-1">{intent.intent_key}</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            <Badge className={RISK_TONE[intent.risk_level]} variant="secondary">
              <AlertTriangle className="mr-1 h-3 w-3" />{intent.risk_level}
            </Badge>
            <Badge className={GOV_TONE[intent.governance_level]} variant="secondary">
              <Shield className="mr-1 h-3 w-3" />{intent.governance_level}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="h-4 w-4" /><span className="font-mono">{intent.vertical_key}</span>
        </div>
        <p className="text-foreground leading-relaxed">{intent.goal}</p>
        {intent.desired_transformation && (
          <p className="text-muted-foreground italic border-l-2 border-border pl-3">{intent.desired_transformation}</p>
        )}
        <div className="flex flex-wrap gap-3 pt-2 border-t border-border text-xs">
          {intent.monetary_impact_eur !== null && (
            <span className="text-foreground">
              <strong>{new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(intent.monetary_impact_eur)}</strong>
              <span className="text-muted-foreground"> Impact</span>
            </span>
          )}
          <span className="text-muted-foreground">
            <Target className="inline h-3 w-3 mr-1" />{intent.linked_bundle_count} Bundle{intent.linked_bundle_count === 1 ? "" : "s"}
          </span>
          {intent.last_bundle_at && (
            <span className="text-muted-foreground">letzter Run: {new Date(intent.last_bundle_at).toLocaleDateString("de-DE")}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BusinessIntentsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["business-intents"],
    queryFn: () => listBusinessIntents(),
  });

  useEffect(() => { document.title = "Business Intents — BerufAgentOS"; }, []);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Business Intent Layer</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            SSOT-Schicht für "Warum existiert dieses Projekt?". Jedes Outcome-Bundle wird an ein Geschäftsziel mit KPI-Target,
            monetärer Wirkung und Governance-Level gebunden. Fundament für Continuous Intelligence und autonome Fix-Loops.
          </p>
        </div>
        <IntentDialog onCreated={() => qc.invalidateQueries({ queryKey: ["business-intents"] })} />
      </header>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">
            Fehler beim Laden: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="pt-10 pb-10 text-center space-y-3">
            <Target className="mx-auto h-10 w-10 text-muted-foreground" />
            <CardTitle className="text-lg">Noch keine Business Intents registriert</CardTitle>
            <CardDescription>
              Beginne mit einem klaren Geschäftsziel pro Vertical — Hotline-Reduktion, Compliance-Beschleunigung,
              Conversion-Hebel. Outcome-Bundles werden später an dieses Intent gebunden.
            </CardDescription>
          </CardContent>
        </Card>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((intent) => <IntentCard key={intent.id} intent={intent} />)}
        </div>
      )}
    </div>
  );
}
