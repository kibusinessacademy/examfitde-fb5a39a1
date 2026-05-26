/**
 * Kündigungsfrist-Rechner — interaktive Komponente.
 * Pure UI, ruft die SSOT-Engine. Keine Server-Calls.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateDeadline } from "@/lib/hr/deadline-engine";
import type { ContractType, EmploymentRole } from "@/lib/hr/deadline-rules";

interface Props {
  presetRole?: EmploymentRole;
  presetContract?: ContractType;
  presetTenureMonths?: number;
  onLead?: () => void;
}

function isoToday(offsetMonths = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 10);
}

export function KuendigungsfristCalculator({
  presetRole = "arbeitgeber",
  presetContract = "unbefristet",
  presetTenureMonths,
  onLead,
}: Props) {
  const [role, setRole] = useState<EmploymentRole>(presetRole);
  const [contract, setContract] = useState<ContractType>(presetContract);
  const [startDate, setStartDate] = useState<string>(isoToday(-(presetTenureMonths ?? 12)));
  const [noticeDate, setNoticeDate] = useState<string>(isoToday(0));

  const result = useMemo(() => {
    try {
      return calculateDeadline({ role, contract, startDate, noticeDate });
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [role, contract, startDate, noticeDate]);

  return (
    <Card className="border-2">
      <CardContent className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Rolle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as EmploymentRole)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="arbeitgeber">Arbeitgeber kündigt</SelectItem>
                <SelectItem value="arbeitnehmer">Arbeitnehmer kündigt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vertragsart</Label>
            <Select value={contract} onValueChange={(v) => setContract(v as ContractType)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unbefristet">Unbefristetes Arbeitsverhältnis</SelectItem>
                <SelectItem value="probezeit">Probezeit (Arbeitsverhältnis)</SelectItem>
                <SelectItem value="ausbildung_probezeit">Ausbildung — Probezeit</SelectItem>
                <SelectItem value="ausbildung_nach_probezeit">Ausbildung — nach Probezeit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="startDate">Beschäftigungsbeginn</Label>
            <Input id="startDate" type="date" className="mt-1.5" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="noticeDate">Zugang der Kündigung</Label>
            <Input id="noticeDate" type="date" className="mt-1.5" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-5">
          {"error" in result ? (
            <div className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <p className="text-sm">{result.error}</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Kündigung möglich zum</p>
                  <p className="mt-1 text-3xl font-bold">{result.endDateFormatted}</p>
                </div>
                <Badge variant="outline" className="font-mono text-xs">{result.rule.legalReference}</Badge>
              </div>

              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between"><dt className="text-muted-foreground">Gesetzliche Frist</dt><dd className="font-medium">{result.durationLabel} {result.targetLabel}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Betriebszugehörigkeit</dt><dd className="font-medium">{Math.max(0, result.tenureMonths)} Monate</dd></div>
              </dl>

              <div className="mt-4 rounded-md bg-background p-3 text-sm">
                <div className="flex items-center gap-2 font-medium"><Info className="h-3.5 w-3.5" /> Rechtsgrundlage</div>
                <p className="mt-1 text-muted-foreground">{result.rule.notes}</p>
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wichtig zu prüfen</p>
                {result.warnings.map((w) => (
                  <div key={w.code} className="flex items-start gap-2 rounded-md border bg-card p-2.5 text-sm">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning" />
                    <div>
                      <p className="font-medium">{w.label}</p>
                      <p className="text-muted-foreground text-xs">{w.body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Button onClick={onLead} className="w-full">
                  <FileText className="mr-2 h-4 w-4" /> Ergebnis als PDF (Lead)
                </Button>
                <Button variant="outline" onClick={onLead} className="w-full">
                  <ShieldCheck className="mr-2 h-4 w-4" /> Kündigungsschreiben erstellen
                </Button>
              </div>

              <p className="mt-4 text-[10px] text-muted-foreground">
                Ruleset {result.rulesetVersion} · Deterministisch · Keine Rechtsberatung im Einzelfall.
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
