/**
 * Глобальное состояние приложения (zustand 5): проект, активная комната,
 * выделение, вид, история правок (undo/redo) и сохранение в localStorage.
 *
 * Правила истории:
 *  - любая правка проекта ставит updatedAt и кладёт прежний проект в past
 *    (≤ HISTORY_LIMIT), future очищается;
 *  - undo/redo возвращают снимок из истории как новую ревизию: содержимое то
 *    же (по ссылкам), updatedAt — время перехода;
 *  - между beginGesture и endGesture весь жест (перетаскивание) — одна
 *    запись, она появляется в endGesture, если проект изменился;
 *  - transient-правки вне жеста склеиваются в одну запись до первой
 *    обычной правки или undo/redo (на случай, если UI не открыл жест);
 *  - частые правки одного поля (ввод текста, ползунок, выбор цвета) в
 *    пределах COALESCE_MS склеиваются в одну запись.
 */
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { clamp } from "../domain/geometry";
import {
  MAX_NAME_LENGTH,
  MAX_PROJECT_ROOMS,
  ROOM_HEIGHT_RANGE,
  SCHEMA_VERSION,
  WALL_THICKNESS_RANGE,
  cloneRoom,
  createDemoProject,
  createProject,
  createRoom,
  migrateProject,
} from "../domain/project";
import * as edit from "../domain/roomEdit";
import { clearShareHash, decodeProject, readShareHash } from "../domain/share";
import { getCatalogProduct, priceForLength } from "../domain/skirtingCatalog";
import type {
  AccessoryPrices,
  Appearance,
  FloorPattern,
  Opening,
  OpeningKind,
  ProductOverride,
  Project,
  Room,
  RoomShapeId,
  SkirtingProduct,
  SkirtingSettings,
  Vec2,
} from "../domain/types";

export type ViewMode = "plan" | "3d" | "split";
export type PanelTab = "room" | "openings" | "skirting" | "result";
export type Selection =
  | { type: "wall"; roomId: string; wallId: string }
  | { type: "point"; roomId: string; pointId: string }
  | { type: "opening"; roomId: string; openingId: string }
  | null;

/** transient: не писать в историю (во время перетаскивания). */
export interface EditOpts {
  transient?: boolean;
}

/** Правка продукта: цены можно передавать частично — они мёржатся. */
export type ProductOverridePatch = Omit<ProductOverride, "prices"> & {
  prices?: Partial<AccessoryPrices>;
};

export interface AppState {
  project: Project;
  activeRoomId: string;
  selection: Selection;
  /** Подсветка участка плинтуса между планом/3D/раскроем. */
  hoverSegmentId: string | null;
  /**
   * Подсветка стены активной комнаты при наведении в панелях (план/3D).
   * Снимается при смене активной комнаты, undo/redo, новом или загруженном
   * проекте и когда подсвеченной стены больше нет (удалили точку, шаблон).
   */
  hoverWallId: string | null;
  view: ViewMode;
  panelTab: PanelTab;
  /** История (≤ 100). */
  past: Project[];
  future: Project[];
  // история
  undo(): void;
  redo(): void;
  beginGesture(): void;
  endGesture(): void;
  // проект
  newProject(): void;
  /** Проект извне (файл, ссылка): проходит migrateProject; не проект — игнорируется. */
  loadProject(p: Project): void;
  renameProject(name: string): void;
  // комнаты
  /** Добавляет комнату и делает её активной. */
  addRoom(shape?: RoomShapeId): void;
  duplicateRoom(roomId: string): void;
  /** Последнюю комнату удалить нельзя. */
  removeRoom(roomId: string): void;
  setActiveRoom(roomId: string): void;
  renameRoom(roomId: string, name: string): void;
  /** К активной комнате. */
  applyTemplate(shape: RoomShapeId, params?: Partial<Record<string, number>>): void;
  /** К активной комнате. */
  updateRoom(patch: Partial<Pick<Room, "height" | "wallThickness" | "skirtingEnabled" | "productId" | "name">>): void;
  // стены и точки (активная комната)
  setWallLength(wallId: string, length: number, o?: EditOpts): void;
  moveWall(wallId: string, delta: number, o?: EditOpts): void;
  moveVertex(pointId: string, pos: Vec2, o?: EditOpts): void;
  /** Делит стену и выделяет новую точку. */
  splitWall(wallId: string, at: number): void;
  removePoint(pointId: string): void;
  setWallThickness(wallId: string, t: number): void;
  // проёмы (активная комната)
  /** Добавляет и выделяет новый проём; null — нет места. */
  addOpening(kind: OpeningKind, opts?: { wallId?: string; presetId?: string; offset?: number }): string | null;
  updateOpening(id: string, patch: Partial<Opening>, o?: EditOpts): void;
  moveOpening(id: string, wallId: string, offset: number, o?: EditOpts): void;
  removeOpening(id: string): void;
  duplicateOpening(id: string): void;
  // плинтус
  setDefaultProduct(productId: string): void;
  /** Цены (prices) мёржатся; значения, совпавшие с каталогом, не хранятся. */
  updateProductOverride(productId: string, patch: ProductOverridePatch): void;
  resetProductOverride(productId: string): void;
  updateSkirtingSettings(patch: Partial<SkirtingSettings>): void;
  // вид
  setAppearance(patch: Partial<Appearance>): void;
  select(sel: Selection): void;
  setHoverSegment(id: string | null): void;
  setHoverWall(id: string | null): void;
  setView(v: ViewMode): void;
  setPanelTab(t: PanelTab): void;
}

