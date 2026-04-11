import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  content: { headline?: string; copy?: string; buttonLabel?: string; buttonUrl?: string };
  onChange: (content: Record<string, string>) => void;
}

export function CTABlockEditor({ content, onChange }: Props) {
  const update = (key: string, value: string) => onChange({ ...content, [key]: value });

  const headlineEmpty = !content.headline?.trim();
  const labelEmpty = !content.buttonLabel?.trim();

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className={`text-[10px] ${headlineEmpty ? 'text-destructive' : 'text-muted-foreground'}`}>
          Headline {headlineEmpty && '*'}
        </Label>
        <Input
          value={content.headline ?? ''}
          onChange={(e) => update('headline', e.target.value)}
          className={`text-xs h-8 ${headlineEmpty ? 'border-destructive/50' : ''}`}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Text</Label>
        <Textarea value={content.copy ?? ''} onChange={(e) => update('copy', e.target.value)} rows={2} className="text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className={`text-[10px] ${labelEmpty ? 'text-destructive' : 'text-muted-foreground'}`}>
            Button-Label {labelEmpty && '*'}
          </Label>
          <Input
            value={content.buttonLabel ?? ''}
            onChange={(e) => update('buttonLabel', e.target.value)}
            className={`text-xs h-8 ${labelEmpty ? 'border-destructive/50' : ''}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Button-URL</Label>
          <Input value={content.buttonUrl ?? ''} onChange={(e) => update('buttonUrl', e.target.value)} className="text-xs h-8" />
        </div>
      </div>
    </div>
  );
}
