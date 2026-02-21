import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export function MiniKPI({ label, value, sub, alert: isAlert }: { label: string; value: any; sub?: string; alert?: boolean }) {
  return (
    <Card className={cn(isAlert && "border-destructive/50")}>
      <CardContent className="py-3 px-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-xl font-bold mt-1", isAlert ? "text-destructive" : "text-foreground")}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
