import { ShieldAlert, ShieldCheck, AlertTriangle, Ban } from "lucide-react";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import type { StandaloneLicense } from "@/hooks/useStandaloneLicenses";

interface Props {
  licenses: StandaloneLicense[];
  onFilter: (level: string | null) => void;
}

export function StandaloneLicenseRiskCards({ licenses, onFilter }: Props) {
  const active = licenses.filter((l) => l.status === "active" && l.risk_level === "ok").length;
  const warning = licenses.filter((l) => l.risk_level === "warning").length;
  const critical = licenses.filter((l) => l.risk_level === "critical").length;
  const revoked = licenses.filter((l) => ["revoked", "suspended"].includes(l.status)).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        label="Aktiv"
        value={active}
        icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
        onClick={() => onFilter("ok")}
      />
      <KpiCard
        label="Warnung"
        value={warning}
        hint="Gerätelimit erreicht"
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        onClick={() => onFilter("warning")}
      />
      <KpiCard
        label="Kritisch"
        value={critical}
        hint="Limit überschritten / abgelaufen"
        icon={<ShieldAlert className="h-4 w-4 text-destructive" />}
        onClick={() => onFilter("critical")}
      />
      <KpiCard
        label="Gesperrt"
        value={revoked}
        icon={<Ban className="h-4 w-4 text-muted-foreground" />}
        onClick={() => onFilter("revoked")}
      />
    </div>
  );
}
