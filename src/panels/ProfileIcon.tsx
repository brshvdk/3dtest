/**
 * Сечение плинтуса: профиль (product.profile, мм) у стены на полу,
 * размерная линия и подпись высоты («55 мм»).
 *
 * Масштаб: по умолчанию профиль вписывается по высоте; scaleMm задаёт общий
 * масштаб (например, 120 мм на всю высоту иконки) — так в каталоге видно,
 * какой плинтус выше.
 */
import { memo, useMemo } from "react";
import type { SkirtingProduct } from "../domain/types";
import { formatNumber } from "../domain/units";
import "./panels.css";

export interface ProfileIconProps {
  product: Pick<SkirtingProduct, "profile" | "height" | "depth" | "color"> & { name?: string };
  /** Высота иконки, px. */
  size?: number;
  /** мм, которые занимают всю высоту иконки (общий масштаб). По умолчанию — высота профиля. */
  scaleMm?: number;
  /** Подпись высоты справа. */
  showLabel?: boolean;
  className?: string;
}

const PAD_TOP = 3;
const PAD_BOTTOM = 4;

function ProfileIconImpl({ product, size = 48, scaleMm, showLabel = true, className }: ProfileIconProps) {
  const g = useMemo(() => {
    const prof = product.profile.length >= 3 ? product.profile : fallbackProfile(product);
    const H = Math.max(1, ...prof.map(([, h]) => h));
    const D = Math.max(1, ...prof.map(([d]) => d));
    const floorY = size - PAD_BOTTOM;
    const avail = floorY - PAD_TOP;
    const k = avail / Math.max(scaleMm ?? H, H);
    // Маленькая иконка — стена тонкой сплошной полосой, без штриховки.
    const small = size < 50;
    const wallW = small ? 3 : Math.max(4, Math.round(size * 0.1));
    const x0 = 1 + wallW;
    const points = prof
      .map(([d, h]) => `${r(x0 + d * k)},${r(floorY - h * k)}`)
      .join(" ");
    const profRight = x0 + D * k;
    const top = floorY - H * k;
    const fontSize = Math.round(Math.min(12, Math.max(9.5, size * 0.21)));
    const label = `${formatNumber(Math.round(product.height * 1000), 0)} мм`;
    const xDim = profRight + 5;
    const labelW = showLabel ? Math.ceil(label.length * fontSize * 0.58) + 2 : 0;
    const width = Math.ceil(showLabel ? xDim + 4 + labelW : profRight + 3);
    // Штриховка стены: диагонали внутри полосы.
    const hatch: string[] = [];
    if (!small) for (let y = wallW + 1; y <= floorY; y += 4) hatch.push(`M1 ${y}L${1 + wallW} ${y - wallW}`);
    return { points, floorY, x0, top, xDim, fontSize, label, width, hatch: hatch.join(""), wallW, dimH: floorY - top, small };
  }, [product, size, scaleMm, showLabel]);

  return (
    <svg
      className={`pn-prof${className ? ` ${className}` : ""}`}
      width={g.width}
      height={size}
      viewBox={`0 0 ${g.width} ${size}`}
      role="img"
      aria-label={`Сечение плинтуса, высота ${g.label}`}
    >
      <rect className={`pn-prof__wall${g.small ? " is-small" : ""}`} x={1} y={0} width={g.wallW} height={g.floorY} />
      {g.hatch ? <path className="pn-prof__hatch" d={g.hatch} /> : null}
      <line className="pn-prof__floor" x1={0} y1={g.floorY + 0.5} x2={g.width} y2={g.floorY + 0.5} />
      <polygon className="pn-prof__shape" points={g.points} style={{ fill: product.color }} />
      {showLabel ? (
        <>
          <path
            className="pn-prof__dim"
            d={`M${r(g.xDim)} ${r(g.top)}V${g.floorY}M${r(g.xDim - 2)} ${r(g.top)}h4M${r(g.xDim - 2)} ${g.floorY}h4`}
          />
          <text
            className="pn-prof__label"
            x={r(g.xDim + 4)}
            y={r(Math.min(g.floorY - 1, g.top + g.dimH / 2 + g.fontSize * 0.36))}
            style={{ fontSize: g.fontSize }}
          >
            {g.label}
          </text>
        </>
      ) : null}
    </svg>
  );
}

const r = (v: number) => Math.round(v * 10) / 10;

/** Прямоугольник по габаритам, если профиль не задан. */
function fallbackProfile(p: Pick<SkirtingProduct, "height" | "depth">): Array<[number, number]> {
  const h = p.height * 1000;
  const d = p.depth * 1000;
  return [
    [0, 0],
    [d, 0],
    [d, h],
    [0, h],
  ];
}

export const ProfileIcon = memo(ProfileIconImpl);