export const HISTORY_LIMIT = 100;
/** мс, в течение которых правки одного поля склеиваются в одну запись истории. */
const COALESCE_MS = 1000;
/** Ключ склейки transient-правок вне жеста (без ограничения по времени). */
const TRANSIENT_KEY = "\u0000transient";
const STORAGE_KEY = "merka:v1";
/** мс, задержка записи в localStorage и максимальная отсрочка при непрерывных правках. */
const SAVE_DELAY_MS = 300;
const SAVE_MAX_WAIT_MS = 2000;

const VIEWS: readonly ViewMode[] = ["plan", "3d", "split"];
const FLOOR_PATTERNS: readonly FloorPattern[] = ["deck", "herringbone", "tile", "plain"];
const HEX_RE = /^#[0-9a-f]{6}$/i;

type Persisted = Pick<AppState, "project" | "activeRoomId" | "view">;

/* --------------------------- Чистые помощники --------------------------- */

const findRoom = (project: Project, roomId: string): Room | undefined =>
  project.rooms.find((r) => r.id === roomId);

const replaceRoom = (project: Project, room: Room): Project => ({
  ...project,
  rooms: project.rooms.map((r) => (r.id === room.id ? room : r)),
});

const pushHistory = (stack: Project[], p: Project): Project[] => [...stack, p].slice(-HISTORY_LIMIT);

/** Выделение, которое всё ещё указывает на существующий объект активной комнаты, иначе null. */
function validSelection(project: Project, activeRoomId: string, sel: Selection): Selection {
  if (!sel || sel.roomId !== activeRoomId) return null;
  const room = findRoom(project, sel.roomId);
  if (!room) return null;
  switch (sel.type) {
    case "wall":
      return room.points.some((p) => p.id === sel.wallId) ? sel : null;
    case "point":
      return room.points.some((p) => p.id === sel.pointId) ? sel : null;
    case "opening":
      return room.openings.some((o) => o.id === sel.openingId) ? sel : null;
  }
}

/** Подсветка стены (hoverWallId), если стена есть в активной комнате, иначе null. */
function validHoverWall(project: Project, activeRoomId: string, wallId: string | null): string | null {
  if (wallId === null) return null;
  return findRoom(project, activeRoomId)?.points.some((p) => p.id === wallId) ? wallId : null;
}

/** Активная комната и выделение, согласованные с проектом. */
function consistentView(project: Project, activeRoomId: string, selection: Selection) {
  const active = findRoom(project, activeRoomId) ? activeRoomId : project.rooms[0].id;
  return { activeRoomId: active, selection: validSelection(project, active, selection) };
}

/**
 * Комната, которую затронул переход from → to (первая отличающаяся по ссылке),
 * если активная при этом не менялась: undo/redo показывают, что изменилось.
 */
function roomToReveal(from: Project, to: Project, activeRoomId: string): string {
  if (findRoom(from, activeRoomId) !== findRoom(to, activeRoomId)) return activeRoomId;
  const changed = to.rooms.find((r) => findRoom(from, r.id) !== r);
  return changed ? changed.id : activeRoomId;
}

