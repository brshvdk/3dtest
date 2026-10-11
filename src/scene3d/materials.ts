/**
 * Материалы сцены. Палитра моделей проёмов создаётся на каждый проём
 * (чтобы подсвечивать выделенный), остальное — по одному на сцену.
 */
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Color, DoubleSide, MeshStandardMaterial, type Plane } from "three";
import type { SkirtingMaterial } from "../domain/types";

export interface Palette {
  /** Дерево двери/коробки/наличников. */
  wood: MeshStandardMaterial;
  /** Белый ПВХ окон. */
  pvc: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  /** Подоконник. */
  sill: MeshStandardMaterial;
  /** Мебель: корпус, фасады, столешница, тёмные детали, глянец (ванна), зеркало. */
  body: MeshStandardMaterial;
  front: MeshStandardMaterial;
  top: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  gloss: MeshStandardMaterial;
  mirror: MeshStandardMaterial;
}

function std(color: string, roughness: number, metalness = 0, extra: Partial<MeshStandardMaterial> = {}) {
  const m = new MeshStandardMaterial({ color, roughness, metalness });
  Object.assign(m, extra);
  return m;
}

export function createPalette(clip: Plane | null): Palette {
  const p: Palette = {
    wood: std("#c29c72", 0.58),
    pvc: std("#f6f6f3", 0.34),
    glass: std("#d6e8f0", 0.04, 0, {
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: DoubleSide,
      envMapIntensity: 1.6,
    } as Partial<MeshStandardMaterial>),
    metal: std("#c3c6cb", 0.3, 0.9),
    sill: std("#f8f7f4", 0.28),
    body: std("#ebe7df", 0.62),
    front: std("#f4f2ed", 0.42),
    top: std("#5a524b", 0.38),
    dark: std("#1d1e21", 0.25),
    gloss: std("#fbfbfa", 0.12),
    mirror: std("#cdd6dc", 0.06, 0.7),
  };
  if (clip) {
    for (const m of Object.values(p) as MeshStandardMaterial[]) {
      m.clippingPlanes = [clip];
      m.clipShadows = true;
    }
  }
  return p;
}

export function disposePalette(p: Palette): void {
  for (const m of Object.values(p) as MeshStandardMaterial[]) m.dispose();
}

/**
 * Подсветка наведённого/выделенного проёма: лёгкое осветление без сдвига
 * оттенка (цветной контур выделения рисует SelectionOutline).
 */
export function useHighlight(p: Palette, level: 0 | 1 | 2): void {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const c = new Color("#ffffff");
    const k = level === 2 ? 0.07 : level === 1 ? 0.1 : 0;
    for (const m of Object.values(p) as MeshStandardMaterial[]) {
      m.emissive.copy(c);
      m.emissiveIntensity = k;
    }
    invalidate();
  }, [p, level, invalidate]);
}

/** Палитра проёма с очисткой. */
export function usePalette(clip: Plane | null): Palette {
  const p = useMemo(() => createPalette(clip), [clip]);
  useEffect(() => () => disposePalette(p), [p]);
  return p;
}

/** Параметры поверхности плинтуса по материалу. */
export function skirtingSurface(material: SkirtingMaterial): { roughness: number; metalness: number } {
  switch (material) {
    case "pvc":
      return { roughness: 0.36, metalness: 0 };
    case "mdf":
      return { roughness: 0.6, metalness: 0 };
    case "wood":
      return { roughness: 0.55, metalness: 0 };
    case "polyurethane":
      return { roughness: 0.72, metalness: 0 };
    case "aluminum":
    case "shadow":
      return { roughness: 0.3, metalness: 0.88 };
    case "ceramic":
      return { roughness: 0.2, metalness: 0 };
  }
}
