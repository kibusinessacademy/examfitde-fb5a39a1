/**
 * Global UI handler for domain errors.
 * Maps DomainErrorCode → toast + optional navigation.
 */
import { parseDomainError } from "@/lib/domain-errors";

type NavigateFn = (to: string) => void;
type ToastFn = (opts: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => void;

export function handleDomainError(
  rawError: unknown,
  opts: { navigate: NavigateFn; toast: ToastFn },
): boolean {
  const err = parseDomainError(rawError);
  if (!err) return false;

  switch (err.code) {
    case "ACTIVE_PACKAGE_EXISTS": {
      const packageId = String(err.details?.existing_package_id ?? "");
      const title = String(err.details?.existing_title ?? "Bestehendes Paket");
      const status = String(err.details?.existing_status ?? "");

      opts.toast({
        title: "Aktives Paket existiert bereits",
        description: `${title}${status ? ` (${status})` : ""}`,
      });

      if (packageId) {
        opts.navigate(`/admin/studio/${packageId}`);
      }
      return true;
    }

    case "PACKAGE_NOT_FOUND":
    case "CURRICULUM_NOT_FOUND":
    case "CERTIFICATION_NOT_FOUND":
      opts.toast({ title: "Nicht gefunden", description: err.message, variant: "destructive" });
      return true;

    case "UNAUTHORIZED":
      opts.toast({ title: "Nicht angemeldet", description: err.message, variant: "destructive" });
      return true;

    case "FORBIDDEN":
      opts.toast({ title: "Keine Berechtigung", description: err.message, variant: "destructive" });
      return true;

    case "RATE_LIMITED":
      opts.toast({ title: "Zu viele Anfragen", description: err.message, variant: "destructive" });
      return true;

    case "INVALID_INPUT":
      opts.toast({ title: "Ungültige Eingabe", description: err.message, variant: "destructive" });
      return true;

    default:
      opts.toast({ title: "Vorgang fehlgeschlagen", description: err.message, variant: "destructive" });
      return true;
  }
}
