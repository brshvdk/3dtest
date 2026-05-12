import { useRoomStore } from "../state/useRoomStore";

export function Lights() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);
  const height = useRoomStore((s) => s.height);

  const half = Math.max(length, width);

  return (
    <>
      {/* Окружающий свет — общий уровень. */}
      <ambientLight intensity={0.35} />

      {/* Полусферический — тёплый низ от пола, прохладный верх от потолка/неба. */}
      <hemisphereLight args={["#dbe7ff", "#3a2a1c", 0.4]} />

      {/* Главный направленный свет (имитация солнца в окно). */}
      <directionalLight
        position={[length * 0.7, height * 2.2, width * 0.9]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.5}
        shadow-camera-far={height * 4 + half}
        shadow-bias={-0.0005}
      />

      {/* Контровой свет с противоположной стороны — заполняет тени. */}
      <directionalLight
        position={[-length * 0.6, height * 1.3, -width * 0.5]}
        intensity={0.45}
        color="#fff5e0"
      />

      {/* Точечный внутри комнаты — даёт читаемые блики на лаке пола. */}
      <pointLight
        position={[0, height * 0.88, 0]}
        intensity={0.7}
        distance={Math.max(length, width) * 2.2}
        decay={1.6}
        color="#fff2dc"
      />
    </>
  );
}