/** «Комната N» с первым свободным номером. */
function nextRoomName(project: Project): string {
  const names = new Set(project.rooms.map((r) => r.name));
  let n = project.rooms.length + 1;
  while (names.has(`Комната ${n}`)) n++;
  return `Комната ${n}`;
}

function copyName(project: Project, name: string): string {
  const names = new Set(project.rooms.map((r) => r.name));
  let candidate = `${name} (копия)`;
  for (let n = 2; names.has(candidate); n++) candidate = `${name} (копия ${n})`;
  return candidate;
}

const SCALAR_OVERRIDE_KEYS = [
  "length",
  "height",
  "depth",
  "color",
  "cornerMethod",
  "fastenerStep",
  "glueRate",
  "price",
  "name",
] as const;
type ScalarOverrideKey = (typeof SCALAR_OVERRIDE_KEYS)[number];

function setOverrideKey<K extends ScalarOverrideKey>(o: ProductOverride, key: K, value: ProductOverride[K]) {
  if (value === undefined) delete o[key];
  else o[key] = value;
}

/**
 * Правка продукта каталога поверх текущей. Храним только отличия от
 * каталога: совпавшие с ним значения удаляются. undefined — правок нет.
 */
function mergeOverride(
  base: SkirtingProduct,
  current: ProductOverride | undefined,
  patch: ProductOverridePatch,
): ProductOverride | undefined {
  const next: ProductOverride = { ...current };
  for (const key of SCALAR_OVERRIDE_KEYS) {
    if (key in patch) setOverrideKey(next, key, patch[key]);
  }
  if (typeof next.color === "string") next.color = next.color.toLowerCase();
  // Своя цена — цена планки своей длины: при смене длины без новой цены
  // сохраняем цену погонного метра (550 ₽ за 2,4 м → 642 ₽ за 2,8 м).
  if ("length" in patch && !("price" in patch) && typeof next.price === "number") {
    const was = current?.length ?? base.length;
    const now = next.length ?? base.length;
    if (was > 0 && now > 0 && Number.isFinite(was) && Number.isFinite(now) && was !== now) {
      next.price = Math.round((next.price / was) * now);
    }
  }
  if (patch.prices) {
    const prices: AccessoryPrices = { ...base.prices, ...current?.prices };
    for (const k of Object.keys(base.prices) as Array<keyof AccessoryPrices>) {
      const v = patch.prices[k];
      if (typeof v === "number" && Number.isFinite(v)) prices[k] = v;
    }
    next.prices = prices;
  }
  for (const key of SCALAR_OVERRIDE_KEYS) {
    if (key !== "price" && next[key] === base[key]) delete next[key];
  }
  // Цена без правки следует за длиной планки (priceForLength) — совпавшая с ней не правка.
  if (next.price === priceForLength(base, next.length ?? base.length)) delete next.price;
  const p = next.prices;
  if (p && (Object.keys(base.prices) as Array<keyof AccessoryPrices>).every((k) => p[k] === base.prices[k])) {
    delete next.prices;
  }
  return Object.keys(next).length ? next : undefined;
}

function sanitizeSkirting(cur: SkirtingSettings, patch: Partial<SkirtingSettings>): SkirtingSettings {
  const num = (v: number | undefined, old: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : old;
  return {
    productId: typeof patch.productId === "string" && getCatalogProduct(patch.productId) ? patch.productId : cur.productId,
    reservePct: num(patch.reservePct, cur.reservePct, 0, 100),
    minPiece: num(patch.minPiece, cur.minPiece, 0, 5),
    kerf: num(patch.kerf, cur.kerf, 0, 0.05),
    shareOffcuts: typeof patch.shareOffcuts === "boolean" ? patch.shareOffcuts : cur.shareOffcuts,
  };
}

function sanitizeAppearance(cur: Appearance, patch: Partial<Appearance>): Appearance {
  const color = (v: string | undefined, old: string) => (v && HEX_RE.test(v) ? v.toLowerCase() : old);
  return {
    wallColor: color(patch.wallColor, cur.wallColor),
    floorTint: color(patch.floorTint, cur.floorTint),
    floorPattern:
      patch.floorPattern && FLOOR_PATTERNS.includes(patch.floorPattern) ? patch.floorPattern : cur.floorPattern,
  };
}

const shallowEqual = <T extends object>(a: T, b: T): boolean =>
  (Object.keys(a) as Array<keyof T>).every((k) => a[k] === b[k]) &&
  Object.keys(a).length === Object.keys(b).length;

/** Ключ склейки для правки набора полей объекта. */
const fieldsKey = (scope: string, patch: object): string => `${scope}:${Object.keys(patch).sort().join(",")}`;

/* ------------------------------ Хранилище ------------------------------ */

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    // Доступ к localStorage может бросать (приватный режим, запрет cookies).
    return null;
  }
}

