import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWalls, polygonArea } from "../../domain/geometry";
import { createDemoProject, createProject } from "../../domain/project";
import { getCatalogProduct } from "../../domain/skirtingCatalog";
import type { Project, Room } from "../../domain/types";
import { getEstimate, getRoomMetrics, getRoomProduct, getRoomWalls } from "../hooks";
import { HISTORY_LIMIT, initFromUrl, useAppStore } from "../store";
import { expectSameVersion } from "./historyExpect";

const S = () => useAppStore.getState();
const room = (): Room => S().project.rooms.find((r) => r.id === S().activeRoomId)!;
const wallIds = () => room().points.map((p) => p.id);

/** Чистое состояние: прямоугольная комната 4,5×3,6 без проёмов, пустая история. */
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
  // undo на пустой истории сбрасывает внутреннее состояние (жест, склейку правок).
  S().undo();
}

beforeEach(() => reset());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("начальное состояние", () => {
  it("демо-проект при первом запуске (в node без localStorage)", async () => {
    vi.resetModules();
    const fresh = (await import("../store")).useAppStore.getState();
    expect(fresh.project.name).toBe("Моя квартира");
    expect(fresh.activeRoomId).toBe(fresh.project.rooms[0].id);
    expect(fresh.project.rooms[0].openings).toHaveLength(2);
    expect(fresh.view).toBe("split");
    expect(fresh.past).toEqual([]);
  });
});

describe("история", () => {
  it("undo / redo", () => {
    const p0 = S().project;
    S().setWallLength(wallIds()[0], 5);
    const p1 = S().project;
    expect(p1).not.toBe(p0);
    expect(getWalls(room())[0].length).toBeCloseTo(5);
    expect(S().past).toEqual([p0]);
    S().undo();
    expectSameVersion(S().project, p0);
    expect(S().future).toEqual([p1]);
    S().redo();
    expectSameVersion(S().project, p1);
    expect(S().future).toEqual([]);
    // новая правка очищает future
    S().undo();
    S().setWallLength(wallIds()[1], 4);
    expect(S().future).toEqual([]);
    expect(S().past).toHaveLength(1);
  });

  it("отклонённая правка не пишет историю", () => {
    const p0 = S().project;
    S().setWallLength(wallIds()[0], 0.01);
    S().moveVertex(wallIds()[2], { x: -5, y: -5 });
    expect(S().project).toBe(p0);
    expect(S().past).toHaveLength(0);
  });

  it("updatedAt обновляется при правке", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
    S().setWallLength(wallIds()[0], 5);
    expect(S().project.updatedAt).toBe(1_900_000_000_000);
  });

  it("undo/redo — новая ревизия: содержимое снимка, updatedAt — время перехода", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
    const p0 = S().project;
    S().setWallLength(wallIds()[0], 5);
    const p1 = S().project;
    now.mockReturnValue(1_900_000_060_000);
    S().undo();
    // Тот же проект, что до правки (комнаты — те же объекты), но изменён только что:
    // другие вкладки примут его как более свежий, список недавних и печать покажут время отмены.
    expect(S().project.rooms).toBe(p0.rooms);
    expect(S().project.updatedAt).toBe(1_900_000_060_000);
    expect(S().project.updatedAt).toBeGreaterThan(p1.updatedAt);
    now.mockReturnValue(1_900_000_120_000);
    S().redo();
    expect(S().project.rooms).toBe(p1.rooms);
    expect(S().project.updatedAt).toBe(1_900_000_120_000);
    // Пустая история — проект не трогаем, updatedAt прежний.
    S().redo();
    expect(S().project.updatedAt).toBe(1_900_000_120_000);
  });

  it(`не больше ${HISTORY_LIMIT} шагов`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) S().setWallLength(wallIds()[0], i % 2 ? 5 : 6);
    expect(S().past).toHaveLength(HISTORY_LIMIT);
  });

  it("жест: перетаскивание — одна запись", () => {
    const base = S().project;
    const id = wallIds()[2];
    S().beginGesture();
    S().moveVertex(id, { x: 4.6, y: 3.6 }, { transient: true });
    S().moveVertex(id, { x: 4.8, y: 3.7 }, { transient: true });
    S().moveVertex(id, { x: 5, y: 3.8 }, { transient: true });
    expect(S().past).toHaveLength(0);
    S().endGesture();
    expect(S().past).toEqual([base]);
    S().undo();
    expectSameVersion(S().project, base);
  });

  it("жест без изменений не пишет историю", () => {
    S().beginGesture();
    S().moveVertex(wallIds()[2], { x: -5, y: -5 }, { transient: true }); // отклонено
    S().endGesture();
    expect(S().past).toHaveLength(0);
  });

  it("transient без beginGesture склеивается в одну запись до обычной правки", () => {
    const base = S().project;
    S().moveWall(wallIds()[1], -0.5, { transient: true });
    S().moveWall(wallIds()[1], -0.5, { transient: true });
    const dragged = S().project;
    expect(S().past).toEqual([base]); // «Отменить» доступно сразу
    S().setWallLength(wallIds()[1], 4);
    expect(S().past).toEqual([base, dragged]);
    S().undo();
    S().undo();
    expectSameVersion(S().project, base);
  });

  it("частые правки одного поля склеиваются", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const base = S().project;
    S().renameProject("Д");
    S().renameProject("До");
    S().renameProject("Дом");
    expect(S().past).toEqual([base]);
    expect(S().project.name).toBe("Дом");
    now.mockReturnValue(1_000_000 + 5_000);
    S().renameProject("Дом 2");
    expect(S().past).toHaveLength(2);
    // правка другого поля — отдельная запись
    S().setAppearance({ wallColor: "#ffffff" });
    expect(S().past).toHaveLength(3);
  });
});

