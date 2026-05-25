import { ShieldCheck } from "lucide-react";
import {
  TRUST_PRESETS,
  trustSignals,
  type TrustPresetKey,
  type TrustSignalKind,
} from "@/lib/trust/signals";

interface Props {
  /** Curated preset key (preferred). */
  preset?: TrustPresetKey;
  /** Explicit signal kinds — overrides preset. */
  kinds?: readonly TrustSignalKind[];
  /** Optional eyebrow above the strip. */
  eyebrow?: string;
  className?: string;
}

/**
 * Trust-Signal-Band — wiederverwendbar auf Landing, Produkt, Tutor,
 * Simulation. Liest aus `@/lib/trust/signals` SSOT.
 */
export function TrustLayerStrip({
  preset = "landing",
  kinds,
  eyebrow = "Warum BerufOS dir vertrauen kann",
  className,
}: Props) {
  const list = trustSignals(kinds ?? TRUST_PRESETS[preset]);

  return (
    <section
      className={
        "rounded-2xl border border-border bg-surface-subtle p-5 sm:p-6 " +
        (className ?? "")
      }
      data-trust-preset={kinds ? undefined : preset}
      aria-label="Vertrauenssignale"
    >
      {eyebrow ? (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {list.map((s) => (
          <li
            key={s.kind}
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 p-3"
            data-trust-signal={s.kind}
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{s.label}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {s.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
