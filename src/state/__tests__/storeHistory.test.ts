/**
 * Состязательные тесты истории хранилища: undo/redo возвращают ровно
 * прежние состояния (содержимое — те же объекты, updatedAt — свежий, см.
 * historyExpect), жест — ровно одна запись, пустые правки историю не
 * засоряют, выделение всегда указывает на существующий объект.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWalls } from "../../domain/geometry";
import { MAX_PROJECT_ROOMS, createProject } from "../../domain/project";
import type { OpeningKind, Project, Room } from "../../domain/types";
import { HISTORY_LIMIT, useAppStore, type AppState } from "../store";
import { expectSameVersion, expectSameVersions } from "./historyExpect";

const S = () => useAppStore.getState();
const active = (): Room => S().project.rooms.find((r) => r.id === S().activeRoomId)!;

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

let clock = 1_000_000;
function reset(project: Project = createProject()) {
  S().endGesture();
  useAppStore.setState({
    project,
    activeRoomId: project.rooms[0].id,
    selection: null,
    hoverSegmentId: null,
    hoverWallId: null,
    view: "split",
    panelTab: "room",
    past: [],
    future: [],
  });
  S().undo(); // сбрасывает внутреннюю склейку правок
}

beforeEach(() => {
  clock = 1_000_000;
  // Каждая правка — через 2 с после предыдущей: склейка по времени не срабатывает.
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 2000));
  reset();
});
afterEach(() => vi.restoreAllMocks());

const KINDS: OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];

/** Случайное действие пользователя (без transient). */
function randomAction(rnd: () => number): void {
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const s: AppState = S();
  const room = active();
  const walls = getWalls(room);
  const wall = pick(walls);
  const point = pick(room.points);
  const opening = room.openings.length ? pick(room.openings) : null;
  const r = rnd();
  if (r < 0.08) s.setWallLength(wall.id, Math.round(wall.length * (0.6 + rnd() * 0.8) * 100) / 100);
  else if (r < 0.15) s.moveWall(wall.id, Math.round((rnd() - 0.5) * 100) / 100);
  else if (r < 0.22) s.moveVertex(point.id, { x: point.x + rnd() - 0.5, y: point.y + rnd() - 0.5 });
  else if (r < 0.27) s.splitWall(wall.id, wall.length / 2);
  else if (r < 0.3) s.removePoint(point.id);
  else if (r < 0.4) s.addOpening(pick(KINDS));
  else if (r < 0.45 && opening) s.updateOpening(opening.id, { hinge: pick(["left", "right"] as const) });
  else if (r < 0.5 && opening) s.moveOpening(opening.id, wall.id, rnd() * wall.length);
  else if (r < 0.54 && opening) s.removeOpening(opening.id);
  else if (r < 0.57 && opening) s.duplicateOpening(opening.id);
  else if (r < 0.6) s.addRoom(pick(["rect", "L", "bay"] as const));
  else if (r < 0.62) s.duplicateRoom(room.id);
  else if (r < 0.65) s.removeRoom(room.id);
  else if (r < 0.7) s.setActiveRoom(pick(s.project.rooms).id);
  else if (r < 0.74) s.applyTemplate(pick(["rect", "L", "U", "T", "trapezoid"] as const));
  else if (r < 0.78) s.updateRoom({ height: 2.5 + Math.round(rnd() * 10) / 10 });
  else if (r < 0.81) s.setWallThickness(wall.id, 0.1 + Math.round(rnd() * 20) / 100);
  else if (r < 0.84) s.renameRoom(room.id, pick(["Кухня", "Спальня", "Зал"]));
  else if (r < 0.87) s.updateSkirtingSettings({ reservePct: Math.round(rnd() * 20) });
  else if (r < 0.9) s.setDefaultProduct(pick(["pvc-55", "mdf-80", "wood-pine-45"]));
  else if (r < 0.93) s.updateProductOverride("pvc-55", { price: 150 + Math.round(rnd() * 200) });
  else if (r < 0.96) s.select({ type: "point", roomId: room.id, pointId: point.id });
  else if (opening) s.select({ type: "opening", roomId: room.id, openingId: opening.id });
}

function expectSelectionValid() {
  const sel = S().selection;
  if (!sel) return;
  expect(sel.roomId).toBe(S().activeRoomId);
  const room = active();
  if (sel.type === "opening") expect(room.openings.some((o) => o.id === sel.openingId)).toBe(true);
  else {
    const id = sel.type === "wall" ? sel.wallId : sel.pointId;
    expect(room.points.some((p) => p.id === id)).toBe(true);
  }
}

