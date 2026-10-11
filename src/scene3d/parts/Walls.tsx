/**
 * Стены комнаты + «кукольный домик»: в режиме «авто» стены между камерой
 * и комнатой заменяются низким срезом, чтобы всегда был виден пол и плинтус.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Color, MeshStandardMaterial, type Mesh, type Material } from "three";
import { getCorners } from "../../domain/geometry";
import { formatLength } from "../../domain/units";
import type { Opening, Room, Wall } from "../../domain/types";
import { useAppStore } from "../../state/store";
import {
  LOW_WALL_HEIGHT,
  STUB_HEIGHT,
  buildWallEndCap,
  buildWallGeometry,
  wallHoles,
  wallSignature,
} from "../build/walls";
import { setCanvasCursor, setShown, useScene, type WallEntry } from "../context";
import { clearHoverInfo, setHoverInfo, type WallMode } from "../sceneState";

/** Клик после поворота камеры (смещение > px) — не выбор. */
export const CLICK_TOLERANCE = 5;

interface WallMaterials {
  inner: MeshStandardMaterial;
  innerSelected: MeshStandardMaterial;
  outer: MeshStandardMaterial;
  reveal: MeshStandardMaterial;
  cap: MeshStandardMaterial;
  threshold: MeshStandardMaterial;
}

function useWallMaterials(wallColor: string, primary: string, section: string, outer: string): WallMaterials {
  const mats = useMemo<WallMaterials>(() => {
    const base = new Color(wallColor);
    const sel = base.clone().lerp(new Color(primary), 0.16);
    return {
      inner: new MeshStandardMaterial({ color: base, roughness: 0.94, vertexColors: true }),
      innerSelected: new MeshStandardMaterial({
        color: sel,
        roughness: 0.9,
        vertexColors: true,
        emissive: new Color(primary),
        emissiveIntensity: 0.06,
      }),
      outer: new MeshStandardMaterial({ color: outer, roughness: 0.96 }),
      reveal: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.97), roughness: 0.94 }),
      cap: new MeshStandardMaterial({ color: section, roughness: 0.85 }),
      threshold: new MeshStandardMaterial({ color: "#a9a196", roughness: 0.6 }),
    };
  }, [wallColor, primary, section, outer]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}

interface WallItemProps {
  wall: Wall;
  startInner: boolean;
  endInner: boolean;
  /** Высота потолка (стены в полную высоту) — для затенения у потолка. */
  ceiling: number | null;
  roomId: string;
  openings: Opening[];
  top: number;
  auto: boolean;
  selected: boolean;
  mats: WallMaterials;
}

const WallItem = memo(function WallItem({
  wall,
  startInner,
  endInner,
  ceiling,
  roomId,
  openings,
  top,
  auto,
  selected,
  mats,
}: WallItemProps) {
  const { registry } = useScene();
  const invalidate = useThree((s) => s.invalidate);
  const shade = { startInner, endInner, ceiling };
  const stubShade = { startInner, endInner, ceiling: null };
  const holes = wallHoles(wall, openings, top);
  const sig = wallSignature(wall, holes, top, shade);
  const stubHoles = auto ? wallHoles(wall, openings, STUB_HEIGHT) : null;
  const stubSig = stubHoles ? wallSignature(wall, stubHoles, STUB_HEIGHT, stubShade) : "";

  // Геометрия пересобирается только при изменении формы стены/её проёмов.
  const full = useMemo(() => buildWallGeometry(wall, holes, top, shade), [sig]);
  const stub = useMemo(
    () => (stubHoles ? buildWallGeometry(wall, stubHoles, STUB_HEIGHT, stubShade) : null),
    [stubSig],
  );
  const caps = useMemo(
    () =>
      auto
        ? { start: buildWallEndCap(wall, "start", STUB_HEIGHT, top), end: buildWallEndCap(wall, "end", STUB_HEIGHT, top) }
        : null,
    [auto, sig],
  );
  useEffect(() => () => full.dispose(), [full]);
  useEffect(() => () => stub?.dispose(), [stub]);
  useEffect(
    () => () => {
      caps?.start.dispose();
      caps?.end.dispose();
    },
    [caps],
  );

  const material = useMemo<Material[]>(
    () => [selected ? mats.innerSelected : mats.inner, mats.outer, mats.reveal, mats.cap, mats.threshold],
    [selected, mats],
  );

  const fullRef = useRef<Mesh>(null);
  const stubRef = useRef<Mesh>(null);
  const capStartRef = useRef<Mesh>(null);
  const capEndRef = useRef<Mesh>(null);

  // Регистрация для кукольного домика; начальная видимость — как у соседей сейчас.
  useLayoutEffect(() => {
    const entry: WallEntry = {
      index: wall.index,
      full: fullRef.current,
      stub: stubRef.current,
      capStart: capStartRef.current,
      capEnd: capEndRef.current,
    };
    const hidden = registry.hidden.has(wall.id);
    setShown(entry.full, !hidden);
    setShown(entry.stub, hidden);
    setShown(entry.capStart, false);
    setShown(entry.capEnd, false);
    registry.setWall(wall.id, entry);
    invalidate();
    return () => registry.removeWall(wall.id, entry);
  }, [registry, wall.id, wall.index, auto, invalidate]);

  const handlers = useMemo(() => {
    const key = `wall:${wall.id}`;
    return {
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > CLICK_TOLERANCE) return;
        useAppStore.getState().select({ type: "wall", roomId, wallId: wall.id });
      },
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setCanvasCursor(e, "pointer");
        setHoverInfo({ key, title: `Стена ${wall.label}`, sub: formatLength(wall.length) });
      },
      onPointerOut: (e: ThreeEvent<PointerEvent>) => {
        setCanvasCursor(e, "");
        clearHoverInfo(key);
      },
    };
  }, [wall.id, wall.label, wall.length, roomId]);

  return (
    <group>
      <mesh ref={fullRef} geometry={full} material={material} receiveShadow {...handlers} />
      {stub ? <mesh ref={stubRef} geometry={stub} material={material} receiveShadow {...handlers} /> : null}
      {caps ? (
        <>
          <mesh ref={capStartRef} geometry={caps.start} material={mats.cap} />
          <mesh ref={capEndRef} geometry={caps.end} material={mats.cap} />
        </>
      ) : null}
    </group>
  );
});

