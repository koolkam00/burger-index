// The original nautical icon set (DESIGN.md "Iconography"). Hand-drawn inline SVG on a 24px grid:
// 2px stroke, round caps and joins, currentColor. Generic seaside and galley objects only; nothing
// here is traced from, or stands in for, any show, character, restaurant or logo.
import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number | string };

function Svg({ size = 24, className, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Eight spoke ends at r=10 around (12,12), handles as dots. */
const SPOKES = Array.from({ length: 8 }, (_, k) => {
  const a = (k * Math.PI) / 4;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x1: r(12 + 2 * Math.cos(a)), y1: r(12 + 2 * Math.sin(a)), x2: r(12 + 9.6 * Math.cos(a)), y2: r(12 + 9.6 * Math.sin(a)) };
});

export function ShipWheel(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      {SPOKES.map((s, i) => (
        <line key={i} {...s} />
      ))}
    </Svg>
  );
}

export function Anchor(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 6.5V21" />
      <path d="M8 9.5h8" />
      <path d="M4.5 14.5c.8 4 3.8 6.5 7.5 6.5s6.7-2.5 7.5-6.5" />
      <path d="M2.8 16.2l1.7-1.7 1.9 1.3" />
      <path d="M21.2 16.2l-1.7-1.7-1.9 1.3" />
    </Svg>
  );
}

export function Spatula(props: IconProps) {
  return (
    <Svg {...props}>
      <g transform="rotate(45 12 12)">
        <rect x="8.5" y="2" width="7" height="9" rx="1.5" />
        <path d="M10.8 4.4v4.2M13.2 4.4v4.2" />
        <path d="M12 11v2.5" />
        <rect x="10.8" y="13.5" width="2.4" height="8.5" rx="1.2" />
      </g>
    </Svg>
  );
}

export function Spyglass(props: IconProps) {
  return (
    <Svg {...props}>
      <g transform="rotate(-38 12 12)">
        <rect x="2.5" y="10.25" width="5" height="3.5" rx=".8" />
        <rect x="7.5" y="9.25" width="6" height="5.5" rx="1" />
        <rect x="13.5" y="8" width="8" height="8" rx="1.2" />
      </g>
    </Svg>
  );
}

/**
 * A wire-mesh lobster trap as fishing gear, in 3/4 view: a flat-topped box with diamond mesh on the
 * front, the entrance funnel as a ring on the end face, and a rope bridle to a small float. No arch,
 * no ground line, no opening centered on a facade: it must never read as a building.
 */
export function LobsterTrap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 11h13v9.5h-13z" />
      <path d="M2.5 11l4-4h13l-4 4" />
      <path d="M19.5 7v9.5l-4 4" />
      <path d="M2.5 16.2L7.7 11M4.3 20.5L13.8 11M9.3 20.5l6.2-6.2M2.5 14.2l6.3 6.3M6.8 11l9.5 9.5M12 11l3.5 3.5" strokeWidth={1.1} />
      <ellipse cx="17.5" cy="13.8" rx="1" ry="2" strokeWidth={1.5} />
      <path d="M11 7c0-2.3 1.5-3.8 3.8-4.2" />
      <circle cx="17" cy="2.8" r="1.6" />
    </Svg>
  );
}

export function Porthole(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="6" />
      {[45, 135, 225, 315].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return <circle key={deg} cx={Math.round((12 + 7.8 * Math.cos(a)) * 100) / 100} cy={Math.round((12 + 7.8 * Math.sin(a)) * 100) / 100} r=".6" fill="currentColor" />;
      })}
    </Svg>
  );
}

/** A counter service bell. `dings` adds the three "ding" strokes above it (class `bell-ding`). */
export function OrderBell({ dings = true, ...props }: IconProps & { dings?: boolean }) {
  return (
    <Svg {...props}>
      <path className="bell-body" d="M5 16.5a7 7 0 0 1 14 0z" />
      <rect className="bell-body" x="3.5" y="16.5" width="17" height="2.8" rx="1.2" />
      <path d="M12 8.2v1.3" />
      <circle className="bell-body" cx="12" cy="7.2" r="1.2" />
      {dings ? (
        <g className="bell-ding">
          <path d="M12 1.8v1.6" />
          <path d="M6.6 3.6l1 1.3" />
          <path d="M17.4 3.6l-1 1.3" />
        </g>
      ) : null}
    </Svg>
  );
}

export function Lantern(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="3.4" r="1.4" />
      <path d="M8.5 7h7l-1.2-2.2H9.7z" />
      <rect x="7.5" y="7" width="9" height="11" rx="2" />
      <path d="M7 18h10v2.6H7z" />
      <path d="M12 10.2c1.6 1.5 1.6 3.3 0 4.8-1.6-1.5-1.6-3.3 0-4.8z" />
    </Svg>
  );
}

