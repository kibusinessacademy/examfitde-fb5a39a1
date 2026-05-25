/**
 * Berufs-KI Dokumenten-Agent — Studio (Phase 1 Foundation).
 * 3-Spalten: Templates → Inputs+Branding → Ergebnis mit Compliance.
 */
import { useEffect, useMemo, useState } from "react";
import {
  listTemplates, listMyProfiles, upsertMyProfile, runDocument, exportRun,
} from "@/lib/document-agent/api";
import type { DocTemplate, DocProfile, DocRunResult } from "@/lib/document-agent/types";
import type { LayoutTemplate } from "@/lib/document-agent/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, FileText, ShieldCheck, Sparkles, Building2, FileDown, Loader2 } from "lucide-react";

const LAYOUT_OPTIONS: Array<{ value: LayoutTemplate; label: string }> = [
  { value: "modern_corporate", label: "Modern Corporate" },
  { value: "minimal_professional", label: "Minimal Professional" },
  { value: "legal_style", label: "Legal Style" },
  { value: "enterprise_clean", label: "Enterprise Clean" },
  { value: "friendly_business", label: "Friendly Business" },
];

const RISK_BADGE: Record<string, string> = {
  low: "bg-status-bg-subtle-success text-status-fg-success",
  medium: "bg-status-bg-subtle-warning text-status-fg-warning",
  high: "bg-status-bg-subtle-danger text-status-fg-danger",
};

