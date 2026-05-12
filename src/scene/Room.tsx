import { useMemo } from "react";
import { BackSide, Color } from "three";
import { useRoomStore } from "../state/useRoomStore";
import { getWallTexture } from "../lib/textures";

/**
 * 4 стены комнаты. Используем одну BoxGeometry без верха/низа: рендерим
 * заднюю сторону (BackSide), чтобы стенки были видны изнутри. Это даёт
 * правильное освещение внутренней поверхности без 4-х отдельных плейнов.
 */
export function Room() {
  const length = useRoomStore((s) => s.length);
  const width = useRoomStore((s) => s.width);
  const height = useRoomStore((s) => s.height);
  const wallColor = useRoomStore((s) => s.wallColor);

  const wallTexture = useMemo(() => {
    const t = getWallTexture();
    // Растягиваем штукатурку по высоте стены, чтобы зерно было одинакового масштаба.
    t.repeat.set(Math.max(length, width) / 2, height / 2);
    return t;
  }, [length, width, height]);

  const color = useMemo(() => new Color(wallColor), [wallColor]);

  return (
    <mesh
      position={[0, height / 2, 0]}
      receiveShadow
    >
      <boxGeometry args={[length, height, width]} />
      <meshStandardMaterial
        map={wallTexture}
        color={color}
        side={BackSide}
        roughness={0.92}
        metalness={0}
      />
    </mesh>
  );
}
