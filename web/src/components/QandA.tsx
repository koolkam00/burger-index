// The Q&A block (DESIGN.md "Q&A block"): a short list of plain questions with answer-first sentences
// and live numbers, as a definition list on the counter, plus its FAQPage JSON-LD. Both come from the
// same items (lib/answers.ts), so the markup says word for word what the page shows.
import Link from "next/link";
import { Fragment } from "react";
import { segmentsText, type FaqItem, type Segment } from "@/lib/answers";
import { faqPageNode } from "@/lib/jsonld";
import { OrderBell } from "./icons/nautical";
import { JsonLd } from "./JsonLd";
import { SectionHeading } from "./ui";

function Answer({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        typeof s === "string" ? (
          <Fragment key={i}>{s}</Fragment>
        ) : (
          <Link key={i} href={s.href} className="link">
            {s.text}
          </Link>
        ),
      )}
    </>
  );
}

export function QandA({ id = "answers", items }: { id?: string; items: readonly FaqItem[] }) {
  if (!items.length) return null;
  return (
    <section className="section" aria-labelledby={id}>
      <JsonLd nodes={[faqPageNode(items.map((it) => ({ question: it.q, answer: segmentsText(it.a) })))]} />
      <SectionHeading id={id} kicker="Ask the cook" icon={OrderBell} title="Quick answers." />
      <dl className="qa mt-6">
        {items.map((it) => (
          <div key={it.q} className="qa-item">
            <dt className="t-ui-l font-semibold">{it.q}</dt>
            <dd className="t-body mt-1">
              <Answer segments={it.a} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
