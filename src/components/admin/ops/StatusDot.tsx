import { cn } from "@/lib/utils";

export function StatusDot({ state }: { state: "green" | "yellow" | "red" | "gray" }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        state === "green" && "bg-emerald-500",
        state === "yellow" && "bg-amber-500",
        state === "red" && "bg-destructive",
        state === "gray" && "bg-muted-foreground/40",
      )}
    />
  );
}
