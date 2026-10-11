import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  useActiveRoom,
  useEstimate,
  useRoomMetrics,
  useRoomProduct,
  useRoomResult,
  useWalls,
} from "../hooks";

/**
 * Хуки в серверном рендере (node, без DOM): читают начальное состояние
 * хранилища — демо-проект. Проверяем, что всё считается и селекторы
 * стабильны (иначе React предупреждает о бесконечном цикле).
 */
describe("hooks (SSR)", () => {
  it("отдают согласованные данные активной комнаты", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: Record<string, unknown> = {};
    function Probe() {
      const room = useActiveRoom();
      const estimate = useEstimate();
      const result = useRoomResult();
      const product = useRoomProduct();
      const metrics = useRoomMetrics();
      const walls = useWalls();
      Object.assign(seen, { room, estimate, result, product, metrics, walls });
      return createElement("span", null, `${room.name}: ${walls.length}`);
    }
    const html = renderToString(createElement(Probe));
    expect(html).toContain("Гостиная: 4");
    expect(errors).not.toHaveBeenCalled();
    const room = seen.room as ReturnType<typeof useActiveRoom>;
    const result = seen.result as ReturnType<typeof useRoomResult>;
    expect(result?.roomId).toBe(room.id);
    expect((seen.estimate as ReturnType<typeof useEstimate>).rooms).toContain(result);
    expect((seen.product as ReturnType<typeof useRoomProduct>).id).toBe("pvc-55");
    expect((seen.metrics as ReturnType<typeof useRoomMetrics>).floorArea).toBeCloseTo(16.2);
  });
});
