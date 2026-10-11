import { describe, expect, it } from "vitest";
import { getWalls } from "../../domain/geometry";
import { createOpening } from "../../domain/openings";
import { createRoom } from "../../domain/project";
import { useAppStore } from "../../state/store";
import { dimChipPos, layoutWallLabels, openingDimItems, type WallLabelLayout } from "../Labels";
import { claimSelection, selectionKey, selectOnPlan, usePlanUi } from "../planUi";

describe("плашки размеров проёма", () => {
  const room = createRoom({ params: { length: 4, width: 3 } });
  const walls = getWalls(room);
  const w = walls[0];
  // Дверь у самого правого угла: «до правого угла» — короткий участок, плашка вынесена за угол.
  const door = { ...createOpening("door", w.id, 4 - 0.87 - 0.1, "door-80") };
  const s = 60;
  const items = openingDimItems(door, w, s);
  const right = items.find((it) => it.key.startsWith("opr:"))!;

  it("без помех — плашка на размерной линии", () => {
    const empty: WallLabelLayout = new Map();
    expect(right.tight).toBe(true);
    expect(dimChipPos(w, right, 0.3, s, empty)).toEqual({ along: right.chipAlong, perp: 0.3 });
  });

  it("плашка стены на месте — отводим вглубь комнаты", () => {
    const c = {
      x: (w.a.x + w.dir.x * right.chipAlong + w.normalIn.x * 0.3) * s,
      y: (w.a.y + w.dir.y * right.chipAlong + w.normalIn.y * 0.3) * s,
    };
    const blocker: WallLabelLayout = new Map([
      ["x", { text: "B", compact: true, offPx: 0, shiftPx: 0, rect: { x0: c.x - 20, y0: c.y - 14, x1: c.x + 20, y1: c.y + 14 } }],
    ]);
    const at = dimChipPos(w, right, 0.3, s, blocker);
    expect(at.perp).toBeGreaterThan(0.3);
  });

  it("раскладка плашек стен без наложений у прямоугольной комнаты", () => {
    const layout = layoutWallLabels(walls, s, false);
    const rects = [...layout.values()].map((x) => x.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
      }
    }
  });
});

describe("контекстная панель плана", () => {
  it("открывается только для выделения, сделанного на плане", () => {
    const st = useAppStore.getState();
    const room = st.project.rooms.find((r) => r.id === st.activeRoomId)!;
    const wallId = room.points[0].id;
    // Выделение из боковой панели — панель плана не открыта.
    st.select({ type: "wall", roomId: room.id, wallId });
    expect(usePlanUi.getState().ctxFor).not.toBe(useAppStore.getState().selection);
    // Выбор на плане — открыта именно для этого выделения.
    selectOnPlan({ type: "wall", roomId: room.id, wallId });
    expect(usePlanUi.getState().ctxFor).toBe(useAppStore.getState().selection);
    expect(selectionKey(useAppStore.getState().selection)).toBe(`wall:${wallId}`);
    // Новое выделение из панели (тот же объект, новая ссылка) панель не наследует.
    st.select({ type: "wall", roomId: room.id, wallId: room.points[1].id });
    expect(usePlanUi.getState().ctxFor).not.toBe(useAppStore.getState().selection);
    claimSelection();
    expect(usePlanUi.getState().ctxFor).toBe(useAppStore.getState().selection);
    st.select(null);
    expect(selectionKey(null)).toBe("");
  });
});
