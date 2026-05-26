import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CompanyProfile, ProgramTopic, Region, CompanySize } from "@/lib/foerdermittel/types";
import { REGION_LABEL, SIZE_LABEL } from "@/lib/foerdermittel/matching";

const TOPICS: { key: ProgramTopic; label: string }[] = [
  { key: "digitalisierung", label: "Digitalisierung" },
  { key: "ki", label: "KI" },
  { key: "weiterbildung", label: "Weiterbildung" },
  { key: "ausbildung", label: "Ausbildung" },
  { key: "energie", label: "Energie" },
  { key: "nachhaltigkeit", label: "Nachhaltigkeit" },
  { key: "innovation", label: "Innovation / F&E" },
  { key: "gruendung", label: "Gründung" },
  { key: "personal", label: "Personal" },
];

const REGIONS: Region[] = [
  "DE", "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV",
  "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
];

const SIZES: CompanySize[] = ["solo", "micro", "small", "medium", "large"];

export function MatchingWizard({
  initial,
  onSubmit,
}: {
  initial?: Partial<CompanyProfile>;
  onSubmit: (profile: CompanyProfile) => void;
}) {
  const [region, setRegion] = useState<Region>(initial?.region ?? "DE");
  const [size, setSize] = useState<CompanySize>(initial?.size ?? "small");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [employees, setEmployees] = useState<string>(initial?.employees?.toString() ?? "");
  const [topics, setTopics] = useState<ProgramTopic[]>(initial?.topics ?? ["digitalisierung"]);

  const toggleTopic = (t: ProgramTopic) => {
    setTopics((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Region</Label>
            <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>{REGION_LABEL[r] ?? r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Unternehmensgröße</Label>
            <Select value={size} onValueChange={(v) => setSize(v as CompanySize)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SIZES.map((s) => (
                  <SelectItem key={s} value={s}>{SIZE_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employees">Mitarbeitende</Label>
            <Input
              id="employees"
              inputMode="numeric"
              value={employees}
              onChange={(e) => setEmployees(e.target.value.replace(/\D/g, ""))}
              placeholder="z. B. 24"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="industry">Branche (optional)</Label>
          <Input
            id="industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="z. B. IT-Dienstleistung, Maschinenbau, Handwerk"
          />
        </div>

        <div className="space-y-2">
          <Label>Förderziele (mehrere möglich)</Label>
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t) => {
              const active = topics.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleTopic(t.key)}
                  className={`px-3 py-1.5 rounded-full border text-sm transition ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {topics.length === 0 && (
            <Badge variant="outline" className="text-xs">Mind. ein Ziel auswählen</Badge>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button
            disabled={topics.length === 0}
            onClick={() =>
              onSubmit({
                region,
                size,
                industry: industry || undefined,
                employees: employees ? Number(employees) : undefined,
                topics,
              })
            }
          >
            Förderungen finden
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
