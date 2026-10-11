/**
 * Пиктограмма формы комнаты: многоугольник шаблона (buildTemplatePoints),
 * вписанный в квадрат size×size. Для своей формы можно передать points.
 * Цвет контура — currentColor, заливка — var(--pn-shape-fill).
 */
import { memo, useMemo } from "react";
import { buildTemplatePoints } from "../domain/roomTemplates";
import type { RoomShapeId, Vec2 } from "../domain/types";
import "./panels.css";

/** «Своя» форма без точек — условный неправильный многоугольник. */
const CUSTOM_POINTS: Vec2[] = [
  { x: 0, y: 0.4 },
  { x: 2.6, y: 0 },
  { x: 4, y: 1.4 },
  { x: 3.4, y: 3.4 },
  { x: 1.6, y: 3 },
  { x: 0.4, y: 3.6 },
];

const cache = new Map<RoomShapeId, Vec2[]>();

function templatePoints(shape: RoomShapeId): Vec2[] {
  let pts = cache.get(shape);
  if (!pts) {
    pts = shape === "custom" ? CUSTOM_POINTS : buildTemplatePoints(shape).map(({ x, y }) => ({ x, y }));
    cache.set(shape, pts);
  }
  return pts;
}

function ShapeIconImpl({
  shape,
  size = 40,
  points,
  dashed,
  className,
}: {
  shape: RoomShapeId;
  size?: number;
  /** Точки своей формы (например, фактической комнаты). */
  points?: readonly Vec2[];
  /** Пунктирный контур (форма-подсказка). */
  dashed?: boolean;
  className?: string;
}) {
  const d = useMemo(() => {
    const pts = points && points.length >= 3 ? points : templatePoints(shape);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 3;
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxY - minY);
    const k = (size - 2 * pad) / Math.max(w, h);
    const ox = (size - w * k) / 2;
    const oy = (size - h * k) / 2;
    return (
      pts
        .map((p, i) => `${i ? "L" : "M"}${(ox + (p.x - minX) * k).toFixed(1)} ${(oy + (p.y - minY) * k).toFixed(1)}`)
        .join("") + "Z"
    );
  }, [shape, points, size]);

  return (
    <svg
      className={`pn-shape${dashed ? " is-dashed" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <path className="pn-shape__poly" d={d} />
    </svg>
  );
}

export const ShapeIcon = memo(ShapeIconImpl);
