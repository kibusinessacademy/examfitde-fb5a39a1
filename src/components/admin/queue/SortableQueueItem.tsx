import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { GripVertical, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveTitle } from '@/hooks/useCanonicalTitles';

interface QueuePackage {
  id: string;
  title: string | null;
  status: string;
  priority: number;
  build_progress: number;
  created_at: string;
}

interface Props {
  pkg: QueuePackage;
  index: number;
  canonicalTitles?: Map<string, string>;
}

export default function SortableQueueItem({ pkg, index }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pkg.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-2.5 rounded-lg border bg-card transition-all",
        isDragging ? "shadow-lg border-primary/50 z-50 opacity-90" : "hover:border-primary/30"
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none"
        aria-label="Reihenfolge ändern"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Position indicator */}
      <span className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">
        #{index + 1}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{pkg.title || pkg.id.substring(0, 12)}</p>
        <p className="text-xs text-muted-foreground">
          {pkg.build_progress > 0 ? `${pkg.build_progress}% fertig · ` : ''}
          {new Date(pkg.created_at).toLocaleDateString('de-DE')}
        </p>
      </div>

      {/* Status */}
      <Badge variant="outline" className="text-xs shrink-0">
        {pkg.status === 'queued' ? 'Queued' : pkg.status}
      </Badge>

      {/* Link to detail */}
      <Link
        to={`/admin/studio/${pkg.id}`}
        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
