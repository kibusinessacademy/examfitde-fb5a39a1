/**
 * Phase P4 — Generic Pillar / Satellite page.
 *
 * Renders a routed entity (Beruf | Kompetenz | Pruefung) by composing:
 *   - P1 KnowledgeGraph (data)
 *   - P2 GroundedDocument (chunks + FAQ, citation-bound)
 *   - P3 JSON-LD schema (Course/DefinedTerm/EducationEvent/FAQPage/Breadcrumb)
 *   - P4 SemanticCrossLinks (internal graph-derived links)
 *
 * NO hand-written SEO copy. NO calls into examiner mutators.
 */

import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useKnowledgeGraph, useEntityByKey } from "@/hooks/useKnowledgeGraph";
import { buildGroundedDocument } from "@/lib/llm-grounding";
import { buildEntitySchema } from "@/lib/seo/schema";
import { pillarAbsoluteUrl, type RoutedEntityKind } from "@/lib/semantic";
import { JsonLdHead } from "@/components/seo/JsonLdHead";
import { GroundingChunkList } from "@/components/seo/GroundingChunkList";
import { SemanticCrossLinks } from "@/components/seo/SemanticCrossLinks";
import { SemanticRelatedLinks } from "@/components/semantic/SemanticRelatedLinks";
import { ReadinessSignalBlock } from "@/components/semantic/ReadinessSignalBlock";
import { TrustLayerStrip } from "@/components/trust/TrustLayerStrip";
import { AdaptiveHero } from "@/components/intent/AdaptiveHero";
import { ConfidenceStatusStrip } from "@/components/intent/ConfidenceStatusStrip";
import { RecommendationStrip } from "@/components/recommendations/RecommendationStrip";


const BASE_URL = "https://examfitde.lovable.app";
const PROVIDER = { name: "ExamFit", url: BASE_URL } as const;

const KIND_LABEL: Readonly<Record<RoutedEntityKind, string>> = {
  beruf: "Beruf",
  kompetenz: "Kompetenz",
  pruefung: "Prüfung",
};

export interface EntityPillarPageProps {
  kind: RoutedEntityKind;
}

export default function EntityPillarPage({ kind }: EntityPillarPageProps) {
  const { key } = useParams<{ key: string }>();
  const graph = useKnowledgeGraph();
  const entity = useEntityByKey(graph, kind, key);

  if (!entity) {
    return (
      <>
        <Helmet>
          <title>{`${KIND_LABEL[kind]} nicht gefunden | ExamFit`}</title>
          <meta name="robots" content="noindex,follow" />
        </Helmet>
        <main className="container mx-auto max-w-3xl py-16">
          <h1 className="text-3xl font-semibold">{KIND_LABEL[kind]} nicht verfügbar</h1>
          <p className="mt-3 text-muted-foreground">
            Diese Wissensseite ist aktuell nicht im semantischen Graph hinterlegt.
          </p>
        </main>
      </>
    );
  }

  const document = buildGroundedDocument(graph, entity);
  const schema = buildEntitySchema(
    graph,
    { baseUrl: BASE_URL, snapshot_at: graph.snapshot_at },
    entity,
    {
      provider: PROVIDER,
      breadcrumbs: [
        { name: "Wissen", url: `${BASE_URL}/wissen` },
        { name: KIND_LABEL[kind], url: `${BASE_URL}/wissen/${kind}` },
        { name: entity.name, url: pillarAbsoluteUrl(BASE_URL, entity) ?? BASE_URL },
      ],
    },
  );
  const canonical = pillarAbsoluteUrl(BASE_URL, entity) ?? undefined;

  return (
    <>
      <JsonLdHead
        schema={schema}
        canonical={canonical}
        title={`${entity.name} — ${KIND_LABEL[kind]} | ExamFit`}
        description={entity.description}
      />
      <main className="container mx-auto max-w-3xl py-10">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {KIND_LABEL[kind]}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-foreground">{entity.name}</h1>
          {entity.description ? (
            <p className="mt-3 text-base text-muted-foreground">{entity.description}</p>
          ) : null}
        </header>

        <AdaptiveHero
          signals={{
            path: typeof window !== "undefined" ? window.location.pathname : `/wissen/${kind}/${entity.id}`,
          }}
          eyebrow={`Dein Einstieg in ${entity.name}`}
          className="mb-8"
        />

        <GroundingChunkList chunks={document.chunks} heading="Wissensbasis" />

        {kind === "beruf" || kind === "pruefung" ? (
          <>
            <ReadinessSignalBlock mode="product" contextLabel={entity.name} />
            <ConfidenceStatusStrip className="mt-6" />
          </>
        ) : null}

        <div className="mt-8">
          <TrustLayerStrip preset="product" />
        </div>

        <SemanticCrossLinks graph={graph} entity={entity} />

        <SemanticRelatedLinks entityId={entity.id} />
      </main>
    </>
  );
}
