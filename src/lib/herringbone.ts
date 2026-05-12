import { Matrix4, Euler, Vector3, Quaternion } from "three";

export interface PlankInstance {
  matrix: Matrix4;
  /** Псевдослучайный сид для вариации UV/цвета между плашками. */
  uvOffset: number;
}

export interface HerringboneParams {
  roomLength: number; // вдоль X, м
  roomWidth: number; // вдоль Z, м
  plankLength: number; // м, длинная сторона плашки
  plankWidth: number; // м, короткая сторона плашки
  gap: number; // зазор между плашками, м
}

/**
 * Классическая «ёлочка» (herringbone) без пустот.
 *
 * Геометрия пары планок (в неповёрнутой системе координат):
 *
 *   Плашка A — горизонтальная, центр (0, 0), занимает X∈[-L/2, L/2], Z∈[-W/2, W/2]
 *   Плашка B — вертикальная, центр ((L+W)/2, (L-W)/2),
 *              занимает X∈[L/2, L/2+W], Z∈[-W/2, L-W/2]
 *
 * Они стыкуются торец A (правый, длина W) к боку B (левому, длиной L) на
 * отрезке X = L/2, Z∈[-W/2, +W/2]. Без щели, без перекрытия.
 *
 * Тиление плоскости двумя векторами трансляции (по две планки в ячейке):
 *
 *   T1 = (L, L)    — вдоль «зигзагной цепи» (направление +45° в неповёрнутой)
 *   T2 = (W, -W)   — перпендикулярно цепи, к соседней цепи
 *
 * Определитель |det(T1, T2)| = 2·L·W = площадь двух планок ⇒ 100% покрытие.
 *
 * Параметр `gap` раздвигает планки на половину зазора от стыка, как настоящий
 * шов между плашками. Это работает потому, что сдвиг применяется
 * пропорционально размерам ячейки.
 *
 * Всё генерируется в неповёрнутой («диагональной») системе, затем поворачивается
 * на 45° вокруг центра пола, чтобы планки шли под ±45° к стенам комнаты —
 * каноничный вид ёлочки.
 *
 * Финальная обрезка по периметру комнаты — clippingPlanes материала, см. Floor.tsx.
 */
export function buildHerringbone({
  roomLength,
  roomWidth,
  plankLength: L,
  plankWidth: W,
  gap,
}: HerringboneParams): PlankInstance[] {
  // С шумом-зазором: смещаем планки внутри ячейки на gap/2 от стыка.
  // Это сохраняет латтице, но создаёт визуальный шов шириной gap.
  const Lg = L; // длина плашки геометрически не меняется
  const Wg = W;
  const halfGap = gap / 2;

  // Шаг латтице с учётом зазоров. Чтобы получить шов вдоль каждой границы
  // стыка, сдвигаем сами трансляции на (gap, gap) и (gap, -gap).
  const T1x = Lg + gap;
  const T1z = Lg + gap;
  const T2x = Wg + gap;
  const T2z = -Wg - gap;

  // Полу-диагональ комнаты + запас в одну плашку — это радиус, который
  // должна покрыть наша сетка после поворота на 45° вокруг (0, 0).
  const D =
    Math.sqrt(roomLength * roomLength + roomWidth * roomWidth) / 2 + Lg;

  // Грубые границы для (i, j):
  // |i*T1x + j*T2x| ≤ D и |i*T1z + j*T2z| ≤ D.
  // Простой запас: оба индекса в пределах ±ceil(D / min(L, W)) + 1.
  const iMax = Math.ceil(D / Math.min(Lg, Wg)) + 2;

  const planks: PlankInstance[] = [];
  const halfPi = Math.PI / 2;
  const rot45 = Math.PI / 4;

  // Лимиты для отсечки по принадлежности к диагональному квадрату вокруг комнаты.
  // После поворота на 45° точка с координатами (x, z) станет
  // ( (x - z)/√2, (x + z)/√2 ). Чтобы попасть в комнату, нужны:
  //   |x - z|/√2 ≤ roomLength/2 + Lg
  //   |x + z|/√2 ≤ roomWidth/2  + Lg
  const limA = (roomLength / 2 + Lg) * Math.SQRT2;
  const limB = (roomWidth / 2 + Lg) * Math.SQRT2;

  // Смещение второй плашки в паре в неповернутой системе:
  const offsetBx = (Lg + Wg) / 2 + halfGap;
  const offsetBz = (Lg - Wg) / 2;

  const tmpQ = new Quaternion();
  const tmpV = new Vector3();
  const tmpS = new Vector3(1, 1, 1);

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -iMax; j <= iMax; j++) {
      const baseX = i * T1x + j * T2x;
      const baseZ = i * T1z + j * T2z;

      // Плашка A — горизонтальная в неповёрнутой системе.
      const ax = baseX;
      const az = baseZ;
      if (Math.abs(ax - az) <= limA && Math.abs(ax + az) <= limB) {
        planks.push(
          makePlank(ax, az, rot45 /* self=0 + grid=45 */, tmpV, tmpQ, tmpS, i * 7 + j * 3),
        );
      }

      // Плашка B — вертикальная (self=π/2), сдвинута на (offsetBx, offsetBz).
      const bx = baseX + offsetBx;
      const bz = baseZ + offsetBz;
      if (Math.abs(bx - bz) <= limA && Math.abs(bx + bz) <= limB) {
        planks.push(
          makePlank(
            bx,
            bz,
            rot45 + halfPi /* self=π/2 + grid=45 */,
            tmpV,
            tmpQ,
            tmpS,
            i * 11 + j * 5 + 1,
          ),
        );
      }
    }
  }

  return planks;
}

function makePlank(
  localX: number,
  localZ: number,
  totalRotY: number,
  pos: Vector3,
  quat: Quaternion,
  scale: Vector3,
  uvSeed: number,
): PlankInstance {
  // Поворачиваем позицию центра на +45° вокруг Y (общий поворот «диагональной» сетки).
  // Угол поворота сетки фиксирован — π/4. Используем точные cos/sin.
  const c = Math.SQRT1_2; // cos(π/4)
  const s = Math.SQRT1_2; // sin(π/4)
  const wx = localX * c - localZ * s;
  const wz = localX * s + localZ * c;

  pos.set(wx, 0, wz);
  quat.setFromEuler(new Euler(0, totalRotY, 0));
  const m = new Matrix4().compose(pos, quat, scale);

  return { matrix: m, uvOffset: ((uvSeed * 0.137) % 1 + 1) % 1 };
}
