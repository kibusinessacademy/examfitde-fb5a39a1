/**
 * Phase P4 — JSON-LD <Helmet> head injector.
 *
 * Renders a JSON-LD object built by `@/lib/seo/schema` into a
 * `<script type="application/ld+json">` tag. This component is allow-listed
 * in `seo-schema-ssot.baseline.json` because the JSON-LD itself is
 * produced exclusively by the SSOT builders.
 */

import { Helmet } from "react-helmet-async";
import { serializeSchema } from "@/lib/seo/schema";
import type { JsonLdObject } from "@/lib/seo/schema";

export interface JsonLdHeadProps {
  schema: JsonLdObject;
  /** Optional canonical URL to publish on this page. */
  canonical?: string;
  title?: string;
  description?: string;
}

export function JsonLdHead({ schema, canonical, title, description }: JsonLdHeadProps) {
  return (
    <Helmet>
      {title ? <title>{title}</title> : null}
      {description ? <meta name="description" content={description} /> : null}
      {canonical ? <link rel="canonical" href={canonical} /> : null}
      {/* application/ld+json: produced by SSOT builders only */}
      <script type="application/ld+json">{serializeSchema(schema)}</script>
    </Helmet>
  );
}