describe("undo/redo: ровно прежние состояния", () => {
  it.each([1, 2, 3, 4])("случайные действия (сид %i)", (seed) => {
    const rnd = rng(seed);
    const states: Project[] = [S().project];
    for (let i = 0; i < 80; i++) {
      randomAction(rnd);
      const p = S().project;
      if (p !== states[states.length - 1]) {
        states.push(p);
        // каждая изменившая проект правка — ровно одна запись истории
        expect(S().past[S().past.length - 1]).toBe(states[states.length - 2]);
      }
      expect(S().past).toHaveLength(states.length - 1);
      expect(S().future).toHaveLength(0);
      expect(S().project.rooms.some((r) => r.id === S().activeRoomId)).toBe(true);
      expectSelectionValid();
    }
    expect(states.length).toBeGreaterThan(30);
    // назад до самого начала
    for (let k = states.length - 2; k >= 0; k--) {
      S().undo();
      expectSameVersion(S().project, states[k]);
      expectSelectionValid();
    }
    S().undo(); // пустая история — ничего не происходит
    expectSameVersion(S().project, states[0]);
    // и вперёд до конца
    for (let k = 1; k < states.length; k++) {
      S().redo();
      expectSameVersion(S().project, states[k]);
      expectSelectionValid();
    }
    S().redo();
    expectSameVersion(S().project, states[states.length - 1]);
  });

  it("правка после undo отбрасывает будущее", () => {
    const p0 = S().project;
    S().setWallLength(active().points[0].id, 5);
    S().setWallLength(active().points[1].id, 4);
    S().undo();
    S().undo();
    expect(S().future).toHaveLength(2);
    S().moveWall(active().points[1].id, -0.3);
    expect(S().future).toEqual([]);
    expectSameVersions(S().past, [p0]);
  });

  it("future тоже ограничено HISTORY_LIMIT", () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) S().updateRoom({ height: 2.5 + (i % 2) / 10 });
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) S().undo();
    expect(S().past).toHaveLength(0);
    expect(S().future).toHaveLength(HISTORY_LIMIT);
  });
});

describe("жесты", () => {
  it("перетаскивание — ровно одна запись, undo — ровно база", () => {
    S().addOpening("door");
    const before = S().past.length;
    const base = S().project;
    const wallId = active().points[1].id;
    S().beginGesture();
    for (let i = 1; i <= 30; i++) S().moveWall(wallId, -0.01, { transient: true });
    expect(S().past).toHaveLength(before);
    S().endGesture();
    expect(S().past).toHaveLength(before + 1);
    expect(S().past[S().past.length - 1]).toBe(base);
    S().endGesture(); // повторный конец жеста — без эффекта
    expect(S().past).toHaveLength(before + 1);
    const dragged = S().project;
    S().undo();
    expectSameVersion(S().project, base);
    S().redo();
    expectSameVersion(S().project, dragged);
  });

  it("вложенный beginGesture не сдвигает базу", () => {
    const base = S().project;
    const id = active().points[2].id;
    S().beginGesture();
    S().moveVertex(id, { x: 4.7, y: 3.6 }, { transient: true });
    S().beginGesture();
    S().moveVertex(id, { x: 4.9, y: 3.7 }, { transient: true });
    S().endGesture();
    expect(S().past).toEqual([base]);
  });

  it("не-transient правка внутри жеста тоже входит в эту запись", () => {
    const base = S().project;
    S().beginGesture();
    S().moveWall(active().points[1].id, -0.2, { transient: true });
    S().updateRoom({ height: 3 });
    S().endGesture();
    expect(S().past).toEqual([base]);
  });

  it("жест — граница склейки transient-правок", () => {
    const wallId = active().points[1].id;
    S().moveWall(wallId, -0.1, { transient: true }); // без жеста
    expect(S().past).toHaveLength(1);
    S().beginGesture();
    S().endGesture(); // пустой жест
    S().moveWall(wallId, -0.1, { transient: true });
    // второе перетаскивание — отдельная запись, а не продолжение первого
    expect(S().past).toHaveLength(2);
  });

  it("undo посреди жеста закрывает жест и откатывает его", () => {
    const base = S().project;
    S().beginGesture();
    S().moveWall(active().points[1].id, -0.2, { transient: true });
    S().undo();
    expectSameVersion(S().project, base);
    expect(S().past).toHaveLength(0);
    expect(S().future).toHaveLength(1);
  });
});

