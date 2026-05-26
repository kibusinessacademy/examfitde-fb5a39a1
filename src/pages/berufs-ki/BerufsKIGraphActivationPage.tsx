import { Helmet } from "react-helmet-async";
import {
  NextBestSkillActionsCard,
  GraphWorkflowRecommendationsCard,
  ManagerRiskExplanationsCard,
} from "@/components/berufs-ki/GraphActivationCards";

/**
 * Learner-facing entry into the BerufOS Graph Activation Layer.
 * Surfaces the deterministic, evidence-based recommendations driven
 * by berufs_ki_graph_* — no AI generation in core decisions.
 */
export default function BerufsKIGraphActivationPage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <Helmet>
        <title>Graph Activation – BerufOS Intelligence</title>
        <meta
          name="description"
          content="Deterministische, graph-basierte Empfehlungen für Skills, Workflows und Risiken."
        />
      </Helmet>

      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">
          BerufOS Intelligence Graph
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text-primary">Graph Activation</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Empfehlungen aus dem produktiven Intelligence-Graph: nachvollziehbar, deterministisch,
          evidence-basiert. Keine AI-generierten Kernentscheidungen.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <NextBestSkillActionsCard />
        <GraphWorkflowRecommendationsCard />
        <div className="md:col-span-2">
          <ManagerRiskExplanationsCard />
        </div>
      </div>
    </div>
  );
}
