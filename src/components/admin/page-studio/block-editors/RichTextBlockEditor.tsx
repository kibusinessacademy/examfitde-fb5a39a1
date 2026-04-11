import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  content: { body?: string };
  onChange: (content: { body: string }) => void;
}

export function RichTextBlockEditor({ content, onChange }: Props) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">Inhalt (HTML)</Label>
      <Textarea
        value={content.body ?? ''}
        onChange={(e) => onChange({ ...content, body: e.target.value })}
        rows={4}
        className="text-xs font-mono"
        placeholder="<p>Dein Text hier…</p>"
      />
    </div>
  );
}