describe("выделение", () => {
  it("новый проём выделяется, удалённый — снимается", () => {
    const id = S().addOpening("door")!;
    expect(id).toBeTruthy();
    expect(S().selection).toEqual({ type: "opening", roomId: room().id, openingId: id });
    S().removeOpening(id);
    expect(S().selection).toBeNull();
  });

  it("undo, убирающий выделенный объект, снимает выделение", () => {
    const id = S().addOpening("window")!;
    expect(S().selection?.type).toBe("opening");
    S().undo();
    expect(room().openings.find((o) => o.id === id)).toBeUndefined();
    expect(S().selection).toBeNull();
  });

  it("удаление выделенной точки и стены", () => {
    const r = room();
    S().select({ type: "wall", roomId: r.id, wallId: r.points[0].id });
    S().splitWall(r.points[0].id, 2);
    const sel = S().selection;
    expect(sel?.type).toBe("point");
    const pointId = sel && sel.type === "point" ? sel.pointId : "";
    expect(room().points).toHaveLength(5);
    S().removePoint(pointId);
    expect(room().points).toHaveLength(4);
    expect(S().selection).toBeNull();
  });

  it("смена комнаты снимает выделение; выделение в другой комнате активирует её", () => {
    S().addRoom();
    const [r1, r2] = S().project.rooms;
    expect(S().activeRoomId).toBe(r2.id);
    S().select({ type: "wall", roomId: r2.id, wallId: r2.points[0].id });
    S().setActiveRoom(r1.id);
    expect(S().selection).toBeNull();
    S().select({ type: "point", roomId: r2.id, pointId: r2.points[1].id });
    expect(S().activeRoomId).toBe(r2.id);
    expect(S().selection?.type).toBe("point");
    S().select({ type: "opening", roomId: r2.id, openingId: "nope" });
    expect(S().selection).toBeNull();
  });
});

