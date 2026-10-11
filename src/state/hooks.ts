/**
 * Хуки над хранилищем с мемоизацией производных данных.
 *
 * Кэши — WeakMap по ссылке на неизменяемые объекты (проект, комната,
 * набор правок продуктов): сколько бы компонентов ни спросили смету одного
 * и того же проекта, считается она один раз, а старые записи собирает GC.
 * Селекторы возвращают закэшированные объекты, поэтому ссылки стабильны и
 * лишних перерисовок нет.
 */
import { useDeferredValue } from "react";
import { estimateProject, type ProjectEstimate } from "../domain/estimate";
import { getWalls } from "../domain/geometry";
import { computeRoomMetrics, type RoomMetrics } from "../domain/roomMetrics";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import { resolveProduct } from "../domain/skirtingCatalog";
import type { ProductOverride, Project, Room, SkirtingProduct, Wall } from "../domain/types";
import { useAppStore, type AppState } from "./store";

const estimateCache = new WeakMap<Project, ProjectEstimate>();
const metricsCache = new WeakMap<Room, RoomMetrics>();
const wallsCache = new WeakMap<Room, Wall[]>();
const productCache = new WeakMap<Record<string, ProductOverride>, Map<string, SkirtingProduct>>();

function cached<K extends object, V>(cache: WeakMap<K, V>, key: K, compute: (key: K) => V): V {
  let value = cache.get(key);
  if (value === undefined) {
    value = compute(key);
    cache.set(key, value);
  }
  return value;
}

/** Смета проекта (тот же кэш, что у useEstimate) — для кода вне React. */
export function getEstimate(project: Project): ProjectEstimate {
  return cached(estimateCache, project, estimateProject);
}

export function getRoomMetrics(room: Room): RoomMetrics {
  return cached(metricsCache, room, computeRoomMetrics);
}

export function getRoomWalls(room: Room): Wall[] {
  return cached(wallsCache, room, getWalls);
}

/** Эффективный плинтус комнаты: свой или проекта, с правками пользователя. */
export function getRoomProduct(project: Project, room: Room): SkirtingProduct {
  const productId = room.productId ?? project.skirting.productId;
  const byId = cached(productCache, project.productOverrides, () => new Map<string, SkirtingProduct>());
  let product = byId.get(productId);
  if (!product) {
    product = resolveProduct(productId, project.productOverrides);
    byId.set(productId, product);
  }
  return product;
}

/** Комната по id; если её нет (или id не задан) — активная. */
function pickRoom(s: AppState, roomId?: string): Room {
  const { rooms } = s.project;
  return (
    (roomId !== undefined ? rooms.find((r) => r.id === roomId) : undefined) ??
    rooms.find((r) => r.id === s.activeRoomId) ??
    rooms[0]
  );
}

export function useActiveRoom(): Room {
  return useAppStore((s) => pickRoom(s));
}

/**
 * Смета проекта. Расчёт (раскрой!) самый тяжёлый в приложении, поэтому
 * берём отложенное значение проекта: при перетаскивании план и 3D
 * обновляются сразу, а смета — в фоновой отрисовке следом.
 */
export function useEstimate(): ProjectEstimate {
  const project = useAppStore((s) => s.project);
  return getEstimate(useDeferredValue(project));
}

/** Расчёт плинтуса комнаты (по умолчанию активной); undefined — комната не считается. */
export function useRoomResult(roomId?: string): RoomSkirtingResult | undefined {
  const estimate = useEstimate();
  const id = useAppStore((s) => roomId ?? s.activeRoomId);
  return estimate.rooms.find((r) => r.roomId === id);
}

export function useRoomProduct(roomId?: string): SkirtingProduct {
  return useAppStore((s) => getRoomProduct(s.project, pickRoom(s, roomId)));
}

export function useRoomMetrics(roomId?: string): RoomMetrics {
  return useAppStore((s) => getRoomMetrics(pickRoom(s, roomId)));
}

export function useWalls(roomId?: string): Wall[] {
  return useAppStore((s) => getRoomWalls(pickRoom(s, roomId)));
}
