// Renders a page's JSON-LD (Next 16 guide "JSON-LD"): a native <script type="application/ld+json">
// in the server-rendered HTML, never next/script. serializeJsonLd escapes "<" so data can't end the tag.
import { jsonLdDocument, serializeJsonLd, type JsonLdNode } from "@/lib/jsonld";

export function JsonLd({ nodes }: { nodes: readonly (JsonLdNode | null | undefined | false)[] }) {
  const doc = jsonLdDocument(nodes);
  if (!doc) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(doc) }} />;
}