describe("подсветка стены из панели (hoverWallId)", () => {
  const hover = (id: string | null = wallIds()[1]) => {
    S().setHoverWall(id);
    expect(S().hoverWallId).toBe(id);
  };

  it("сбрасывается при смене активной комнаты и выделении в другой комнате", () => {
    const r1 = room();
    S().addRoom();
    expect(S().hoverWallId).toBeNull();
    hover();
    S().setActiveRoom(r1.id);
    expect(S().hoverWallId).toBeNull();
    hover();
    const r2 = S().project.rooms[1];
    S().select({ type: "wall", roomId: r2.id, wallId: r2.points[0].id });
    expect(S().activeRoomId).toBe(r2.id);
    expect(S().hoverWallId).toBeNull();
    // выделение в той же комнате подсветку не трогает
    hover();
    S().select({ type: "point", roomId: r2.id, pointId: r2.points[2].id });
    expect(S().hoverWallId).toBe(wallIds()[1]);
  });

  it("живёт, пока жива стена: правка другой стены — остаётся, удаление стены — сброс", () => {
    hover(wallIds()[2]);
    S().setWallLength(wallIds()[0], 5);
    expect(S().hoverWallId).toBe(wallIds()[2]);
    S().splitWall(wallIds()[0], 1);
    const added = room().points[1].id;
    hover(added);
    S().removePoint(added);
    expect(room().points.some((p) => p.id === added)).toBe(false);
    expect(S().hoverWallId).toBeNull();
    hover();
    S().applyTemplate("L"); // новые точки — прежних стен нет
    expect(S().hoverWallId).toBeNull();
  });

  it("удаление комнаты: активной — сброс, другой — подсветка остаётся", () => {
    const r1 = room();
    S().addRoom();
    const r2 = room();
    S().addRoom();
    hover();
    S().removeRoom(r1.id);
    expect(S().hoverWallId).toBe(wallIds()[1]);
    S().removeRoom(room().id);
    expect(S().activeRoomId).toBe(r2.id);
    expect(S().hoverWallId).toBeNull();
  });

  it("сбрасывается при undo/redo", () => {
    S().setWallLength(wallIds()[0], 5);
    hover();
    S().undo();
    expect(S().hoverWallId).toBeNull();
    hover();
    S().redo();
    expect(S().hoverWallId).toBeNull();
    // пустая история — переход не случился, подсветку не трогаем
    hover();
    S().redo();
    expect(S().hoverWallId).toBe(wallIds()[1]);
  });

  it("сбрасывается при newProject и loadProject, даже если id стены совпал", () => {
    hover();
    S().newProject();
    expect(S().hoverWallId).toBeNull();
    const same = S().project;
    hover();
    S().loadProject({ ...same, name: "Тот же проект" });
    expect(S().activeRoomId).toBe(same.rooms[0].id);
    expect(S().hoverWallId).toBeNull();
  });

  it("проект подменили снаружи (другая вкладка) — select() сверяет подсветку", () => {
    hover();
    const r = room();
    useAppStore.setState({
      project: { ...S().project, rooms: [{ ...r, points: r.points.filter((p) => p.id !== wallIds()[1]) }] },
    });
    S().select(S().selection);
    expect(S().hoverWallId).toBeNull();
  });
});

describe("комнаты", () => {
  it("addRoom: «Комната 2», та же высота, активна", () => {
    S().updateRoom({ height: 3.1 });
    S().addRoom("L");
    const r = room();
    expect(S().project.rooms).toHaveLength(2);
    expect(r.name).toBe("Комната 2");
    expect(r.shape).toBe("L");
    expect(r.height).toBe(3.1);
  });

  it("duplicateRoom / removeRoom", () => {
    const r1 = room();
    S().duplicateRoom(r1.id);
    const copy = room();
    expect(copy.id).not.toBe(r1.id);
    expect(copy.name).toBe("Комната 1 (копия)");
    expect(S().project.rooms.map((r) => r.id)).toEqual([r1.id, copy.id]);
    S().duplicateRoom(r1.id);
    expect(room().name).toBe("Комната 1 (копия 2)");
    S().removeRoom(room().id);
    expect(S().project.rooms).toHaveLength(2);
    expect(S().activeRoomId).toBe(copy.id);
    S().removeRoom(copy.id);
    S().removeRoom(r1.id); // последнюю — нельзя
    expect(S().project.rooms).toHaveLength(1);
  });

  it("applyTemplate и updateRoom к активной комнате", () => {
    S().applyTemplate("L", { length: 6, width: 5, cutLength: 2, cutWidth: 2 });
    expect(room().shape).toBe("L");
    expect(polygonArea(room().points)).toBeCloseTo(26);
    S().updateRoom({ height: 100, wallThickness: 0.2, skirtingEnabled: false, name: "Кухня" });
    expect(room()).toMatchObject({ height: 10, wallThickness: 0.2, skirtingEnabled: false, name: "Кухня" });
    const p = S().project;
    S().updateRoom({ height: 10 });
    expect(S().project).toBe(p);
  });

  it("undo/redo переключают на комнату, которую затронули", () => {
    const r1 = room();
    S().addRoom();
    const r2 = room();
    S().setActiveRoom(r1.id);
    S().removeRoom(r2.id);
    expect(S().project.rooms).toHaveLength(1);
    S().undo(); // комната вернулась — показываем её
    expect(S().activeRoomId).toBe(r2.id);
    S().setActiveRoom(r1.id);
    S().setWallLength(getWalls(r1)[0].id, 5);
    S().setActiveRoom(r2.id);
    S().undo(); // правка была в первой комнате
    expect(S().activeRoomId).toBe(r1.id);
  });

  it("renameRoom", () => {
    S().renameRoom(room().id, "Спальня");
    expect(room().name).toBe("Спальня");
  });
});

