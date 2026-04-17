import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ACTION_LABEL, type ActionabilityClass, type RecommendedAction } from "./types";
import { Lock, Eye, AlertTriangle, Zap } from "lucide-react";

interface Props {
  action: RecommendedAction;
  actionability: ActionabilityClass;
  onClick?: () => void;
  disabled?: boolean;
  size?: "sm" | "default";
}

const VARIANT: Record<ActionabilityClass, "default" | "secondary" | "outline" | "destructive"> = {
  auto: "default",
  modal: "secondary",
  confirm: "destructive",
  observe: "outline",
};

const ICON: Record<ActionabilityClass, typeof Zap> = {
  auto: Zap,
  modal: AlertTriangle,
  confirm: Lock,
  observe: Eye,
};

export function RecommendedActionButton({
  action,
  actionability,
  onClick,
  disabled,
  size = "sm",
}: Props) {
  const Icon = ICON[actionability];
  const isObserve = actionability === "observe";

  return (
    <Button
      size={size}
      variant={VARIANT[actionability]}
      onClick={onClick}
      disabled={disabled || isObserve}
      className="gap-1.5"
      title={`Aktionsklasse: ${actionability}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{ACTION_LABEL[action]}</span>
    </Button>
  );
}

export function ActionabilityBadge({ value }: { value: ActionabilityClass }) {
  const tone =
    value === "auto"
      ? "bg-primary/10 text-primary border-primary/20"
      : value === "modal"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
        : value === "confirm"
          ? "bg-destructive/10 text-destructive border-destructive/20"
          : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {value}
    </Badge>
  );
}
