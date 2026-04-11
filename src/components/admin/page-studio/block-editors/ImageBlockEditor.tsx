import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  content: { src?: string; alt?: string; caption?: string };
  onChange: (content: { src: string; alt: string; caption: string }) => void;
}

export function ImageBlockEditor({ content, onChange }: Props) {
  const update = (key: string, value: string) =>
    onChange({ ...content, src: content.src ?? '', alt: content.alt ?? '', caption: content.caption ?? '', [key]: value });

  const altEmpty = !content.alt?.trim();

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Bild-URL</Label>
        <Input value={content.src ?? ''} onChange={(e) => update('src', e.target.value)} className="text-xs h-8" placeholder="https://..." />
      </div>
      <div className="space-y-1">
        <Label className={`text-[10px] ${altEmpty ? 'text-destructive' : 'text-muted-foreground'}`}>
          Alt-Text (Pflicht für SEO) {altEmpty && '*'}
        </Label>
        <Input
          value={content.alt ?? ''}
          onChange={(e) => update('alt', e.target.value)}
          className={`text-xs h-8 ${altEmpty ? 'border-destructive/50' : ''}`}
        />
        {altEmpty && <p className="text-[10px] text-destructive">Alt-Text sollte für SEO gesetzt sein</p>}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Bildunterschrift</Label>
        <Input value={content.caption ?? ''} onChange={(e) => update('caption', e.target.value)} className="text-xs h-8" />
      </div>
    </div>
  );
}
