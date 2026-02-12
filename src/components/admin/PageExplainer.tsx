import { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkflowStep {
  label: string;
  active?: boolean;
}

interface PageExplainerProps {
  title: string;
  description: string;
  actions?: string[];
  workflow?: WorkflowStep[];
  tips?: string[];
}

export default function PageExplainer({ title, description, actions, workflow, tips }: PageExplainerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Info className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

          {workflow && workflow.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Workflow-Position</p>
              <div className="flex items-center gap-0 overflow-x-auto pb-1">
                {workflow.map((step, i) => (
                  <div key={step.label} className="flex items-center shrink-0">
                    <div className={cn(
                      "px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap",
                      step.active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {step.label}
                    </div>
                    {i < workflow.length - 1 && (
                      <div className="w-3 h-px bg-border shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {actions && actions.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Was du hier tun kannst</p>
              <ul className="space-y-1">
                {actions.map((action, i) => (
                  <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tips && tips.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Tipps</p>
              <ul className="space-y-1">
                {tips.map((tip, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-warning mt-0.5">💡</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
