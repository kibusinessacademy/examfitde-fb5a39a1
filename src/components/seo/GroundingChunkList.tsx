/**
 * Phase P4 — Renderer for P2 GroundedChunk[].
 *
 * Pure presentational. NEVER mutates chunks, NEVER generates copy.
 * Each chunk is rendered as a <section> with a stable id (chunk_id),
 * the headline as <h2>, the body as <p>, and a citation block.
 */

import type { GroundedChunk } from "@/lib/llm-grounding";

export interface GroundingChunkListProps {
  chunks: ReadonlyArray<GroundedChunk>;
  /** Optional heading rendered above the list. */
  heading?: string;
}

export function GroundingChunkList({ chunks, heading }: GroundingChunkListProps) {
  if (chunks.length === 0) return null;

  return (
    <div className="space-y-6">
      {heading ? <h2 className="text-2xl font-semibold">{heading}</h2> : null}
      {chunks.map((c) => (
        <section
          key={c.chunk_id}
          id={c.chunk_id}
          data-role={c.role}
          data-anchor={c.anchor_entity_id}
          className="rounded-lg border border-border bg-card p-5"
        >
          <h3 className="text-lg font-semibold text-foreground">{c.headline}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
            {c.body}
          </p>
          {c.citations.length > 0 ? (
            <ul
              aria-label="Quellen"
              className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground"
            >
              {c.citations.map((cit, i) => (
                <li
                  key={`${cit.source_kind}:${cit.source_id}:${i}`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono"
                  title={`${cit.source_kind}${cit.anchor ? ` · ${cit.anchor}` : ""}`}
                >
                  {cit.source_kind}:{cit.source_id.slice(0, 8)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
