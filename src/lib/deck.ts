import { Matrix4, Vector3, Quaternion, Euler } from "three";
import type { PlankInstance } from "./herringbone";

export interface DeckParams {
  roomLength: number;
  roomWidth: number;
  plankLength: number;
  plankWidth: number;
  gap: number;
  /** Сдвиг следующего ряда относительно предыдущего (в долях длины плашки). */
  rowOffset?: number;
}

/**
 * Палубная раскладка ламината: ряды вдоль X, плашки укладываются по длине
 * комнаты с зазором, каждый следующий ряд смещён на rowOffset * plankLength
 * для классического «вразбежку».
 */
export function buildDeck({
  roomLength,
  roomWidth,
  plankLength: L,
  plankWidth: W,
  gap,
  rowOffset = 1 / 3,
}: DeckParams): PlankInstance[] {
  const planks: PlankInstance[] = [];

  const rowStep = W + gap;
  const colStep = L + gap;

  const rows = Math.ceil(roomWidth / rowStep) + 2;
  const cols = Math.ceil(roomLength / colStep) + 2;

  const quat = new Quaternion().setFromEuler(new Euler(0, 0, 0));
  const scale = new Vector3(1, 1, 1);

  // Центрируем сетку вокруг (0, 0).
  const z0 = -((rows - 1) * rowStep) / 2;
  const x0 = -((cols - 1) * colStep) / 2;

  for (let r = 0; r < rows; r++) {
    const z = z0 + r * rowStep;
    const rowShift = (r * rowOffset * L) % colStep;
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * colStep + rowShift - colStep;
      const m = new Matrix4().compose(new Vector3(x, 0, z), quat, scale);
      planks.push({ matrix: m, uvOffset: ((r * 13 + c * 7) % 100) / 100 });
    }
  }

  return planks;
}
