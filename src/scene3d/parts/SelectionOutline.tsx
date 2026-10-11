/**
 * Контур выделенного проёма: тонкая линия цвета акцента точно по краю
 * отверстия в стене — с аркой, Г-образным балконным блоком и наличниками;
 * у мебели — рёбра габарита.
 */
import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { CASING_INSET } from "../../domain/openings";
import type { Opening } from "../../domain/types";
import { FREE_SIDES, type OpeningSides } from "../build/sides";
import { clipHole, openingHole } from "../build/walls";
import { casingSpan } from "../models/Door";

type P3 = [number, number, number];

const noRaycast = () => null;
/** Зазор между контуром и краем проёма, м. */
const GAP = 0.012;
/** Толщина наличника (как в models/Door), м: контур лежит перед ним. */
const CASING_FRONT = 0.016;

function rect(x0: number, x1: number, y0: number, y1: number, z: number): P3[] {
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
    [x0, y0, z],
  ];
}

function boxEdges(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): P3[] {
  const c: P3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  return e.map((i) => c[i]);
}

/**
 * Контур отверстия (как его режет стена) с отступом GAP наружу:
 * низ — слева направо, верх — справа налево, замкнутый.
 */
function holeOutline(o: Opening, cut: number, z: number): P3[] | null {
  const hole = openingHole({ ...o, offset: 0 }, o.width);
  const h = hole ? clipHole(hole, cut) : null;
  if (!h || h.length < 2) return null;
  const n = h.length;
  const out: P3[] = [];
  // Отступ по x у крайних отсчётов, по y — от низа вниз и от верха вверх.
  const xOf = (i: number) => h[i].u + (i === 0 ? -GAP : i === n - 1 ? GAP : 0);
  for (let i = 0; i < n; i++) out.push([xOf(i), Math.max(0.003, h[i].b - (h[i].b > 0.01 ? GAP : 0)), z]);
  for (let i = n - 1; i >= 0; i--) out.push([xOf(i), Math.min(h[i].t + GAP, cut), z]);
  out.push(out[0]);
  return out;
}

/** Проём целиком выше среза стен (окно в режиме «Низкие»): рамка на торце стены. */
function topMarker(W: number, th: number, y: number): P3[] {
  return [
    [-GAP, y, 0.004],
    [W + GAP, y, 0.004],
    [W + GAP, y, -th - 0.004],
    [-GAP, y, -th - 0.004],
    [-GAP, y, 0.004],
  ];
}

export function SelectionOutline({
  o,
  th,
  color,
  cut,
  sides = FREE_SIDES,
}: {
  o: Opening;
  th: number;
  color: string;
  cut: number;
  sides?: OpeningSides;
}) {
  const { rings, segments } = useMemo((): { rings: P3[][]; segments: boolean } => {
    const W = o.width;
    if (o.kind === "furniture") {
      const D = Math.max(0.15, o.depth || 0.6);
      return {
        rings: [boxEdges(-0.01, W + 0.01, 0.002, Math.min(o.height, cut) + 0.01, -0.005, D + 0.03)],
        segments: true,
      };
    }
    // Снаружи — по краю отверстия на внешней грани: в режиме «Все» проём выделен и с улицы.
    const outer = holeOutline(o, cut, -th - 0.004);
    if (!outer) return { rings: [topMarker(W, th, cut + 0.003)], segments: false };
    // Дверь/портал с наличниками: изнутри контур по внешнему краю наличников.
    if ((o.kind === "door" || o.kind === "passage") && o.casing > 0 && !(o.kind === "passage" && o.arch)) {
      // У угла наличник подрезан — и контур не заходит в соседнюю стену.
      const span = casingSpan(o, sides);
      const x0 = -span.left - Math.min(GAP, Math.max(0, sides.left.room - span.left));
      const x1 = W + span.right + Math.min(GAP, Math.max(0, sides.right.room - span.right));
      const top = Math.min(o.height - CASING_INSET + o.casing, cut);
      return { rings: [rect(x0, x1, 0.003, top + GAP, CASING_FRONT), outer], segments: false };
    }
    return { rings: [holeOutline(o, cut, 0.004) ?? outer, outer], segments: false };
  }, [o, th, cut, sides]);

  // Два прохода: чёткая линия там, где проём виден, и бледная «рентгеновская» —
  // где его загораживает стена или полотно двери (в режиме «Все» контур не висит поверх стены).
  return (
    <group>
      {rings.map((points, i) => (
        <group key={i}>
          <Line
            points={points}
            segments={segments}
            color={color}
            lineWidth={2}
            transparent
            opacity={0.28}
            depthTest={false}
            depthWrite={false}
            renderOrder={9}
            raycast={noRaycast}
          />
          <Line
            points={points}
            segments={segments}
            color={color}
            lineWidth={2}
            depthWrite={false}
            renderOrder={10}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
}
