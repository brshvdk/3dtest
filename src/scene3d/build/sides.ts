/**
 * Место у проёма по бокам — до угла комнаты. Наличник двери и подоконник
 * выступают за края проёма; у самого угла они не должны заходить в соседнюю
 * стену (внутренний угол) или висеть в воздухе за наружным углом — их
 * подрезают по углу, как сделал бы монтажник.
 *
 * Вершины «на прямой» (стена разделена точкой) углом не считаются: место
 * продолжается по соседней стене.
 */
import type { Corner, Opening, Wall } from "../../domain/types";

export interface SideRoom {
  /** м от края проёма до угла вдоль стены (Infinity — угла нет). */
  room: number;
  /**
   * На сколько граница сдвигается к проёму на каждый метр выступа от стены:
   * у острого внутреннего угла (< 90°) соседняя стена «наклонена» над
   * деталью — cot θ. Для прямого, тупого и наружного угла 0.
   */
  slope: number;
}

export interface OpeningSides {
  left: SideRoom;
  right: SideRoom;
}

export const FREE_SIDE: SideRoom = { room: Infinity, slope: 0 };
export const FREE_SIDES: OpeningSides = { left: FREE_SIDE, right: FREE_SIDE };

/**
 * Место слева (к началу стены) и справа (к концу) от проёма. corners[i] —
 * угол в начале стены i (между стенами i−1 и i), как в getCorners().
 */
export function openingSides(walls: Wall[], corners: Corner[], wall: Wall, o: Opening): OpeningSides {
  const n = walls.length;
  if (n < 3 || corners.length !== n) return FREE_SIDES;
  const side = (toStart: boolean): SideRoom => {
    let room = toStart ? o.offset : wall.length - o.offset - o.width;
    let i = wall.index;
    for (let step = 0; step < n; step++) {
      const c = corners[toStart ? i : (i + 1) % n];
      if (!c) break;
      if (c.kind !== "straight") {
        const slope = c.kind === "inner" && c.angle < 90 ? 1 / Math.tan((Math.max(c.angle, 1) * Math.PI) / 180) : 0;
        return { room, slope };
      }
      i = toStart ? (i - 1 + n) % n : (i + 1) % n;
      if (i === wall.index) break;
      room += walls[i]?.length ?? 0;
    }
    return FREE_SIDE;
  };
  return { left: side(true), right: side(false) };
}

/**
 * Выступ детали за край проёма с учётом места до угла: деталь толщиной
 * depth (от стены в комнату) не заходит за угол. Не меньше 0.
 */
export function clipExtent(ext: number, side: SideRoom, depth: number): number {
  if (!(ext > 0)) return 0;
  return Math.max(0, Math.min(ext, side.room - side.slope * Math.max(0, depth)));
}

export function sameSides(a: OpeningSides, b: OpeningSides): boolean {
  return (
    a.left.room === b.left.room &&
    a.left.slope === b.left.slope &&
    a.right.room === b.right.room &&
    a.right.slope === b.right.slope
  );
}