export function Walls({ room, walls, mode }: { room: Room; walls: Wall[]; mode: WallMode }) {
  const { theme, registry } = useScene();
  const wallColor = useAppStore((s) => s.project.appearance.wallColor);
  const selectedWall = useAppStore((s) =>
    s.selection?.type === "wall" && s.selection.roomId === room.id ? s.selection.wallId : null,
  );
  const mats = useWallMaterials(wallColor, theme.primary, theme.section, theme.outer);
  const auto = mode === "auto";
  const top = mode === "low" ? Math.min(LOW_WALL_HEIGHT, room.height) : room.height;

  const corners = useMemo(() => getCorners(room), [room]);
  const ceiling = mode === "low" ? null : room.height;

  const wallsRef = useRef(walls);
  wallsRef.current = walls;

  // Режим сменился — всё показать заново.
  useLayoutEffect(() => {
    if (!auto) registry.hidden = new Set();
    registry.dirty = true;
  }, [auto, registry]);

  useFrame(({ camera }) => {
    const list = wallsRef.current;
    const hidden = new Set<string>();
    if (auto) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      for (const w of list) {
        const s = (cx - w.a.x) * w.normalOut.x + (cz - w.a.y) * w.normalOut.y;
        const was = registry.hidden.has(w.id);
        if (s > w.thickness + (was ? 0.02 : 0.15)) hidden.add(w.id);
      }
      // Все стены скрыты быть не могут (камера «везде снаружи» — вырожденный случай).
      if (hidden.size === list.length) hidden.clear();
    }
    let same = !registry.dirty && hidden.size === registry.hidden.size;
    if (same) for (const id of hidden) if (!registry.hidden.has(id)) same = false;
    if (same) return;
    registry.hidden = hidden;
    registry.dirty = false;
    const n = list.length;
    for (const [id, e] of registry.walls) {
      const h = hidden.has(id);
      setShown(e.full, !h);
      setShown(e.stub, h);
      const prev = list[(e.index - 1 + n) % n];
      const next = list[(e.index + 1) % n];
      setShown(e.capStart, !h && !!prev && hidden.has(prev.id));
      setShown(e.capEnd, !h && !!next && hidden.has(next.id));
    }
    for (const [, o] of registry.openings) setShown(o.obj, !hidden.has(o.wallId));
  });

  return (
    <group>
      {walls.map((w) => (
        <WallItem
          key={w.id}
          wall={w}
          startInner={corners[w.index]?.kind === "inner"}
          endInner={corners[(w.index + 1) % corners.length]?.kind === "inner"}
          ceiling={ceiling}
          roomId={room.id}
          openings={room.openings}
          top={top}
          auto={auto}
          selected={selectedWall === w.id}
          mats={mats}
        />
      ))}
    </group>
  );
}
