/**
 * Общее для частей сцены: тема, плоскость среза моделей (режим «Низкие»)
 * и реестр объектов для «кукольного домика» (скрытие ближних стен).
 * Контекст создаётся ВНУТРИ <Canvas> — у R3F свой корень React.
 */
import { createContext, useContext } from "react";
import { Mesh, Plane, Vector3, type Object3D } from "three";
import type { SceneTheme } from "./theme";

export interface WallEntry {
  index: number;
  full: Object3D | null;
  stub: Object3D | null;
  capStart: Object3D | null;
  capEnd: Object3D | null;
}

const noRaycast = () => {};

/** Показать/скрыть объект и выключить у скрытого попадание лучом (клики). */
export function setShown(obj: Object3D | null, on: boolean): void {
  if (!obj) return;
  obj.visible = on;
  obj.traverse((o) => {
    if ((o as Mesh).isMesh) {
      const m = o as Mesh;
      if (on) {
        if (m.raycast === noRaycast) m.raycast = Mesh.prototype.raycast;
      } else {
        m.raycast = noRaycast;
      }
    }
  });
}

export class SceneRegistry {
  walls = new Map<string, WallEntry>();
  openings = new Map<string, { wallId: string; obj: Object3D }>();
  /** Стены, скрытые сейчас (кукольный домик). */
  hidden = new Set<string>();
  /** Реестр изменился — пересчитать видимость в ближайшем кадре. */
  dirty = true;

  setWall(id: string, entry: WallEntry): void {
    this.walls.set(id, entry);
    this.dirty = true;
  }

  removeWall(id: string, entry: WallEntry): void {
    if (this.walls.get(id) === entry) this.walls.delete(id);
    this.dirty = true;
  }

  addOpening(id: string, wallId: string, obj: Object3D): void {
    this.openings.set(id, { wallId, obj });
    setShown(obj, !this.hidden.has(wallId));
  }

  removeOpening(id: string, obj: Object3D): void {
    if (this.openings.get(id)?.obj === obj) this.openings.delete(id);
  }
}

export interface SceneCtx {
  theme: SceneTheme;
  /** Срез моделей проёмов по высоте (режим «Низкие»); constant = высота среза. */
  clip: Plane;
  registry: SceneRegistry;
}

export const NO_CLIP = 1000;

export function createClipPlane(): Plane {
  return new Plane(new Vector3(0, -1, 0), NO_CLIP);
}

export const SceneContext = createContext<SceneCtx | null>(null);

export function useScene(): SceneCtx {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene: нет SceneContext");
  return ctx;
}

/** Курсор над интерактивным объектом сцены. */
export function setCanvasCursor(e: { nativeEvent: Event }, cursor: string): void {
  const el = e.nativeEvent.target as HTMLElement | null;
  if (el && el.style) el.style.cursor = cursor;
}
