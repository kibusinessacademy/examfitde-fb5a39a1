import { ADMIN_GLOSSARY } from '@/admin/adminGlossary';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface GlossaryTermProps {
  /** Key into ADMIN_GLOSSARY */
  term: string;
  /** Override display text (default: German label from glossary) */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Inline glossary tooltip — shows German label with English term + explanation on hover.
 * 
 * Usage: <GlossaryTerm term="quality_gate" /> → "Qualitätssperre" with tooltip
 * Usage: <GlossaryTerm term="pipeline">Ablauf</GlossaryTerm> → custom text with tooltip
 */
export default function GlossaryTerm({ term, children, className }: GlossaryTermProps) {
  const entry = ADMIN_GLOSSARY[term];
  if (!entry) return <span className={className}>{children ?? term}</span>;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'border-b border-dotted border-muted-foreground/40 cursor-help',
              className,
            )}
          >
            {children ?? entry.de}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-medium">{entry.de} <span className="text-muted-foreground">({entry.en})</span></p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{entry.desc}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
