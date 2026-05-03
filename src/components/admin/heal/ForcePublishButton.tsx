import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Rocket, Loader2 } from "lucide-react";

interface Props {
  packageId: string;
  packageTitle?: string | null;
  status?: string | null;
  buildProgress?: number | null;
  size?: "sm" | "default";
}

/**
 * Admin-Action: Force-Publish — bypasst Pipeline-Tail (run_integrity_check, quality_council, auto_publish)
 * und published das Paket sofort. Cancelled offene Jobs. Nur für Admins (RPC enforced has_role).
 */
export function ForcePublishButton({ packageId, packageTitle, status, buildProgress, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("manual_force_publish");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("admin_force_publish_package" as never, {
        p_package_id: packageId,
        p_reason: reason || "manual_force_publish",
      } as never);
      if (error) throw error;
      const res = data as { ok: boolean; cancelled_jobs?: number; already_published?: boolean; error?: string };
      if (!res?.ok) throw new Error(res?.error ?? "force-publish failed");
      toast({
        title: res.already_published ? "Bereits published" : "Force-Published",
        description: res.already_published
          ? `${packageTitle ?? packageId} war bereits published.`
          : `${packageTitle ?? packageId} ist live. ${res.cancelled_jobs ?? 0} Jobs gecancelt.`,
      });
      qc.invalidateQueries({ queryKey: ["heal-cockpit"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
      setOpen(false);
    } catch (e) {
      toast({
        title: "Force-Publish fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size={size} variant="outline" className="gap-1">
          <Rocket className="h-3.5 w-3.5" /> Force-Publish
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Force-Publish bestätigen</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                <strong>{packageTitle ?? packageId}</strong>
                <br />
                Status: <code>{status ?? "?"}</code> · Progress: <code>{buildProgress ?? "?"}</code>
              </p>
              <p className="text-sm text-muted-foreground">
                Diese Aktion bypasst den restlichen Pipeline-Tail (Integrity / Quality-Council / Auto-Publish),
                cancelled offene Jobs und setzt das Paket sofort auf <code>published</code>. Nur verwenden
                wenn manuell verifiziert wurde, dass das Paket release-ready ist.
              </p>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Begründung (für Audit-Log)"
                rows={2}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); handleConfirm(); }} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Force-Publish"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
