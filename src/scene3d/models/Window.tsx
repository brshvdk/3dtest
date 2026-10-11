/**
 * Окно и балконный блок: рама ПВХ, импосты, створки со стеклом, ручки,
 * подоконник с комнатной стороны и отлив снаружи. Локальная система — как у
 * двери (x вдоль стены, y вверх, z в комнату; стена z ∈ [−толщина, 0]).
 */
import { windowSashCount } from "../../domain/openings";
import type { Opening } from "../../domain/types";
import { FREE_SIDES, clipExtent, type OpeningSides } from "../build/sides";
import type { Palette } from "../materials";
import { Box } from "./Box";

/** Ширина и глубина рамы, м. */
const FW = 0.06;
const FD = 0.07;
/** Ширина профиля створки, м. */
const SW = 0.055;
/** Подоконник: выступ за откосы с каждой стороны и вынос в комнату, м. */
const SILL_EXT = 0.05;
const SILL_OUT = 0.065;

/** Глубина плоскости окна от внутренней грани (окно ближе к улице). */
export function windowDepth(th: number): number {
  return -Math.max(FD / 2 + 0.01, th * 0.58);
}

function Sash({
  x0,
  x1,
  y0,
  y1,
  zc,
  handle,
  panel,
  p,
}: {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zc: number;
  /** Сторона ручки: -1 слева, 1 справа, 0 без ручки. */
  handle: -1 | 0 | 1;
  /** Доля глухой панели снизу (балконная дверь). */
  panel?: number;
  p: Palette;
}) {
  if (x1 - x0 < 2 * SW + 0.02 || y1 - y0 < 2 * SW + 0.02) return null;
  const za = zc - FD / 2 + 0.008;
  const zb = zc + FD / 2 + 0.006;
  const gx0 = x0 + SW;
  const gx1 = x1 - SW;
  const gy1 = y1 - SW;
  let gy0 = y0 + SW;
  const parts = [
    <Box key="l" b={[x0, x0 + SW, y0, y1, za, zb]} m={p.pvc} />,
    <Box key="r" b={[x1 - SW, x1, y0, y1, za, zb]} m={p.pvc} />,
    <Box key="b" b={[gx0, gx1, y0, y0 + SW, za, zb]} m={p.pvc} />,
    <Box key="t" b={[gx0, gx1, y1 - SW, y1, za, zb]} m={p.pvc} />,
  ];
  if (panel && panel > 0) {
    const py = y0 + (y1 - y0) * panel;
    parts.push(<Box key="pn" b={[gx0, gx1, gy0, py, zc - 0.012, zc + 0.012]} m={p.pvc} />);
    parts.push(<Box key="pr" b={[gx0, gx1, py, py + 0.045, za, zb]} m={p.pvc} />);
    gy0 = py + 0.045;
  }
  parts.push(<Box key="g" b={[gx0, gx1, gy0, gy1, zc - 0.004, zc + 0.004]} m={p.glass} cast={false} />);
  if (handle !== 0) {
    const hx = handle < 0 ? x0 + SW / 2 : x1 - SW / 2;
    const hy = y0 + Math.min(1.05, (y1 - y0) * 0.5);
    parts.push(<Box key="h1" b={[hx - 0.014, hx + 0.014, hy - 0.035, hy + 0.035, zb, zb + 0.012]} m={p.pvc} />);
    parts.push(<Box key="h2" b={[hx - 0.009, hx + 0.009, hy - 0.13, hy, zb + 0.012, zb + 0.03]} m={p.pvc} />);
  }
  return <group>{parts}</group>;
}

