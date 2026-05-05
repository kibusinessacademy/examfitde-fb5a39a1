/**
 * CopyButton — universal one-click copy for IDs, errors, SQL snippets, JSON bundles.
 * Variants:
 *  - "icon" (default): tiny icon-only, inline neben IDs.
 *  - "chip": Badge-Style, zeigt Label + Icon.
 *  - "button": volles Button mit Label.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Variant = "icon" | "chip" | "button";

interface Props {
  value: string | (() => string | Promise<string>);
  label?: string;
  toastLabel?: string;
  variant?: Variant;
  className?: string;
  title?: string;
}

export function CopyButton({ value, label, toastLabel, variant = "icon", className, title }: Props) {
  const [copied, setCopied] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const v = typeof value === "function" ? await value() : value;
      await navigator.clipboard.writeText(v);
      setCopied(true);
      toast.success(toastLabel ?? "Kopiert", { description: v.length > 80 ? v.slice(0, 80) + "…" : v, duration: 1500 });
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Konnte nicht kopieren");
    }
  };

  const Icon = copied ? Check : Copy;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handle}
        title={title ?? "Kopieren"}
        className={cn(
          "inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition",
          copied && "text-success",
          className,
        )}
      >
        <Icon className="h-3 w-3" />
      </button>
    );
  }
  if (variant === "chip") {
    return (
      <button
        type="button"
        onClick={handle}
        title={title ?? "Kopieren"}
        className={cn(
          "inline-flex items-center gap-1 h-6 px-2 rounded-full border border-border text-[10px] font-mono hover:bg-muted text-muted-foreground hover:text-foreground transition",
          copied && "border-success text-success",
          className,
        )}
      >
        <Icon className="h-3 w-3" />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={handle}
      title={title ?? "Kopieren"}
      className={cn(
        "inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border text-xs hover:bg-muted transition",
        copied && "border-success text-success",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label ?? "Kopieren"}
    </button>
  );
}

/** Kürzt eine UUID auf "ab12…cd34" für die Anzeige. */
export function shortId(id: string | null | undefined, head = 6, tail = 4): string {
  if (!id) return "—";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/**
 * IdChip — Anzeige einer ID + Copy-Button in einer Zeile.
 */
export function IdChip({ id, label }: { id: string | null | undefined; label?: string }) {
  if (!id) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      {label && <span className="text-muted-foreground">{label}:</span>}
      <span title={id}>{shortId(id)}</span>
      <CopyButton value={id} toastLabel={`${label ?? "ID"} kopiert`} />
    </span>
  );
}
