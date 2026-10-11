/**
 * Свойства редактора на случайных последовательностях правок: что бы ни
 * делал пользователь, комната остаётся валидной, а проёмы — в своих стенах.
 * Генератор детерминированный (сид), поэтому падение воспроизводимо.
 */
import { describe, expect, it } from "vitest";
import { getWalls, signedArea } from "../geometry";
import type { OpeningKind, Room, RoomShapeId } from "../types";
import {
  addOpening,
  isValidPolygon,
  moveOpening,
  moveVertex,
  moveWall,
  removeOpening,
  removePoint,
  setWallLength,
  splitWall,
  updateOpening,
} from "../roomEdit";
import { createRoom } from "../project";
import { computeRoomSkirting } from "../skirtingCalc";
import { resolveProduct } from "../skirtingCatalog";

/** mulberry32 — маленький детерминированный ГПСЧ. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];

function checkInvariants(room: Room, step: string) {
  const ctx = `${step}: ${JSON.stringify(room.points.map((p) => [p.x, p.y]))}`;
  expect(isValidPolygon(room.points), ctx).toBe(true);
  expect(signedArea(room.points), ctx).toBeGreaterThan(0);
  expect(new Set(room.points.map((p) => p.id)).size, ctx).toBe(room.points.length);
  for (const p of room.points) {
    expect(Math.abs(p.x * 1e4 - Math.round(p.x * 1e4)), ctx).toBeLessThan(1e-6);
    expect(Math.abs(p.y * 1e4 - Math.round(p.y * 1e4)), ctx).toBeLessThan(1e-6);
  }
  const walls = new Map(getWalls(room).map((w) => [w.id, w]));
  for (const o of room.openings) {
    const w = walls.get(o.wallId);
    expect(w, ctx).toBeDefined();
    expect(o.width, ctx).toBeLessThanOrEqual(w!.length + 1e-6);
    expect(o.offset, ctx).toBeGreaterThanOrEqual(0);
    expect(o.offset + o.width, ctx).toBeLessThanOrEqual(w!.length + 1e-6);
  }
}

function randomEdit(room: Room, rnd: () => number): { room: Room; op: string } {
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const walls = getWalls(room);
  const wall = pick(walls);
  const point = pick(room.points);
  const opening = room.openings.length ? pick(room.openings) : null;
  const r = rnd();
  // Не даём многоугольнику и списку проёмов разрастаться бесконечно.
  if (room.points.length > 14 && r < 0.5) return { room: removePoint(room, point.id), op: "removePoint" };
  if (opening && room.openings.length > 12 && r < 0.5) return { room: removeOpening(room, opening.id), op: "removeOpening" };
  if (r < 0.18) return { room: setWallLength(room, wall.id, wall.length * (0.3 + rnd() * 1.4)), op: "setWallLength" };
  if (r < 0.34) return { room: moveWall(room, wall.id, (rnd() - 0.5) * 2), op: "moveWall" };
  if (r < 0.5) {
    const pos = { x: point.x + (rnd() - 0.5) * 2, y: point.y + (rnd() - 0.5) * 2 };
    return { room: moveVertex(room, point.id, pos), op: "moveVertex" };
  }
  if (r < 0.6) return { room: splitWall(room, wall.id, rnd() * wall.length), op: "splitWall" };
  if (r < 0.68) return { room: removePoint(room, point.id), op: "removePoint" };
  if (r < 0.8) return { room: addOpening(room, pick(KINDS)).room, op: "addOpening" };
  if (!opening) return { room, op: "noop" };
  if (r < 0.88) {
    return { room: moveOpening(room, opening.id, wall.id, (rnd() - 0.2) * wall.length), op: "moveOpening" };
  }
  if (r < 0.96) {
    return { room: updateOpening(room, opening.id, { width: 0.2 + rnd() * 3 }), op: "updateOpening" };
  }
  return { room: removeOpening(room, opening.id), op: "removeOpening" };
}

const SHAPES: RoomShapeId[] = ["rect", "L", "U", "T", "corner-box", "bay", "trapezoid"];

describe("редактор комнаты: случайные правки", () => {
  it.each(SHAPES.map((s, i) => [s, 1000 + i]))("%s (сид %i)", (shape, seed) => {
    const rnd = rng(seed as number);
    const product = resolveProduct("pvc-55", {});
    let room = createRoom({ shape: shape as RoomShapeId });
    let applied = 0;
    for (let step = 0; step < 400; step++) {
      const { room: next, op } = randomEdit(room, rnd);
      if (next !== room) applied++;
      room = next;
      checkInvariants(room, `#${step} ${op}`);
      // расчёт плинтуса не должен падать ни на какой допустимой комнате
      if (step % 20 === 0) expect(() => computeRoomSkirting(room, product)).not.toThrow();
    }
    // правки действительно применялись, а не все отклонялись
    expect(applied).toBeGreaterThan(100);
  });
});