describe("стены и проёмы", () => {
  it("moveWall, setWallThickness", () => {
    S().moveWall(wallIds()[1], -0.5);
    expect(getWalls(room())[0].length).toBeCloseTo(5);
    S().setWallThickness(wallIds()[1], 0.3);
    expect(getWalls(room())[1].thickness).toBe(0.3);
  });

  it("updateOpening / moveOpening / duplicateOpening", () => {
    const id = S().addOpening("door", { wallId: wallIds()[1] })!;
    S().updateOpening(id, { presetId: "door-60" });
    expect(room().openings[0].presetId).toBe("door-60");
    S().moveOpening(id, wallIds()[2], 0.5);
    expect(room().openings[0]).toMatchObject({ wallId: wallIds()[2], offset: 0.5 });
    S().duplicateOpening(id);
    expect(room().openings).toHaveLength(2);
    const sel = S().selection;
    expect(sel?.type === "opening" && sel.openingId !== id).toBe(true);
  });

  it("addOpening без места → null и без истории", () => {
    reset({
      ...createProject(),
      rooms: [{ ...createProject().rooms[0], points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 1.2, y: 0 },
        { id: "c", x: 1.2, y: 1 },
        { id: "d", x: 0, y: 1 },
      ] }],
    });
    expect(S().addOpening("balcony")).toBeNull();
    expect(S().past).toHaveLength(0);
  });
});

describe("плинтус и вид", () => {
  it("правки продукта: цены мёржатся, совпадающие с каталогом не хранятся", () => {
    const base = getCatalogProduct("pvc-55")!;
    S().updateProductOverride("pvc-55", { price: 250, prices: { endCap: 40 } });
    let ov = S().project.productOverrides["pvc-55"];
    expect(ov.price).toBe(250);
    expect(ov.prices).toEqual({ ...base.prices, endCap: 40 });
    S().updateProductOverride("pvc-55", { prices: { innerCorner: 50 } });
    ov = S().project.productOverrides["pvc-55"];
    expect(ov.prices).toEqual({ ...base.prices, endCap: 40, innerCorner: 50 });
    expect(getRoomProduct(S().project, room()).prices.endCap).toBe(40);
    // вернули каталожные значения — правка исчезает
    S().updateProductOverride("pvc-55", {
      price: base.price,
      prices: { endCap: base.prices.endCap, innerCorner: base.prices.innerCorner },
    });
    expect(S().project.productOverrides["pvc-55"]).toBeUndefined();
    S().updateProductOverride("pvc-55", { color: "#AABBCC" });
    expect(S().project.productOverrides["pvc-55"]).toEqual({ color: "#aabbcc" });
    S().resetProductOverride("pvc-55");
    expect(S().project.productOverrides).toEqual({});
    S().updateProductOverride("no-such", { price: 1 });
    expect(S().project.productOverrides).toEqual({});
  });

  it("длина планки: цена без правки следует за длиной, своя цена пересчитывается за метр", () => {
    const product = () => getRoomProduct({ ...S().project, skirting: { ...S().project.skirting, productId: "mdf-80" } }, room());
    // Без правки цены: 550 ₽ за 2,4 м → цена погонного метра для 2,8 м.
    S().updateProductOverride("mdf-80", { length: 2.8 });
    expect(S().project.productOverrides["mdf-80"]).toEqual({ length: 2.8 });
    expect(product().price).toBe(Math.round((550 / 2.4) * 2.8));
    // Своя цена 550 ₽ за 2,8 м — правка, хотя совпадает с каталожной ценой 2,4 м.
    S().updateProductOverride("mdf-80", { price: 550 });
    expect(S().project.productOverrides["mdf-80"]).toEqual({ length: 2.8, price: 550 });
    expect(product().price).toBe(550);
    // Смена длины сохраняет цену метра своей цены.
    S().updateProductOverride("mdf-80", { length: 2.4 });
    expect(S().project.productOverrides["mdf-80"]).toEqual({ price: Math.round((550 / 2.8) * 2.4) });
    // Цена, совпавшая с ценой каталога для этой длины, — не правка.
    S().updateProductOverride("mdf-80", { price: 550 });
    expect(S().project.productOverrides["mdf-80"]).toBeUndefined();
  });

  it("setDefaultProduct и настройки с ограничениями", () => {
    S().setDefaultProduct("mdf-80");
    expect(S().project.skirting.productId).toBe("mdf-80");
    expect(getRoomProduct(S().project, room()).id).toBe("mdf-80");
    S().updateSkirtingSettings({ reservePct: 500, kerf: Number.NaN, shareOffcuts: false });
    expect(S().project.skirting).toMatchObject({ reservePct: 100, kerf: 0.003, shareOffcuts: false });
  });

  it("внешний вид и UI-состояние", () => {
    S().setAppearance({ wallColor: "not a color", floorPattern: "herringbone" });
    expect(S().project.appearance).toMatchObject({ wallColor: "#e9e4da", floorPattern: "herringbone" });
    S().setView("plan");
    S().setPanelTab("result");
    S().setHoverSegment("seg");
    expect(S()).toMatchObject({ view: "plan", panelTab: "result", hoverSegmentId: "seg" });
    // UI-состояние не попадает в историю
    expect(S().past).toHaveLength(1);
  });
});