/**
 * localStorage с отложенной записью: при перетаскивании состояние меняется
 * десятки раз в секунду, а пишем не чаще раза в SAVE_DELAY_MS (но не позже
 * SAVE_MAX_WAIT_MS). Изменения UI (выделение, подсветка) запись не вызывают.
 * Без window (тесты, SSR) — ничего не сохраняет.
 */
function createDebouncedStorage(): PersistStorage<Persisted> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: StorageValue<Persisted> } | null = null;
  let firstPendingAt = 0;
  let saved: Persisted | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      getLocalStorage()?.setItem(name, JSON.stringify(value));
      saved = value.state;
    } catch {
      // Переполнение квоты и т.п.: продолжаем работать без сохранения.
    }
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
    }
  }

  return {
    getItem: (name) => {
      try {
        const raw = getLocalStorage()?.getItem(name);
        // Структура проверяется в merge (migrateProject).
        return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (!getLocalStorage()) return;
      const s = value.state;
      const base = pending?.value.state ?? saved;
      if (base && base.project === s.project && base.activeRoomId === s.activeRoomId && base.view === s.view) return;
      if (!pending) firstPendingAt = Date.now();
      pending = { name, value };
      if (timer) clearTimeout(timer);
      const wait = Date.now() - firstPendingAt >= SAVE_MAX_WAIT_MS ? 0 : SAVE_DELAY_MS;
      timer = setTimeout(flush, wait);
    },
    removeItem: (name) => {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        getLocalStorage()?.removeItem(name);
      } catch {
        // нечего удалять
      }
    },
  };
}

/** Восстановление из localStorage: всё проверяем, мусор — игнорируем. */
function mergePersisted(persisted: unknown, current: AppState): AppState {
  if (typeof persisted !== "object" || persisted === null) return current;
  const p = persisted as Partial<Record<keyof Persisted, unknown>>;
  const project = migrateProject(p.project);
  if (!project) return current;
  const activeRoomId =
    typeof p.activeRoomId === "string" && findRoom(project, p.activeRoomId) ? p.activeRoomId : project.rooms[0].id;
  const view = VIEWS.includes(p.view as ViewMode) ? (p.view as ViewMode) : current.view;
  return { ...current, project, activeRoomId, view, selection: null, past: [], future: [] };
}

/* -------------------------------- Store -------------------------------- */

interface CommitOpts {
  transient?: boolean;
  /** Ключ склейки частых правок одного поля. */
  coalesce?: string;
  activeRoomId?: string;
  selection?: Selection;
  /** Снять подсветку стены (новый проект целиком). */
  resetHover?: boolean;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      /** Проект до начала открытого жеста (beginGesture). */
      let gestureBase: Project | null = null;
      /** Последняя «склеиваемая» правка. */
      let lastCommit: { key: string; at: number } | null = null;

      /** Закрывает жест: база уходит в историю, если проект изменился. */
      const flushGesture = () => {
        if (!gestureBase) return;
        const base = gestureBase;
        gestureBase = null;
        const s = get();
        if (base !== s.project) set({ past: pushHistory(s.past, base), future: [] });
      };

