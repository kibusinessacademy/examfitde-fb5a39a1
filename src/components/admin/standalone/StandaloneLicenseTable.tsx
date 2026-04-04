import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StandaloneLicense } from "@/hooks/useStandaloneLicenses";

interface Props {
  licenses: StandaloneLicense[];
  onSelect: (license: StandaloneLicense) => void;
}

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  revoked: "bg-destructive/15 text-destructive border-destructive/30",
  suspended: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  expired: "bg-muted text-muted-foreground border-border",
};

const riskColor: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
};

export function StandaloneLicenseTable({ licenses, onSelect }: Props) {
  if (licenses.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Keine Lizenzen gefunden.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>E-Mail</TableHead>
            <TableHead>Kurs</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-center">Geräte</TableHead>
            <TableHead>Risiko</TableHead>
            <TableHead>Letzte Validierung</TableHead>
            <TableHead>Ablauf</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {licenses.map((lic) => (
            <TableRow
              key={lic.id}
              className="cursor-pointer"
              onClick={() => onSelect(lic)}
            >
              <TableCell className="font-medium">{lic.email}</TableCell>
              <TableCell className="max-w-[200px] truncate text-muted-foreground">
                {lic.course_title}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={statusColor[lic.status] ?? ""}>
                  {lic.status}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                {lic.device_count}/{lic.device_limit}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={riskColor[lic.risk_level] ?? ""}>
                  {lic.risk_level}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {lic.last_validated_at
                  ? format(new Date(lic.last_validated_at), "dd.MM.yy HH:mm")
                  : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {format(new Date(lic.expires_at), "dd.MM.yy")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
