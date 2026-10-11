/**
 * Модели проёмов на стенах: дверь, окно, проём, балкон, мебель.
 * Клик — выделение проёма; выделенный и наведённый слегка подсвечены.
 */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Group } from "three";
import { describeOpening } from "../../domain/openings";
import type { Opening, Room, Wall } from "../../domain/types";
import { useAppStore } from "../../state/store";
import { LOW_WALL_HEIGHT } from "../build/walls";
import { setCanvasCursor, useScene } from "../context";
import { useHighlight, usePalette } from "../materials";
import { CastShadow } from "../models/Box";
import { DoorModel, PassageModel } from "../models/Door";
import { FurnitureModel } from "../models/Furniture";
import { BalconyModel, WindowModel } from "../models/Window";
import { clearHoverInfo, setHoverInfo, type WallMode } from "../sceneState";
import { SelectionOutline } from "./SelectionOutline";
import { CLICK_TOLERANCE } from "./Walls";

interface ItemProps {
  o: Opening;
  wall: Wall;
  roomId: string;
  cut: number;
}

function sameWall(a: Wall, b: Wall): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.a.x === b.a.x &&
    a.a.y === b.a.y &&
    a.b.x === b.b.x &&
    a.b.y === b.b.y &&
    a.thickness === b.thickness
  );
}

const OpeningItem = memo(
  function OpeningItem({ o, wall, roomId, cut }: ItemProps) {
    const { theme, clip, registry } = useScene();
    const selected = useAppStore((s) => s.selection?.type === "opening" && s.selection.openingId === o.id);
    const [hovered, setHovered] = useState(false);
    const furniture = o.kind === "furniture";
    const palette = usePalette(furniture ? null : clip);
    useHighlight(palette, hovered ? 1 : selected ? 2 : 0);

    const ref = useRef<Group>(null);
    useLayoutEffect(() => {
      const obj = ref.current;
      if (!obj || furniture) return;
      registry.addOpening(o.id, wall.id, obj);
      return () => registry.removeOpening(o.id, obj);
    }, [registry, o.id, wall.id, furniture]);

    const handlers = useMemo(() => {
      const key = `op:${o.id}`;
      const wallText = `стена ${wall.label}`;
      return {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > CLICK_TOLERANCE) return;
          useAppStore.getState().select({ type: "opening", roomId, openingId: o.id });
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setCanvasCursor(e, "pointer");
          setHovered(true);
          setHoverInfo({ key, title: describeOpening(o), sub: wallText });
        },
        onPointerOut: (e: ThreeEvent<PointerEvent>) => {
          setCanvasCursor(e, "");
          setHovered(false);
          clearHoverInfo(key);
        },
      };
    }, [o, wall.label, roomId]);

    const th = wall.thickness;
    let model: JSX.Element | null = null;
    switch (o.kind) {
      case "door":
        model = <DoorModel o={o} th={th} p={palette} />;
        break;
      case "passage":
        model = <PassageModel o={o} th={th} p={palette} />;
        break;
      case "window":
        model = <WindowModel o={o} th={th} p={palette} cut={cut} />;
        break;
      case "balcony":
        model = <BalconyModel o={o} th={th} p={palette} cut={cut} />;
        break;
      case "furniture":
        model = <FurnitureModel o={o} p={palette} maxH={cut} />;
        break;
    }

    // Локальная система: x вдоль стены, y вверх, z — внутренняя нормаль.
    const px = wall.a.x + wall.dir.x * o.offset;
    const pz = wall.a.y + wall.dir.y * o.offset;
    const rot = Math.atan2(-wall.dir.y, wall.dir.x);
    return (
      <>
        <group ref={ref} position={[px, 0, pz]} rotation={[0, rot, 0]} {...handlers}>
          <CastShadow.Provider value={furniture}>{model}</CastShadow.Provider>
        </group>
        {/* Контур — отдельно от модели: виден, даже если стена скрыта кукольным домиком. */}
        {selected ? (
          <group position={[px, 0, pz]} rotation={[0, rot, 0]}>
            <SelectionOutline o={o} th={wall.thickness} color={theme.primary} cut={cut} />
          </group>
        ) : null}
      </>
    );
  },
  (p, n) => p.o === n.o && p.roomId === n.roomId && p.cut === n.cut && sameWall(p.wall, n.wall),
);

export function Openings({ room, walls, mode }: { room: Room; walls: Wall[]; mode: WallMode }) {
  const byId = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);
  const cut = mode === "low" ? Math.min(LOW_WALL_HEIGHT, room.height) : room.height + 1;
  return (
    <group>
      {room.openings.map((o) => {
        const w = byId.get(o.wallId);
        return w ? <OpeningItem key={o.id} o={o} wall={w} roomId={room.id} cut={cut} /> : null;
      })}
    </group>
  );
}
