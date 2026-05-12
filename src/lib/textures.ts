import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  Texture,
} from "three";

/**
 * Процедурная текстура дерева для плашки ламината.
 * Возвращает пару (albedo, roughness) — линейные/sRGB настройки выставлены корректно.
 * Текстура задана в координатах плашки: U идёт вдоль длины (с волокном),
 * V — поперёк.
 */
let cachedWood: { albedo: CanvasTexture; roughness: CanvasTexture } | null =
  null;

export function getWoodTextures() {
  if (cachedWood) return cachedWood;

  const albedo = makeWoodAlbedo(1024, 256);
  albedo.colorSpace = SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = RepeatWrapping;
  albedo.anisotropy = 8;

  const roughness = makeWoodRoughness(1024, 256);
  roughness.colorSpace = NoColorSpace;
  roughness.wrapS = roughness.wrapT = RepeatWrapping;
  roughness.anisotropy = 8;

  cachedWood = { albedo, roughness };
  return cachedWood;
}

function makeWoodAlbedo(w: number, h: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Базовая заливка — теплый средне-коричневый, сверху мультипликатор для тонирования.
  ctx.fillStyle = "#a87146";
  ctx.fillRect(0, 0, w, h);

  // Длинные продольные полосы (волокна) — тёмные/светлые штрихи.
  const lineCount = 80;
  for (let i = 0; i < lineCount; i++) {
    const y = Math.random() * h;
    const baseAlpha = 0.04 + Math.random() * 0.08;
    const dark = Math.random() < 0.5;
    ctx.strokeStyle = dark
      ? `rgba(40, 22, 10, ${baseAlpha})`
      : `rgba(220, 175, 130, ${baseAlpha})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.2;
    ctx.beginPath();
    // Лёгкая волнистая кривая по всей длине плашки.
    const segments = 12;
    for (let s = 0; s <= segments; s++) {
      const x = (s / segments) * w;
      const yy = y + Math.sin((s / segments) * Math.PI * 2 + i) * 1.5;
      if (s === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  // Сучки/пятна.
  const knots = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < knots; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const r = 3 + Math.random() * 6;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, "rgba(50, 25, 12, 0.55)");
    grad.addColorStop(1, "rgba(50, 25, 12, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Шум по поверхности — мелкая зернистость.
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] = clampByte(d[i] + n);
    d[i + 1] = clampByte(d[i + 1] + n);
    d[i + 2] = clampByte(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);

  return new CanvasTexture(canvas);
}

function makeWoodRoughness(w: number, h: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // Дерево в лаке — roughness ~0.5, с лёгкой вариацией.
  ctx.fillStyle = "#888888";
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    const v = clampByte(140 + n);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return new CanvasTexture(canvas);
}

function clampByte(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Процедурная текстура штукатурки/краски для стен. */
let cachedWall: Texture | null = null;
export function getWallTexture(): Texture {
  if (cachedWall) return cachedWall;
  const w = 512;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Слабая шумовая «штукатурка» — eyes-perceptible, но не доминирующая.
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    const v = clampByte(245 + n);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  cachedWall = tex;
  return tex;
}
