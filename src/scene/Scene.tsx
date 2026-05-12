import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import { Lights } from "./Lights";
import { Room } from "./Room";
import { Floor } from "./Floor";
import { Skirting } from "./Skirting";
import { useRoomStore } from "../state/useRoomStore";

export function Scene() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);
  const height = useRoomStore((s) => s.height);

  const camDist = Math.max(length, width) * 0.9;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        localClippingEnabled: true,
      }}
    >
      <color attach="background" args={["#1a1a1d"]} />

      <PerspectiveCamera
        makeDefault
        position={[camDist, height * 1.4, camDist]}
        fov={45}
        near={0.05}
        far={100}
      />
      <OrbitControls
        target={[0, height * 0.4, 0]}
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={25}
        maxPolarAngle={Math.PI / 2 - 0.02}
      />

      <Lights />

      <Room />
      <Floor />
      <Skirting />
    </Canvas>
  );
}
