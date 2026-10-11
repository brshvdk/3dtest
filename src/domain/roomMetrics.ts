/**
 * Метрики комнаты для сводки и будущих материалов (краска, обои, ламинат):
 * площади пола/стен/потолка, объём, углы.
 */
import { dedupePoints, getCorners, getWalls, polygonArea } from "./geometry";
import { openingWallArea } from "./openings";
import type { Project, Room } from "./types";

export interface RoomMetrics {
  /** м² */
  floorArea: number;
  /** м, внутренний периметр */
  perimeter: number;
  /** м², периметр × высота */
  wallAreaGross: number;
  /** м², Σ проёмов (мебель — 0) */
  openingsArea: number;
  /** м², стены за вычетом проёмов */
  wallAreaNet: number;
  /** м² */
  ceilingArea: number;
  /** м³ */
  volume: number;
  innerCorners: number;
  outerCorners: number;
  walls: number;
}

function emptyMetrics(): RoomMetrics {
  return {
    floorArea: 0,
    perimeter: 0,
    wallAreaGross: 0,
    openingsArea: 0,
    wallAreaNet: 0,
    ceilingArea: 0,
    volume: 0,
    innerCorners: 0,
    outerCorners: 0,
    walls: 0,
  };
}

export function computeRoomMetrics(room: Room): RoomMetrics {
  if (room.points.length < 3) return emptyMetrics();
  const height = Number.isFinite(room.height) ? Math.max(0, room.height) : 0;
  const walls = getWalls(room);
  const wallLength = new Map(walls.map((w) => [w.id, w.length]));
  const perimeter = walls.reduce((s, w) => s + w.length, 0);
  const floorArea = polygonArea(room.points);
  const wallAreaGross = perimeter * height;

  let openingsArea = 0;
  for (const o of room.openings) {
    const L = wallLength.get(o.wallId);
    if (L === undefined) continue;
    // Считаем только часть проёма в пределах стены: по ширине — пересечение
    // с [0, L], по высоте — от низа проёма до потолка. Мусор (NaN, < 0) → 0.
    const width = Math.min(L, o.offset + o.width) - Math.max(0, o.offset);
    const elevation = Math.max(0, o.elevation);
    const clipped = {
      ...o,
      width: width > 0 ? width : 0,
      height: Math.max(0, Math.min(o.height, height - elevation)) || 0,
    };
    const area = openingWallArea(clipped);
    if (area > 0) openingsArea += area;
  }
  openingsArea = Math.min(openingsArea, wallAreaGross);

  // Углы и число стен — по контуру без повторяющихся точек: стена нулевой
  // длины не имеет направления и «съела» бы настоящий угол.
  const contour = dedupePoints(room.points, 1e-9);
  let innerCorners = 0;
  let outerCorners = 0;
  if (contour.length >= 3) {
    for (const c of getCorners({ ...room, points: contour })) {
      if (c.kind === "inner") innerCorners++;
      else if (c.kind === "outer") outerCorners++;
    }
  }

  return {
    floorArea,
    perimeter,
    wallAreaGross,
    openingsArea,
    wallAreaNet: Math.max(0, wallAreaGross - openingsArea),
    ceilingArea: floorArea,
    volume: floorArea * height,
    innerCorners,
    outerCorners,
    walls: contour.length >= 3 ? contour.length : 0,
  };
}

export function computeProjectMetrics(project: Project): {
  rooms: Array<{ roomId: string; name: string; metrics: RoomMetrics }>;
  total: RoomMetrics;
} {
  const rooms = project.rooms.map((r) => ({
    roomId: r.id,
    name: r.name,
    metrics: computeRoomMetrics(r),
  }));
  const total = emptyMetrics();
  for (const { metrics } of rooms) {
    for (const key of Object.keys(total) as Array<keyof RoomMetrics>) {
      total[key] += metrics[key];
    }
  }
  return { rooms, total };
}
