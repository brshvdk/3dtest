/**
 * Интерактивные SVG-слои поверх статичного плана: подсветка наведения и
 * выделения, ручки вершин, направляющие, размеры выделенного проёма,
 * подсветка участка плинтуса. Каждый слой подписан только на свой кусок
 * состояния — наведение не перерисовывает весь план.
 */
import { memo } from "react";
import type { Room, Vec2, Wall } from "../domain/types";
import { useAppStore } from "../state/store";
import { onWall, openingExtent, polysToPath, r, wallDimLines, type SkirtLine } from "./geom";
import { dimChipPos, openingDimItems, openingDimPerp, type WallLabelLayout } from "./Labels";
import { usePlanUi } from "./planUi";

const pts = (poly: readonly Vec2[], s: number): string =>
  poly.map((p) => `${r(p.x * s)},${r(p.y * s)}`).join(" ");

/** Выделение в активной комнате (или null). */
function useRoomSelection(roomId: string) {
  return useAppStore((st) => (st.selection && st.selection.roomId === roomId ? st.selection : null));
}

/** Размерная линия внутри комнаты вдоль стены: от a0 до a1 на расстоянии perp. */
export function dimPath(w: Wall, a0: number, a1: number, perp: number, s: number): string {
  const p = onWall(w, a0, perp);
  const q = onWall(w, a1, perp);
  const e0 = onWall(w, a0, 0);
  const e1 = onWall(w, a1, 0);
  const t = 4 / s;
  const k = { x: (w.dir.x + w.normalIn.x) * t, y: (w.dir.y + w.normalIn.y) * t };
  const tick = (v: Vec2) => `M${r((v.x - k.x) * s)} ${r((v.y - k.y) * s)}L${r((v.x + k.x) * s)} ${r((v.y + k.y) * s)}`;
  const ext = (a: Vec2, b: Vec2) => `M${r(a.x * s)} ${r(a.y * s)}L${r(b.x * s)} ${r(b.y * s)}`;
  const over = { x: w.normalIn.x * (4 / s), y: w.normalIn.y * (4 / s) };
  return (
    ext(p, q) +
    tick(p) +
    tick(q) +
    ext(e0, { x: p.x + over.x, y: p.y + over.y }) +
    ext(e1, { x: q.x + over.x, y: q.y + over.y })
  );
}

export interface SelectionLayerProps {
  room: Room;
  walls: readonly Wall[];
  piecesByWall: ReadonlyMap<string, Vec2[][]>;
  s: number;
  /** м от внутренней грани до размерных линий проёма. */
  dimPerp: number;
  coarse: boolean;
  /** Плашки стен: плашку размера проёма, вынесенную за угол, отводим от них. */
  labels: WallLabelLayout;
}

export const SelectionLayer = memo(function SelectionLayer({
  room,
  walls,
  piecesByWall,
  s,
  dimPerp,
  coarse,
  labels,
}: SelectionLayerProps) {
  const sel = useRoomSelection(room.id);
  const hover = usePlanUi((u) => u.hover);
  // Стена, на строку которой навели в боковой панели (hoverWallId), — подсвечиваем как наведённую на плане.
  const panelHoverWallId = useAppStore((st) => st.hoverWallId);
  const inRoom = usePlanUi((u) => u.inRoom);
  const drag = usePlanUi((u) => u.drag);

  const wallById = new Map(walls.map((w) => [w.id, w]));
  const selWallId = sel?.type === "wall" ? sel.wallId : null;
  const hoverWallIds = [hover?.type === "wall" ? hover.id : null, panelHoverWallId].filter(
    (id, i, all): id is string => !!id && id !== selWallId && piecesByWall.has(id) && all.indexOf(id) === i,
  );

  const openingOutline = (id: string, cls: string) => {
    const o = room.openings.find((x) => x.id === id);
    const w = o && wallById.get(o.wallId);
    if (!o || !w) return null;
    const e = openingExtent(o, w);
    const pad = 3 / s;
    const poly = [
      onWall(w, e.a0 - pad, e.p0 - pad),
      onWall(w, e.a1 + pad, e.p0 - pad),
      onWall(w, e.a1 + pad, e.p1 + pad),
      onWall(w, e.a0 - pad, e.p1 + pad),
    ];
    return <polygon className={cls} points={pts(poly, s)} />;
  };

  // Размеры «от левого угла / до правого угла» у выделенного проёма.
  let dims: JSX.Element | null = null;
  let centerMark: JSX.Element | null = null;
  if (sel?.type === "opening") {
    const o = room.openings.find((x) => x.id === sel.openingId);
    const w = o && wallById.get(o.wallId);
    if (o && w) {
      const perp = openingDimPerp(o, s, dimPerp);
      let d = "";
      for (const it of openingDimItems(o, w, s)) {
        d += dimPath(w, it.from, it.to, perp, s);
        const at = dimChipPos(w, it, perp, s, labels);
        if (it.tight || at.perp !== perp) {
          // Выносная линия к плашке за пределами короткого участка (или отведённой от плашки стены).
          const along = at.along < it.from ? it.from : at.along > it.to ? it.to : at.along;
          const p = onWall(w, along, perp);
          const q = onWall(w, at.along, at.perp);
          d += `M${r(p.x * s)} ${r(p.y * s)}L${r(q.x * s)} ${r(q.y * s)}`;
        }
      }
      dims = <path className="pl-dim" d={d} />;
      if (drag?.kind === "opening" && drag.centered) {
        const c0 = onWall(w, w.length / 2, -w.thickness - 6 / s);
        const c1 = onWall(w, w.length / 2, perp + 8 / s);
        centerMark = (
          <line className="pl-center-mark" x1={r(c0.x * s)} y1={r(c0.y * s)} x2={r(c1.x * s)} y2={r(c1.y * s)} />
        );
      }
    }
  }

  // Направляющие выравнивания при перетаскивании вершины.
  let guides: JSX.Element | null = null;
  if (drag?.kind === "point") {
    const pt = room.points.find((p) => p.id === drag.pointId);
    if (pt) {
      const ext = 24 / s;
      const g: JSX.Element[] = [];
      if (drag.guideX) {
        const y0 = Math.min(pt.y, drag.guideX.y) - ext;
        const y1 = Math.max(pt.y, drag.guideX.y) + ext;
        g.push(<line key="x" className="pl-guide" x1={r(pt.x * s)} y1={r(y0 * s)} x2={r(pt.x * s)} y2={r(y1 * s)} />);
      }
      if (drag.guideY) {
        const x0 = Math.min(pt.x, drag.guideY.x) - ext;
        const x1 = Math.max(pt.x, drag.guideY.x) + ext;
        g.push(<line key="y" className="pl-guide" x1={r(x0 * s)} y1={r(pt.y * s)} x2={r(x1 * s)} y2={r(pt.y * s)} />);
      }
      guides = <g>{g}</g>;
    }
  }

  const showHandles = inRoom || !!sel || (!!drag && drag.kind !== "pan");
  const hr = coarse ? 7 : 5.5;

  return (
    <g className="pl-sel">
      {hoverWallIds.map((id) => (
        <path key={id} className="pl-wall--hover" d={polysToPath(piecesByWall.get(id) ?? [], s)} />
      ))}
      {selWallId ? <path className="pl-wall--sel" d={polysToPath(piecesByWall.get(selWallId) ?? [], s)} /> : null}
      {hover?.type === "opening" && !(sel?.type === "opening" && sel.openingId === hover.id)
        ? openingOutline(hover.id, "pl-op--hover")
        : null}
      {sel?.type === "opening" ? openingOutline(sel.openingId, "pl-op--sel") : null}
      {dims}
      {centerMark}
      {guides}
      {showHandles ? (
        <g className="pl-handles">
          {room.points.map((p) => {
            const isSel = sel?.type === "point" && sel.pointId === p.id;
            const isHover = hover?.type === "point" && hover.id === p.id;
            return (
              <circle
                key={p.id}
                className={`pl-handle${isSel ? " is-sel" : isHover ? " is-hover" : ""}`}
                cx={r(p.x * s)}
                cy={r(p.y * s)}
                r={isSel || isHover ? hr + 1.5 : hr}
              />
            );
          })}
        </g>
      ) : null}
    </g>
  );
});