      /** Применяет новый проект (с историей). false — ничего не изменилось. */
      const commit = (next: Project, opts: CommitOpts = {}): boolean => {
        const s = get();
        if (next === s.project) return false;
        const now = Date.now();
        let { past, future } = s;
        if (gestureBase) {
          // Запись появится в endGesture.
          lastCommit = null;
        } else {
          const key = opts.transient ? TRANSIENT_KEY : opts.coalesce;
          const merge =
            key !== undefined &&
            lastCommit?.key === key &&
            (key === TRANSIENT_KEY || now - lastCommit.at < COALESCE_MS);
          if (!merge) past = pushHistory(past, s.project);
          future = [];
          lastCommit = key !== undefined ? { key, at: now } : null;
        }
        const project: Project = { ...next, updatedAt: now };
        const view = consistentView(
          project,
          opts.activeRoomId ?? s.activeRoomId,
          opts.selection !== undefined ? opts.selection : s.selection,
        );
        // Подсветка из панели живёт, пока жива её стена в той же активной комнате.
        const hoverWallId =
          opts.resetHover || view.activeRoomId !== s.activeRoomId
            ? null
            : validHoverWall(project, view.activeRoomId, s.hoverWallId);
        set({ project, past, future, ...view, hoverWallId });
        return true;
      };

      const activeRoom = (): Room => {
        const { project, activeRoomId } = get();
        return findRoom(project, activeRoomId) ?? project.rooms[0];
      };

      /** Правка активной комнаты чистой функцией Room → Room. */
      const editRoom = (fn: (room: Room) => Room, opts: CommitOpts = {}): boolean => {
        const room = activeRoom();
        const next = fn(room);
        if (next === room) return false;
        return commit(replaceRoom(get().project, next), opts);
      };

      /**
       * Переход по истории (undo/redo). Снимок возвращается тем же содержимым
       * (комнаты и настройки — те же объекты), но как новая ревизия проекта —
       * со свежим updatedAt: проект изменился сейчас, и это должны видеть другие
       * вкладки (свежее — значит принять), список недавних проектов и печать.
       */
      const travel = (from: "past" | "future") => {
        flushGesture();
        lastCommit = null;
        const s = get();
        const stack = s[from];
        if (!stack.length) return;
        const target = from === "past" ? stack[stack.length - 1] : stack[0];
        const rest = from === "past" ? stack.slice(0, -1) : stack.slice(1);
        const project: Project = { ...target, updatedAt: Date.now() };
        set({
          project,
          past: from === "past" ? rest : pushHistory(s.past, s.project),
          future: from === "past" ? [s.project, ...s.future].slice(0, HISTORY_LIMIT) : rest,
          ...consistentView(project, roomToReveal(s.project, project, s.activeRoomId), s.selection),
          // Стены могли исчезнуть или смениться под указателем; комната — тоже.
          hoverWallId: null,
        });
      };

      const initial = createDemoProject();

