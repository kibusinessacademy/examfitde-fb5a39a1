import { Link } from "react-router-dom";
import { Briefcase, ChevronRight } from "lucide-react";
import { useActiveCourse } from "@/contexts/ActiveCourseContext";

/**
 * BerufIdentityChip — sichtbarer Identity-Token: das System kennt deinen Beruf.
 *
 * Klein, ruhig, immer klickbar. Default-Ziel: /berufe (Auswahl/Wechsel).
 * Konsumiert ActiveCourseContext; fällt auf "Beruf wählen" zurück, wenn keiner
 * gewählt ist.
 */

function useSafeActive() {
  try {
    return useActiveCourse();
  } catch {
    return { active: null } as { active: { title?: string | null } | null };
  }
}

export function BerufIdentityChip({ to = "/berufe" }: { to?: string } = {}) {
  const { active } = useSafeActive();
  const label = active?.title ?? "Beruf wählen";

  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Aktiver Beruf: ${label}. Wechseln`}
    >
      <Briefcase className="h-3.5 w-3.5 text-primary" aria-hidden />
      <span className="truncate max-w-[180px]">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
    </Link>
  );
}