/** Подсветка участка плинтуса (hoverSegmentId ставят план, раскрой и 3D). */
export const SkirtHoverLayer = memo(function SkirtHoverLayer({
  lines,
  s,
  width,
}: {
  lines: readonly SkirtLine[];
  s: number;
  width: number;
}) {
  const id = useAppStore((st) => st.hoverSegmentId);
  const l = id ? lines.find((x) => x.id === id) : undefined;
  if (!l) return null;
  const d = `M${r(l.p.x * s)} ${r(l.p.y * s)}L${r(l.q.x * s)} ${r(l.q.y * s)}`;
  return (
    <g className="pl-skirt-hl" pointerEvents="none">
      <path className="pl-skirt-hl__glow" d={d} style={{ strokeWidth: width + 8 }} />
      <path className="pl-skirt-hl__line" d={d} style={{ strokeWidth: width + 1.5 }} />
    </g>
  );
});

/**
 * Размерные линии стен снаружи: выносные от внешней грани и линия на уровне
 * плашки «A · 4,50 м» (плашка лежит на ней). У входящих углов линии
 * соседних стен не перекрещиваются, а сходятся уголком.
 */
export const WallDims = memo(function WallDims({
  walls,
  layout,
  s,
}: {
  walls: readonly Wall[];
  layout: WallLabelLayout;
  s: number;
}) {
  let d = "";
  let ticks = "";
  const seg = (p: Vec2, q: Vec2) => `M${r(p.x * s)} ${r(p.y * s)}L${r(q.x * s)} ${r(q.y * s)}`;
  const lines = wallDimLines(walls, (w) => {
    const spot = layout.get(w.id);
    return spot && w.length * s >= 18 ? w.thickness + spot.offPx / s : 0;
  });
  for (const l of lines) {
    if (!l) continue;
    const w = l.wall;
    d += seg(l.a, l.b);
    const over = { x: w.normalOut.x * (5 / s), y: w.normalOut.y * (5 / s) };
    const t = 3.5 / s;
    const k = { x: (w.dir.x + w.normalIn.x) * t, y: (w.dir.y + w.normalIn.y) * t };
    const end = (p: Vec2, along: number) => {
      d += seg(onWall(w, along, -w.thickness - 3 / s), { x: p.x + over.x, y: p.y + over.y });
      ticks += seg({ x: p.x - k.x, y: p.y - k.y }, { x: p.x + k.x, y: p.y + k.y });
    };
    if (!l.openA) end(l.a, 0);
    if (!l.openB) end(l.b, w.length);
  }
  return (
    <g className="pl-wdims" pointerEvents="none">
      <path className="pl-wdims__line" d={d} />
      <path className="pl-wdims__tick" d={ticks} />
    </g>
  );
});
