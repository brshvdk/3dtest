import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  Plane,
  Vector3,
} from "three";
import { useRoomStore } from "../state/useRoomStore";
import { getWoodTextures } from "../lib/textures";
import { buildHerringbone } from "../lib/herringbone";
import { buildDeck } from "../lib/deck";

/**
 * Пол с инстансингом. Геометрия плашки одна (BoxGeometry), материал один —
 * сотни/тысячи инстансов рисуются в один draw call. Финальная обрезка по
 * периметру комнаты — через clippingPlanes материала (требует
 * gl.localClippingEnabled = true; включаем в Scene).
 */
export function Floor() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);
  const pattern = useRoomStore((s) => s.pattern);
  const plankLength = useRoomStore((s) => s.plankLength);
  const plankWidth = useRoomStore((s) => s.plankWidth);
  const gap = useRoomStore((s) => s.gap);
  const woodTint = useRoomStore((s) => s.woodTint);

  const planks = useMemo(() => {
    const params = {
      roomLength: length,
      roomWidth: width,
      plankLength,
      plankWidth,
      gap,
    };
    return pattern === "herringbone"
      ? buildHerringbone(params)
      : buildDeck(params);
  }, [length, width, pattern, plankLength, plankWidth, gap]);

  const PLANK_THICKNESS = 0.012;

  // Геометрия плашки (общая для всех инстансов).
  const geometry = useMemo(() => {
    const g = new BoxGeometry(plankLength, PLANK_THICKNESS, plankWidth);
    return g;
  }, [plankLength, plankWidth]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Материал плашек — текстуры и clipping.
  const material = useMemo(() => {
    const { albedo, roughness } = getWoodTextures();
    const mat = new MeshStandardMaterial({
      map: albedo,
      roughnessMap: roughness,
      color: 0xffffff, // оттенок через instanceColor
      roughness: 1,
      metalness: 0,
      clipShadows: true,
    });
    return mat;
  }, []);

  useEffect(() => () => material.dispose(), [material]);

  // Обновляем clipping planes при изменении размеров комнаты.
  useEffect(() => {
    material.clippingPlanes = [
      new Plane(new Vector3(1, 0, 0), length / 2),
      new Plane(new Vector3(-1, 0, 0), length / 2),
      new Plane(new Vector3(0, 0, 1), width / 2),
      new Plane(new Vector3(0, 0, -1), width / 2),
    ];
    material.needsUpdate = true;
  }, [length, width, material]);

  const meshRef = useRef<InstancedMesh>(null);
  const tintColor = useMemo(() => new Color(woodTint), [woodTint]);

  // Раскладка инстансов: матрица + индивидуальный цвет (jitter оттенка).
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    const tmpColor = new Color();
    for (let i = 0; i < planks.length; i++) {
      m.setMatrixAt(i, planks[i].matrix);
      const j = 0.92 + 0.16 * planks[i].uvOffset; // 0.92..1.08
      tmpColor.setRGB(
        Math.min(1, tintColor.r * j),
        Math.min(1, tintColor.g * (j * 0.98 + 0.02)),
        Math.min(1, tintColor.b * (j * 0.96 + 0.04)),
      );
      m.setColorAt(i, tmpColor);
    }
    m.count = planks.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [planks, tintColor]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(planks.length, 1)]}
      position={[0, PLANK_THICKNESS / 2, 0]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}
