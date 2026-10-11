/**
 * Свет: полусфера + направленный «солнечный» с мягкими тенями + слабый
 * заполняющий; окружение — процедурная «студия» (RoomEnvironment), без
 * загрузки внешних HDR: даёт блики на глянце, металле и стекле.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Object3D, PMREMGenerator, type DirectionalLight, type Mesh } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { bbox } from "../../domain/geometry";
import type { Room } from "../../domain/types";

export function Environment({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    room.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
    scene.environment = rt.texture;
    invalidate();
    return () => {
      scene.environment = null;
      rt.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
    invalidate();
  }, [scene, intensity, invalidate]);
  return null;
}

export function Lights({ room }: { room: Room }) {
  const b = useMemo(() => bbox(room.points), [room.points]);
  const cx = b.minX + b.width / 2;
  const cz = b.minY + b.height / 2;
  const r = Math.max(1.5, Math.hypot(b.width, b.height) / 2 + room.wallThickness);
  const H = room.height;

  const target = useMemo(() => new Object3D(), []);
  const key = useRef<DirectionalLight>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    target.position.set(cx, 0, cz);
    target.updateMatrixWorld();
    const l = key.current;
    if (l) {
      const cam = l.shadow.camera;
      const ext = r * 1.25 + H * 0.6;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 0.5;
      cam.far = r * 6 + H * 6;
      cam.updateProjectionMatrix();
      l.shadow.needsUpdate = true;
    }
    invalidate();
  }, [cx, cz, r, H, target, invalidate]);

  return (
    <>
      <hemisphereLight args={["#fffaf3", "#bfb3a3", 0.9]} />
      <directionalLight
        ref={key}
        position={[cx + r * 0.7, H + r * 3.4, cz + r * 1.1]}
        intensity={1.9}
        color="#fff3e3"
        target={target}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00025}
        shadow-normalBias={0.015}
        shadow-radius={4}
      />
      <directionalLight position={[cx - r * 1.2, H + r, cz - r]} intensity={0.35} color="#e7eeff" />
      <primitive object={target} />
    </>
  );
}
