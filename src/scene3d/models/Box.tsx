/**
 * Параллелепипед по границам [x0, x1] × [y0, y1] × [z0, z1] — общий
 * единичный BoxGeometry + масштаб: сотни деталей моделей без новых буферов.
 */
import { createContext, useContext } from "react";
import { BoxGeometry, MeshBasicMaterial, type Material } from "three";

/** Общий единичный куб (не удаляется: живёт всё время работы модуля). */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/**
 * Отбрасывают ли детали тень. Стены теней не отбрасывают (иначе комнату
 * залило бы тенью), поэтому и встроенные в них двери/окна — тоже: иначе на
 * полу появляется «висящая» тень рамы. Тени — от мебели и плинтуса.
 */
export const CastShadow = createContext(true);

export type Bounds = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];

export function Box({ b, m, cast = true }: { b: Bounds; m: Material; cast?: boolean }) {
  const allow = useContext(CastShadow);
  const [x0, x1, y0, y1, z0, z1] = b;
  const sx = Math.max(1e-4, Math.abs(x1 - x0));
  const sy = Math.max(1e-4, Math.abs(y1 - y0));
  const sz = Math.max(1e-4, Math.abs(z1 - z0));
  return (
    <mesh
      geometry={UNIT_BOX}
      material={m}
      position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]}
      scale={[sx, sy, sz]}
      castShadow={cast && allow}
      receiveShadow
    />
  );
}

/** Материал невидимых объёмов наведения (не рисуется). */
export const HIT_MATERIAL = new MeshBasicMaterial();

/**
 * Невидимый объём для наведения и клика (проём без двери — «пустота»,
 * в которую иначе не попасть). Невидимые меши в three всё равно ловят луч.
 */
export function HitBox({ b }: { b: Bounds }) {
  const [x0, x1, y0, y1, z0, z1] = b;
  return (
    <mesh
      geometry={UNIT_BOX}
      material={HIT_MATERIAL}
      visible={false}
      position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]}
      scale={[Math.max(1e-4, x1 - x0), Math.max(1e-4, y1 - y0), Math.max(1e-4, z1 - z0)]}
    />
  );
}
