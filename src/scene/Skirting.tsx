import { useRoomStore } from "../state/useRoomStore";

const SKIRTING_HEIGHT = 0.08; // 8 см
const SKIRTING_DEPTH = 0.015; // 15 мм

/**
 * Плинтус по периметру комнаты — четыре длинных бруска. На углах они
 * пересекаются (стыки в нахлёст), что для визуала вполне приемлемо при
 * толщине 15 мм. Расчёт погонажа в StatsPanel считает чистый периметр
 * без учёта этого нахлёста.
 */
export function Skirting() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);

  const y = SKIRTING_HEIGHT / 2 + 0.0005; // чуть приподняли над полом против z-fighting
  const halfL = length / 2;
  const halfW = width / 2;
  const offset = SKIRTING_DEPTH / 2;

  return (
    <group>
      {/* Вдоль X — задняя стена (z = +halfW) */}
      <mesh position={[0, y, halfW - offset]} castShadow receiveShadow>
        <boxGeometry args={[length, SKIRTING_HEIGHT, SKIRTING_DEPTH]} />
        <meshStandardMaterial color="#f4ede0" roughness={0.6} />
      </mesh>
      {/* Передняя стена (z = -halfW) */}
      <mesh position={[0, y, -halfW + offset]} castShadow receiveShadow>
        <boxGeometry args={[length, SKIRTING_HEIGHT, SKIRTING_DEPTH]} />
        <meshStandardMaterial color="#f4ede0" roughness={0.6} />
      </mesh>
      {/* Левая стена (x = -halfL) */}
      <mesh position={[-halfL + offset, y, 0]} castShadow receiveShadow>
        <boxGeometry args={[SKIRTING_DEPTH, SKIRTING_HEIGHT, width]} />
        <meshStandardMaterial color="#f4ede0" roughness={0.6} />
      </mesh>
      {/* Правая стена (x = +halfL) */}
      <mesh position={[halfL - offset, y, 0]} castShadow receiveShadow>
        <boxGeometry args={[SKIRTING_DEPTH, SKIRTING_HEIGHT, width]} />
        <meshStandardMaterial color="#f4ede0" roughness={0.6} />
      </mesh>
    </group>
  );
}
