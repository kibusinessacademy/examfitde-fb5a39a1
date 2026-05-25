import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { OS_TONE } from "@/lib/os/os-copy";

/**
 * AnticipationCard — eine Aussage, eine Aktion. Kein Status-Label.
 *
 * Wird auf /app, optional im Hero und im Pruefungscheck-Briefing eingesetzt.
 * Beginnt mit einer System-Stimme ("Mein Vorschlag", "Mir fällt auf"), nicht
 * mit Status. Eine einzige primäre Aktion — nichts daneben.
 */

type InsightKind = keyof typeof OS_TONE.insight;

export interface AnticipationCardProps {
  kind?: InsightKind;
  /** Optional: ersetzt das Default-Eyebrow ("Mein Vorschlag" / "Mir fällt auf" …). */
  eyebrow?: string;
  /** Hauptaussage — eine Zeile, persönlich, in System-Ich-Form bevorzugt. */
  statement: string;
  /** Optionaler 1-Satz-Zusatz. */
  detail?: string;
  /** Primäre Aktion — entweder Link oder onClick. */
  action: {
    label: string;
    to?: string;
    onClick?: () => void;
  };
  /** Optionales Icon links neben dem Eyebrow. */
  icon?: React.ReactNode;
}

export function AnticipationCard({
  kind = "suggest",
  eyebrow,
  statement,
  detail,
  action,
  icon,
}: AnticipationCardProps) {
  const ey = eyebrow ?? OS_TONE.insight[kind];

  const content = (
    <>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
        {icon}
        {ey}
      </span>
      <p className="mt-2 text-base font-medium leading-snug text-foreground sm:text-lg">
        {statement}
      </p>
      {detail && (
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{detail}</p>
      )}
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:gap-2 transition-all">
        {action.label}
        <ArrowRight className="h-4 w-4" />
      </span>
    </>
  );

  const baseCls =
    "group block rounded-2xl border border-border/60 bg-card/80 p-5 text-left shadow-sm backdrop-blur transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  if (action.to) {
    return (
      <Link to={action.to} className={baseCls}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={`${baseCls} w-full`}>
      {content}
    </button>
  );
}
