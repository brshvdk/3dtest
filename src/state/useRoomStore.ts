import { create } from "zustand";

export type FloorPattern = "herringbone" | "deck";

export interface RoomState {
  // Размеры в метрах
  length: number; // X
  width: number; // Z
  height: number; // Y

  // Параметры пола
  pattern: FloorPattern;
  plankLength: number; // м
  plankWidth: number; // м
  gap: number; // м (зазор между плашками)
  reservePct: number; // запас по плашкам (%)

  // Материалы
  wallColor: string;
  woodTint: string;

  // Расход краски
  paintCoverage: number; // м²/л на 1 слой
  paintCoats: number; // число слоёв

  setLength: (v: number) => void;
  setWidth: (v: number) => void;
  setHeight: (v: number) => void;
  setPattern: (p: FloorPattern) => void;
  setGap: (v: number) => void;
  setReservePct: (v: number) => void;
  setWallColor: (c: string) => void;
  setWoodTint: (c: string) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  length: 5,
  width: 4,
  height: 2.7,

  pattern: "herringbone",
  plankLength: 0.6,
  plankWidth: 0.1,
  gap: 0.002,
  reservePct: 10,

  wallColor: "#e8e1d4",
  woodTint: "#c89567",

  paintCoverage: 10,
  paintCoats: 2,

  setLength: (v) => set({ length: clamp(v, 1.5, 15) }),
  setWidth: (v) => set({ width: clamp(v, 1.5, 15) }),
  setHeight: (v) => set({ height: clamp(v, 2, 4.5) }),
  setPattern: (pattern) => set({ pattern }),
  setGap: (v) => set({ gap: clamp(v, 0, 0.01) }),
  setReservePct: (v) => set({ reservePct: clamp(v, 0, 30) }),
  setWallColor: (wallColor) => set({ wallColor }),
  setWoodTint: (woodTint) => set({ woodTint }),
}));

function clamp(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