      return {
        project: initial,
        activeRoomId: initial.rooms[0].id,
        selection: null,
        hoverSegmentId: null,
        hoverWallId: null,
        view: "split",
        panelTab: "room",
        past: [],
        future: [],

        undo: () => travel("past"),
        redo: () => travel("future"),
        beginGesture: () => {
          if (gestureBase) return;
          gestureBase = get().project;
          // Жест — граница: transient-правки после него не склеиваются с прежними.
          lastCommit = null;
        },
        endGesture: () => flushGesture(),

        newProject: () => {
          flushGesture();
          const p = createProject();
          commit(p, { activeRoomId: p.rooms[0].id, selection: null, resetHover: true });
        },
        loadProject: (p) => {
          // Проект приходит извне (файл, ссылка) — проверяем так же, как localStorage.
          const project = migrateProject(p);
          if (!project) return;
          flushGesture();
          commit(project, { activeRoomId: project.rooms[0].id, selection: null, resetHover: true });
        },
        renameProject: (name) => {
          const project = get().project;
          const value = name.slice(0, MAX_NAME_LENGTH);
          if (value === project.name) return;
          commit({ ...project, name: value }, { coalesce: "project-name" });
        },

        addRoom: (shape = "rect") => {
          const { project } = get();
          if (project.rooms.length >= MAX_PROJECT_ROOMS) return;
          const current = activeRoom();
          // Высота потолка и стены — как у текущей комнаты (обычно одна квартира).
          const room = createRoom({
            name: nextRoomName(project),
            shape,
            height: current.height,
            wallThickness: current.wallThickness,
          });
          commit({ ...project, rooms: [...project.rooms, room] }, { activeRoomId: room.id, selection: null });
        },
        duplicateRoom: (roomId) => {
          const { project } = get();
          const idx = project.rooms.findIndex((r) => r.id === roomId);
          if (idx < 0 || project.rooms.length >= MAX_PROJECT_ROOMS) return;
          const copy = cloneRoom(project.rooms[idx], copyName(project, project.rooms[idx].name));
          const rooms = [...project.rooms.slice(0, idx + 1), copy, ...project.rooms.slice(idx + 1)];
          commit({ ...project, rooms }, { activeRoomId: copy.id, selection: null });
        },
        removeRoom: (roomId) => {
          const { project, activeRoomId } = get();
          const idx = project.rooms.findIndex((r) => r.id === roomId);
          if (idx < 0 || project.rooms.length <= 1) return;
          const rooms = project.rooms.filter((r) => r.id !== roomId);
          const nextActive = activeRoomId === roomId ? rooms[Math.min(idx, rooms.length - 1)].id : activeRoomId;
          commit({ ...project, rooms }, { activeRoomId: nextActive });
        },
        setActiveRoom: (roomId) => {
          const s = get();
          if (roomId === s.activeRoomId || !findRoom(s.project, roomId)) return;
          set({ activeRoomId: roomId, selection: null, hoverWallId: null });
        },
        renameRoom: (roomId, name) => {
          const { project } = get();
          const room = findRoom(project, roomId);
          const value = name.slice(0, MAX_NAME_LENGTH);
          if (!room || room.name === value) return;
          commit(replaceRoom(project, { ...room, name: value }), { coalesce: `room-name:${roomId}` });
        },
        applyTemplate: (shape, params) => {
          editRoom((r) => edit.applyTemplate(r, shape, params), { coalesce: `template:${get().activeRoomId}` });
        },
        updateRoom: (patch) => {
          const room = activeRoom();
          const next: Room = { ...room };
          if (typeof patch.height === "number" && Number.isFinite(patch.height)) {
            next.height = clamp(patch.height, ROOM_HEIGHT_RANGE.min, ROOM_HEIGHT_RANGE.max);
          }
          if (typeof patch.wallThickness === "number" && Number.isFinite(patch.wallThickness)) {
            next.wallThickness = clamp(patch.wallThickness, WALL_THICKNESS_RANGE.min, WALL_THICKNESS_RANGE.max);
          }
          if (typeof patch.skirtingEnabled === "boolean") next.skirtingEnabled = patch.skirtingEnabled;
          // Неизвестный id молча заменился бы в расчёте плинтусом по умолчанию — не принимаем.
          if (patch.productId === null || patch.productId === "") next.productId = null;
          else if (typeof patch.productId === "string" && getCatalogProduct(patch.productId)) {
            next.productId = patch.productId;
          }
          if (typeof patch.name === "string") next.name = patch.name.slice(0, MAX_NAME_LENGTH);
          if (shallowEqual(room, next)) return;
          editRoom(() => next, { coalesce: fieldsKey(`room:${room.id}`, patch) });
        },

        setWallLength: (wallId, length, o) => {
          editRoom((r) => edit.setWallLength(r, wallId, length), { transient: o?.transient });
        },
        moveWall: (wallId, delta, o) => {
          editRoom((r) => edit.moveWall(r, wallId, delta), { transient: o?.transient });
        },
        moveVertex: (pointId, pos, o) => {
          editRoom((r) => edit.moveVertex(r, pointId, pos), { transient: o?.transient });
        },
        splitWall: (wallId, at) => {
          const room = activeRoom();
          const next = edit.splitWall(room, wallId, at);
          if (next === room) return;
          const idx = next.points.findIndex((p) => p.id === wallId);
          const point = next.points[(idx + 1) % next.points.length];
          commit(replaceRoom(get().project, next), {
            selection: { type: "point", roomId: room.id, pointId: point.id },
          });
        },
        removePoint: (pointId) => {
          editRoom((r) => edit.removePoint(r, pointId));
        },
        setWallThickness: (wallId, t) => {
          editRoom((r) => edit.setWallThickness(r, wallId, t), { coalesce: `thickness:${wallId}` });
        },

        addOpening: (kind, opts) => {
          const room = activeRoom();
          const res = edit.addOpening(room, kind, opts);
          if (!res.openingId) return null;
          commit(replaceRoom(get().project, res.room), {
            selection: { type: "opening", roomId: room.id, openingId: res.openingId },
          });
          return res.openingId;
        },
        updateOpening: (id, patch, o) => {
          editRoom((r) => edit.updateOpening(r, id, patch), {
            transient: o?.transient,
            coalesce: fieldsKey(`opening:${id}`, patch),
          });
        },
        moveOpening: (id, wallId, offset, o) => {
          editRoom((r) => edit.moveOpening(r, id, wallId, offset), { transient: o?.transient });
        },
        removeOpening: (id) => {
          editRoom((r) => edit.removeOpening(r, id));
        },
        duplicateOpening: (id) => {
          const room = activeRoom();
          const res = edit.duplicateOpening(room, id);
          if (!res.openingId) return;
          commit(replaceRoom(get().project, res.room), {
            selection: { type: "opening", roomId: room.id, openingId: res.openingId },
          });
        },

        setDefaultProduct: (productId) => {
          const { project } = get();
          if (project.skirting.productId === productId || !getCatalogProduct(productId)) return;
          commit({ ...project, skirting: { ...project.skirting, productId } });
        },
        updateProductOverride: (productId, patch) => {
          const base = getCatalogProduct(productId);
          if (!base) return; // правки применимы только к продуктам каталога
          const { project } = get();
          const current = project.productOverrides[productId];
          const merged = mergeOverride(base, current, patch);
          const productOverrides = { ...project.productOverrides };
          if (merged) productOverrides[productId] = merged;
          else delete productOverrides[productId];
          if (!merged && !current) return;
          if (merged && current && JSON.stringify(merged) === JSON.stringify(current)) return;
          commit({ ...project, productOverrides }, { coalesce: fieldsKey(`override:${productId}`, patch) });
        },
        resetProductOverride: (productId) => {
          const { project } = get();
          if (!(productId in project.productOverrides)) return;
          const productOverrides = { ...project.productOverrides };
          delete productOverrides[productId];
          commit({ ...project, productOverrides });
        },
        updateSkirtingSettings: (patch) => {
          const { project } = get();
          const skirting = sanitizeSkirting(project.skirting, patch);
          if (shallowEqual(skirting, project.skirting)) return;
          commit({ ...project, skirting }, { coalesce: fieldsKey("skirting", patch) });
        },

        setAppearance: (patch) => {
          const { project } = get();
          const appearance = sanitizeAppearance(project.appearance, patch);
          if (shallowEqual(appearance, project.appearance)) return;
          commit({ ...project, appearance }, { coalesce: fieldsKey("appearance", patch) });
        },
        select: (sel) => {
          const s = get();
          // Выделение в другой комнате делает её активной.
          const roomId = sel && findRoom(s.project, sel.roomId) ? sel.roomId : s.activeRoomId;
          const selection = validSelection(s.project, roomId, sel);
          // Заодно сверяем подсветку: проект мог смениться в обход стора (другая вкладка).
          const hoverWallId = roomId === s.activeRoomId ? validHoverWall(s.project, roomId, s.hoverWallId) : null;
          if (selection === s.selection && roomId === s.activeRoomId && hoverWallId === s.hoverWallId) return;
          set({ selection, activeRoomId: roomId, hoverWallId });
        },
        setHoverSegment: (id) => {
          if (get().hoverSegmentId !== id) set({ hoverSegmentId: id });
        },
        setHoverWall: (id) => {
          if (get().hoverWallId !== id) set({ hoverWallId: id });
        },
        setView: (view) => {
          if (VIEWS.includes(view) && get().view !== view) set({ view });
        },
        setPanelTab: (panelTab) => {
          if (get().panelTab !== panelTab) set({ panelTab });
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createDebouncedStorage(),
      partialize: (s): Persisted => ({ project: s.project, activeRoomId: s.activeRoomId, view: s.view }),
      // Будущие версии схемы: данные всё равно проходят migrateProject в merge.
      migrate: (persisted) => persisted as Persisted,
      merge: (persisted, current) => mergePersisted(persisted, current),
    },
  ),
);

/**
 * Если в hash есть проект — загружает его (текущий уходит в историю, его
 * можно вернуть «Отменить») и очищает hash. true — проект загружен.
 */
export async function initFromUrl(): Promise<boolean> {
  const encoded = readShareHash();
  if (!encoded) return false;
  const project = await decodeProject(encoded);
  clearShareHash();
  if (!project) return false;
  useAppStore.getState().loadProject(project);
  return true;
}
