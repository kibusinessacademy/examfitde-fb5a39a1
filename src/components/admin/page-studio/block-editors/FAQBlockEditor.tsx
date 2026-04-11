import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
}

interface Props {
  content: { items?: FAQItem[] };
  onChange: (content: { items: FAQItem[] }) => void;
}

export function FAQBlockEditor({ content, onChange }: Props) {
  const items = content.items ?? [];

  const updateItem = (idx: number, field: keyof FAQItem, value: string) => {
    const updated = items.map((item, i) => i === idx ? { ...item, [field]: value } : item);
    onChange({ items: updated });
  };

  const addItem = () => {
    onChange({ items: [...items, { question: '', answer: '' }] });
  };

  const removeItem = (idx: number) => {
    onChange({ items: items.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={idx} className="space-y-1.5 p-2 rounded border border-border bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-muted-foreground">Frage {idx + 1}</Label>
            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => removeItem(idx)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Input
            value={item.question}
            onChange={(e) => updateItem(idx, 'question', e.target.value)}
            className="text-xs h-8"
            placeholder="Frage…"
          />
          <Textarea
            value={item.answer}
            onChange={(e) => updateItem(idx, 'answer', e.target.value)}
            rows={2}
            className="text-xs"
            placeholder="Antwort…"
          />
        </div>
      ))}
      <Button variant="outline" size="sm" className="text-xs h-7" onClick={addItem}>
        <Plus className="h-3 w-3 mr-1" />Frage hinzufügen
      </Button>
    </div>
  );
}
