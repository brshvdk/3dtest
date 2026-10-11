/**
 * Локальное состояние редактора плана: наведение, текущее перетаскивание,
 * редактируемая подпись. Отдельный маленький store, чтобы наведение мыши
 * перерисовывало только слой подсветки, а не весь план.
 */
import { create } from "zustand";
import type { Vec2 } from "../domain/types";

export type HoverTarget =
  | { type: "point"; id: string }
  | { type: "opening"; id: string }
  | { type: "wall"; id: string }
  | null;

export type DragInfo =
  | { kind: "wall"; wallId: string }
  | { kind: "point"; pointId: string; guideX: Vec2 | null; guideY: Vec2 | null }
  | { kind: "opening"; openingId: string; centered: boolean }
  | { kind: "pan" };

interface PlanUiState {
  hover: HoverTarget;
  /** Указатель над комнатой — показываем ручки вершин. */
  inRoom: boolean;
  drag: DragInfo | null;
  /** Ключ подписи, открытой для ввода (`wall:<id>`, `opl:<id>`, `opr:<id>`). */
  editing: string | null;
  setHover(h: HoverTarget, inRoom: boolean): void;
  setDrag(d: DragInfo | null): void;
  setEditing(k: string | null): void;
}

const sameHover = (a: HoverTarget, b: HoverTarget): boolean =>
  a === b || (!!a && !!b && a.type === b.type && a.id === b.id);

export const usePlanUi = create<PlanUiState>((set, get) => ({
  hover: null,
  inRoom: false,
  drag: null,
  editing: null,
  setHover(hover, inRoom) {
    const s = get();
    if (sameHover(s.hover, hover) && s.inRoom === inRoom) return;
    set({ hover, inRoom });
  },
  setDrag(drag) {
    set({ drag });
  },
  setEditing(editing) {
    if (get().editing !== editing) set({ editing });
  },
}));
