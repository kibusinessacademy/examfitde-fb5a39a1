import { Button } from "@/components/ui/button";

type Props = {
  headline: string;
  subline?: string;
  cta: string;
  onClick: () => void;
};

export function ConversionCard({ headline, subline, cta, onClick }: Props) {
  return (
    <div className="rounded-2xl border p-6 space-y-4 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="text-lg font-semibold">{headline}</div>
      {subline && (
        <div className="text-sm text-muted-foreground">{subline}</div>
      )}
      <Button onClick={onClick} className="w-full">
        {cta}
      </Button>
    </div>
  );
}
