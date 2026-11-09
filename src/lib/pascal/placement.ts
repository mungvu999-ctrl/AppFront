/**
 * Hình học đặt đồ đạc sinh ra (J10): hình chữ nhật xoay, nằm trong phòng, chồng nhau (SAT),
 * vùng mở cửa và các cạnh phòng kèm khoảng cửa. Thuần, đơn vị mm.
 *
 * Quy ước (K1, rotationConvention.test.ts): khung riêng `w × d` (w theo trục x riêng, d theo
 * y riêng), xoay `rotationDeg` quanh tâm — trên mặt bằng là phép quay chuẩn
 * (x, y) → (x cos − y sin, x sin + y cos). Mặt trước món đồ là +y riêng (= +z của GLB).
 */

import { outlineContains, signedAreaMm2 } from '@/domain/rooms/area';
import type { Furniture, LevelId, Point, Room, SpatialGraph } from '@/domain/spatial/types';
import { FURNITURE_KIND_LABELS, isFinitePoint, toPointMm } from '@/lib/commands/business/shared';

export interface Rect {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly d: number;
  readonly rotationDeg: number;
}

export interface RoomEdge {
  readonly a: Point;
  readonly b: Point;
  readonly lengthMm: number;
  readonly inwardNormal: Point;
  /** Nửa dày lớn nhất của tường nằm trên cạnh (0 = không có tường): đồ tựa cạnh phải lùi hơn mức này. */
  readonly wallHalfMm: number;
  readonly openings: readonly { readonly fromMm: number; readonly toMm: number }[];
  /** Đoạn dọc cạnh có tường thật phía sau (đã gộp, theo thứ tự); phần còn lại là chỗ trống/thông phòng. */
  readonly walled: readonly { readonly fromMm: number; readonly toMm: number }[];
}

const EPS = 1e-6;
/** Vùng mở của cửa trượt/cố định: sâu 600 mm mỗi bên tường. */
const SLIDING_SWING_DEPTH_MM = 600;
/** Tường được coi là nằm trên cạnh phòng khi tâm tường cách cạnh ≤ nửa dày + 50 mm. */
const EDGE_WALL_SLACK_MM = 50;
/** Khe giữa hai đoạn tường (hoặc tới đầu cạnh) ngắn hơn mức này coi như liền: mối nối tường dò không khít. */
const WALL_JOIN_MM = 300;

const radiansOf = (deg: number): number => (deg * Math.PI) / 180;
const axesOf = (r: Rect): readonly [Point, Point] => {
  const t = radiansOf(r.rotationDeg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
};
const dot = (p: Point, q: Point): number => p.x * q.x + p.y * q.y;
const cross = (o: Point, p: Point, q: Point): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);

export const rectOfFurniture = (f: Pick<Furniture, 'centre' | 'boundingBox' | 'rotationDeg'>): Rect => ({
  cx: f.centre.x,
  cy: f.centre.y,
  w: f.boundingBox.max.x - f.boundingBox.min.x,
  d: f.boundingBox.max.y - f.boundingBox.min.y,
  rotationDeg: f.rotationDeg,
});

/** 4 góc theo thứ tự quanh hình: (−,−), (+,−), (+,+), (−,+) trong khung riêng. */
export const rectCorners = (r: Rect): Point[] => {
  const [ex, ey] = axesOf(r);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx = 0, sy = 0]) => ({
    x: r.cx + ex.x * (sx * r.w) / 2 + ey.x * (sy * r.d) / 2,
    y: r.cy + ex.y * (sx * r.w) / 2 + ey.y * (sy * r.d) / 2,
  }));
};

const properlyCross = (p1: Point, p2: Point, q1: Point, q2: Point): boolean => {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return d1 * d2 < -EPS && d3 * d4 < -EPS;
};

/**
 * Hình (nở thêm `insetMm` mỗi phía) nằm trọn trong outline: 4 góc trong, không đỉnh nào của
 * outline lọt vào hình, không cạnh nào cắt ngang (bắt được góc lõm của phòng chữ L).
 */