describe("пустые правки не пишут историю", () => {
  it("те же значения проёма, шаблона, толщины, настроек", () => {
    const id = S().addOpening("door")!;
    const o = active().openings[0];
    const p = S().project;
    const n = S().past.length;
    S().updateOpening(id, { hinge: o.hinge });
    S().updateOpening(id, { width: o.width, offset: o.offset });
    S().updateOpening(id, { presetId: o.presetId! });
    S().updateOpening(id, { kind: "door" });
    S().moveOpening(id, o.wallId, o.offset);
    S().applyTemplate("rect");
    S().updateRoom({ height: active().height });
    S().updateSkirtingSettings({ reservePct: p.skirting.reservePct });
    S().setAppearance({ wallColor: p.appearance.wallColor });
    S().setDefaultProduct(p.skirting.productId);
    S().updateProductOverride("pvc-55", {});
    S().resetProductOverride("pvc-55");
    S().renameProject(p.name);
    S().renameRoom(active().id, active().name);
    expect(S().project).toBe(p);
    expect(S().past).toHaveLength(n);
  });

  it("неизвестный продукт не становится плинтусом проекта/комнаты", () => {
    const p = S().project;
    S().setDefaultProduct("no-such-product");
    S().updateRoom({ productId: "no-such-product" });
    expect(S().project).toBe(p);
    S().updateRoom({ productId: "mdf-80" });
    expect(active().productId).toBe("mdf-80");
    S().updateRoom({ productId: null });
    expect(active().productId).toBeNull();
  });
});

describe("пределы", () => {
  it(`не больше ${MAX_PROJECT_ROOMS} комнат`, () => {
    for (let i = 0; i < MAX_PROJECT_ROOMS + 5; i++) S().addRoom();
    expect(S().project.rooms).toHaveLength(MAX_PROJECT_ROOMS);
    S().duplicateRoom(active().id);
    expect(S().project.rooms).toHaveLength(MAX_PROJECT_ROOMS);
  });
});

describe("loadProject: данные извне", () => {
  it("мусор игнорируется, битые комнаты чинятся", () => {
    const p = S().project;
    S().loadProject(null as unknown as Project);
    S().loadProject({ rooms: "x" } as unknown as Project);
    expect(S().project).toBe(p);
    const raw = {
      name: "Импорт",
      rooms: [
        {
          id: "r1",
          // обход против канонического и проём за пределами стены
          points: [
            { id: "a", x: 0, y: 0 },
            { id: "b", x: 0, y: 3 },
            { id: "c", x: 4, y: 3 },
            { id: "d", x: 4, y: 0 },
          ],
          openings: [{ id: "o", kind: "door", wallId: "a", offset: 50, width: 0.87 }],
        },
      ],
    } as unknown as Project;
    S().loadProject(raw);
    expect(S().project.name).toBe("Импорт");
    expect(S().activeRoomId).toBe("r1");
    const room = active();
    const wall = getWalls(room).find((w) => w.id === room.openings[0].wallId)!;
    expect(room.openings[0].offset + room.openings[0].width).toBeLessThanOrEqual(wall.length + 1e-9);
    expect(S().past[S().past.length - 1]).toBe(p);
  });
});

describe("жесты, transient и обычные правки вперемешку", () => {
  /** Перетаскивание: несколько transient-правок одной стены или точки. */
  function drag(rnd: () => number) {
    const room = active();
    const steps = 1 + Math.floor(rnd() * 5);
    if (rnd() < 0.5) {
      const wall = room.points[Math.floor(rnd() * room.points.length)];
      for (let i = 0; i < steps; i++) S().moveWall(wall.id, (rnd() - 0.5) * 0.2, { transient: true });
    } else {
      const p = room.points[Math.floor(rnd() * room.points.length)];
      for (let i = 1; i <= steps; i++) {
        S().moveVertex(p.id, { x: p.x + (rnd() - 0.5) * 0.3 * i, y: p.y + (rnd() - 0.5) * 0.3 * i }, { transient: true });
      }
    }
  }

  it.each([11, 12, 13])("модель истории совпадает (сид %i)", (seed) => {
    const rnd = rng(seed);
    const states: Project[] = [S().project];
    let transientOpen = false; // последняя запись — transient-правки вне жеста, к ней склеиваются новые
    // ≤ 90 шагов: укладываемся в HISTORY_LIMIT, иначе старые записи законно отбрасываются
    for (let i = 0; i < 90; i++) {
      const before = S().project;
      const r = rnd();
      if (r < 0.3) {
        S().beginGesture();
        transientOpen = false;
        drag(rnd);
        S().endGesture();
        if (S().project !== before) states.push(S().project);
      } else if (r < 0.45) {
        drag(rnd); // UI забыл открыть жест
        if (S().project !== before) {
          if (transientOpen) states[states.length - 1] = S().project;
          else states.push(S().project);
          transientOpen = true;
        }
      } else {
        randomAction(rnd);
        if (S().project !== before) {
          states.push(S().project);
          transientOpen = false;
        }
      }
      expect(S().past, `шаг ${i}`).toHaveLength(states.length - 1);
      expectSelectionValid();
    }
    expect(states.length).toBeGreaterThan(30);
    for (let k = states.length - 2; k >= 0; k--) {
      S().undo();
      expectSameVersion(S().project, states[k]);
    }
    for (let k = 1; k < states.length; k++) S().redo();
    // вперёд — до последнего «закоммиченного» состояния (склеенные transient — одной записью)
    expectSameVersion(S().project, states[states.length - 1]);
  });
});
