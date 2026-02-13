import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save, RotateCcw } from 'lucide-react';
import type { FeatureFlags, ProductTrack } from '@/hooks/useTrackConfig';
import { DEFAULT_FLAGS } from '@/hooks/useTrackConfig';

const FLAG_LABELS: Record<keyof FeatureFlags, string> = {
  has_learning_course: 'Lernkurs (H5P)',
  has_practice_course_h5p: 'Praxis-Kurs H5P',
  has_minichecks: 'MiniChecks',
  has_exam_trainer: 'Prüfungstrainer',
  has_exam_simulation: 'Prüfungssimulation',
  has_oral_exam_trainer: 'Mündliche Prüfung',
  has_ai_tutor: 'AI Tutor',
  has_handbook: 'Handbuch',
};

interface Props {
  flags: FeatureFlags;
  track: ProductTrack;
  onChange: (flags: FeatureFlags) => void;
  onSave?: () => void;
  saving?: boolean;
}

export default function FeatureFlagEditor({ flags, track, onChange, onSave, saving }: Props) {
  const [local, setLocal] = useState<FeatureFlags>(flags);

  useEffect(() => { setLocal(flags); }, [flags]);

  const toggle = (key: keyof FeatureFlags) => {
    // exam_trainer and exam_simulation are always required
    if (key === 'has_exam_trainer' || key === 'has_exam_simulation') return;
    const next = { ...local, [key]: !local[key] };
    setLocal(next);
    onChange(next);
  };

  const resetToDefaults = () => {
    const defaults = DEFAULT_FLAGS[track];
    setLocal(defaults);
    onChange(defaults);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Feature Flags</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetToDefaults} className="text-xs h-7">
              <RotateCcw className="h-3 w-3 mr-1" /> Defaults
            </Button>
            {onSave && (
              <Button size="sm" onClick={onSave} disabled={saving} className="text-xs h-7">
                <Save className="h-3 w-3 mr-1" /> Speichern
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(FLAG_LABELS) as (keyof FeatureFlags)[]).map(key => {
            const locked = key === 'has_exam_trainer' || key === 'has_exam_simulation';
            return (
              <div key={key} className="flex items-center gap-2">
                <Switch
                  checked={local[key]}
                  onCheckedChange={() => toggle(key)}
                  disabled={locked}
                  id={key}
                />
                <Label htmlFor={key} className="text-xs cursor-pointer">
                  {FLAG_LABELS[key]}
                  {locked && <span className="text-muted-foreground ml-1">(Pflicht)</span>}
                </Label>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