export const rectInsidePolygon = (r: Rect, outline: readonly Point[], insetMm: number): boolean => {
  // Toạ độ hỏng: trả `false` chứ không ném (hàm đo của domain ném với số không hữu hạn).
  if (outline.length < 3 || !outline.every(isFinitePoint)) return false;
  if (![r.cx, r.cy, r.w, r.d, r.rotationDeg, insetMm].every(Number.isFinite)) return false;
  // Nhỏ hơn 0,01 mm để hình chạm đúng mép lùi không bị tia quét xử ngẫu nhiên.
  const grown: Rect = { ...r, w: r.w + 2 * insetMm - 0.02, d: r.d + 2 * insetMm - 0.02 };
  const corners = rectCorners(grown);
  const outlineMm = outline.map(toPointMm);
  if (!corners.every((corner) => outlineContains(outlineMm, toPointMm(corner)))) return false;
  const [ex, ey] = axesOf(grown);
  const strictlyInside = (p: Point): boolean => {
    const v = { x: p.x - grown.cx, y: p.y - grown.cy };
    return Math.abs(dot(v, ex)) < grown.w / 2 - EPS && Math.abs(dot(v, ey)) < grown.d / 2 - EPS;
  };
  if (outline.some(strictlyInside)) return false;
  return outline.every((p, i) => {
    const q = outline[(i + 1) % outline.length] as Point;
    return corners.every((c, j) => !properlyCross(p, q, c, corners[(j + 1) % 4] as Point));
  });
};

/** Hai hình xoay chồng nhau (SAT); cách nhau đúng `gapMm` thì không tính là chồng. */
export const rectsOverlap = (a: Rect, b: Rect, gapMm = 0): boolean => {
  const [ax, ay] = axesOf(a);
  const [bx, by] = axesOf(b);
  const between = { x: b.cx - a.cx, y: b.cy - a.cy };
  const half = (r: Rect, ex: Point, ey: Point, u: Point): number =>
    Math.abs(dot(ex, u)) * (r.w / 2) + Math.abs(dot(ey, u)) * (r.d / 2);
  return [ax, ay, bx, by].every(
    (u) => Math.abs(dot(between, u)) < half(a, ax, ay, u) + half(b, bx, by, u) + gapMm - EPS,
  );
};

/** Vùng mở của mọi cửa đi trên tầng: rộng × rộng cả hai bên tường; trượt/cố định: rộng × 600. */
export const doorSwingRects = (graph: SpatialGraph, levelId: LevelId): Rect[] => {
  const walls = new Map(graph.walls.filter((w) => w.levelId === levelId).map((w) => [w.id, w]));
  return graph.openings.flatMap((o) => {
    const wall = walls.get(o.wallId);
    if (o.kind !== 'door' || wall === undefined) return [];
    const { start, end } = wall.centreline;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < EPS) return [];
    const dir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const along = o.offsetMm + o.widthMm / 2;
    const depth = o.swing === 'sliding' || o.swing === 'fixed' ? SLIDING_SWING_DEPTH_MM : o.widthMm;
    const reach = wall.thicknessMm / 2 + depth / 2;
    const rotationDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    return [1, -1].map((side) => ({
      cx: start.x + dir.x * along - dir.y * reach * side,
      cy: start.y + dir.y * along + dir.x * reach * side,
      w: o.widthMm,
      d: depth,
      rotationDeg,
    }));
  });
};

/**
 * Thân mọi tường cùng tầng (dài theo tâm tường × dày): đồ sinh ra không được cắt tường, kể cả
 * tường ngăn không nằm trên outline phòng hay tường ngoài dày hơn mức lùi 100 mm.
 */
export const wallRects = (graph: SpatialGraph, levelId: LevelId): Rect[] =>
  graph.walls.flatMap((w) => {
    const { start, end } = w.centreline;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (w.levelId !== levelId || !(length > EPS) || !Number.isFinite(w.thicknessMm)) return [];
    return [
      {
        cx: (start.x + end.x) / 2,
        cy: (start.y + end.y) / 2,
        w: length,
        d: w.thicknessMm,
        rotationDeg: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
      },
    ];
  });

/**
 * Các cạnh outline của phòng, pháp tuyến hướng vào trong và khoảng cửa (đi + sổ) dọc cạnh:
 * lấy từ tường cùng tầng có cả hai đầu tâm tường cách đường cạnh ≤ dày/2 + 50 mm và phủ một
 * phần đoạn cạnh; `walled` là các đoạn cạnh có tường đó phía sau.
 */
