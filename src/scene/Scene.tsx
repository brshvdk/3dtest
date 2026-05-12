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

  // Камера на старте — слегка приподнята над комнатой и сдвинута за её
  // дальний угол, смотрит на центр пола. Так с первого кадра видны
  // все 4 стены изнутри (через "BackSide"-просвет ближних стен) и пол.
  const diag = Math.hypot(length, width);
  const camX = diag * 0.55;
  const camY = height * 1.05;
  const camZ = diag * 0.55;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        localClippingEnabled: true,
      }}
    >
      <color attach="background" args={["#1a1a1d"]} />

      <PerspectiveCamera
        makeDefault
        position={[camX, camY, camZ]}
        fov={42}
        near={0.05}
        far={100}
      />
      <OrbitControls
        target={[0, 0.1, 0]}
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2 - 0.02}
      />

      <Lights />

      <Room />
      <Floor />
      <Skirting />
    </Canvas>
  );
}
