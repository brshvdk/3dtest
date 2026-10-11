/**
 * Локальное состояние 3D-вида (не проект): режим стен, подписи, активный
 * ракурс, подсказка и всплывающая информация под курсором. Настройки вида
 * запоминаются в localStorage — это удобство конкретного пользователя.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";

export type WallMode = "auto" | "all" | "low";
export type CameraPreset = "persp" | "top" | "entry";

interface Prefs {
  wallMode: WallMode;
  labels: boolean;
}

const PREFS_KEY = "merka:3d";
const HINT_KEY = "merka:3d-hint";

function readPrefs(): Prefs {
  const def: Prefs = { wallMode: "auto", labels: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      wallMode: p.wallMode === "all" || p.wallMode === "low" ? p.wallMode : "auto",
      labels: typeof p.labels === "boolean" ? p.labels : true,
    };
  } catch {
    return def;
  }
}

function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* приватный режим */
  }
}

function readHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export interface CameraRequest {
  preset: CameraPreset;
  /** Счётчик запросов: повторное нажатие той же кнопки снова двигает камеру. */
  seq: number;
  /** Без анимации (первый показ). */
  instant: boolean;
}

/** Короткая подпись над панелью после нажатия кнопки-иконки (что сейчас включено). */
export interface Flash {
  text: string;
  /** Какая группа кнопок: подпись нужна только там, где у кнопок нет текста. */
  kind: "view" | "walls" | "labels";
  seq: number;
}

interface ViewState extends Prefs {
  /** Ракурс, выбранный последним (подсвечен, пока пользователь не повернул камеру). */
  activePreset: CameraPreset | null;
  request: CameraRequest;
  hintSeen: boolean;
  /** Сколько пикселей сверху занимает подсказка (кадр вписывается ниже неё). */
  insetTop: number;
  flash: Flash | null;
  setWallMode(m: WallMode): void;
  toggleLabels(): void;
  goTo(preset: CameraPreset, instant?: boolean): void;
  setActivePreset(p: CameraPreset | null): void;
  dismissHint(): void;
  setInsetTop(px: number): void;
  showFlash(text: string, kind: Flash["kind"]): void;
}

export const useView3d = create<ViewState>((set, get) => ({
  ...readPrefs(),
  activePreset: "persp",
  request: { preset: "persp", seq: 0, instant: true },
  hintSeen: readHintSeen(),
  insetTop: 0,
  flash: null,
  setWallMode: (wallMode) => {
    if (get().wallMode === wallMode) return;
    set({ wallMode });
    writePrefs({ wallMode, labels: get().labels });
  },
  toggleLabels: () => {
    const labels = !get().labels;
    set({ labels });
    writePrefs({ wallMode: get().wallMode, labels });
  },
  goTo: (preset, instant = false) =>
    set((s) => ({ activePreset: preset, request: { preset, seq: s.request.seq + 1, instant } })),
  setActivePreset: (activePreset) => {
    if (get().activePreset !== activePreset) set({ activePreset });
  },
  dismissHint: () => {
    if (get().hintSeen) return;
    set({ hintSeen: true });
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* приватный режим */
    }
  },
  setInsetTop: (px) => {
    const v = Math.max(0, Math.round(px));
    if (get().insetTop !== v) set({ insetTop: v });
  },
  showFlash: (text, kind) => set((s) => ({ flash: { text, kind, seq: (s.flash?.seq ?? 0) + 1 } })),
}));

/* ------------------- Подсказка под курсором (тултип) ------------------- */

export interface HoverInfo {
  /** Ключ объекта — чтобы уход с одного объекта не стирал подсказку другого. */
  key: string;
  title: string;
  sub?: string;
  tone?: "skirting" | "default";
}

let hoverInfo: HoverInfo | null = null;
const listeners = new Set<() => void>();

export function setHoverInfo(info: HoverInfo | null): void {
  if (hoverInfo === info) return;
  if (hoverInfo && info && hoverInfo.key === info.key && hoverInfo.title === info.title && hoverInfo.sub === info.sub) {
    return;
  }
  hoverInfo = info;
  listeners.forEach((l) => l());
}

/** Убирает подсказку, только если она всё ещё принадлежит объекту key. */
export function clearHoverInfo(key: string): void {
  if (hoverInfo && hoverInfo.key === key) setHoverInfo(null);
}

export function useHoverInfo(): HoverInfo | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => hoverInfo,
    () => null,
  );
}