export const roomEdges = (room: Pick<Room, 'levelId' | 'outline'>, graph: SpatialGraph): RoomEdge[] => {
  const outline = room.outline;
  if (outline.length < 3 || !outline.every(isFinitePoint)) return [];
  const sign = signedAreaMm2(outline.map(toPointMm)) >= 0 ? 1 : -1;
  const walls = graph.walls.filter((w) => w.levelId === room.levelId);
  const openingsByWall = new Map<string, typeof graph.openings>();
  for (const o of graph.openings) openingsByWall.set(o.wallId, [...(openingsByWall.get(o.wallId) ?? []), o]);

  return outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length] as Point;
    const lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
    if (lengthMm < EPS) return [];
    const e = { x: (b.x - a.x) / lengthMm, y: (b.y - a.y) / lengthMm };
    const inwardNormal = { x: -e.y * sign, y: e.x * sign };
    const offLine = (p: Point): number => Math.abs((p.x - a.x) * e.y - (p.y - a.y) * e.x);
    const along = (p: Point): number => (p.x - a.x) * e.x + (p.y - a.y) * e.y;

    // Tường thẳng hàng nhưng nằm ngoài đoạn cạnh (cạnh khác cùng đường thẳng) không tính.
    const spanOf = (w: (typeof walls)[number]): { fromMm: number; toMm: number } => {
      const p = along(w.centreline.start);
      const q = along(w.centreline.end);
      return { fromMm: Math.max(0, Math.min(p, q)), toMm: Math.min(lengthMm, Math.max(p, q)) };
    };
    const onEdge = walls.filter((w) => {
      const tol = w.thicknessMm / 2 + EDGE_WALL_SLACK_MM;
      const { fromMm, toMm } = spanOf(w);
      return offLine(w.centreline.start) <= tol && offLine(w.centreline.end) <= tol && toMm - fromMm > EPS;
    });
    const walled: { fromMm: number; toMm: number }[] = [];
    for (const s of onEdge.map(spanOf).sort((x, y) => x.fromMm - y.fromMm)) {
      const last = walled[walled.length - 1];
      if (last !== undefined && s.fromMm - last.toMm <= WALL_JOIN_MM) last.toMm = Math.max(last.toMm, s.toMm);
      else walled.push({ ...s });
    }
    const head = walled[0];
    const tail = walled[walled.length - 1];
    if (head !== undefined && head.fromMm <= WALL_JOIN_MM) head.fromMm = 0;
    if (tail !== undefined && lengthMm - tail.toMm <= WALL_JOIN_MM) tail.toMm = lengthMm;
    const wallHalfMm = Math.max(0, ...onEdge.map((w) => w.thicknessMm / 2));
    const openings = onEdge
      .flatMap((w) => {
        const { start, end } = w.centreline;
        const len = Math.hypot(end.x - start.x, end.y - start.y);
        if (len < EPS) return [];
        const at = (t: number): Point => ({
          x: start.x + ((end.x - start.x) * t) / len,
          y: start.y + ((end.y - start.y) * t) / len,
        });
        return (openingsByWall.get(w.id) ?? []).flatMap((o) => {
          const p = along(at(o.offsetMm));
          const q = along(at(o.offsetMm + o.widthMm));
          const fromMm = Math.max(0, Math.min(p, q));
          const toMm = Math.min(lengthMm, Math.max(p, q));
          return toMm - fromMm > EPS ? [{ fromMm, toMm }] : [];
        });
      })
      .sort((x, y) => x.fromMm - y.fromMm || x.toMm - y.toMm);

    return [{ a, b, lengthMm, inwardNormal, wallHalfMm, openings, walled }];
  });
};

/** rotationDeg ∈ [0, 360) để mặt trước (+y riêng) quay theo `inwardNormal` (vào phòng). */
export const furnitureFacingDeg = (inwardNormal: Point): number => {
  const deg = Math.round(((Math.atan2(-inwardNormal.x, inwardNormal.y) * 180) / Math.PI) * 100) / 100;
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped === 360 || Object.is(wrapped, -0) ? 0 : wrapped;
};

