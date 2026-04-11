import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

interface TrustItem {
  label: string;
  icon?: string;
}

interface Props {
  content: { items?: TrustItem[] };
  onChange: (content: { items: TrustItem[] }) => void;
}

export function TrustBarBlockEditor({ content, onChange }: Props) {
  const items = content.items ?? [];

  const updateItem = (idx: number, value: string) => {
    const updated = items.map((item, i) => i === idx ? { ...item, label: value } : item);
    onChange({ items: updated });
  };

  const addItem = () => {
    onChange({ items: [...items, { label: '', icon: 'check' }] });
  };

  const removeItem = (idx: number) => {
    onChange({ items: items.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            value={item.label}
            onChange={(e) => updateItem(idx, e.target.value)}
            className="text-xs h-8 flex-1"
            placeholder="z. B. IHK-konform"
          />
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeItem(idx)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="text-xs h-7" onClick={addItem}>
        <Plus className="h-3 w-3 mr-1" />Trust-Element hinzufügen
      </Button>
    </div>
  );
}
