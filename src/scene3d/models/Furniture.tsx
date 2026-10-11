/**
 * Мебель у стены (участок без плинтуса): кухня со столешницей и варочной
 * панелью, шкаф-купе, распашной шкаф, ванна, прочее. Локальная система —
 * как у проёмов: x вдоль стены, y вверх, z в комнату (мебель z ∈ [0, depth]).
 */
import type { Opening } from "../../domain/types";
import type { Palette } from "../materials";
import { Box } from "./Box";

type FurnitureType = "kitchen" | "wardrobe" | "closet" | "bath" | "other";

export function furnitureType(o: Opening): FurnitureType {
  switch (o.presetId) {
    case "furn-kitchen":
      return "kitchen";
    case "furn-wardrobe":
      return "wardrobe";
    case "furn-closet":
      return "closet";
    case "furn-bath":
      return "bath";
    case "furn-other":
      return "other";
  }
  const l = o.label.toLowerCase();
  if (/кух|гарнитур/.test(l)) return "kitchen";
  if (/купе|гардероб/.test(l)) return "wardrobe";
  if (/шкаф/.test(l)) return "closet";
  if (/ванн/.test(l)) return "bath";
  if (o.height >= 1.8) return "closet";
  if (o.height >= 0.75 && o.height <= 1.0) return "kitchen";
  return "other";
}

/** Деление на секции примерно по step м. */
function sections(width: number, step: number, min = 1): number[] {
  const n = Math.max(min, Math.round(width / step));
  return Array.from({ length: n + 1 }, (_, k) => (width * k) / n);
}

function Kitchen({ W, D, H, p }: { W: number; D: number; H: number; p: Palette }) {
  const top = 0.038;
  const plinth = Math.min(0.1, H * 0.15);
  const fz = D - 0.02;
  const xs = sections(W, 0.6);
  const hobX = xs.length > 3 ? (xs[1] + xs[2]) / 2 : W * 0.35;
  const sinkX = xs.length > 4 ? (xs[xs.length - 3] + xs[xs.length - 2]) / 2 : W * 0.75;
  return (
    <group>
      <Box b={[0, W, 0, plinth, 0, D - 0.07]} m={p.dark} />
      <Box b={[0, W, plinth, H - top, 0, fz]} m={p.body} />
      {xs.slice(0, -1).map((x, k) => {
        const x1 = xs[k + 1];
        return (
          <group key={k}>
            <Box b={[x + 0.002, x1 - 0.002, plinth + 0.004, H - top - 0.004, fz, D]} m={p.front} />
            <Box b={[(x + x1) / 2 - 0.08, (x + x1) / 2 + 0.08, H - top - 0.06, H - top - 0.048, D, D + 0.018]} m={p.metal} />
          </group>
        );
      })}
      <Box b={[-0.002, W + 0.002, H - top, H, 0, D + 0.02]} m={p.top} />
      {W >= 1.2 ? (
        <>
          <Box b={[hobX - 0.28, hobX + 0.28, H, H + 0.006, D / 2 - 0.25, D / 2 + 0.25]} m={p.dark} cast={false} />
          {W >= 1.8 ? (
            <>
              <Box b={[sinkX - 0.3, sinkX + 0.3, H, H + 0.004, D / 2 - 0.22, D / 2 + 0.22]} m={p.metal} cast={false} />
              <Box b={[sinkX - 0.015, sinkX + 0.015, H, H + 0.25, 0.06, 0.09]} m={p.metal} />
              <Box b={[sinkX - 0.012, sinkX + 0.012, H + 0.23, H + 0.25, 0.06, 0.24]} m={p.metal} />
            </>
          ) : null}
        </>
      ) : null}
    </group>
  );
}