/** Diện tích (mm²) phần chung của hai hình xoay: cắt đa giác lồi (Sutherland–Hodgman). */
export const overlapAreaMm2 = (a: Rect, b: Rect): number => {
  const clip = rectCorners(b);
  let poly = rectCorners(a);
  for (let i = 0; i < clip.length && poly.length > 0; i += 1) {
    const p = clip[i] as Point;
    const q = clip[(i + 1) % clip.length] as Point;
    const inside = (v: Point): boolean => cross(p, q, v) >= -EPS;
    const hit = (u: Point, v: Point): Point => {
      const du = cross(p, q, u);
      const t = du / (du - cross(p, q, v));
      return { x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t };
    };
    poly = poly.flatMap((v, j) => {
      const u = poly[(j + poly.length - 1) % poly.length] as Point;
      if (inside(v)) return inside(u) ? [v] : [hit(u, v), v];
      return inside(u) ? [hit(u, v)] : [];
    });
  }
  return poly.length < 3 ? 0 : Math.abs(signedAreaMm2(poly.map(toPointMm)));
};

export interface PlacementIssue {
  /** `roomMismatch` / `duplicateFixture` / `facing`: luật thiết bị vệ sinh (`sanitaryRules.ts`). */
  /** `outside`: món nằm ngoài nhà (ngoài mọi phòng của tầng, `outsideAllRooms`). */
  readonly kind: 'overlap' | 'doorSwing' | 'wall' | 'outside' | 'roomMismatch' | 'duplicateFixture' | 'facing';
  readonly furnitureIds: readonly string[];
  readonly message: string;
}

/**
 * Món nằm ngoài nhà: tâm ngoài mọi phòng cùng tầng, hoặc quá nửa thân (lưới 5 × 5 tâm ô) ngoài mọi phòng — món
 * vắt qua hai phòng liền nhau vẫn là trong nhà. Tầng không có phòng nào thì không xét (`false`).
 */
export const outsideAllRooms = (
  f: Pick<Furniture, 'levelId' | 'centre' | 'boundingBox' | 'rotationDeg'>,
  rooms: readonly Pick<Room, 'levelId' | 'outline'>[],
): boolean => {
  const outlines = rooms
    .filter((r) => r.levelId === f.levelId && r.outline.length >= 3 && r.outline.every(isFinitePoint))
    .map((r) => r.outline.map(toPointMm));
  const r = rectOfFurniture(f);
  if (outlines.length === 0 || ![r.cx, r.cy, r.w, r.d, r.rotationDeg].every(Number.isFinite)) return false;
  const inside = (p: Point): boolean => outlines.some((o) => outlineContains(o, toPointMm(p)));
  if (!inside(f.centre)) return true;
  const [ex, ey] = axesOf(r);
  let n = 0;
  for (let i = -2; i <= 2; i += 1)
    for (let j = -2; j <= 2; j += 1) {
      const u = (i / 5) * r.w;
      const v = (j / 5) * r.d;
      if (inside({ x: r.cx + ex.x * u + ey.x * v, y: r.cy + ex.y * u + ey.y * v })) n += 1;
    }
  return n * 2 < 25;
};

/** Hai món chồng nhau quá tỉ lệ này của món nhỏ hơn là lỗi. */
const OVERLAP_MAX_FRACTION = 0.3;
/** Dung sai lấn (mm): hộp dò sát tường/cửa thường lấn vài chục mm, chưa phải lỗi. */
const PENETRATION_SLACK_MM = 50;
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
/** Thảm/tấm mỏng hơn mức này (mm) nằm dưới đồ khác: không xét. */
const FLAT_MAX_MM = 50;

const SEAT_HOSTS: ReadonlySet<Furniture['kind']> = new Set(['table', 'kitchenCabinet']);
/** Ghế kê dưới bàn/quầy: chồng hình hợp lệ (bàn ăn có ghế), không phải lỗi. */
export const tuckedSeat = (a: Pick<Furniture, 'kind'>, b: Pick<Furniture, 'kind'>): boolean =>
  (a.kind === 'chair' && SEAT_HOSTS.has(b.kind)) || (b.kind === 'chair' && SEAT_HOSTS.has(a.kind));

/** Vai bám tường: tủ áo, tủ bếp, kệ, tủ thấp — lưng áp tường. */
export const hugsWall = (f: Pick<Furniture, 'kind' | 'variant'>): boolean =>
  f.kind === 'wardrobe' || f.kind === 'kitchenCabinet' || f.variant === 'shelves' || f.variant === 'cabinet';

