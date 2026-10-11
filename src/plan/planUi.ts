/**
 * Локальное состояние редактора плана: наведение, текущее перетаскивание,
 * редактируемая подпись, чья контекстная панель открыта. Отдельный маленький
 * store, чтобы наведение мыши перерисовывало только слой подсветки, а не весь план.
 */
import { create } from "zustand";
import type { Vec2 } from "../domain/types";
import { useAppStore, type Selection } from "../state/store";

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
  /**
   * Выделение, для которого открыта контекстная панель (та же ссылка, что в
   * сторе). Панель открывает только выбор на самом плане; выделение из боковой
   * панели или 3D лишь подсвечивает объект.
   */
  ctxFor: Selection;
  /** Панель открыта с клавиатуры — перевести фокус в неё. */
  ctxFocus: boolean;
  /** Высота панели, прижатой к низу плана (0 — её нет), px: вписывание учитывает её. */
  sheetH: number;
  setHover(h: HoverTarget, inRoom: boolean): void;
  setDrag(d: DragInfo | null): void;
  setEditing(k: string | null): void;
  setCtxFor(sel: Selection): void;
  setCtxFocus(v: boolean): void;
  setSheetH(h: number): void;
}

const sameHover = (a: HoverTarget, b: HoverTarget): boolean =>
  a === b || (!!a && !!b && a.type === b.type && a.id === b.id);

export const usePlanUi = create<PlanUiState>((set, get) => ({
  hover: null,
  inRoom: false,
  drag: null,
  editing: null,
  ctxFor: null,
  ctxFocus: false,
  sheetH: 0,
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
  setCtxFor(ctxFor) {
    if (get().ctxFor !== ctxFor) set({ ctxFor });
  },
  setCtxFocus(ctxFocus) {
    if (get().ctxFocus !== ctxFocus) set({ ctxFocus });
  },
  setSheetH(sheetH) {
    if (get().sheetH !== sheetH) set({ sheetH });
  },
}));

/** Ключ выделения: `wall:<id>`, `point:<id>`, `opening:<id>` (и data-plan-key у ручек плана). */
export function selectionKey(sel: Selection): string {
  if (!sel) return "";
  return `${sel.type}:${sel.type === "wall" ? sel.wallId : sel.type === "point" ? sel.pointId : sel.openingId}`;
}

/** Текущее выделение сделано на плане — открыть для него контекстную панель. */
export function claimSelection(): void {
  usePlanUi.getState().setCtxFor(useAppStore.getState().selection);
}

/** Выделить объект с плана (клик, тап, клавиатура) и открыть его панель; focus — перевести фокус в неё. */
export function selectOnPlan(sel: Selection, focus = false): void {
  useAppStore.getState().select(sel);
  claimSelection();
  if (focus) usePlanUi.getState().setCtxFocus(true);
}

/**
 * Элемент плана с фокусом уходит из DOM (панель закрылась, ручку удалили) —
 * вернуть фокус на план (prefer — например, на плашку), а не терять его на <body>.
 */
export function keepFocusInPlan(el: HTMLElement | null, prefer?: () => HTMLElement | null): void {
  if (!el || !el.contains(document.activeElement)) return;
  const root = el.closest<HTMLElement>(".pl-root");
  queueMicrotask(() => {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const target = prefer?.() ?? root;
    if (target?.isConnected) target.focus({ preventScroll: true });
  });
}
