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
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { boroughMeta } from "@/lib/boroughs";
import { formatDelta, formatPrice, priceParts } from "@/lib/format";
import { PRICE_SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { binFor } from "@/lib/price-bins";
import type { Borough, PriceSource, Status } from "@/lib/schema";
import { AnchorChain, LobsterTrap, MessageBottle, Net, OrderBell, ShipWheel, type IconProps } from "./icons/nautical";

const ICON = { strokeWidth: 2, "aria-hidden": true } as const;

export type NauticalIcon = ComponentType<IconProps>;

/** Display price with deli price-card cents ($ at 0.5em, cents at 0.45em, underlined). */
export function Money({ value, className = "" }: { value: number; className?: string }) {
  const { dollars, cents } = priceParts(value);
  return (
    <span className={`money ${className}`}>
      <span className="sr-only">{formatPrice(value, { cents: "always" })}</span>
      <span aria-hidden="true" className="money-dollar">
        $
      </span>
      <span aria-hidden="true" className="money-whole">
        {dollars}
      </span>
      <span aria-hidden="true" className="money-cents">
        {cents}
      </span>
    </span>
  );
}

/** Two display prices as one unit: "$9.15–$29.40" never breaks between the dash and a price. */
export function MoneyRange({ lo, hi }: { lo: number; hi: number }) {
  return (
    <span className="stat-range">
      <Money value={lo} />
      <span aria-hidden="true">–</span>
      <span className="sr-only">to</span>
      <Money value={hi} />
    </span>
  );
}

/** "Porthole tile": brass rim and rivets, a porthole badge bolted to the top-left rim. */
export function StatTile({ label, value, sub, icon: Icon = ShipWheel }: { label: string; value: ReactNode; sub?: ReactNode; icon?: NauticalIcon }) {
  return (
    <div className="stat-tile">
      <span className="stat-badge porthole" aria-hidden="true">
        <Icon />
      </span>
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

/**
 * Price chip ("price tag"): a full-height ramp stripe on the left, the price, the delta vs the
 * citywide median. Deltas are never colored. `narrowWrap` lets the delta drop to a second line inside
 * the chip on screens under 360px, where a one-line chip in a two-column table pushes the page wider
 * than the screen.
 */
export function PriceChip({
  price,
  median,
  delta = true,
  suffix = "vs NYC",
  narrowWrap = false,
}: {
  price: number | null;
  median: number | null;
  delta?: boolean;
  suffix?: string;
  narrowWrap?: boolean;
}) {
  if (price === null) {
    return (
      <span className="price-chip price-chip-plain">
        <span className="t-ui-s muted">No price</span>
      </span>
    );
  }
  const bin = median !== null ? binFor(price, median) : null;
  return (
    <span
      className={`price-chip ${bin ? "" : "price-chip-plain"} ${narrowWrap ? "price-chip-wrap" : ""}`}
      title={bin ? bin.name : undefined}
      style={bin ? ({ ["--chip" as string]: bin.color } as CSSProperties) : undefined}
    >
      <span className="price-chip-main">
        <span className="t-num-m">{formatPrice(price, { cents: "always" })}</span>
      </span>
      {delta && median !== null ? <span className="t-num-s muted">{formatDelta(price, median, { suffix })}</span> : null}
    </span>
  );
}

/** "Order flag": the index-setting burger. */
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
  return (
    <span className={`badge ${source === "delivery_app" ? "badge-delivery" : ""}`}>
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
 * yet). Same shape as the source badges; the words carry the meaning, the anchor chain only repeats it.
 */
export function ChainOnlyBadge() {
  return (
    <span className="badge badge-chain">
      <AnchorChain size={14} />
      Chain prices only
    </span>
  );
}

/** Borough key dot. `ringed`: a 2px --surface ring (on a sea band). `title`: scaled to sit before an H1. */
export function BoroughDot({ borough, ringed = false, title = false }: { borough: Borough; ringed?: boolean; title?: boolean }) {
  return (
    <span
      className={`key-dot ${ringed ? "key-dot-ringed" : ""} ${title ? "key-dot-title" : ""}`}
      style={{ background: boroughMeta(borough).color }}
      aria-hidden="true"
    />
  );
}

/** Borough key dot + name, linked to the borough page. `ringed` puts the dot in a surface ring (on a sea band). */
export function BoroughName({ borough, link = true, ringed = false }: { borough: Borough; link?: boolean; ringed?: boolean }) {
  const meta = boroughMeta(borough);
  const inner = (
    <>
      <BoroughDot borough={borough} ringed={ringed} />
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

/** Section kicker: galley-red Lilita with an icon. Only on --bg or --surface (on a sea band use KickerTicket). */
export function Kicker({ children, icon: Icon, as: Tag = "p", className = "" }: { children: ReactNode; icon?: NauticalIcon; as?: "p" | "span"; className?: string }) {
  return (
    <Tag className={`kicker t-kicker ${className}`}>
      {Icon ? <Icon /> : null}
      {children}
    </Tag>
  );
}

/**
 * The overline on a detail page's shallows band (borough, neighborhood, restaurant): what kind of
 * page this is, in `label` type, then any coverage badge. Top-level pages use the kicker ticket.
 */
export function DetailOverline({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="t-label muted inline-flex flex-wrap items-center gap-x-2 gap-y-1">{label}</span>
      {children}
    </span>
  );
}

/** The kicker ticket: the only kicker form allowed on a sea band. */
export function KickerTicket({ children, icon: Icon = OrderBell }: { children: ReactNode; icon?: NauticalIcon }) {
  return (
    <p className="ticket t-kicker">
      <Icon />
      {children}
    </p>
  );
}

/** Rope rule, 16px, optional kicker, 8px, the H2 (the computed data sentence), optional description. */
export function SectionHeading({ id, title, kicker, icon, children }: { id?: string; title: ReactNode; kicker?: string; icon?: NauticalIcon; children?: ReactNode }) {
  return (
    <div>
      <span className="rope" aria-hidden="true" />
      <div className="pt-4">
        {kicker ? (
          <Kicker icon={icon} className="mb-2">
            {kicker}
          </Kicker>
        ) : null}
        <h2 id={id} className="t-display-m">
          {title}
        </h2>
        {children ? <div className="t-body muted prose-width mt-3">{children}</div> : null}
      </div>
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

/** Surface ripples at the top of a sea band: one stroke in a 132×30 pattern, faded out before the lede. Never animated. */
export function Caustics({ id }: { id: string }) {
  return (
    <svg className="caustics" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="132" height="30" patternUnits="userSpaceOnUse">
          <path d="M0 15 Q33 5 66 15 T132 15" fill="none" stroke="var(--caustic)" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** The wave at the bottom of a sea band, filled with the page color, with a foam line. */
export function WaveEdge() {
  const d = "M0 20C240 0 480 40 720 20S1200 0 1440 20";
  return (
    <svg className="wave-edge" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={`${d}V40H0Z`} fill="var(--bg)" />
      <path d={d} fill="none" stroke="var(--foam)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Bubbles for the home hero's left and right page gutters only (never over text). */
const BUBBLES: Array<{ side: "l" | "r"; x: number; y: string; s: number; d: number }> = [
  { side: "l", x: 0.45, y: "22%", s: 12, d: 0 },
  { side: "l", x: 0.62, y: "41%", s: 8, d: 0.3 },
  { side: "l", x: 0.38, y: "63%", s: 14, d: 0.55 },
  { side: "l", x: 0.55, y: "82%", s: 6, d: 0.8 },
  { side: "r", x: 0.5, y: "30%", s: 9, d: 0.15 },
  { side: "r", x: 0.36, y: "52%", s: 13, d: 0.45 },
  { side: "r", x: 0.6, y: "74%", s: 7, d: 0.7 },
];

export function Bubbles() {
  return (
    <div className="bubbles" aria-hidden="true">
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{
            width: b.s,
            height: b.s,
            top: b.y,
            [b.side === "l" ? "left" : "right"]: `calc(var(--gutter) * ${b.x} - ${b.s / 2}px)`,
            ["--delay" as string]: `${b.d}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Inner-page header on the shallows band (breadcrumbs, kicker ticket, H1, lede), ending in a wave.
 * `aside` (the Order Board) sits beside the header at lg. Text here is --ink or --ink-muted only, and
 * any chip or badge in the band has its own --surface fill.
 */
export function PageHeader({
  crumbs,
  ticket,
  ticketIcon,
  overline,
  title,
  lede,
  children,
  aside,
}: {
  crumbs?: Array<{ href?: string; label: string }>;
  ticket?: string;
  ticketIcon?: NauticalIcon;
  overline?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  const head = (
    <>
      {ticket ? (
        <div className="mb-4">
          <KickerTicket icon={ticketIcon}>{ticket}</KickerTicket>
        </div>
      ) : null}
      {overline ? <div className="mb-4">{overline}</div> : null}
      <h1 className="t-display-l">{title}</h1>
      {lede ? <p className="t-lede prose-width mt-4 md:mt-5">{lede}</p> : null}
      {children}
    </>
  );
  return (
    <header className="shallows atmo">
      <Caustics id="caustic-shallows" />
      <div className="wrap band-body">
        {crumbs ? (
          <div className="mb-6 md:mb-8">
            <Breadcrumbs items={crumbs} />
          </div>
        ) : null}
        {aside ? (
          // Top-aligned: the header reads straight down from the breadcrumbs, and the board hangs beside it.
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start lg:gap-8">
            <div className="min-w-0 lg:col-span-5 lg:pt-2">{head}</div>
            <div className="min-w-0 lg:col-span-7">{aside}</div>
          </div>
        ) : (
          head
        )}
      </div>
      <WaveEdge />
    </header>
  );
}

const EMPTY_ART = { trap: LobsterTrap, net: Net, bottle: MessageBottle } as const;

/**
 * Empty state the height of what it replaces: one original spot illustration on the trap net (never
 * instead of the words, never animated), the copy, then an optional action.
 */
export function EmptyState({ children, height = 240, art = "trap", action }: { children: ReactNode; height?: number; art?: keyof typeof EMPTY_ART; action?: ReactNode }) {
  const Art = EMPTY_ART[art];
  return (
    <div className="empty-state" style={{ minHeight: height }}>
      <span className="empty-art" aria-hidden="true">
        <Art strokeWidth={1.5} />
        <span className="bubble" style={{ width: 8, height: 8, top: 6, right: 12 }} />
        <span className="bubble" style={{ width: 5, height: 5, top: 20, right: 4 }} />
        <span className="bubble" style={{ width: 6, height: 6, top: -2, right: 26 }} />
      </span>
      <p className="max-w-[46ch]">{children}</p>
      {action}
    </div>
  );
}

/** Empty state the height of the chart it replaces. */
export function ChartEmpty({ children, height = 240, art = "trap" }: { children: ReactNode; height?: number; art?: keyof typeof EMPTY_ART }) {
  return (
    <EmptyState height={height} art={art}>
      {children}
    </EmptyState>
  );
}
