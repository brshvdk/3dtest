/**
 * Накопитель треугольников для процедурной геометрии: позиции + нормали,
 * группы материалов. Ориентация треугольника подгоняется под заданную
 * нормаль — вызывающему коду не нужно следить за порядком вершин.
 */
import { BufferGeometry, Float32BufferAttribute } from "three";

export type V3 = [number, number, number];

const WHITE: V3 = [1, 1, 1];

const AREA_EPS = 1e-12;

export class MeshBuilder {
  private pos: number[][] = [];
  private nrm: number[][] = [];
  private col: number[][] = [];
  private hasColor = false;

  constructor(groups = 1) {
    for (let i = 0; i < groups; i++) {
      this.pos.push([]);
      this.nrm.push([]);
      this.col.push([]);
    }
  }

  /** Треугольник с плоской нормалью n (вершины переставляются под неё). */
  tri(g: number, a: V3, b: V3, c: V3, n: V3): void {
    this.triN(g, a, b, c, n, n, n, n);
  }

  /** Треугольник с плоской нормалью и цветами вершин (затенение углов). */
  triC(g: number, a: V3, b: V3, c: V3, n: V3, ca: V3, cb: V3, cc: V3): void {
    this.hasColor = true;
    this.triN(g, a, b, c, n, n, n, n, ca, cb, cc);
  }

  /** Четырёхугольник a-b-c-d с цветами вершин. */
  quadC(g: number, a: V3, b: V3, c: V3, d: V3, n: V3, ca: V3, cb: V3, cc: V3, cd: V3): void {
    this.triC(g, a, b, c, n, ca, cb, cc);
    this.triC(g, a, c, d, n, ca, cc, cd);
  }

  /**
   * Треугольник с нормалями по вершинам; ориентацию задаёт ref
   * (обычно — средняя нормаль).
   */
  triN(
    g: number,
    a: V3,
    b: V3,
    c: V3,
    na: V3,
    nb: V3,
    nc: V3,
    ref: V3,
    ca: V3 = WHITE,
    cb: V3 = WHITE,
    cc: V3 = WHITE,
  ): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < AREA_EPS) return;
    const p = this.pos[g];
    const q = this.nrm[g];
    const k = this.col[g];
    if (cx * ref[0] + cy * ref[1] + cz * ref[2] >= 0) {
      p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      q.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
      k.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    } else {
      p.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
      q.push(na[0], na[1], na[2], nc[0], nc[1], nc[2], nb[0], nb[1], nb[2]);
      k.push(ca[0], ca[1], ca[2], cc[0], cc[1], cc[2], cb[0], cb[1], cb[2]);
    }
  }

  /** Четырёхугольник a-b-c-d (по контуру) с плоской нормалью. */
  quad(g: number, a: V3, b: V3, c: V3, d: V3, n: V3): void {
    this.tri(g, a, b, c, n);
    this.tri(g, a, c, d, n);
  }

  /** Четырёхугольник с нормалями по вершинам (гладкие профили). */
  quadN(g: number, a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3): void {
    const ref: V3 = [
      na[0] + nb[0] + nc[0] + nd[0],
      na[1] + nb[1] + nc[1] + nd[1],
      na[2] + nb[2] + nc[2] + nd[2],
    ];
    this.triN(g, a, b, c, na, nb, nc, ref);
    this.triN(g, a, c, d, na, nc, nd, ref);
  }

  get isEmpty(): boolean {
    return this.pos.every((p) => p.length === 0);
  }

  build(): BufferGeometry {
    const geom = new BufferGeometry();
    const total = this.pos.reduce((s, p) => s + p.length, 0);
    const positions = new Float32Array(total);
    const normals = new Float32Array(total);
    const colors = this.hasColor ? new Float32Array(total) : null;
    let offset = 0;
    this.pos.forEach((p, g) => {
      positions.set(p, offset);
      normals.set(this.nrm[g], offset);
      colors?.set(this.col[g], offset);
      if (this.pos.length > 1) geom.addGroup(offset / 3, p.length / 3, g);
      offset += p.length;
    });
    geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geom.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    if (colors) geom.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geom.computeBoundingSphere();
    geom.computeBoundingBox();
    return geom;
  }
}
