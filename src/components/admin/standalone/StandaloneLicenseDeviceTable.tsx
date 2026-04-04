import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LicenseDevice } from "@/hooks/useStandaloneLicenses";

interface Props {
  devices: LicenseDevice[];
  onRemove: (device: LicenseDevice) => void;
}

export function StandaloneLicenseDeviceTable({ devices, onRemove }: Props) {
  if (devices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Keine Geräte registriert.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fingerprint</TableHead>
          <TableHead>Erste Nutzung</TableHead>
          <TableHead>Letzte Nutzung</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {devices.map((dev) => (
          <TableRow key={dev.id}>
            <TableCell className="font-mono text-xs">
              {dev.device_fingerprint.slice(0, 12)}…
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {format(new Date(dev.first_seen_at), "dd.MM.yy HH:mm")}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {dev.last_seen_at
                ? format(new Date(dev.last_seen_at), "dd.MM.yy HH:mm")
                : "—"}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(dev)}
                title="Gerät entfernen"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
