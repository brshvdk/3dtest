/**
 * Дверь и проём-портал. Локальная система проёма: x — вдоль стены от левого
 * края проёма (как видно изнутри), y — вверх от пола, z — в комнату
 * (стена занимает z ∈ [−толщина, 0]).
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { CASING_INSET, DOOR_FRAME } from "../../domain/openings";
import type { Opening } from "../../domain/types";
import { FREE_SIDES, clipExtent, type OpeningSides } from "../build/sides";
import { useScene } from "../context";
import type { Palette } from "../materials";
import { Box, HitBox } from "./Box";

/** Толщина наличника, м. */
export const CASING_T = 0.012;
/** Толщина полотна, м. */
const LEAF_T = 0.038;
/** Полотно приоткрыто, градусы. */
const OPEN_DEG = 25;

/**
 * Выступ наличников за края проёма слева и справа, м: у самого угла наличник
 * подрезан по соседней стене (не заходит в неё и не висит за наружным углом).
 */
export function casingSpan(o: Opening, sides: OpeningSides): { left: number; right: number } {
  const ext = Math.max(0, o.casing - CASING_INSET);
  const depth = CASING_T + 0.001;
  return { left: clipExtent(ext, sides.left, depth), right: clipExtent(ext, sides.right, depth) };
}

/** Наличники с комнатной стороны: слева, справа и сверху. */
export function Casings({ o, p, sides = FREE_SIDES }: { o: Opening; p: Palette; sides?: OpeningSides }) {
  const c = o.casing;
  if (c <= 0) return null;
  const W = o.width;
  const H = o.height;
  const { left, right } = casingSpan(o, sides);
  const yTop = H - CASING_INSET;
  return (
    <group>
      <Box b={[-left, CASING_INSET, 0, yTop, 0, CASING_T]} m={p.wood} />
      <Box b={[W - CASING_INSET, W + right, 0, yTop, 0, CASING_T]} m={p.wood} />
      <Box b={[-left, W + right, yTop, yTop + c, 0, CASING_T + 0.001]} m={p.wood} />
    </group>
  );
}

/** Ручка-нажимка с розеткой на одной стороне полотна. dir — куда смотрит рычаг (к петлям). */
function Handle({ x, y, z, side, dir, p }: { x: number; y: number; z: number; side: 1 | -1; dir: 1 | -1; p: Palette }) {
  const face = z;
  const out = face + side * 0.055;
  return (
    <group>
      <Box b={[x - 0.022, x + 0.022, y - 0.035, y + 0.035, face, face + side * 0.008]} m={p.metal} />
      <Box b={[x - 0.008, x + 0.008, y - 0.008, y + 0.008, face, out]} m={p.metal} />
      <Box b={[x - (dir < 0 ? 0.12 : 0.008), x + (dir > 0 ? 0.12 : 0.008), y - 0.009, y + 0.009, out - side * 0.018, out]} m={p.metal} />
    </group>
  );
}

/**
 * Полотно с петлями на hingeX; открывается в сторону openSign (+1 — в комнату).
 * Снаружи (кукольный домик) приоткрыто — видно, куда открывается; когда камера
 * в комнате (вид «От входа»), закрыто: приоткрытое полотно вблизи заслоняет кадр.
 */
function Leaf({
  hingeX,
  width,
  height,
  z,
  hinge,
  openSign,
  angleDeg,
  p,
}: {
  hingeX: number;
  width: number;
  height: number;
  z: number;
  hinge: "left" | "right";
  openSign: 1 | -1;
  angleDeg: number;
  p: Palette;
}) {
  const s = hinge === "left" ? 1 : -1; // полотно идёт от петель в сторону s
  const phi = (angleDeg * Math.PI) / 180;
  // Поворот вокруг Y: +x уходит к −z, поэтому знак = −s·openSign.
  const rot = -s * openSign * phi;
  // Полотно лежит по одну сторону от оси петель: внутрь стены (−openSign).
  const z0 = openSign > 0 ? -LEAF_T : 0;
  const z1 = openSign > 0 ? 0 : LEAF_T;
  const x0 = s > 0 ? 0.002 : -width + 0.002;
  const x1 = s > 0 ? width - 0.002 : -0.002;
  const hx = s > 0 ? width - 0.07 : -width + 0.07;
  const hy = Math.min(1.0, height * 0.48);
  const { registry } = useScene();
  const ref = useRef<Group>(null);
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const r = registry.isInside(camera.position) ? 0 : rot;
    if (g.rotation.y !== r) g.rotation.y = r;
  });
  return (
    <group ref={ref} position={[hingeX, 0, z]} rotation={[0, rot, 0]}>
      <Box b={[x0, x1, 0.008, height, z0, z1]} m={p.wood} />
      <Handle x={hx} y={hy} z={z1} side={1} dir={(-s) as 1 | -1} p={p} />
      <Handle x={hx} y={hy} z={z0} side={-1} dir={(-s) as 1 | -1} p={p} />
    </group>
  );
}

export function DoorModel({ o, th, p, sides }: { o: Opening; th: number; p: Palette; sides?: OpeningSides }) {
  const W = o.width;
  const H = o.height;
  const F = DOOR_FRAME;
  const leafH = Math.max(0.3, H - F - 0.004);
  const leafW = Math.max(0.2, W - 2 * F);
  const openIn = o.swing === "in";
  const openSign: 1 | -1 = openIn ? 1 : -1;
  // Ось петель у той грани стены, куда открывается дверь.
  const zHinge = openIn ? -0.006 : -th + 0.006;
  return (
    <group>
      {/* Коробка с добором на всю толщину стены */}
      <Box b={[0, F, 0, H, -th, 0.001]} m={p.wood} />
      <Box b={[W - F, W, 0, H, -th, 0.001]} m={p.wood} />
      <Box b={[0, W, H - F, H, -th, 0.001]} m={p.wood} />
      {o.leaves === 2 ? (
        <>
          <Leaf hingeX={F} width={leafW / 2} height={leafH} z={zHinge} hinge="left" openSign={openSign} angleDeg={OPEN_DEG - 4} p={p} />
          <Leaf hingeX={W - F} width={leafW / 2} height={leafH} z={zHinge} hinge="right" openSign={openSign} angleDeg={OPEN_DEG - 12} p={p} />
        </>
      ) : (
        <Leaf
          hingeX={o.hinge === "left" ? F : W - F}
          width={leafW}
          height={leafH}
          z={zHinge}
          hinge={o.hinge}
          openSign={openSign}
          angleDeg={OPEN_DEG}
          p={p}
        />
      )}
      <Casings o={o} p={p} sides={sides} />
    </group>
  );
}

/** Проём без двери: при наличниках — портал с добором по откосам. Арку не обрамляем. */
export function PassageModel({ o, th, p, sides }: { o: Opening; th: number; p: Palette; sides?: OpeningSides }) {
  const W = o.width;
  const H = o.height;
  const t = 0.012;
  // Пустой проём: невидимый объём, чтобы его можно было выбрать кликом.
  const hit = <HitBox b={[0, W, 0, o.arch ? H - Math.min(W / 2, H * 0.6) : H, -th, 0]} />;
  if (o.casing <= 0 || o.arch) return hit;
  return (
    <group>
      {hit}
      <Box b={[0, t, 0, H, -th, 0.001]} m={p.wood} />
      <Box b={[W - t, W, 0, H, -th, 0.001]} m={p.wood} />
      <Box b={[0, W, H - t, H, -th, 0.001]} m={p.wood} />
      <Casings o={o} p={p} sides={sides} />
    </group>
  );
}
