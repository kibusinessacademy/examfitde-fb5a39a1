import { useState } from "react";
import { Sparkles, Loader2, ShieldAlert, Radar, FileText, ArrowRight, ExternalLink, BookOpenCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildAllowedCopilotActions,
  buildCopilotContext,
  buildGroundingInstructions,
  buildPreparedBridgeIntents,
  buildRefusal,
  sanitizeCopilotPayload,
  validateCopilotResponse,
  type CopilotAction,
  type CopilotContext,
  type CopilotIntent,
} from "@/lib/foerdermittel/copilot";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyProfile, Program, ProgramMatch } from "@/lib/foerdermittel/types";

interface Props {
  program: Program;
  match?: ProgramMatch;
  profile?: CompanyProfile;
}

interface AnswerState {
  intent: CopilotIntent;
  text: string;
  warnings: string[];
  sources: { url: string; label: string; lastVerifiedAt?: string }[];
  freshnessLabel: string;
}

export function CopilotPanel({ program, match, profile }: Props) {
  const ctx: CopilotContext = buildCopilotContext(program, match, profile);
  const actions = buildAllowedCopilotActions(ctx);
  const bridges = buildPreparedBridgeIntents(ctx);
  const grounding = buildGroundingInstructions(ctx);

  const [loading, setLoading] = useState<CopilotIntent | null>(null);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [refusal, setRefusal] = useState<ReturnType<typeof buildRefusal> | null>(null);

  const staleOrUnknown = ctx.freshness.status === "stale" || ctx.freshness.status === "unknown";

  async function run(action: CopilotAction) {
    setRefusal(null);
    setAnswer(null);

    if (action.requiresProfile && !profile) {
      setRefusal(buildRefusal("missing_profile"));
      return;
    }
    if (staleOrUnknown && action.intent !== "explain_freshness_risk") {
      // Allow but force disclaimer via grounding
    }

    setLoading(action.intent);
    try {
      const payload = sanitizeCopilotPayload({
        intent: action.intent,
        message: action.label,
        context: ctx,
        grounding,
      });

      const { data, error } = await supabase.functions.invoke("foerdermittel-copilot", {
        body: payload,
      });

      if (error) {
        setRefusal(buildRefusal("model_unavailable"));
        return;
      }
      if (!data?.answer) {
        setRefusal(buildRefusal("model_unavailable"));
        return;
      }
      const validation = validateCopilotResponse(data.answer, ctx);
      setAnswer({
        intent: action.intent,
        text: data.answer,
        warnings: validation.warnings,
        sources: data.sources ?? [],
        freshnessLabel: ctx.freshness.statusLabel,
      });
    } catch (e) {
      console.error("copilot run failed", e);
      setRefusal(buildRefusal("model_unavailable"));
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-6 pb-12">
      <Card className="border-primary/30 bg-gradient-to-br from-background to-primary/[0.03]">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">Fördermittel CoPilot</h2>
                <Badge variant="outline" className="text-[10px]">grounded</Badge>
                <Badge variant="outline" className="text-[10px]">
                  Quelle: {ctx.freshness.statusLabel}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Antworten ausschließlich aus Registry, Matching, Freshness und Antragscheck. Keine
                Rechtsberatung, keine verbindliche Förderzusage.
              </p>
            </div>
          </div>

          {/* Action grid */}
          <div className="grid gap-2 sm:grid-cols-2">
            {actions.map((a) => (
              <button
                key={a.intent}
                onClick={() => run(a)}
                disabled={loading !== null}
                className="text-left rounded-lg border p-3 hover:bg-muted transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{a.label}</div>
                  {loading === a.intent ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{a.description}</div>
                {a.requiresProfile && !profile && (
                  <div className="text-[10px] text-amber-600 mt-1 inline-flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3" /> benötigt Unternehmensprofil
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Stale warning */}
          {staleOrUnknown && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <Radar className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-sm">Aktualität: {ctx.freshness.statusLabel}</AlertTitle>
              <AlertDescription className="text-xs">
                Die Datenbasis ist nicht frisch. Antworten enthalten einen Hinweis zur manuellen
                Prüfung beim Förderträger.
              </AlertDescription>
            </Alert>
          )}

          {/* Refusal state */}
          {refusal && (
            <Alert variant="destructive" className="bg-destructive/5">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle className="text-sm capitalize">CoPilot abgelehnt</AlertTitle>
              <AlertDescription className="text-xs">
                {refusal.message}
                {refusal.suggestion && (
                  <div className="mt-1 text-foreground">{refusal.suggestion}</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Answer card */}
          {answer && (
            <Card className="border-primary/20">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">CoPilot-Antwort</span>
                  <Badge variant="outline" className="text-[10px]">
                    {answer.freshnessLabel}
                  </Badge>
                  {answer.warnings.length > 0 &&
                    answer.warnings.map((w) => (
                      <Badge key={w} variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                        {w}
                      </Badge>
                    ))}
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                  {answer.text}
                </div>
                {answer.sources.length > 0 && (
                  <div className="border-t pt-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Datenbasis
                    </div>
                    <ul className="space-y-1 text-xs">
                      {answer.sources.map((s) => (
                        <li key={s.url}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {s.label} <ExternalLink className="h-3 w-3" />
                          </a>
                          {s.lastVerifiedAt && (
                            <span className="text-muted-foreground ml-2">
                              · verifiziert{" "}
                              {new Date(s.lastVerifiedAt).toLocaleDateString("de-DE")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Cross-OS bridge actions */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 inline-flex items-center gap-1">
              <BookOpenCheck className="h-3 w-3" /> Cross-OS Aktionen
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {bridges.map((b) => (
                <div
                  key={b.intent}
                  className="rounded-md border p-2.5 text-xs flex items-center justify-between gap-2"
                >
                  <span className="truncate">{b.label}</span>
                  <Badge
                    variant="outline"
                    className={
                      b.availability === "available"
                        ? "text-[9px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : "text-[9px] border-muted-foreground/30 text-muted-foreground"
                    }
                  >
                    {b.availability === "available" ? "vorbereitet" : "bald verfügbar"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* SEO-friendly static legal note */}
          <p className="text-[11px] text-muted-foreground border-t pt-3">
            Der Fördermittel CoPilot unterstützt bei Förderentscheidung, Unterlagencheck und
            Antragsvorbereitung mit KI — auf Basis der hinterlegten Programmdaten und
            Aktualitätsprüfung. Er ersetzt keine Rechts- oder Förderberatung.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