/** Dãy tủ: hai món cùng góc (sai ≤ 5°, tính theo bội 90°) giao nhau dọc cạnh dài không quá chừng này, mm. */
const RUN_OVERLAP_MM = 150;
const RUN_ALIGN_DEG = 5;
/**
 * Hai món bám tường xếp thành dãy (giao nhau dọc tường ≤ 150 mm): mép hộp dò chờm nhau, không phải chồng đồ. "Dọc
 * tường" = trục riêng của `a` mà hai tâm lệch nhau nhiều hơn (hai tủ đứng cạnh nhau, không cần biết mặt trước).
 */
export const cabinetRun = (
  a: Pick<Furniture, 'kind' | 'variant' | 'centre' | 'boundingBox' | 'rotationDeg'>,
  b: Pick<Furniture, 'kind' | 'variant' | 'centre' | 'boundingBox' | 'rotationDeg'>,
): boolean => {
  if (!hugsWall(a) || !hugsWall(b)) return false;
  const ra = rectOfFurniture(a);
  const rb = rectOfFurniture(b);
  const turn = (((rb.rotationDeg - ra.rotationDeg) % 90) + 90) % 90;
  if (Math.min(turn, 90 - turn) > RUN_ALIGN_DEG) return false;
  const [ex, ey] = axesOf(ra);
  const between = { x: rb.cx - ra.cx, y: rb.cy - ra.cy };
  const axis = Math.abs(dot(between, ex)) >= Math.abs(dot(between, ey)) ? ex : ey;
  const span = (r: Rect): [number, number] => {
    const t = rectCorners(r).map((p) => dot(p, axis));
    return [Math.min(...t), Math.max(...t)];
  };
  const [a0, a1] = span(ra);
  const [b0, b1] = span(rb);
  return Math.min(a1, b1) - Math.max(a0, b0) <= RUN_OVERLAP_MM;
};

/**
 * C7 — lỗi đặt đồ của cả đồ thị (chỉ báo, không dời): nằm ngoài nhà, chồng nhau > 30 % diện tích món nhỏ, chắn
 * vùng mở cửa đi, xuyên tường (dãy tủ chờm nhau ≤ 150 mm dọc tường không tính chồng). Ngoài nhà xét mọi món trừ thang (viền gợi ý, thảm vẫn hiện ngoài nhà); các lỗi còn
 * lại bỏ đồ gợi ý chưa nhận, thang, thảm và ghế kê dưới bàn/quầy.
 */
export const scenePlacementIssues = (graph: SpatialGraph): PlacementIssue[] => {
  const issues: PlacementIssue[] = graph.furniture
    .filter((f) => f.kind !== 'stair' && outsideAllRooms(f, graph.rooms))
    .map((f) => ({ kind: 'outside', furnitureIds: [f.id], message: `${capital(FURNITURE_KIND_LABELS[f.kind])} nằm ngoài nhà` }));
  const items = graph.furniture.filter(
    (f) => f.suggested !== true && f.kind !== 'stair' && !(f.heightMm !== undefined && f.heightMm < FLAT_MAX_MM),
  );
  const levels = new Set(items.map((f) => f.levelId));
  for (const levelId of levels) {
    const onLevel = items.filter((f) => f.levelId === levelId).map((f) => ({ f, r: rectOfFurniture(f) }));
    const swings = doorSwingRects(graph, levelId);
    const walls = wallRects(graph, levelId);
    onLevel.forEach(({ f, r }, i) => {
      for (const { f: g, r: s } of onLevel.slice(i + 1)) {
        if (!rectsOverlap(r, s) || tuckedSeat(f, g) || cabinetRun(f, g)) continue;
        const smaller = Math.min(r.w * r.d, s.w * s.d);
        if (smaller > 0 && overlapAreaMm2(r, s) / smaller > OVERLAP_MAX_FRACTION)
          issues.push({ kind: 'overlap', furnitureIds: [f.id, g.id], message: `${capital(FURNITURE_KIND_LABELS[f.kind])} chồng lên ${FURNITURE_KIND_LABELS[g.kind]}` });
      }
      if (swings.some((sw) => rectsOverlap(r, sw, -PENETRATION_SLACK_MM)))
        issues.push({ kind: 'doorSwing', furnitureIds: [f.id], message: `${capital(FURNITURE_KIND_LABELS[f.kind])} chắn lối mở cửa` });
      if (walls.some((w) => rectsOverlap(r, w, -PENETRATION_SLACK_MM)))
        issues.push({ kind: 'wall', furnitureIds: [f.id], message: `${capital(FURNITURE_KIND_LABELS[f.kind])} lấn vào tường` });
    });
  }
  return issues;
};
