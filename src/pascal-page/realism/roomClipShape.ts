/**
 * Vòng 7 làn R — mặt nạ room-clip theo ĐA GIÁC phòng thật (thay hộp bao AABB ở mặt XZ).
 *
 * Vòng 6 dùng AABB của đa giác → phòng chữ L / phòng xoay phủ sang phòng bên, đèn vẫn lọt. Ở đây mỗi đèn mang tới
 * `ROOM_CLIP_MAX_VERTS` đỉnh (2 đỉnh / vec4 → 4 uniform). Shader tính khoảng cách có dấu tới đa giác:
 * dấu theo luật chẵn-lẻ (đếm cạnh cắt tia +x), độ lớn = khoảng cách tới cạnh gần nhất; mặt nạ =
 * clamp((sd + margin) / edge + 0.5) — cùng margin/mép mềm như hộp cũ. Đỉnh thừa = lặp đỉnh cuối (cạnh suy biến:
 * không cắt tia, khoảng cách = tới chính đỉnh đó → vô hại). Phòng quá nhiều đỉnh (sau khi bỏ đỉnh thẳng hàng) → lùi về
 * hình chữ nhật AABB = hành vi vòng 6. Dải Y (sàn → sàn tầng trên) vẫn do hộp trong `lightingRoomClip.ts` lo.
 *
 * `polygonClipFactor` là bản JS cùng công thức với shader (để test); sửa một bên phải sửa bên kia.
 */
type Polygon = ReadonlyArray<readonly [number, number]>;

/** Số đỉnh tối đa mỗi đèn trong shader (chữ L = 6, chữ T/U = 8, chữ nhật xoay = 4). */
export const ROOM_CLIP_MAX_VERTS = 8;
/** Đỉnh lệch khỏi đường nối hai đỉnh kề ít hơn quãng này (m) thì bỏ (đỉnh thẳng hàng / trùng). */
export const SIMPLIFY_TOL_M = 0.02;

type P2 = readonly [number, number];

function segDist(x: number, z: number, a: P2, b: P2): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / Math.max(ex * ex + ez * ez, 1e-8)));
  return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
}

/** Bỏ đỉnh trùng / gần thẳng hàng (lặp tới khi hết). Giữ ≥ 3 đỉnh. */
export function simplifyPolygon(poly: Polygon, tol = SIMPLIFY_TOL_M): [number, number][] {
  const out = poly.map(([x, z]) => [x, z] as [number, number]);
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const prev = out[(i + out.length - 1) % out.length]!;
      const next = out[(i + 1) % out.length]!;
      const v = out[i]!;
      if (segDist(v[0], v[1], prev, next) < tol) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}

export interface ClipShape {
  /** Đúng `ROOM_CLIP_MAX_VERTS` đỉnh (đã đệm bằng đỉnh cuối), toạ độ thế giới XZ, mét. */
  verts: [number, number][];
  /** true = phòng quá nhiều đỉnh, đang dùng hình chữ nhật AABB (như vòng 6). */
  fallback: boolean;
}

const pad = (v: [number, number][]): [number, number][] =>
  Array.from({ length: ROOM_CLIP_MAX_VERTS }, (_, i) => v[Math.min(i, v.length - 1)]!);

/** Dữ liệu mặt nạ cho một phòng: đa giác rút gọn, hoặc AABB khi > ROOM_CLIP_MAX_VERTS đỉnh. */
export function clipShapeOf(poly: Polygon): ClipShape {
  const s = simplifyPolygon(poly);
  // ponytail: > 8 đỉnh lùi AABB; nếu đo thấy nhiều phòng rơi vào đây thì tách lõm thành ≤ 2 đa giác hoặc tăng MAX.
  if (s.length <= ROOM_CLIP_MAX_VERTS) return { verts: pad(s), fallback: false };
  const xs = s.map((p) => p[0]);
  const zs = s.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return { verts: pad([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]), fallback: true };
}

/** Hình "không cắt" (đèn ngoài mọi phòng): hình vuông rất lớn → mặt nạ = 1 khắp nơi. */
export function openShape(size: number): ClipShape {
  return { verts: pad([[-size, -size], [size, -size], [size, size], [-size, size]]), fallback: false };
}

/**
 * Bản JS của mặt nạ đa giác trong shader. Từng cạnh a→b (b = đỉnh kế, vòng về 0):
 * - khoảng cách tới đoạn ab, lấy nhỏ nhất;
 * - cắt tia +x khi (a.z ≥ z) ≠ (b.z ≥ z) và cross·(b.z − a.z) > 0, cross = (b.x−a.x)(z−a.z) − (x−a.x)(b.z−a.z).
 * Số lần cắt lẻ → trong (sd > 0).
 */
export function polygonClipFactor(x: number, z: number, verts: readonly P2[], margin: number, edge: number): number {
  let dmin = 1e9;
  let cnt = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    dmin = Math.min(dmin, segDist(x, z, a, b));
    const ez = b[1] - a[1];
    const straddle = Math.abs((a[1] >= z ? 1 : 0) - (b[1] >= z ? 1 : 0));
    const cross = (b[0] - a[0]) * (z - a[1]) - (x - a[0]) * ez;
    cnt += straddle * (cross * ez >= 0 ? 1 : 0);
  }
  const sd = cnt % 2 === 1 ? dmin : -dmin;
  return Math.min(1, Math.max(0, (sd + margin) / edge + 0.5));
}
