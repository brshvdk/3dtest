import { useRoomStore } from "../state/useRoomStore";

export function Lights() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);
  const height = useRoomStore((s) => s.height);

  // Размер ортогональной shadow-камеры подбираем под комнату.
  const half = Math.max(length, width);

  return (
    <>
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#cbe2ff", "#3a2a1c", 0.25]} />
      <directionalLight
        position={[length * 0.6, height * 2, width * 0.7]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.5}
        shadow-camera-far={height * 3 + half}
        shadow-bias={-0.0005}
      />
      {/* Лёгкий заполняющий point внутри комнаты для подсветки теней. */}
      <pointLight position={[0, height * 0.85, 0]} intensity={0.35} distance={Math.max(length, width) * 2} />
    </>
  );
}
