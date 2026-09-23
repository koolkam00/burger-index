// Server-safe presentational components from DESIGN.md "Components".
import {
  Bike,
  BookOpen,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  FileText,
  FileX,
  Globe,
  ShoppingBag,
  Store,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { boroughMeta } from "@/lib/boroughs";
import { formatDelta, formatPrice, priceParts } from "@/lib/format";
import { DELIVERY_NOTE, PRICE_SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { binFor } from "@/lib/price-bins";
import type { Borough, PriceSource, Status } from "@/lib/schema";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

/** Display price with deli price-card cents ($ at 0.5em, cents at 0.45em, underlined). */
export function Money({ value, className = "" }: { value: number; className?: string }) {
  const { dollars, cents } = priceParts(value);
  return (
    <span className={`money ${className}`}>
      <span className="sr-only">{formatPrice(value, { cents: "always" })}</span>
      <span aria-hidden="true" className="money-dollar">
        $
      </span>
      <span aria-hidden="true">{dollars}</span>
      <span aria-hidden="true" className="money-cents">
        {cents}
      </span>
    </span>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat-tile">
      <p className="t-label muted">{label}</p>
      <p className="t-stat mt-2">{value}</p>
      {sub ? <p className="t-ui-s muted mt-2">{sub}</p> : null}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="stat-grid" style={{ ["--stat-cols" as string]: cols }}>
      {children}
    </div>
  );
}

export function Swatch({ price, median }: { price: number; median: number }) {
  const bin = binFor(price, median);
  return <span className="swatch" style={{ background: bin.color }} aria-hidden="true" />;
}

/** "†" after a delivery-app price. The glyph is hidden from screen readers, which hear the words. */
export function Dagger() {
  return (
    <>
      <span aria-hidden="true">†</span>
      <span className="sr-only"> (delivery-app price)</span>
    </>
  );
}

/**
 * Price chip: ramp swatch, price, delta vs the citywide median. Never red/green. `narrowWrap` lets the
 * delta drop to a second line inside the chip on screens under 360px, where a one-line chip in a
 * two-column table pushes the page wider than the screen.
 */
export function PriceChip({
  price,
  median,
  delta = true,
  suffix = "vs NYC",
  dagger = false,
  narrowWrap = false,
}: {
  price: number | null;
  median: number | null;
  delta?: boolean;
  suffix?: string;
  dagger?: boolean;
  narrowWrap?: boolean;
}) {
  if (price === null) {
    return (
      <span className="price-chip">
        <span className="t-ui-s muted">No price</span>
      </span>
    );
  }
  const bin = median !== null ? binFor(price, median) : null;
  return (
    <span className={`price-chip ${narrowWrap ? "price-chip-wrap" : ""}`} title={bin ? bin.name : undefined}>
      <span className="price-chip-main">
        {bin ? <span className="swatch" style={{ background: bin.color }} aria-hidden="true" /> : null}
        <span className="t-num-m">
          {formatPrice(price, { cents: "always" })}
          {dagger ? <Dagger /> : null}
        </span>
      </span>
      {delta && median !== null ? <span className="t-num-s muted">{formatDelta(price, median, { suffix })}</span> : null}
    </span>
  );
}

export function IndexTag() {
  return <span className="index-tag">Index price</span>;
}

const SOURCE_ICON: Record<PriceSource, LucideIcon> = {
  official_site: Globe,
  official_pdf: FileText,
  online_ordering: ShoppingBag,
  menu_aggregator: BookOpen,
  delivery_app: Bike,
};

export function SourceBadge({ source }: { source: PriceSource | null }) {
  if (!source) return null;
  const Icon = SOURCE_ICON[source];
  const delivery = source === "delivery_app";
  return (
    <span className={`badge ${delivery ? "badge-delivery" : ""}`} title={delivery ? DELIVERY_NOTE : undefined}>
      <Icon {...ICON} />
      {PRICE_SOURCE_LABEL[source]}
    </span>
  );
}

const STATUS_STYLE: Record<Status, { Icon: LucideIcon; bg: string; icon: string }> = {
  priced: { Icon: CircleCheck, bg: "var(--ok-bg)", icon: "var(--ok-icon)" },
  no_prices: { Icon: CircleHelp, bg: "var(--warn-bg)", icon: "var(--warn-icon)" },
  no_burgers: { Icon: CircleSlash, bg: "var(--surface-2)", icon: "var(--ink-muted)" },
  no_menu_found: { Icon: FileX, bg: "var(--surface-2)", icon: "var(--ink-muted)" },
  error: { Icon: TriangleAlert, bg: "var(--err-bg)", icon: "var(--err-icon)" },
};

export function StatusBadge({ status }: { status: Status }) {
  const { Icon, bg, icon } = STATUS_STYLE[status];
  return (
    <span className="badge badge-status" style={{ background: bg }}>
      <Icon {...ICON} style={{ color: icon }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Coverage badge for an area priced only from chain menus (no independent restaurant priced there
 * yet). Same shape as the source badges; the words carry the meaning, the icon only repeats it.
 */
export function ChainOnlyBadge() {
  return (
    <span className="badge" title="No independent restaurant is priced here yet: every price comes from a chain's menu.">
      <Store {...ICON} />
      Chain prices only
    </span>
  );
}

export function BoroughDot({ borough }: { borough: Borough }) {
  return <span className="key-dot" style={{ background: boroughMeta(borough).color }} aria-hidden="true" />;
}

/** Borough key dot + name, linked to the borough page. */
export function BoroughName({ borough, link = true }: { borough: Borough; link?: boolean }) {
  const meta = boroughMeta(borough);
  const inner = (
    <>
      <BoroughDot borough={borough} />
      {borough}
    </>
  );
  return link ? (
    <Link href={`/boroughs/${meta.slug}`} className="ui-link inline-flex items-center gap-1.5">
      {inner}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1.5">{inner}</span>
  );
}

export function SectionHeading({ id, title, children }: { id?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="section-rule">
      <h2 id={id} className="t-display-m">
        {title}
      </h2>
      {children ? <div className="t-body muted prose-width mt-3">{children}</div> : null}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="t-ui-s muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-2">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="ui-link break-anywhere text-ink-muted hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="break-anywhere">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ overline, title, lede, children }: { overline?: ReactNode; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-8 md:pt-12">
      {overline ? <div className="mb-4">{overline}</div> : null}
      <h1 className="t-display-l">{title}</h1>
      {lede ? <p className="t-lede prose-width mt-4 md:mt-5">{lede}</p> : null}
      {children}
    </header>
  );
}

/** Empty state the height of the chart it replaces. */
export function ChartEmpty({ children, height = 240 }: { children: ReactNode; height?: number }) {
  return (
    <div className="chart-empty" style={{ minHeight: height }}>
      <p className="max-w-[46ch]">{children}</p>
    </div>
  );
}
