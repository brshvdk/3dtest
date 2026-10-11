/**
 * Подписи стен (A · 4,50 м) — HTML-чипы над стенами. Над скрытой стеной
 * чип опускается к полу, у дальних (за комнатой) — приглушается.
 */
import { memo, useCallback, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";
import { formatLength } from "../../domain/units";
import { pointInPolygon } from "../../domain/geometry";
import type { Vec2, Wall } from "../../domain/types";
import { useAppStore } from "../../state/store";
import { useScene } from "../context";

function sameLabel(
  p: { wall: Wall; top: number; selected: boolean; points: Vec2[]; ceiling: number },
  n: { wall: Wall; top: number; selected: boolean; points: Vec2[]; ceiling: number },
): boolean {
  const a = p.wall;
  const b = n.wall;
  return (
    p.top === n.top &&
    p.selected === n.selected &&
    p.points === n.points &&
    p.ceiling === n.ceiling &&
    a.id === b.id &&
    a.label === b.label &&
    a.length === b.length &&
    a.thickness === b.thickness &&
    a.a.x === b.a.x &&
    a.a.y === b.a.y &&
    a.b.x === b.b.x &&
    a.b.y === b.b.y
  );
}

const Label = memo(function Label({
  wall,
  top,
  selected,
  points,
  ceiling,
}: {
  wall: Wall;
  top: number;
  selected: boolean;
  points: Vec2[];
  ceiling: number;
}) {
  const { registry } = useScene();
  const group = useRef<Group>(null);
  const chip = useRef<HTMLDivElement | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  // Html рендерит содержимое в отдельный корень — элемент появляется позже кадра.
  const setChip = useCallback(
    (el: HTMLDivElement | null) => {
      chip.current = el;
      if (el) invalidate();
    },
    [invalidate],
  );
  const mx = (wall.a.x + wall.b.x) / 2 + wall.normalOut.x * (wall.thickness / 2);
  const mz = (wall.a.y + wall.b.y) / 2 + wall.normalOut.y * (wall.thickness / 2);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const hidden = registry.hidden.has(wall.id);
    const y = hidden ? 0.16 : top + 0.16;
    // Html обновляет позицию в своём useFrame (он раньше нашего) — нужен ещё кадр.
    if (g.position.y !== y) {
      g.position.y = y;
      invalidate();
    }
    const facing = (camera.position.x - mx) * wall.normalOut.x + (camera.position.z - mz) * wall.normalOut.y;
    // Дальняя стена: камера с внутренней стороны и смотрит не сверху.
    const far = facing < -0.2 && !hidden && camera.position.y - y < -facing * 0.75;
    // Камера внутри комнаты (вид «От входа») — подписи над потолком не нужны.
    const p = camera.position;
    const inside = p.y < ceiling && pointInPolygon({ x: p.x, y: p.z }, points);
    const el = chip.current;
    if (el) {
      if (el.classList.contains("is-far") !== far) el.classList.toggle("is-far", far);
      if (el.classList.contains("is-off") !== inside) el.classList.toggle("is-off", inside);
    }
  });

  return (
    <group ref={group} position={[mx, top + 0.16, mz]}>
      <Html
        ref={setChip}
        center
        zIndexRange={[4, 0]}
        pointerEvents="none"
        className={`s3d-wall-label${selected ? " is-selected" : ""}`}
      >
        <b>{wall.label}</b>
        <span className="s3d-wall-label__dot" aria-hidden>
          ·
        </span>
        <span>{formatLength(wall.length)}</span>
      </Html>
    </group>
  );
}, sameLabel);

export function WallLabels({
  walls,
  roomId,
  top,
  points,
  ceiling,
}: {
  walls: Wall[];
  roomId: string;
  top: number;
  points: Vec2[];
  ceiling: number;
}) {
  const selectedWall = useAppStore((s) =>
    s.selection?.type === "wall" && s.selection.roomId === roomId ? s.selection.wallId : null,
  );
  return (
    <group>
      {walls.map((w) => (
        <Label key={w.id} wall={w} top={top} selected={selectedWall === w.id} points={points} ceiling={ceiling} />
      ))}
    </group>
  );
}
