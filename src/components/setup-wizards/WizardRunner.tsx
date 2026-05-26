/**
 * Premium UX — Generic Wizard Runner.
 * Renders a step-by-step flow for any `WizardDef`. State is persisted via
 * `useUpsertSetupWizard` after every step transition.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ArrowRight, ArrowLeft, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import type { WizardDef } from '@/lib/setup-wizards/catalog';
import { useUpsertSetupWizard } from '@/hooks/useSetupWizards';
import type { SetupWizardState } from '@/lib/setup-wizards/api';

interface Props {
  wizard: WizardDef;
  orgId: string;
  state?: SetupWizardState;
  onClose?: () => void;
}

export default function WizardRunner({ wizard, orgId, state, onClose }: Props) {
  const upsert = useUpsertSetupWizard(orgId);
  const [stepIdx, setStepIdx] = useState(state?.current_step ?? 0);
  const [config, setConfig] = useState<Record<string, unknown>>(state?.config ?? {});

  // Bridge wizards (existing route / connector) render a launch panel instead.
  if (wizard.existing_route || wizard.connector_id) {
    return (
      <BridgePanel wizard={wizard} state={state} onClose={onClose} />
    );
  }

  const steps = wizard.steps ?? [];
  const total = Math.max(steps.length, 1);
  const currentStep = steps[stepIdx];
  const isLast = stepIdx >= total - 1;

  const updateField = (key: string, value: string) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const persist = async (nextStep: number, nextStatus: 'in_progress' | 'connected') => {
    const res = await upsert.mutateAsync({
      wizardKey: wizard.key,
      status: nextStatus,
      currentStep: nextStep,
      totalSteps: total,
      config,
    });
    if (res.reason !== 'OK') {
      toast.error(`Wizard konnte nicht gespeichert werden: ${res.reason}`);
      return false;
    }
    return true;
  };

  const next = async () => {
    if (isLast) {
      const ok = await persist(total, 'connected');
      if (ok) {
        toast.success(`${wizard.label} aktiviert.`);
        onClose?.();
      }
      return;
    }
    const ok = await persist(stepIdx + 1, 'in_progress');
    if (ok) setStepIdx((s) => s + 1);
  };

  const back = () => setStepIdx((s) => Math.max(0, s - 1));

  return (
    <Card className="shadow-elev-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{wizard.label}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{wizard.vendor}</p>
          </div>
          <Badge variant="outline">~ {wizard.estimated_minutes} Min</Badge>
        </div>
        <Progress value={((stepIdx) / total) * 100} className="mt-3 h-1.5" />
        <p className="text-xs text-muted-foreground mt-2">
          Schritt {stepIdx + 1} / {total} · {wizard.promise}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentStep ? (
          <>
            <div>
              <h3 className="font-semibold text-foreground">{currentStep.label}</h3>
              <p className="text-sm text-muted-foreground mt-1">{currentStep.description}</p>
            </div>
            {currentStep.fields && (
              <div className="space-y-3">
                {currentStep.fields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label htmlFor={`${wizard.key}-${f.key}`}>
                      {f.label}
                      {f.optional && <span className="text-xs text-muted-foreground ml-1">(optional)</span>}
                    </Label>
                    {f.type === 'textarea' ? (
                      <Textarea
                        id={`${wizard.key}-${f.key}`}
                        placeholder={f.placeholder}
                        value={String(config[f.key] ?? '')}
                        onChange={(e) => updateField(f.key, e.target.value)}
                      />
                    ) : (
                      <Input
                        id={`${wizard.key}-${f.key}`}
                        type={f.type === 'password' ? 'password' : 'text'}
                        placeholder={f.placeholder}
                        value={String(config[f.key] ?? '')}
                        onChange={(e) => updateField(f.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Diese Integration hat noch keine Schritte definiert.</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={back} disabled={stepIdx === 0 || upsert.isPending}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Zurück
          </Button>
          <Button onClick={next} disabled={upsert.isPending} size="sm">
            {upsert.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {isLast ? (
              <>Abschließen <CheckCircle2 className="h-4 w-4 ml-1" /></>
            ) : (
              <>Weiter <ArrowRight className="h-4 w-4 ml-1" /></>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BridgePanel({
  wizard, state, onClose,
}: { wizard: WizardDef; state?: SetupWizardState; onClose?: () => void }) {
  return (
    <Card className="shadow-elev-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{wizard.label}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{wizard.vendor}</p>
          </div>
          <Badge variant="outline">~ {wizard.estimated_minutes} Min</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{wizard.promise}</p>

        {wizard.prerequisites?.length ? (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs font-semibold text-foreground mb-1">Was du brauchst</p>
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {wizard.prerequisites.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ) : null}

        {state?.status === 'connected' ? (
          <div className="flex items-center gap-2 text-status-success-text">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm">Bereits verbunden{state.completed_at ? ` · ${new Date(state.completed_at).toLocaleDateString()}` : ''}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-2">
          {wizard.existing_route ? (
            <Button asChild size="sm">
              <Link to={wizard.existing_route}>
                Öffnen <ExternalLink className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          ) : wizard.connector_id ? (
            <p className="text-xs text-muted-foreground">
              Connector: <code className="bg-surface-2 px-1.5 py-0.5 rounded">{wizard.connector_id}</code> — über die Lovable-Cloud-Verbindungen aktivierbar.
            </p>
          ) : null}
          {onClose && <Button variant="ghost" size="sm" onClick={onClose}>Schließen</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
