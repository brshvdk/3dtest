/**
 * Плинтус в 3D: участок = отдельный меш (подсветка/наведение по id участка,
 * синхронно с планом и раскроем через hoverSegmentId).
 */
import { memo, useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Color, MeshStandardMaterial } from "three";
import type { SkirtingSegment } from "../../domain/skirtingCalc";
import { formatLength } from "../../domain/units";
import { useRoomProduct, useRoomResult } from "../../state/hooks";
import { useAppStore } from "../../state/store";
import {
  buildSegmentGeometry,
  fallbackProfile,
  normalizeProfile,
  segmentNeighbors,
  segmentSignature,
  type SegmentNeighbors,
} from "../build/skirting";
import { setCanvasCursor, useScene } from "../context";
import { skirtingSurface } from "../materials";
import { HIT_MATERIAL, UNIT_BOX } from "../models/Box";
import { clearHoverInfo, setHoverInfo } from "../sceneState";
import { CLICK_TOLERANCE } from "./Walls";

interface SegMats {
  base: MeshStandardMaterial;
  hot: MeshStandardMaterial;
}

/** Глубина невидимой зоны наведения от стены, м. */
const HIT_DEPTH = 0.09;

const Segment = memo(function Segment({
  seg,
  nb,
  profile,
  profileKey,
  hitHeight,
  mats,
}: {
  seg: SkirtingSegment;
  nb: SegmentNeighbors;
  profile: Array<[number, number]>;
  profileKey: string;
  hitHeight: number;
  mats: SegMats;
}) {
  const hot = useAppStore((s) => s.hoverSegmentId === seg.id);
  const sig = segmentSignature(seg, nb, profileKey);
  const geometry = useMemo(() => buildSegmentGeometry(seg, nb, profile), [sig]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const handlers = useMemo(() => {
    const key = `seg:${seg.id}`;
    const title = seg.isReveal ? `Плинтус · ${seg.label}` : `Плинтус · участок ${seg.label}`;
    return {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setCanvasCursor(e, "pointer");
        useAppStore.getState().setHoverSegment(seg.id);
        setHoverInfo({ key, title, sub: formatLength(seg.length), tone: "skirting" });
      },
      onPointerOut: (e: ThreeEvent<PointerEvent>) => {
        setCanvasCursor(e, "");
        const st = useAppStore.getState();
        if (st.hoverSegmentId === seg.id) st.setHoverSegment(null);
        clearHoverInfo(key);
      },
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > CLICK_TOLERANCE) return;
        const st = useAppStore.getState();
        if (seg.isReveal && seg.openingId) {
          st.select({ type: "opening", roomId: seg.roomId, openingId: seg.openingId });
        } else {
          st.select({ type: "wall", roomId: seg.roomId, wallId: seg.wallId });
        }
        st.setHoverSegment(seg.id);
      },
    };
  }, [seg.id, seg.isReveal, seg.label, seg.length, seg.openingId, seg.roomId, seg.wallId]);

  // Невидимый «толстый» объём вокруг участка: тонкий плинтус легко навести и в общем виде.
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const nx = -dy / (seg.length || 1);
  const ny = dx / (seg.length || 1);
  const hitH = hitHeight + 0.04;
  return (
    <group {...handlers}>
      <mesh geometry={geometry} material={hot ? mats.hot : mats.base} castShadow receiveShadow />
      <mesh
        geometry={UNIT_BOX}
        material={HIT_MATERIAL}
        visible={false}
        position={[(seg.a.x + seg.b.x) / 2 + nx * HIT_DEPTH * 0.5, hitH / 2, (seg.a.y + seg.b.y) / 2 + ny * HIT_DEPTH * 0.5]}
        rotation={[0, Math.atan2(-dy, dx), 0]}
        scale={[Math.max(0.01, seg.length), hitH, HIT_DEPTH]}
      />
    </group>
  );
});

export function Skirting({ roomId }: { roomId: string }) {
  const { theme } = useScene();
  const result = useRoomResult(roomId);
  const product = useRoomProduct(roomId);

  const profile = useMemo(() => {
    const p = normalizeProfile(product.profile);
    return p.length >= 3 ? p : normalizeProfile(fallbackProfile(product.height * 1000, product.depth * 1000));
  }, [product.profile, product.height, product.depth]);
  const profileKey = useMemo(() => profile.map(([d, h]) => `${d.toFixed(4)},${h.toFixed(4)}`).join(";"), [profile]);

  const neighbors = useMemo(() => (result ? segmentNeighbors(result) : null), [result]);

  const mats = useMemo<SegMats>(() => {
    const surf = skirtingSurface(product.material);
    const base = new MeshStandardMaterial({ color: product.color, ...surf });
    const accent = new Color(theme.accent);
    // Подсветка участка должна читаться издалека: яркий акцент темы.
    const hot = new MeshStandardMaterial({
      color: accent,
      roughness: 0.5,
      metalness: 0,
      emissive: accent,
      emissiveIntensity: 0.65,
    });
    return { base, hot };
  }, [product.material, product.color, theme.accent]);
  useEffect(
    () => () => {
      mats.base.dispose();
      mats.hot.dispose();
    },
    [mats],
  );

  if (!result || !neighbors) return null;
  return (
    <group>
      {result.segments.map((seg) => (
        <Segment
          key={seg.id}
          seg={seg}
          nb={neighbors.get(seg.id) ?? { prev: null, next: null }}
          profile={profile}
          profileKey={profileKey}
          hitHeight={product.height}
          mats={mats}
        />
      ))}
    </group>
  );
}