describe("проект", () => {
  it("newProject и loadProject — в историю", () => {
    const before = S().project;
    S().newProject();
    expect(S().project).not.toBe(before);
    expect(S().project.rooms).toHaveLength(1);
    S().undo();
    expectSameVersion(S().project, before);
    const demo = createDemoProject();
    S().loadProject(demo);
    expect(S().project.rooms[0].name).toBe("Гостиная");
    expect(S().activeRoomId).toBe(demo.rooms[0].id);
    expectSameVersion(S().past[S().past.length - 1], before);
  });

  it("initFromUrl без window — false", async () => {
    expect(await initFromUrl()).toBe(false);
  });
});

describe("кэши хуков", () => {
  it("смета и производные считаются один раз на объект", () => {
    const p = S().project;
    expect(getEstimate(p)).toBe(getEstimate(p));
    expect(getRoomMetrics(room())).toBe(getRoomMetrics(room()));
    expect(getRoomWalls(room())).toBe(getRoomWalls(room()));
    expect(getRoomProduct(p, room())).toBe(getRoomProduct(p, room()));
    const e = getEstimate(p);
    expect(e.rooms[0].perimeter).toBeCloseTo(16.2);
    S().setWallLength(wallIds()[0], 5);
    expect(getEstimate(S().project)).not.toBe(e);
  });
});

describe("сохранение в localStorage", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it("пишет с задержкой только project/activeRoomId/view", () => {
    vi.useFakeTimers();
    const ls = memoryStorage();
    vi.stubGlobal("window", { localStorage: ls });
    S().setWallLength(wallIds()[0], 5);
    S().setHoverSegment("x");
    expect(ls.data.size).toBe(0);
    vi.advanceTimersByTime(350);
    const saved = JSON.parse(ls.data.get("merka:v1")!);
    expect(Object.keys(saved.state).sort()).toEqual(["activeRoomId", "project", "view"]);
    expect(saved.state.project.id).toBe(S().project.id);
    expect(saved.version).toBe(1);
  });

  it("восстанавливает валидный проект и игнорирует мусор", async () => {
    const ls = memoryStorage();
    vi.stubGlobal("window", { localStorage: ls });
    const demo = createDemoProject();
    ls.setItem("merka:v1", JSON.stringify({ state: { project: demo, activeRoomId: "nope", view: "3d" }, version: 1 }));
    await useAppStore.persist.rehydrate();
    expect(S().project).toEqual(demo);
    expect(S().activeRoomId).toBe(demo.rooms[0].id);
    expect(S().view).toBe("3d");

    const before = S().project;
    ls.setItem("merka:v1", JSON.stringify({ state: { project: { rooms: "x" } }, version: 1 }));
    await useAppStore.persist.rehydrate();
    expect(S().project).toBe(before);
    ls.setItem("merka:v1", "{not json");
    await useAppStore.persist.rehydrate();
    expect(S().project).toBe(before);
  });
});
