import { useState, useMemo } from "react";
import { Loader2, Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useStandaloneLicenses, type StandaloneLicense } from "@/hooks/useStandaloneLicenses";
import { StandaloneLicenseRiskCards } from "@/components/admin/standalone/StandaloneLicenseRiskCards";
import { StandaloneLicenseTable } from "@/components/admin/standalone/StandaloneLicenseTable";
import { StandaloneLicenseDetailSheet } from "@/components/admin/standalone/StandaloneLicenseDetailSheet";

export default function StandaloneLicensesPage() {
  const { data: licenses = [], isLoading } = useStandaloneLicenses();
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<StandaloneLicense | null>(null);

  const filtered = useMemo(() => {
    let result = licenses;

    if (riskFilter === "revoked") {
      result = result.filter((l) => ["revoked", "suspended"].includes(l.status));
    } else if (riskFilter) {
      result = result.filter((l) => l.risk_level === riskFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.email.toLowerCase().includes(q) ||
          l.course_title.toLowerCase().includes(q) ||
          l.license_id.toLowerCase().includes(q),
      );
    }

    return result;
  }, [licenses, riskFilter, search]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Key className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Standalone Lizenzen</h1>
        <span className="text-sm text-muted-foreground">
          {licenses.length} gesamt
        </span>
      </div>

      <StandaloneLicenseRiskCards
        licenses={licenses}
        onFilter={(level) => setRiskFilter((prev) => (prev === level ? null : level))}
      />

      <Input
        placeholder="Suche nach E-Mail, Kurs oder Lizenz-ID…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <StandaloneLicenseTable licenses={filtered} onSelect={setSelected} />

      <StandaloneLicenseDetailSheet
        license={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
