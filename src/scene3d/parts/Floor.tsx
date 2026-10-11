/**
 * Пол с процедурной раскладкой, «срез» перекрытия под стенами и мягкая
 * тень под моделью — комната выглядит как аккуратный макет.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Mesh,
} from "three";
import { bbox, distance, outerPolygon, pointInPolygon, signedArea } from "../../domain/geometry";
import type { FloorPattern, Room } from "../../domain/types";
import { useAppStore } from "../../state/store";
import { MeshBuilder } from "../build/builder";
import { buildFloorAO, buildFloorGeometry, getFloorTile, getSoftShadowCanvas } from "../build/floor";
import { useScene } from "../context";
import { useSettled } from "../settle";

/** Толщина «перекрытия» под комнатой, м. */
export const SLAB = 0.08;

const ROUGHNESS: Record<FloorPattern, number> = { deck: 0.5, herringbone: 0.48, tile: 0.26, plain: 0.7 };

/** Направление раскладки — вдоль самой длинной стены. */
function layoutAngle(room: Room): number {
  let best = 0;
  let angle = 0;
  const pts = room.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const l = distance(a, b);
    if (l > best + 1e-6) {
      best = l;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  // Приводим к [−45°, 45°): одинаковая раскладка для противоположных стен.
  const q = Math.PI / 2;
  return angle - Math.round(angle / q) * q;
}

export function Floor({ room }: { room: Room }) {
  const pattern = useAppStore((s) => s.project.appearance.floorPattern);
  const tint = useAppStore((s) => s.project.appearance.floorTint);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const tile = useMemo(() => getFloorTile(pattern), [pattern]);

  const texture = useMemo(() => {
    const t = new CanvasTexture(tile.canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return t;
  }, [tile, gl]);
  useEffect(() => () => texture.dispose(), [texture]);

  // Карта затенения — самый тяжёлый пересчёт сцены (≈10 мс): пока тянут стену,
  // остаётся прежняя (растягивается по габариту пола), новая — после жеста.
  const aoPoints = useSettled(room.points);
  const ao = useMemo(() => {
    const t = new CanvasTexture(buildFloorAO(aoPoints));
    t.channel = 1;
    return t;
  }, [aoPoints]);
  useEffect(() => () => ao.dispose(), [ao]);

  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ map: texture, roughness: ROUGHNESS[pattern], metalness: 0, aoMapIntensity: 1 });
    // aoMap в three гасит только рассеянный свет; у стен пол должен темнеть и от прямого.
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <aomap_fragment>",
        "#include <aomap_fragment>\n#ifdef USE_AOMAP\n  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.65);\n#endif",
      );
    };
    return m;
  }, [texture, pattern]);
  useEffect(() => {
    material.aoMap = ao;
    material.needsUpdate = true;
    invalidate();
  }, [material, ao, invalidate]);
  useEffect(() => {
    material.color.set(tint);
    invalidate();
  }, [material, tint, invalidate]);
  useEffect(() => () => material.dispose(), [material]);

  const angle = layoutAngle(room);
  const geometry = useMemo(
    () => buildFloorGeometry(room.points, angle, tile.width, tile.height),
    [room.points, angle, tile],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return <mesh geometry={geometry} material={material} receiveShadow />;
}

/** Боковины перекрытия по внешнему контуру + мягкая тень на «земле». */
export function Base({ room }: { room: Room }) {
  const { theme } = useScene();
  const outer = useMemo(() => outerPolygon(room), [room]);

  const slab = useMemo(() => {
    const mb = new MeshBuilder(1);
    const n = outer.length;
    // Контур в канонической ориентации: наружу смотрит (dy, −dx) — и в «выемках» Г/П-комнат тоже.
    const sign = signedArea(outer) >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = outer[i];
      const b = outer[(i + 1) % n];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (sign * (b.y - a.y)) / l;
      const ny = (-sign * (b.x - a.x)) / l;
      mb.quad(0, [a.x, -SLAB, a.y], [b.x, -SLAB, b.y], [b.x, 0, b.y], [a.x, 0, a.y], [nx, 0, ny]);
    }
    return mb.build();
  }, [outer]);
  useEffect(() => () => slab.dispose(), [slab]);

  const slabMat = useMemo(
    () => new MeshStandardMaterial({ color: new Color(theme.outer).multiplyScalar(0.84), roughness: 0.95 }),
    [theme.outer],
  );
  useEffect(() => () => slabMat.dispose(), [slabMat]);

  const shadowTex = useMemo(() => new CanvasTexture(getSoftShadowCanvas()), []);
  useEffect(() => () => shadowTex.dispose(), [shadowTex]);
  const shadowMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: shadowTex,
        color: 0x000000,
        transparent: true,
        opacity: theme.shadow,
        depthWrite: false,
      }),
    [shadowTex, theme.shadow],
  );
  useEffect(() => () => shadowMat.dispose(), [shadowMat]);

  const b = bbox(outer);
  const size = Math.max(b.width, b.height);

  return (
    <group>
      <mesh geometry={slab} material={slabMat} />
      <mesh
        material={shadowMat}
        position={[b.minX + b.width / 2, -SLAB - 0.002, b.minY + b.height / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[b.width + size * 0.9, b.height + size * 0.9, 1]}
        renderOrder={-1}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

/**
 * Потолок — только когда камера внутри комнаты (вид «От входа»): снаружи
 * кукольный домик открыт сверху. Рисуется одной стороной — снизу.
 */
export function Ceiling({ room }: { room: Room }) {
  const ref = useRef<Mesh>(null);
  const geometry = useMemo(() => buildFloorGeometry(room.points, 0, 1, 1), [room.points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#f6f5f2",
        roughness: 0.95,
        side: BackSide,
        emissive: new Color("#f6f5f2"),
        emissiveIntensity: 0.18,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const pointsRef = useRef(room.points);
  pointsRef.current = room.points;
  const H = room.height;

  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    const p = camera.position;
    const inside = p.y < H - 0.05 && pointInPolygon({ x: p.x, y: p.z }, pointsRef.current);
    if (m.visible !== inside) m.visible = inside;
  });

  return <mesh ref={ref} geometry={geometry} material={material} position={[0, H, 0]} visible={false} />;
}