/** Оконный блок в прямоугольнике [x0, x1] × [y0, y1]. */
export function WindowUnit({
  x0,
  x1,
  y0,
  y1,
  th,
  door,
  sill,
  sillLeft = SILL_EXT,
  sillRight = SILL_EXT,
  p,
}: {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  th: number;
  /** Балконная дверь: одна створка с глухой панелью снизу. */
  door?: boolean;
  /** Подоконник и отлив (окно не в пол). */
  sill: boolean;
  /** Выступ подоконника за x0 / x1 (у угла комнаты — меньше), м. */
  sillLeft?: number;
  sillRight?: number;
  p: Palette;
}) {
  const zc = windowDepth(th);
  const z0 = zc - FD / 2;
  const z1 = zc + FD / 2;
  const w = x1 - x0;
  const ix0 = x0 + FW;
  const ix1 = x1 - FW;
  const iy0 = y0 + FW;
  const iy1 = y1 - FW;
  const sashes: JSX.Element[] = [];
  if (door) {
    sashes.push(<Sash key="d" x0={ix0} x1={ix1} y0={iy0} y1={iy1} zc={zc} handle={1} panel={0.38} p={p} />);
  } else {
    const n = windowSashCount(w);
    const sw = (ix1 - ix0 - (n - 1) * FW) / n;
    for (let k = 0; k < n; k++) {
      const sx0 = ix0 + k * (sw + FW);
      const sx1 = sx0 + sw;
      if (k > 0) sashes.push(<Box key={`m${k}`} b={[sx0 - FW, sx0, iy0, iy1, z0, z1]} m={p.pvc} />);
      // Ручка у открывающихся створок: у одностворчатого — справа, иначе у импоста.
      const handle: -1 | 0 | 1 = n === 1 ? 1 : n === 2 ? (k === 1 ? -1 : 0) : k === 1 ? 1 : 0;
      sashes.push(<Sash key={`s${k}`} x0={sx0 + 0.004} x1={sx1 - 0.004} y0={iy0 + 0.004} y1={iy1 - 0.004} zc={zc} handle={handle} p={p} />);
    }
  }
  return (
    <group>
      <Box b={[x0, ix0, y0, y1, z0, z1]} m={p.pvc} />
      <Box b={[ix1, x1, y0, y1, z0, z1]} m={p.pvc} />
      <Box b={[ix0, ix1, y0, iy0, z0, z1]} m={p.pvc} />
      <Box b={[ix0, ix1, iy1, y1, z0, z1]} m={p.pvc} />
      {sashes}
      {sill ? (
        <>
          <Box b={[x0 - sillLeft, x1 + sillRight, y0 - 0.022, y0 + 0.004, z1 - 0.004, SILL_OUT]} m={p.sill} />
          <Box b={[x0 - 0.02, x1 + 0.02, y0 - 0.014, y0 - 0.004, -th - 0.05, z0]} m={p.metal} />
        </>
      ) : null}
    </group>
  );
}

/** Подоконник у угла комнаты подрезан по соседней стене. */
function sillSpan(sides: OpeningSides): { left: number; right: number } {
  return { left: clipExtent(SILL_EXT, sides.left, SILL_OUT), right: clipExtent(SILL_EXT, sides.right, SILL_OUT) };
}

export function WindowModel({
  o,
  th,
  p,
  cut,
  sides = FREE_SIDES,
}: {
  o: Opening;
  th: number;
  p: Palette;
  cut: number;
  sides?: OpeningSides;
}) {
  if (o.elevation >= cut) return null;
  const s = sillSpan(sides);
  return (
    <WindowUnit
      x0={0}
      x1={o.width}
      y0={o.elevation}
      y1={o.elevation + o.height}
      th={th}
      sill={o.elevation > 0.05}
      sillLeft={s.left}
      sillRight={s.right}
      p={p}
    />
  );
}

export function BalconyModel({
  o,
  th,
  p,
  cut,
  sides = FREE_SIDES,
}: {
  o: Opening;
  th: number;
  p: Palette;
  cut: number;
  sides?: OpeningSides;
}) {
  const W = o.width;
  const H = o.height;
  const dw = Math.max(0, Math.min(o.balconyDoorWidth, W));
  const sill = Math.max(0, Math.min(o.balconySillHeight, H));
  const left = o.balconyDoorSide === "left";
  const d0 = left ? 0 : W - dw;
  const d1 = left ? dw : W;
  const w0 = left ? dw : 0;
  const w1 = left ? W : W - dw;
  return (
    <group>
      {dw > 0.2 ? <WindowUnit x0={d0} x1={d1} y0={0} y1={H} th={th} door sill={false} p={p} /> : null}
      {w1 - w0 > 0.2 && sill < cut ? (
        <WindowUnit
          x0={w0}
          x1={w1}
          y0={sill}
          y1={H}
          th={th}
          sill={sill > 0.05}
          sillLeft={left ? undefined : sillSpan(sides).left}
          sillRight={left ? sillSpan(sides).right : undefined}
          p={p}
        />
      ) : null}
    </group>
  );
}
