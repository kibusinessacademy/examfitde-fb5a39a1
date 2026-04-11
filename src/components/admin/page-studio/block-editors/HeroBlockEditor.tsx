import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface HeroContent {
  kicker?: string;
  headline?: string;
  subline?: string;
  primaryCtaLabel?: string;
  primaryCtaUrl?: string;
  imageUrl?: string;
}

interface Props {
  content: HeroContent;
  onChange: (content: HeroContent) => void;
}

export function HeroBlockEditor({ content, onChange }: Props) {
  const update = (key: keyof HeroContent, value: string) =>
    onChange({ ...content, [key]: value });

  const headlineEmpty = !content.headline?.trim();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Kicker</Label>
        <Input value={content.kicker ?? ''} onChange={(e) => update('kicker', e.target.value)} className="text-xs h-8" placeholder="z. B. Neu bei ExamFit" />
      </div>
      <div className="space-y-1">
        <Label className={`text-[10px] ${headlineEmpty ? 'text-destructive' : 'text-muted-foreground'}`}>
          Headline {headlineEmpty && '*'}
        </Label>
        <Input
          value={content.headline ?? ''}
          onChange={(e) => update('headline', e.target.value)}
          className={`text-xs h-8 ${headlineEmpty ? 'border-destructive/50' : ''}`}
        />
        {headlineEmpty && <p className="text-[10px] text-destructive">Headline darf nicht leer sein</p>}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Subline</Label>
        <Textarea value={content.subline ?? ''} onChange={(e) => update('subline', e.target.value)} rows={2} className="text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">CTA Label</Label>
          <Input value={content.primaryCtaLabel ?? ''} onChange={(e) => update('primaryCtaLabel', e.target.value)} className="text-xs h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">CTA URL</Label>
          <Input value={content.primaryCtaUrl ?? ''} onChange={(e) => update('primaryCtaUrl', e.target.value)} className="text-xs h-8" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Bild-URL</Label>
        <Input value={content.imageUrl ?? ''} onChange={(e) => update('imageUrl', e.target.value)} className="text-xs h-8" placeholder="https://..." />
      </div>
    </div>
  );
}