export function Sun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      {Array.from({ length: 8 }, (_, k) => {
        const a = (k * Math.PI) / 4;
        const p = (r: number, f: (x: number) => number) => Math.round((12 + r * f(a)) * 100) / 100;
        return <line key={k} x1={p(6.6, Math.cos)} y1={p(6.6, Math.sin)} x2={p(9.4, Math.cos)} y2={p(9.4, Math.sin)} />;
      })}
    </Svg>
  );
}

/** Two overlapping stud-link ovals (the "Chain prices only" badge). */
export function AnchorChain(props: IconProps) {
  return (
    <Svg {...props}>
      <g transform="rotate(-32 12 12)">
        <ellipse cx="7.8" cy="12" rx="5.2" ry="3.3" />
        <path d="M7.8 9.8v4.4" />
        <ellipse cx="16.2" cy="12" rx="5.2" ry="3.3" />
        <path d="M16.2 9.8v4.4" />
      </g>
    </Svg>
  );
}

/** A landing net: an oval hoop on a handle, with a sagging mesh bag below it. */
export function Net(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="9" cy="7.5" rx="6.5" ry="3" />
      <path d="M2.5 7.8c.4 5.8 3.3 11.2 6.5 12.7 3.2-1.5 6.1-6.9 6.5-12.7" />
      <path d="M4.6 12.3l6.8-2M6.2 16.5l8-4.6M5.6 10.3l6.3 8.2M9.7 10.5l3.5 5.3" strokeWidth={1.25} />
      <path d="M15.2 6.3l6.3-4" />
    </Svg>
  );
}

export function MessageBottle(props: IconProps) {
  return (
    <Svg {...props}>
      <g transform="rotate(-35 12 12)">
        <rect x="10.6" y="1.4" width="2.8" height="2.2" rx=".6" />
        <path d="M10.5 3.6v2.6c-2.4 1-3.5 2.5-3.5 5V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-7.8c0-2.5-1.1-4-3.5-5V3.6" />
        <rect x="9.4" y="11.5" width="5.2" height="6.5" rx="1.2" strokeWidth={1.5} />
        <path d="M9.4 14.7h5.2" strokeWidth={1.25} />
      </g>
    </Svg>
  );
}

export function CompassRose(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 4.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z" />
    </Svg>
  );
}

/** A round mooring buoy riding the waterline: a banded ball with a small ring top mark (short and wide, unlike the lighthouse). */
export function Buoy(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 16.5A6 6 0 1 1 16.5 16.5" />
      <path d="M6.3 10.5h11.4M6.1 13.5h11.8" strokeWidth={1.5} />
      <path d="M12 6.5V4" />
      <circle cx="12" cy="2.6" r="1.3" strokeWidth={1.5} />
      <path d="M2.5 19c1.6-1 3.2-1 4.8 0s3.2 1 4.8 0 3.2-1 4.8 0 3.2 1 4.6 0" />
    </Svg>
  );
}

export function Lighthouse(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 21h13" />
      <path d="M9 21l1.2-11.5h3.6L15 21z" />
      <path d="M9.6 15h4.8" />
      <path d="M9.5 9.5v-3h5v3" />
      <path d="M9 6.5l3-3 3 3" />
      <path d="M4.5 6.5l3 .8M19.5 6.5l-3 .8" />
    </Svg>
  );
}

/**
 * The life-ring emblem (wordmark, board corner, favicon, OG image): four red segments on cream,
 * outlined, with four rope-wrap ticks. Colors come from the --ring-* tokens.
 */
export function LifeRing({ size = 24, className, ...rest }: IconProps) {
  const r = 7.75;
  const seg = (2 * Math.PI * r) / 8;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      {...rest}
    >
      <circle cx="12" cy="12" r={r} stroke="var(--ring-b)" strokeWidth="5.5" />
      <circle
        cx="12"
        cy="12"
        r={r}
        stroke="var(--ring-a)"
        strokeWidth="5.5"
        strokeDasharray={`${seg.toFixed(3)} ${seg.toFixed(3)}`}
        transform={`rotate(${-90 - 22.5} 12 12)`}
      />
      <circle cx="12" cy="12" r="10.5" stroke="var(--ring-line)" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="5" stroke="var(--ring-line)" strokeWidth="1.3" />
      {[45, 135, 225, 315].map((deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        const p = (rr: number, f: (x: number) => number) => Math.round((12 + rr * f(a)) * 100) / 100;
        return <line key={deg} x1={p(4.4, Math.cos)} y1={p(4.4, Math.sin)} x2={p(11.1, Math.cos)} y2={p(11.1, Math.sin)} stroke="var(--ring-line)" strokeWidth="1.3" strokeLinecap="round" />;
      })}
    </svg>
  );
}
