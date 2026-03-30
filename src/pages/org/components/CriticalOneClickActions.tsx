import { Button } from "@/components/ui/button";
import { Mail, BookOpen, Bell } from "lucide-react";
import { toast } from "sonner";
import type { OrgPerformanceRow } from "@/hooks/useOrgPerformance";
import { useScanOrgInterventions } from "@/hooks/useOrgInterventions";

interface Props {
  row: OrgPerformanceRow;
  organizationId: string;
}

export default function CriticalOneClickActions({ row, organizationId }: Props) {
  const scanMutation = useScanOrgInterventions();

  const handleContact = () => {
    toast.info(`Nachricht an ${row.display_name} wird vorbereitet…`);
  };

  const handleReminder = () => {
    scanMutation.mutate(
      { orgId: organizationId, productId: row.product_id },
      {
        onSuccess: (res) => {
          if (res.interventions_created > 0) {
            toast.success(`${res.interventions_created} Intervention(en) für ${row.display_name} erstellt`);
          } else {
            toast.info("Keine neuen Interventionen notwendig (Cooldown aktiv)");
          }
        },
        onError: () => toast.error("Intervention konnte nicht erstellt werden"),
      }
    );
  };

  return (
    <div className="flex gap-1.5 pt-1">
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleContact}>
        <Mail className="h-3 w-3" />
        Kontaktieren
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleReminder}>
        <Bell className="h-3 w-3" />
        Erinnerung
      </Button>
    </div>
  );
}
