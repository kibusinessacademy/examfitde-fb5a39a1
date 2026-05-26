import { useState } from "react";
import OrgConsoleShell from "@/components/org/OrgConsoleShell";
import {
  useOrgStructure,
  useUpsertSite,
  useUpsertCohort,
} from "@/hooks/useOrgStructure";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Users2, Layers, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

function StructureView({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { data, isLoading } = useOrgStructure(orgId);
  const siteUp = useUpsertSite(orgId);
  const cohortUp = useUpsertCohort(orgId);

  const [siteKey, setSiteKey] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteCity, setSiteCity] = useState("");

  const [cohortKey, setCohortKey] = useState("");
  const [cohortName, setCohortName] = useState("");
  const [cohortProf, setCohortProf] = useState("");
  const [cohortYear, setCohortYear] = useState<string>("");
  const [cohortExam, setCohortExam] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const scope = data?.scope;
  const sites = data?.sites ?? [];
  const departments = data?.departments ?? [];
  const cohorts = data?.cohorts ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Organisations-Struktur</h1>
        <p className="text-sm text-muted-foreground">
          Standorte, Fachbereiche und Ausbildungs-Kohorten für {orgName}. BK-Act-5.1 SSOT.
        </p>
        {scope && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">
              {scope.has_full_org_scope ? "Voller Org-Scope" : "Eingeschränkter Scope"}
            </Badge>
            {scope.scoped_roles.map((r) => (
              <Badge key={r} variant="outline">{r}</Badge>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Standorte
            </CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">{sites.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Fachbereiche
            </CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">{departments.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Users2 className="h-3.5 w-3.5" /> Kohorten
            </CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">{cohorts.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Sites */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Standorte
            </CardTitle>
            <CardDescription>Standorte definieren die regionale Berichtsebene.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {sites.length === 0 && (
                <li className="text-sm text-muted-foreground">Noch keine Standorte angelegt.</li>
              )}
              {sites.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-foreground">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.site_key}{s.city ? ` · ${s.city}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{s.country ?? "DE"}</Badge>
                </li>
              ))}
            </ul>

            <div className="space-y-2 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="sk" className="text-xs">site_key</Label>
                  <Input id="sk" value={siteKey} onChange={(e) => setSiteKey(e.target.value)} placeholder="z.B. nord" />
                </div>
                <div>
                  <Label htmlFor="sn" className="text-xs">Name</Label>
                  <Input id="sn" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Standort Nord" />
                </div>
              </div>
              <div>
                <Label htmlFor="sc" className="text-xs">Stadt</Label>
                <Input id="sc" value={siteCity} onChange={(e) => setSiteCity(e.target.value)} placeholder="Hamburg" />
              </div>
              <Button
                size="sm"
                disabled={!siteKey || !siteName || siteUp.isPending}
                onClick={async () => {
                  try {
                    await siteUp.mutateAsync({ siteKey, name: siteName, city: siteCity || undefined });
                    toast({ title: "Standort gespeichert" });
                    setSiteKey(""); setSiteName(""); setSiteCity("");
                  } catch (e: any) {
                    toast({ title: "Fehler", description: e.message, variant: "destructive" });
                  }
                }}
              >
                {siteUp.isPending ? "Speichern…" : "Standort hinzufügen"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cohorts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users2 className="h-4 w-4" /> Kohorten
            </CardTitle>
            <CardDescription>Ausbildungsjahrgänge und Prüfungswellen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {cohorts.length === 0 && (
                <li className="text-sm text-muted-foreground">Noch keine Kohorten angelegt.</li>
              )}
              {cohorts.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.profession_key ?? "—"}
                      {c.start_year ? ` · Start ${c.start_year}` : ""}
                      {c.exam_window ? ` · ${c.exam_window}` : ""}
                    </div>
                  </div>
                  {c.training_year && (
                    <Badge variant="outline" className="text-[10px]">LJ {c.training_year}</Badge>
                  )}
                </li>
              ))}
            </ul>

            <div className="space-y-2 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">cohort_key</Label>
                  <Input value={cohortKey} onChange={(e) => setCohortKey(e.target.value)} placeholder="fisi-2026" />
                </div>
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={cohortName} onChange={(e) => setCohortName(e.target.value)} placeholder="FISI Jahrgang 2026" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Beruf</Label>
                  <Input value={cohortProf} onChange={(e) => setCohortProf(e.target.value)} placeholder="fisi" />
                </div>
                <div>
                  <Label className="text-xs">Start-Jahr</Label>
                  <Input type="number" value={cohortYear} onChange={(e) => setCohortYear(e.target.value)} placeholder="2026" />
                </div>
                <div>
                  <Label className="text-xs">Prüfung</Label>
                  <Input value={cohortExam} onChange={(e) => setCohortExam(e.target.value)} placeholder="SOMMER_2028" />
                </div>
              </div>
              <Button
                size="sm"
                disabled={!cohortKey || !cohortName || cohortUp.isPending}
                onClick={async () => {
                  try {
                    await cohortUp.mutateAsync({
                      cohortKey,
                      name: cohortName,
                      professionKey: cohortProf || undefined,
                      startYear: cohortYear ? Number(cohortYear) : undefined,
                      examWindow: cohortExam || undefined,
                    });
                    toast({ title: "Kohorte gespeichert" });
                    setCohortKey(""); setCohortName(""); setCohortProf(""); setCohortYear(""); setCohortExam("");
                  } catch (e: any) {
                    toast({ title: "Fehler", description: e.message, variant: "destructive" });
                  }
                }}
              >
                {cohortUp.isPending ? "Speichern…" : "Kohorte hinzufügen"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OrgStructurePage() {
  return (
    <OrgConsoleShell>
      {({ orgId, orgName }) => <StructureView orgId={orgId} orgName={orgName} />}
    </OrgConsoleShell>
  );
}