export default function BerufsKIDocumentsPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [profiles, setProfiles] = useState<DocProfile[]>([]);
  const [selected, setSelected] = useState<DocTemplate | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DocRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [newProfile, setNewProfile] = useState({
    company_name: "", default_sender_name: "", default_sender_role: "",
    address: "", contact_email: "", phone: "", website: "", default_signature: "",
    vat_id: "", disclaimer_text: "", layout_template: "modern_corporate" as LayoutTemplate,
    brand_primary: "#1E40AF",
  });

  useEffect(() => {
    (async () => {
      try {
        const [t, p] = await Promise.all([listTemplates(), listMyProfiles()]);
        setTemplates(t);
        setProfiles(p);
        if (p.length && !profileId) setProfileId(p[0].id);
      } catch (e) {
        toast({ title: "Laden fehlgeschlagen", description: (e as Error).message, variant: "destructive" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, DocTemplate[]>();
    for (const t of templates) {
      const arr = m.get(t.category) ?? [];
      arr.push(t); m.set(t.category, arr);
    }
    return Array.from(m.entries());
  }, [templates]);

  const allFields = useMemo(
    () => selected ? [...selected.required_inputs, ...selected.optional_inputs] : [],
    [selected],
  );

  function pickTemplate(t: DocTemplate) {
    setSelected(t); setInputs({}); setResult(null);
  }

  async function saveProfile() {
    if (!newProfile.company_name.trim()) {
      toast({ title: "Unternehmensname erforderlich", variant: "destructive" }); return;
    }
    try {
      const id = await upsertMyProfile({
        ...newProfile,
        brand_colors: { primary: newProfile.brand_primary },
      });
      const ps = await listMyProfiles();
      setProfiles(ps); setProfileId(id); setShowProfileForm(false);
      toast({ title: "Branding-Profil gespeichert" });
    } catch (e) {
      toast({ title: "Speichern fehlgeschlagen", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function run() {
    if (!selected) return;
    setLoading(true); setResult(null);
    try {
      const r = await runDocument(selected.slug, inputs, { profile_id: profileId });
      setResult(r);
      toast({
        title: r.review_required ? "Entwurf erstellt — Review erforderlich" : "Dokument erstellt",
        description: r.compliance_warnings.length ? `${r.compliance_warnings.length} Compliance-Hinweis(e)` : undefined,
      });
    } catch (e) {
      const err = e as Error & { code?: string; missing?: Array<{ key: string; label: string }> };
      if (err.code === "missing_inputs" && err.missing) {
        toast({
          title: "Pflichtfelder fehlen",
          description: err.missing.map((m) => m.label).join(", "),
          variant: "destructive",
        });
      } else {
        toast({ title: "Erstellung fehlgeschlagen", description: err.message, variant: "destructive" });
      }
    } finally { setLoading(false); }
  }

  async function doExport(format: "pdf" | "docx") {
    if (!result) return;
    setExporting(format);
    try {
      const exp = await exportRun(result.run_id, format);
      if (exp.signed_url) {
        const a = document.createElement("a");
        a.href = exp.signed_url;
        a.download = exp.filename;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      }
      toast({
        title: `${format.toUpperCase()} exportiert`,
        description: `Hash ${exp.export_hash.slice(0, 10)}… · ${(exp.byte_size / 1024).toFixed(1)} KB`,
      });
    } catch (e) {
      toast({ title: "Export fehlgeschlagen", description: (e as Error).message, variant: "destructive" });
    } finally { setExporting(null); }
  }


  return (
    <div className="container max-w-screen-2xl py-6 space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Berufs-KI Dokumenten-Studio
          </h1>
          <p className="text-sm text-muted-foreground">
            Berufsbezogene Dokumente mit Branding, Compliance-Hinweisen und Review-Workflow.
            Reviewfähig — niemals als „rechtssicher" garantiert.
          </p>
        </div>
      </header>

      <div className="grid lg:grid-cols-[300px,1fr,1fr] gap-4">
        {/* Templates */}
        <Card className="lg:max-h-[calc(100vh-180px)] flex flex-col">
          <CardHeader className="pb-3"><CardTitle className="text-base">Dokumenttypen</CardTitle></CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-4">
              {grouped.map(([cat, items]) => (
                <div key={cat}>
                  <div className="text-xs uppercase text-muted-foreground mb-2">{cat}</div>
                  <div className="space-y-2">
                    {items.map((t) => (
                      <button key={t.id} onClick={() => pickTemplate(t)}
                        className={`w-full text-left p-3 rounded-md border transition-colors ${
                          selected?.id === t.id ? "border-primary bg-accent" : "border-border hover:bg-muted/50"
                        }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-sm">{t.title}</div>
                          <Badge variant="outline" className={`text-xs ${RISK_BADGE[t.risk_level]}`}>
                            {t.risk_level}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</div>
                        {t.review_required && (
                          <div className="text-xs text-status-fg-warning mt-1 flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" /> Reviewpflicht
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </ScrollArea>
        </Card>

        {/* Assistant + Branding */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Branding-Profil
              </CardTitle>
              <CardDescription>Wird automatisch in das Dokument eingebunden.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {profiles.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {profiles.map((p) => (
                    <button key={p.id} onClick={() => setProfileId(p.id)}
                      className={`px-3 py-1.5 rounded-md text-sm border ${
                        profileId === p.id ? "border-primary bg-accent" : "border-border"
                      }`}>{p.company_name}</button>
                  ))}
                </div>
              )}
              {!showProfileForm ? (
                <Button variant="outline" size="sm" onClick={() => setShowProfileForm(true)}>
                  {profiles.length ? "Neues Profil" : "Profil anlegen"}
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Unternehmensname *" value={newProfile.company_name}
                    onChange={(e) => setNewProfile({ ...newProfile, company_name: e.target.value })} />
                  <Input placeholder="Absender (Name)" value={newProfile.default_sender_name}
                    onChange={(e) => setNewProfile({ ...newProfile, default_sender_name: e.target.value })} />
                  <Input placeholder="Rolle" value={newProfile.default_sender_role}
                    onChange={(e) => setNewProfile({ ...newProfile, default_sender_role: e.target.value })} />
                  <Input placeholder="E-Mail" value={newProfile.contact_email}
                    onChange={(e) => setNewProfile({ ...newProfile, contact_email: e.target.value })} />
                  <Input placeholder="Telefon" value={newProfile.phone}
                    onChange={(e) => setNewProfile({ ...newProfile, phone: e.target.value })} />
                  <Input placeholder="Website" value={newProfile.website}
                    onChange={(e) => setNewProfile({ ...newProfile, website: e.target.value })} />

                  <Textarea className="col-span-2" placeholder="Adresse" value={newProfile.address}
                    onChange={(e) => setNewProfile({ ...newProfile, address: e.target.value })} />
                  <Textarea className="col-span-2" placeholder="Signatur" value={newProfile.default_signature}
                    onChange={(e) => setNewProfile({ ...newProfile, default_signature: e.target.value })} />
                  <div className="col-span-2 flex gap-2">
                    <Button size="sm" onClick={saveProfile}>Speichern</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowProfileForm(false)}>Abbrechen</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {selected ? selected.title : "Dokumenttyp wählen"}
              </CardTitle>
              {selected && <CardDescription>{selected.description}</CardDescription>}
            </CardHeader>
            {selected && (
              <CardContent className="space-y-3">
                {allFields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={f.key}>
                      {f.label}{f.required !== false ? " *" : ""}
                    </Label>
                    {f.type === "textarea" ? (
                      <Textarea id={f.key} placeholder={f.placeholder} value={inputs[f.key] ?? ""}
                        onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })} rows={4} />
                    ) : (
                      <Input id={f.key} placeholder={f.placeholder} value={inputs[f.key] ?? ""}
                        onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })} />
                    )}
                    {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                  </div>
                ))}
                <Separator />
                <Button onClick={run} disabled={loading} className="w-full">
                  {loading ? "Erzeugt Entwurf…" : "Dokument erzeugen"}
                </Button>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Result */}
        <Card className="lg:max-h-[calc(100vh-180px)] flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ergebnis</CardTitle>
            {result && (
              <div className="flex gap-2 flex-wrap mt-2">
                <Badge variant={result.review_required ? "destructive" : "secondary"}>
                  {result.review_required ? "Reviewpflicht" : "Entwurf"}
                </Badge>
                <Badge variant="outline">Qualität {(result.quality_score * 100).toFixed(0)}%</Badge>
                <Badge variant="outline" className="text-xs">{result.model_used}</Badge>
              </div>
            )}
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-3">
              {!result && (
                <p className="text-sm text-muted-foreground">
                  Dokument-Vorschau erscheint hier nach der Erzeugung.
                </p>
              )}
              {result && result.compliance_warnings.length > 0 && (
                <div className="space-y-2">
                  {result.compliance_warnings.map((w, i) => (
                    <div key={i} className="flex gap-2 p-3 rounded-md bg-status-bg-subtle-warning text-status-fg-warning text-sm">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div><div className="font-medium text-xs uppercase">{w.code}</div>{w.message}</div>
                    </div>
                  ))}
                </div>
              )}
              {result && (
                <>
                  <pre className="whitespace-pre-wrap text-sm font-sans bg-muted/30 p-4 rounded-md border">
                    {result.generated_document}
                  </pre>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline"
                      onClick={() => { navigator.clipboard.writeText(result.generated_document); toast({ title: "Kopiert" }); }}>
                      Kopieren
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground border-t pt-3">
                    Dieses Dokument ist berufsbezogen, strukturiert und reviewfähig erstellt.
                    Bei rechtlich verbindlicher Nutzung ist eine fachliche oder juristische Prüfung erforderlich.
                  </p>
                </>
              )}
            </CardContent>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
