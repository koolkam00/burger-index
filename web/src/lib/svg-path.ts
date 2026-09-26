// Smaller SVG paths for the price badges (app/badge/[file]/route.tsx). Satori draws text as absolute
// outlines ("M73.1 44.9Q73.2 44.9 73.3 44.9L73.3 44.9L74.5 44.9…", a tenth of a pixel apart), so a badge's
// three lines of type came to about 43 KB. The same outlines written relative to the pen, with zero-length
// lines dropped, horizontal and vertical lines shortened and repeated commands implied, draw the same shape
// in about half that. Coordinates are kept to the tenth of a pixel Satori already rounds to; working in
// whole tenths means no rounding error builds up along a path.

const TOKEN = /[MLHVQCZmlhvqcz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g;

/** A number of tenths as the shortest SVG number: 5 → ".5", -15 → "-1.5", 20 → "2". */
function num(tenths: number): string {
  const neg = tenths < 0;
  const abs = Math.abs(tenths);
  const whole = Math.floor(abs / 10);
  const frac = abs % 10;
  const text = frac ? `${whole ? whole : ""}.${frac}` : `${whole}`;
  return neg ? `-${text}` : text;
}

/**
 * The path's absolute M/L/Q/C/Z commands as relative ones (anything else, or a path this can't read,
 * comes back as it was).
 */
export function compactPath(d: string): string {
  const tokens = d.match(TOKEN);
  if (!tokens || tokens.join("").replace(/\s/g, "").length !== d.replace(/[\s,]/g, "").length) return d;
  if (tokens.some((t) => /^[a-zHV]$/.test(t))) return d;
  const out: string[] = [];
  let last = "";
  // Emit a command and its numbers: the letter only when it changes (after "m" the implied command is "l").
  const emit = (cmd: string, values: number[]) => {
    const implied = cmd === last || (cmd === "l" && last === "m");
    let s = implied && values.length ? "" : cmd;
    values.forEach((v, i) => {
      const n = num(v);
      s += (i === 0 && !implied) || n.startsWith("-") ? n : ` ${n}`;
    });
    out.push(s);
    last = cmd === "m" ? "m" : cmd;
  };
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const read = () => Math.round(Number(tokens[i++]) * 10);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "Z") {
      emit("z", []);
      x = sx;
      y = sy;
      continue;
    }
    const arity = cmd === "M" || cmd === "L" ? 2 : cmd === "Q" ? 4 : cmd === "C" ? 6 : -1;
    if (arity < 0) return d;
    // Absolute commands may repeat their coordinates without the letter.
    do {
      const v = Array.from({ length: arity }, read);
      if (v.some((n) => Number.isNaN(n))) return d;
      const [ex, ey] = v.slice(-2);
      if (cmd === "M") {
        emit("m", [ex - x, ey - y]);
        sx = ex;
        sy = ey;
      } else if (cmd === "L") {
        if (ex === x && ey === y) {
          // a line to where the pen already is draws nothing
        } else if (ey === y) emit("h", [ex - x]);
        else if (ex === x) emit("v", [ey - y]);
        else emit("l", [ex - x, ey - y]);
      } else {
        emit(cmd === "Q" ? "q" : "c", v.map((n, k) => n - (k % 2 ? y : x)));
      }
      x = ex;
      y = ey;
    } while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]));
  }
  // A path must start with a moveto: the first "m" is relative to the origin, the same as an absolute one.
  return out.join("");
}

/** Every `d="…"` in an SVG, compacted. */
export function compactSvgPaths(svg: string): string {
  return svg.replace(/\sd="([^"]*)"/g, (whole, d: string) => ` d="${compactPath(d)}"`);
}