function Wardrobe({ W, D, H, p }: { W: number; D: number; H: number; p: Palette }) {
  const xs = sections(W, 0.9, 2);
  const n = xs.length - 1;
  const doorW = W / n;
  return (
    <group>
      <Box b={[0, W, 0, H, 0, D - 0.06]} m={p.body} />
      <Box b={[0, W, 0, 0.06, D - 0.06, D - 0.01]} m={p.body} />
      <Box b={[0, W, H - 0.06, H, D - 0.06, D]} m={p.body} />
      {xs.slice(0, -1).map((x, k) => {
        const z = k % 2 === 0 ? D - 0.035 : D - 0.06;
        const x0 = k === 0 ? x : x - 0.02;
        const x1 = Math.min(W, x0 + doorW + (k === 0 ? 0.02 : 0.02));
        return (
          <group key={k}>
            <Box b={[x0, x1, 0.06, H - 0.06, z, z + 0.022]} m={k % 2 === 0 ? p.mirror : p.wood} />
            <Box b={[x0, x0 + 0.018, 0.06, H - 0.06, z + 0.022, z + 0.03]} m={p.metal} />
            <Box b={[x1 - 0.018, x1, 0.06, H - 0.06, z + 0.022, z + 0.03]} m={p.metal} />
          </group>
        );
      })}
    </group>
  );
}

function Closet({ W, D, H, p }: { W: number; D: number; H: number; p: Palette }) {
  const xs = sections(W, 0.5, 2);
  const plinth = 0.07;
  return (
    <group>
      <Box b={[0, W, 0, plinth, 0, D - 0.05]} m={p.dark} />
      <Box b={[0, W, plinth, H, 0, D - 0.02]} m={p.body} />
      {xs.slice(0, -1).map((x, k) => {
        const x1 = xs[k + 1];
        const hx = k % 2 === 0 ? x1 - 0.05 : x + 0.05;
        return (
          <group key={k}>
            <Box b={[x + 0.002, x1 - 0.002, plinth + 0.004, H - 0.004, D - 0.02, D]} m={p.wood} />
            <Box b={[hx - 0.008, hx + 0.008, H * 0.45, H * 0.45 + 0.22, D, D + 0.022]} m={p.metal} />
          </group>
        );
      })}
    </group>
  );
}

function Bath({ W, D, H, p }: { W: number; D: number; H: number; p: Palette }) {
  const rim = 0.07;
  const depth = Math.min(0.42, H - 0.08);
  return (
    <group>
      <Box b={[0, W, 0, H, D - rim, D]} m={p.gloss} />
      <Box b={[0, W, 0, H, 0, rim]} m={p.gloss} />
      <Box b={[0, rim, 0, H, rim, D - rim]} m={p.gloss} />
      <Box b={[W - rim, W, 0, H, rim, D - rim]} m={p.gloss} />
      <Box b={[rim, W - rim, 0, H - depth, rim, D - rim]} m={p.gloss} />
      <Box b={[W - rim - 0.12, W - rim - 0.02, H, H + 0.03, rim * 0.3, rim * 0.7]} m={p.metal} />
      <Box b={[W - rim - 0.09, W - rim - 0.05, H + 0.02, H + 0.04, rim * 0.5, rim + 0.13]} m={p.metal} />
    </group>
  );
}

function Generic({ W, D, H, p }: { W: number; D: number; H: number; p: Palette }) {
  return (
    <group>
      <Box b={[0, W, 0, H, 0, D]} m={p.body} />
      <Box b={[0.01, W - 0.01, H, H + 0.004, 0.01, D - 0.01]} m={p.front} cast={false} />
    </group>
  );
}

/** maxH — высота среза стен (режим «Низкие»): высокая мебель становится «следом» на полу. */
export function FurnitureModel({ o, p, maxH }: { o: Opening; p: Palette; maxH: number }) {
  const W = o.width;
  const D = Math.max(0.15, o.depth || 0.6);
  const H = Math.max(0.1, Math.min(o.height, maxH));
  switch (furnitureType(o)) {
    case "kitchen":
      return <Kitchen W={W} D={D} H={H} p={p} />;
    case "wardrobe":
      return <Wardrobe W={W} D={D} H={H} p={p} />;
    case "closet":
      return <Closet W={W} D={D} H={H} p={p} />;
    case "bath":
      return <Bath W={W} D={D} H={H} p={p} />;
    default:
      return <Generic W={W} D={D} H={H} p={p} />;
  }
}
