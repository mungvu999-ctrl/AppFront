/**
 * Lõi bố trí lại (vòng 18, làn L1): khi tâm hộp AI không chứa được món cỡ thật, tìm chỗ gần đó — sinh tư thế
 * (lưng áp tường / lưới lệch quanh tâm), kiểm footprint + vùng sử dụng, dời cứng cả cụm, kiểm tiếp cận bằng
 * BFS trên lưới chiếm chỗ. Thuần, tất định, đơn vị m; không đọc thư viện, kho hay DOM.
 * Thiết kế: F:/runs/m18/B-layout/THIET-KE.txt §2–§4.
 *
 * Vùng sử dụng, vùng trước cửa và lối đi ở đây là TIÊU CHÍ BỐ TRÍ của phần mềm, KHÔNG phải quy chuẩn xây dựng.
 * Hình chữ nhật dùng chung kiểu `Rect` của placement.ts (tâm, w × d, rotationDeg; mặt trước = +y riêng), ở đây tính bằng m.
 */

import { outlineContains, signedAreaMm2 } from '@/domain/rooms/area';
import type { Point, Room, SpatialGraph } from '@/domain/spatial/types';
import { toPointMm } from '@/lib/commands/business/shared';

import {
  BED_SIDE_MM,
  CHAIR_CLEAR_MM,
  DOOR_APPROACH_MM,
  OPENING_MARGIN_MM,
  doorSwingRects,
  furnitureFacingDeg,
  overlapAreaMm2,
  rectInsidePolygon,
  rectsOverlap,
  roomEdges,
  wallRects,
  type Rect,
} from './placement';

const MM_PER_M = 1000;
/** Số mẫu và số tư thế mỗi mẫu tối đa được thử cho một món. */
export const K_MODELS = 6;
export const K_POSES = 48;
/** Số lần BFS tiếp cận tối đa cho một món. */
export const MAX_BFS = 8;
/**
 * LD: cửa rộng hơn mức này (m) — cửa đi đôi, cửa lùa ra lô gia — chỉ cần MỘT dải lối (rộng mức này + lề mỗi bên,
 * sâu như vùng trước cửa) ở đầu trái / giữa / đầu phải còn trống, không phải cả bề rộng × DOOR_APPROACH. Cửa đơn
 * (≤ 0,95 m trong dữ liệu) không đổi.
 */
const DOOR_PASS_M = 1.0;
/** Dời tâm xa nhất (m) — cùng mức sceneRepair MAX_SHIFT_MM 1500. */
export const MAX_SHIFT_M = 1.5;
const STEP_M = 0.1;
/** Bán kính lưới lệch cho món không tựa tường. */
const OFFSET_RADIUS_M = 0.6;
/** Bước lưới lệch của món KHÔNG tựa tường (M19): 0,20 m — xem `posesOf`. */
const FREE_STEP_M = 0.2;
/** Footprint lùi khỏi outline. */
const INSET_M = 0.05;
/** Khe giữa lưng món và mặt tường. */
const WALL_GAP_M = 0.01;
/** Ô lưới tự do khi cách mọi footprint/thân tường ≥ mức này (lối ≥ 0,60 m). */
const BODY_CLEAR_M = 0.3;
/** Phòng lớn hơn mức này dùng ô 0,15 m. */
const COARSE_GRID_M2 = 80;
const FINE_CELL_M = 0.1;
const COARSE_CELL_M = 0.15;
/** LF1: trần số ô lưới lối đi — vượt thì nở cỡ ô (hộp bao ≤ 400 m² ở ô 0,10 m / ≤ 900 m² ở 0,15 m không đổi). */
export const MAX_GRID_CELLS = 40_000;
/** LF1: trần số món `layoutIssuesOf` xét (đầu danh sách theo id) — cặp chồng ≤ C(64, 2). */
export const MAX_ISSUE_PIECES = 64;
/** Chồng dưới mức này (m²) coi như chạm mép. */
const MIN_ISSUE_M2 = 0.001;
/** Chi phí: dời 1 m, xoay 90°, xoay 180°, mỗi quan hệ cụm gãy, mỗi m² vùng soft bị lấn. */
const SHIFT_COST = 1;
const TURN_90_COST = 0.4;
const TURN_180_COST = 0.25;
const BROKEN_COST = 0.5;
const SOFT_COST_PER_M2 = 4;
/** Dời dưới mức này (m) và xoay dưới 1° coi như không dời. */
const STILL_M = 0.005;

const BED_SIDE_M = BED_SIDE_MM / MM_PER_M;
const CHAIR_CLEAR_M = CHAIR_CLEAR_MM / MM_PER_M;
/** Cạnh giường thoải mái (soft). */
const BED_COMFORT_M = 0.6;
/** Vùng cạnh giường bỏ phần đầu giường dài chừng này: tủ đầu giường đứng đó. */
const BED_HEAD_M = 0.5;

export type Dims = readonly [w: number, h: number, d: number];
export interface Span {
  readonly from: number;
  readonly to: number;
}
export interface LayoutEdge {
  readonly a: Point;
  readonly b: Point;
  readonly lengthM: number;
  readonly inward: Point;
  /** Nửa dày tường lớn nhất trên cạnh (0 = không tường). */
  readonly wallHalfM: number;
  /** Đoạn dọc cạnh (m tính từ `a`) có tường thật phía sau. */
  readonly walled: readonly Span[];
  /** Cửa đi + cửa sổ dọc cạnh (m tính từ `a`). */
  readonly openings: readonly Span[];
}
export interface LayoutDoor {
  /** Tâm cửa trên đường cạnh phòng. */
  readonly at: Point;
  readonly inward: Point;
  readonly widthM: number;
  readonly wallHalfM: number;
}
/** 'approach' = vùng đứng trước cửa: footprint không được chiếm, vùng sử dụng được chồng. */
export type BlockOrigin = 'wall' | 'swing' | 'approach' | 'fixed' | 'set';
export interface Block extends Rect {
  readonly id?: string;
  readonly origin: BlockOrigin;
}
export interface LayoutRoom {
  readonly id: string;
  readonly outline: readonly Point[];
  readonly edges: readonly LayoutEdge[];
  readonly doors: readonly LayoutDoor[];
  /** Tường + vùng mở cửa (+ đồ cố định nếu bên gọi muốn gắn sẵn vào phòng). */
  readonly blocks: readonly Block[];
}
export interface Piece {
  readonly id: string;
  /** Vai (FurnitureRole của sceneVariety; để string cho lõi không phụ thuộc vòng import). */
  readonly role: string;
  /** Cỡ thật của mẫu [rộng, cao, sâu] (m). */
  readonly dims: Dims;
  /** Hộp gốc đã lưu (m) — đầu vào luôn là hộp lưu, không bao giờ là vị trí dẫn xuất. */
  readonly box: Rect;
  readonly wallBack: boolean;
  /** = !fixed && sizeFrom !== 'user' && pinTo === undefined (bên gọi tính). */
  readonly movable: boolean;
  readonly cluster?: string;
  /** Tủ cửa lùa (bên gọi đặt từ dữ liệu mẫu, không suy từ tên): vùng trước 0,55 m thay 0,70 m. */
  readonly sliding?: boolean;
}
export interface Pose {
  readonly cx: number;
  readonly cy: number;
  readonly rot: number;
  readonly shiftM: number;
  /** Góc lệch so với hộp gốc, 0–180. */
  readonly turnDeg: number;
  /** Chỉ số cạnh và vị trí dọc cạnh (m) khi lưng áp tường. */
  readonly edge?: number;
  readonly t?: number;
}
export interface Tried {
  readonly models: number;
  readonly poses: number;
  readonly bfs: number;
}
export interface MemberPose {
  readonly id: string;
  readonly pose: Pose;
}
export interface LayoutMove {
  readonly id: string;
  readonly modelId: string;
  readonly from: Rect;
  readonly to: Pose;
  /** Thành viên cụm đã đặt theo (kể cả món đứng yên); `broken` = thành viên không đi theo được. */
  readonly members: readonly MemberPose[];
  readonly cluster: readonly string[];
  readonly broken: readonly string[];
  readonly why: string;
  readonly tried: Tried;
}
export type IssueKind = 'overlap' | 'use' | 'access' | 'wall' | 'swing';
export interface LayoutIssue {
  readonly kind: IssueKind;
  readonly id: string;
  readonly with?: string;
  readonly m2?: number;
  readonly origin: 'data' | 'rule';
}
export interface Grid {
  readonly x0: number;
  readonly y0: number;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  /** 1 = ô tự do (tâm trong outline, cách footprint ≥ 0,30 m). */
  readonly free: Uint8Array;
}

export type Side = 'front' | 'back' | 'left' | 'right';
/** Một vùng sử dụng: đạt khi MỘT trong các `sides` trống; `need` = cứng (thiếu → loại), còn lại phạt theo m² bị lấn. */
export interface UseSpec {
  readonly sides: readonly Side[];
  readonly depthM: number;
  readonly need: boolean;
  /** Vùng cạnh trái/phải bỏ phần sát lưng dài chừng này (chỗ tủ đầu giường). */
  readonly skipBackM?: number;
}

/**
 * Vùng sử dụng theo vai — TIÊU CHÍ BỐ TRÍ, không phải quy chuẩn xây dựng. Khung riêng: trước = +y, lưng = −y.
 * Số gốc dùng chung với sceneFurnish (BED_SIDE_MM, CHAIR_CLEAR_MM qua placement.ts).
 */
export const USE_ZONES: Readonly<Record<string, readonly UseSpec[]>> = {
  doubleBed: [
    { sides: ['left'], depthM: BED_SIDE_M, need: true, skipBackM: BED_HEAD_M },
    { sides: ['right'], depthM: BED_SIDE_M, need: true, skipBackM: BED_HEAD_M },
    { sides: ['left'], depthM: BED_COMFORT_M, need: false, skipBackM: BED_HEAD_M },
    { sides: ['right'], depthM: BED_COMFORT_M, need: false, skipBackM: BED_HEAD_M },
    { sides: ['front'], depthM: 0.5, need: false },
  ],
  // Giường đơn: một cạnh dài được áp tường, cạnh kia phải trống.
  singleBed: [
    { sides: ['left', 'right'], depthM: BED_COMFORT_M, need: true, skipBackM: BED_HEAD_M },
    { sides: ['front'], depthM: 0.4, need: false },
  ],
  nightstand: [{ sides: ['front'], depthM: 0.3, need: false }],
  // Tủ cửa lùa (Piece.sliding): 0,55 m — specsOf thay.
  closet: [{ sides: ['front'], depthM: 0.7, need: true }],
  dresser: [{ sides: ['front'], depthM: 0.7, need: true }],
  cabinet: [{ sides: ['front'], depthM: 0.5, need: true }],
  bookshelf: [{ sides: ['front'], depthM: 0.5, need: true }],
  desk: [{ sides: ['front'], depthM: 0.75, need: true }],
  // Bàn ăn trong searchPlacement/checkPose: specsOf tính theo cạnh có ghế thật (không ghế → một cạnh dài).
  // Bảng này chỉ còn cho layoutIssuesOf (không biết ghế): một cạnh bất kỳ — lỏng hơn, không sinh lỗi 'rule' giả.
  diningTable: [
    { sides: ['front', 'back', 'left', 'right'], depthM: CHAIR_CLEAR_M, need: true },
    { sides: ['front'], depthM: CHAIR_CLEAR_M, need: false },
    { sides: ['back'], depthM: CHAIR_CLEAR_M, need: false },
  ],
  diningChair: [{ sides: ['back'], depthM: 0.45, need: false }],
  sofa: [{ sides: ['front'], depthM: 0.45, need: true }],
  armchair: [{ sides: ['front'], depthM: 0.45, need: true }],
};

/** Món chính: phải có lối từ cửa tới vùng need (tư thế không tới được bị loại). */
const MAIN_ROLES: ReadonlySet<string> = new Set(['doubleBed', 'singleBed', 'closet', 'desk', 'sofa', 'diningTable']);
/** Ghế kê dưới bàn không tính chồng (như tuckedSeat của placement.ts, theo vai). */
const SEAT_ROLES: ReadonlySet<string> = new Set(['diningChair']);
const TABLE_ROLES: ReadonlySet<string> = new Set(['diningTable', 'desk']);
/** Món phụ: kiểm lối tới bằng BFS nhưng chỉ PHẠT ACCESS_COST, không loại (lượt 1). */
const SECONDARY_ROLES: ReadonlySet<string> = new Set(['nightstand', 'bookshelf', 'coffeeTable', 'armchair']);
/** Lớn hơn chi phí dời xa nhất (1,5 m) → trong số tư thế đã BFS, tư thế tới được luôn thắng. */
// ACCESS_COST = 2 > chi phí dời tối đa lượt 1 (1,5 m + xoay 0,4) → tư thế có lối luôn thắng tư thế không lối. Lượt 2 (`far`,
// dời xa hơn MAX_SHIFT_M) không dùng phạt này: lối từ cửa là bắt buộc với mọi vai, nên giả định 1,5 m không bị phá.
const ACCESS_COST = 2;
/** Chỗ người đứng dùng món phụ (đích BFS). */
const SECONDARY_REACH_M = 0.6;
const BED_ROLES: ReadonlySet<string> = new Set(['doubleBed', 'singleBed']);
/** Khe tủ đầu giường – cạnh giường khi xếp lại (≤ 0,15 m). */
const NIGHT_GAPS_M = [0.01, 0.05, 0.1, 0.15] as const;
const NIGHT_GAP_MAX_M = 0.15;
const SLIDING_FRONT_M = 0.55;

const ROLE_VI: Readonly<Record<string, string>> = {
  doubleBed: 'giường đôi',
  singleBed: 'giường đơn',
  nightstand: 'tủ đầu giường',
  closet: 'tủ áo',
  dresser: 'tủ ngăn kéo',
  cabinet: 'tủ',
  bookshelf: 'kệ sách',
  desk: 'bàn làm việc',
  diningTable: 'bàn ăn',
  diningChair: 'ghế ăn',
  sofa: 'sofa',
  armchair: 'ghế bành',
  coffeeTable: 'bàn trà',
};
const ORIGIN_VI: Readonly<Record<BlockOrigin, string>> = {
  wall: 'tường',
  swing: 'vùng mở cửa',
  approach: 'vùng trước cửa',
  fixed: 'đồ cố định',
  set: 'đồ đã đặt',
};
const SIDE_VI: Readonly<Record<Side, string>> = { front: 'trước', back: 'sau', left: 'trái', right: 'phải' };

const mm = (v: number): number => Math.round(v * MM_PER_M);
const roundMm = (v: number): number => mm(v) / MM_PER_M;
const vi = (v: number): string => v.toFixed(2).replace('.', ',');
const normDeg = (deg: number): number => {
  const r = ((Math.round(deg * 100) / 100) % 360 + 360) % 360;
  return r === 360 || Object.is(r, -0) ? 0 : r;
};
const turnOf = (rot: number, base: number): number => Math.abs((((rot - base) % 360) + 540) % 360 - 180);
const toLocal = (p: Point, r: Rect): Point => {
  const t = (r.rotationDeg * Math.PI) / 180;
  const dx = p.x - r.cx;
  const dy = p.y - r.cy;
  return { x: dx * Math.cos(t) + dy * Math.sin(t), y: -dx * Math.sin(t) + dy * Math.cos(t) };
};
const distToRect = (p: Point, r: Rect): number => {
  const l = toLocal(p, r);
  return Math.hypot(Math.max(Math.abs(l.x) - r.w / 2, 0), Math.max(Math.abs(l.y) - r.d / 2, 0));
};
const pointInRect = (p: Point, r: Rect): boolean => {
  const l = toLocal(p, r);
  return Math.abs(l.x) < r.w / 2 && Math.abs(l.y) < r.d / 2;
};
const inOutline = (p: Point, outline: readonly Point[]): boolean => outlineContains(outline.map(toPointMm), toPointMm(p));
/** rectInsidePolygon tính bằng mm (nó trừ 0,02 đơn vị khi nở hình) → đổi sang mm trước khi gọi. */
const insideM = (r: Rect, outline: readonly Point[], insetM: number): boolean =>
  rectInsidePolygon(
    { cx: r.cx * MM_PER_M, cy: r.cy * MM_PER_M, w: r.w * MM_PER_M, d: r.d * MM_PER_M, rotationDeg: r.rotationDeg },
    outline.map((p) => ({ x: p.x * MM_PER_M, y: p.y * MM_PER_M })),
    insetM * MM_PER_M,
  );
const areaOf = (outline: readonly Point[]): number => Math.abs(signedAreaMm2(outline.map(toPointMm)));

export const footprintOf = (dims: Dims, pose: Pick<Pose, 'cx' | 'cy' | 'rot'>): Rect => ({
  cx: pose.cx,
  cy: pose.cy,
  w: dims[0],
  d: dims[2],
  rotationDeg: pose.rot,
});

/** Vùng sử dụng phía `side` của footprint, sâu `depthM`; cạnh trái/phải bỏ `skipBackM` sát lưng. */
export const zoneRect = (f: Rect, side: Side, depthM: number, skipBackM = 0): Rect => {
  const skip = Math.min(skipBackM, f.d / 2);
  const [ox, oy, w, d] =
    side === 'front'
      ? [0, (f.d + depthM) / 2, f.w, depthM]
      : side === 'back'
        ? [0, -(f.d + depthM) / 2, f.w, depthM]
        : side === 'left'
          ? [-(f.w + depthM) / 2, skip / 2, depthM, f.d - skip]
          : [(f.w + depthM) / 2, skip / 2, depthM, f.d - skip];
  const t = (f.rotationDeg * Math.PI) / 180;
  return {
    cx: f.cx + ox * Math.cos(t) - oy * Math.sin(t),
    cy: f.cy + ox * Math.sin(t) + oy * Math.cos(t),
    w,
    d,
    rotationDeg: f.rotationDeg,
  };
};

/** Vùng đứng trước cửa phía trong phòng: rộng cửa + OPENING_MARGIN mỗi bên, sâu DOOR_APPROACH từ mặt tường (như sceneFurnish). */
export const doorApproachRect = (door: LayoutDoor): Block => {
  const depth = DOOR_APPROACH_MM / MM_PER_M;
  const off = door.wallHalfM + depth / 2;
  return {
    cx: door.at.x + door.inward.x * off,
    cy: door.at.y + door.inward.y * off,
    w: door.widthM + (2 * OPENING_MARGIN_MM) / MM_PER_M,
    d: depth,
    rotationDeg: (Math.atan2(door.inward.x, -door.inward.y) * 180) / Math.PI,
    origin: 'approach',
  };
};

const wideDoor = (door: LayoutDoor): boolean => door.widthM > DOOR_PASS_M + 1e-9;
/** Dải lối của cửa rộng: rộng DOOR_PASS_M + lề mỗi bên, sâu như vùng trước cửa, ở đầu trái / giữa / đầu phải vùng. */
const passSlotsOf = (door: LayoutDoor): Block[] => {
  const a = doorApproachRect(door);
  const w = DOOR_PASS_M + (2 * OPENING_MARGIN_MM) / MM_PER_M;
  const t = (a.rotationDeg * Math.PI) / 180;
  const off = (a.w - w) / 2;
  return [-off, 0, off].map((s) => ({ ...a, cx: a.cx + s * Math.cos(t), cy: a.cy + s * Math.sin(t), w }));
};
/**
 * Vùng trước cửa còn chặn với các footprint `feet` và tường `walls`: cửa thường luôn chặn; cửa rộng khi không còn dải lối nào
 * trống. F9: tường (vật cản kết cấu) cũng che dải — so với dải bỏ lề (đúng DOOR_PASS_M, nằm trọn trong bề rộng cửa) để tường
 * vuông góc ở mép cửa không tính là che.
 */
const approachShut = (door: LayoutDoor, feet: readonly Rect[], walls: readonly Rect[] = []): boolean =>
  !wideDoor(door) ||
  !passSlotsOf(door).some((s) => !feet.some((f) => rectsOverlap(s, f)) && !walls.some((w) => rectsOverlap({ ...s, w: DOOR_PASS_M }, w)));
/**
 * Ô gieo BFS của cửa (F9): dải ngay trong ô cửa, rộng bằng cửa, sâu tới hết hàng ô tự do đầu tiên (BODY_CLEAR_M + một ô) tính từ
 * mặt tường — không gieo cả vùng trước cửa 0,9 m, vốn có thể chứa ô nằm sau một tường trong mà từ ô cửa không tới được.
 */
const doorSeedsOf = (doors: readonly LayoutDoor[], cell: number): Rect[] =>
  doors.map((door) => {
    const a = doorApproachRect(door);
    const depth = BODY_CLEAR_M + cell + 1e-6;
    const off = door.wallHalfM + depth / 2;
    return { cx: door.at.x + door.inward.x * off, cy: door.at.y + door.inward.y * off, w: door.widthM, d: depth, rotationDeg: a.rotationDeg };
  });
/** Vật chặn cố định: khối phòng + vùng trước cửa thường + đồ đã đặt. Vùng trước cửa rộng: checkPoseWith xét riêng. */
const blockersOf = (room: LayoutRoom, placed: readonly Block[]): Block[] => [
  ...room.blocks,
  ...room.doors.filter((d) => !wideDoor(d)).map(doorApproachRect),
  ...placed,
];

/** Đoạn có tường trừ ô mở ± OPENING_MARGIN. */
const freeSpans = (e: LayoutEdge): Span[] => {
  const margin = OPENING_MARGIN_MM / MM_PER_M;
  let spans: Span[] = e.walled.map((s) => ({ ...s }));
  for (const o of e.openings) {
    spans = spans.flatMap((s) => {
      const lo = o.from - margin;
      const hi = o.to + margin;
      if (hi <= s.from || lo >= s.to) return [s];
      return [
        ...(lo > s.from ? [{ from: s.from, to: lo }] : []),
        ...(hi < s.to ? [{ from: hi, to: s.to }] : []),
      ];
    });
  }
  return spans;
};

const poseCost = (p: Pose): number =>
  SHIFT_COST * p.shiftM + (p.turnDeg > 45 && p.turnDeg < 135 ? TURN_90_COST : 0) + (p.turnDeg >= 135 ? TURN_180_COST : 0);
/** Thứ tự tất định không phụ thuộc thứ tự cạnh/khối: chi phí rồi toạ độ làm tròn mm. */
const comparePose = (p: Pose, q: Pose): number =>
  mm(poseCost(p)) - mm(poseCost(q)) || mm(p.cx) - mm(q.cx) || mm(p.cy) - mm(q.cy) || mm(p.rot) - mm(q.rot);

/**
 * Tư thế ứng viên của món (cỡ `piece.dims`), sắp theo chi phí dời, tối đa `limit`.
 * Tựa tường: lưng áp mặt tường mọi cạnh có tường (trừ ô mở), bước 0,10 m + điểm chiếu tâm hộp, dời ≤ 1,5 m.
 * Không tựa tường (hoặc phòng không cạnh nào có tường): lưới lệch bán kính 0,6 m × {rot, rot+90}.
 * Món không movable: chỉ đúng tâm/góc hộp gốc.
 * `far` (M18 LW, lượt 2): mọi cạnh có tường, mỗi đoạn tường tự do ≤ 3 điểm (giữa + hai đầu), KHÔNG trần MAX_SHIFT_M; món
 * không tựa tường không có tư thế lượt 2. Vẫn sắp theo chi phí dời tuyến tính và trần `limit`.
 */
export const posesOf = (piece: Piece, room: LayoutRoom, limit = K_POSES, far = false): Pose[] => {
  const [w, , d] = piece.dims;
  const { box } = piece;
  const byKey = new Map<string, Pose>();
  const add = (x: number, y: number, rotDeg: number, edge?: number, t?: number): void => {
    const cx = roundMm(x);
    const cy = roundMm(y);
    const rot = normDeg(rotDeg);
    const shiftM = roundMm(Math.hypot(cx - box.cx, cy - box.cy));
    if (!far && shiftM > MAX_SHIFT_M + 1e-9) return;
    const key = `${mm(cx)}|${mm(cy)}|${mm(rot)}`;
    if (byKey.has(key)) return;
    const turnDeg = Math.round(turnOf(rot, box.rotationDeg) * 100) / 100;
    byKey.set(key, { cx, cy, rot, shiftM, turnDeg, ...(edge === undefined ? {} : { edge, t: roundMm(t ?? 0) }) });
  };
  if (!piece.movable) {
    add(box.cx, box.cy, box.rotationDeg);
    return [...byKey.values()];
  }
  const walled = room.edges.some((e) => e.walled.length > 0);
  if (far && !(piece.wallBack && walled)) return [];
  if (piece.wallBack && walled) {
    room.edges.forEach((e, i) => {
      if (e.lengthM <= 0) return;
      const dir = { x: (e.b.x - e.a.x) / e.lengthM, y: (e.b.y - e.a.y) / e.lengthM };
      const rot = furnitureFacingDeg(e.inward);
      const off = e.wallHalfM + WALL_GAP_M + d / 2;
      const along = (box.cx - e.a.x) * dir.x + (box.cy - e.a.y) * dir.y;
      const at = (t: number): void =>
        add(e.a.x + dir.x * t + e.inward.x * off, e.a.y + dir.y * t + e.inward.y * off, rot, i, t);
      for (const s of freeSpans(e)) {
        const lo = s.from + w / 2;
        const hi = s.to - w / 2;
        if (hi < lo - 1e-9) continue;
        if (far) {
          for (const t of [lo, (lo + hi) / 2, Math.max(lo, hi)]) at(t);
          continue;
        }
        at(Math.min(hi, Math.max(lo, along)));
        // LF1: chỉ lấy mẫu |t − along| ≤ MAX_SHIFT_M (xa hơn thì dời > MAX_SHIFT_M, `add` vốn loại) — ≤ 34 mẫu mỗi đoạn, tất định.
        const k0 = Math.max(0, Math.floor((along - MAX_SHIFT_M - lo) / STEP_M) - 1);
        const k1 = Math.ceil((along + MAX_SHIFT_M - lo) / STEP_M) + 1;
        for (let k = k0; k <= k1 && lo + k * STEP_M <= hi + 1e-9; k += 1) at(lo + k * STEP_M);
      }
    });
  } else {
    // M19 — bước lưới thưa hơn (0,20 m) để 48 tư thế của `limit` PHỦ HẾT bán kính 0,6 m. Với bước 0,10 m lưới sinh ~226
    // tư thế, sắp theo đoạn dời rồi cắt còn 48 → món không tựa tường thực tế chỉ dời được ~0,25 m, không bao giờ bước ra
    // khỏi món đang đè lên nó (bàn trà dưới sofa, cn17/cn18). Số tư thế được KIỂM không đổi, chỉ trải rộng hơn.
    const n = Math.round(OFFSET_RADIUS_M / FREE_STEP_M);
    for (const rot of [box.rotationDeg, box.rotationDeg + 90]) {
      for (let i = -n; i <= n; i += 1) {
        for (let j = -n; j <= n; j += 1) {
          if (i * i + j * j > n * n) continue;
          add(box.cx + i * FREE_STEP_M, box.cy + j * FREE_STEP_M, rot);
        }
      }
    }
  }
  return [...byKey.values()].sort(comparePose).slice(0, limit);
};

/** m² vùng `z` bị lấn (ngoài outline hoặc dưới vật chặn), lấy mẫu lưới 0,10 m. */
const missingM2 = (z: Rect, outline: readonly Point[], blockers: readonly Rect[]): number => {
  const nx = Math.max(1, Math.round(z.w / STEP_M));
  const ny = Math.max(1, Math.round(z.d / STEP_M));
  const t = (z.rotationDeg * Math.PI) / 180;
  let hit = 0;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const lx = ((i + 0.5) / nx - 0.5) * z.w;
      const ly = ((j + 0.5) / ny - 0.5) * z.d;
      const p = { x: z.cx + lx * Math.cos(t) - ly * Math.sin(t), y: z.cy + lx * Math.sin(t) + ly * Math.cos(t) };
      if (!inOutline(p, outline) || blockers.some((b) => pointInRect(p, b))) hit += 1;
    }
  }
  return (z.w * z.d * hit) / (nx * ny);
};

/** `relaxed` (chỉ ở lượt `relax`): lý do các vùng `need` bị thiếu mà tư thế vẫn được nhận. */
export type PoseCheck =
  | { readonly ok: true; readonly softM2: number; readonly relaxed?: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Kiểm một tư thế: footprint trong outline (lùi 0,05), không chồng tường / vùng mở / vùng trước cửa / đồ cố định /
 * đồ đã đặt; mỗi vùng `need` trong outline và không chồng footprint, tường, vùng mở (được chồng vùng trước cửa và
 * vùng sử dụng khác — vùng không phải vật chặn). Vùng soft bị lấn → `softM2`.
 */
export const checkPose = (piece: Piece, pose: Pose, room: LayoutRoom, placed: readonly Block[]): PoseCheck =>
  checkPoseWith(piece, pose, room, placed, specsOf(piece, []), new Set());

/** Bên của `p` so với hộp `r` (khung riêng của r): cạnh nào gần hơn theo tỉ lệ nửa cạnh. */
const sideOf = (p: Point, r: Rect): Side => {
  const l = toLocal(p, r);
  if (Math.abs(l.x) / Math.max(r.w, 1e-6) > Math.abs(l.y) / Math.max(r.d, 1e-6)) return l.x < 0 ? 'left' : 'right';
  return l.y < 0 ? 'back' : 'front';
};

/**
 * Vùng sử dụng của món: tủ cửa lùa → trước 0,55 m; bàn ăn → mỗi cạnh có ghế (thành viên ghế, theo hộp gốc) cần
 * 0,60 m, không ghế → một cạnh dài cần 0,60 m; còn lại USE_ZONES theo vai.
 */
const specsOf = (piece: Piece, members: readonly Piece[]): readonly UseSpec[] => {
  if (piece.role === 'closet' && piece.sliding === true) return [{ sides: ['front'], depthM: SLIDING_FRONT_M, need: true }];
  if (piece.role !== 'diningTable') return USE_ZONES[piece.role] ?? [];
  const seated = new Set(
    members.filter((m) => SEAT_ROLES.has(m.role)).map((m) => sideOf({ x: m.box.cx, y: m.box.cy }, piece.box)),
  );
  if (seated.size > 0) {
    return (['front', 'back', 'left', 'right'] as const)
      .filter((s) => seated.has(s))
      .map((s) => ({ sides: [s], depthM: CHAIR_CLEAR_M, need: true }));
  }
  const long: readonly Side[] = piece.dims[0] >= piece.dims[2] ? ['front', 'back'] : ['left', 'right'];
  return [{ sides: long, depthM: CHAIR_CLEAR_M, need: true }];
};

/**
 * checkPose với vùng sử dụng cho sẵn; khối có id trong `ignore` (ghế kê dưới bàn của chính cụm) không tính.
 * FA: `relax` — vùng sử dụng (kể cả `need`) là ràng buộc MỀM: tư thế thiếu khoảng vẫn được nhận, lý do trả về
 * trong `relaxed` (ràng buộc CỨNG — outline, tường, cánh cửa, dải lối cửa, đồ cố định/đã đặt — không đổi).
 */
const checkPoseWith = (
  piece: Piece,
  pose: Pose,
  room: LayoutRoom,
  placed: readonly Block[],
  specs: readonly UseSpec[],
  ignore: ReadonlySet<string>,
  relax = false,
): PoseCheck => {
  const foot = footprintOf(piece.dims, pose);
  if (!insideM(foot, room.outline, INSET_M)) return { ok: false, reason: 'ra ngoài phòng' };
  const blockers = blockersOf(room, placed).filter((b) => b.id !== piece.id && (b.id === undefined || !ignore.has(b.id)));
  const hit = blockers.find((b) => rectsOverlap(foot, b));
  if (hit !== undefined) return { ok: false, reason: `chạm ${ORIGIN_VI[hit.origin]}` };
  // LD: cửa rộng — chặn khi footprint chạm vùng trước cửa VÀ cùng đồ đã đặt che hết mọi dải lối.
  const feet = blockers.filter((b) => b.origin === 'fixed' || b.origin === 'set');
  const walls = blockers.filter((b) => b.origin === 'wall');
  if (room.doors.some((d) => wideDoor(d) && rectsOverlap(foot, doorApproachRect(d)) && approachShut(d, [...feet, foot], walls))) {
    return { ok: false, reason: `chạm ${ORIGIN_VI.approach}` };
  }
  const zoneBlockers = blockers.filter((b) => b.origin !== 'approach');
  let softM2 = 0;
  const relaxed: string[] = [];
  for (const spec of specs) {
    const zones = spec.sides.map((s) => zoneRect(foot, s, spec.depthM, spec.skipBackM));
    if (spec.need) {
      const clear = zones.some((z) => insideM(z, room.outline, 0) && !zoneBlockers.some((b) => rectsOverlap(z, b)));
      if (clear) continue;
      const sides = spec.sides.map((s) => SIDE_VI[s]).join('/');
      const why = `thiếu khoảng sử dụng ${vi(spec.depthM)} m phía ${sides}`;
      if (!relax) return { ok: false, reason: why };
      relaxed.push(why);
    }
    softM2 += Math.min(...zones.map((z) => missingM2(z, room.outline, zoneBlockers)));
  }
  return relaxed.length > 0 ? { ok: true, softM2, relaxed } : { ok: true, softM2 };
};

export interface ClusterFit {
  readonly members: readonly MemberPose[];
  /** Thành viên không đi theo neo (không movable, hoặc chỗ dời theo bị chặn nên đứng yên). */
  readonly broken: readonly string[];
}

/**
 * Dời cứng cả cụm theo neo: một Δ + một góc (quay quanh tâm hộp neo rồi tịnh tiến tới tâm tư thế neo).
 * Thành viên không movable đứng yên; thành viên movable bị chặn ở chỗ mới thì thử đứng yên. Chỗ nào cũng không vừa → null.
 * `placed` phải đã gồm footprint neo ở tư thế mới (searchPlacement lo việc này).
 */
const NO_IGNORE: ReadonlySet<string> = new Set();
export const placeCluster = (
  room: LayoutRoom,
  anchor: Piece,
  pose: Pose,
  members: readonly Piece[],
  placed: readonly Block[],
): ClusterFit | null => {
  const dRot = pose.rot - anchor.box.rotationDeg;
  const t = (dRot * Math.PI) / 180;
  const moved = pose.shiftM > STILL_M || pose.turnDeg >= 1;
  // Neo cỡ thật khác hộp gốc (giường mẫu to hơn hộp AI) cũng coi như đổi: tủ đầu giường phải xếp lại.
  const changed =
    moved || Math.abs(anchor.dims[0] - anchor.box.w) > STILL_M || Math.abs(anchor.dims[2] - anchor.box.d) > STILL_M;
  const anchorFoot = footprintOf(anchor.dims, pose);
  const bed = BED_ROLES.has(anchor.role);
  const blocks: Block[] = [...placed];
  const out: MemberPose[] = [];
  const broken: string[] = [];
  const pc = Math.cos((pose.rot * Math.PI) / 180);
  const ps = Math.sin((pose.rot * Math.PI) / 180);
  /** Tư thế thành viên tại toạ độ (lx, ly) trong khung riêng của neo ở tư thế mới. */
  const poseAt = (m: Piece, lx: number, ly: number): Pose => {
    const cx = roundMm(pose.cx + lx * pc - ly * ps);
    const cy = roundMm(pose.cy + lx * ps + ly * pc);
    return {
      cx,
      cy,
      rot: normDeg(m.box.rotationDeg + dRot),
      shiftM: roundMm(Math.hypot(cx - m.box.cx, cy - m.box.cy)),
      turnDeg: Math.round(turnOf(m.box.rotationDeg + dRot, m.box.rotationDeg) * 100) / 100,
    };
  };
  for (const m of [...members].sort((a, b) => a.id.localeCompare(b.id))) {
    const stay: Pose = { cx: m.box.cx, cy: m.box.cy, rot: normDeg(m.box.rotationDeg), shiftM: 0, turnDeg: 0 };
    const rx = m.box.cx - anchor.box.cx;
    const ry = m.box.cy - anchor.box.cy;
    const cx = roundMm(pose.cx + rx * Math.cos(t) - ry * Math.sin(t));
    const cy = roundMm(pose.cy + rx * Math.sin(t) + ry * Math.cos(t));
    const follow: Pose = {
      cx,
      cy,
      rot: normDeg(m.box.rotationDeg + dRot),
      shiftM: roundMm(Math.hypot(cx - m.box.cx, cy - m.box.cy)),
      turnDeg: Math.round(turnOf(m.box.rotationDeg + dRot, m.box.rotationDeg) * 100) / 100,
    };
    // Nửa cỡ tủ đầu giường theo trục giường; khe cạnh và lệch lưng so với đầu (lưng) giường.
    const rel = ((m.box.rotationDeg - anchor.box.rotationDeg) * Math.PI) / 180;
    const hx = (Math.abs(Math.cos(rel)) * m.dims[0] + Math.abs(Math.sin(rel)) * m.dims[2]) / 2;
    const hy = (Math.abs(Math.sin(rel)) * m.dims[0] + Math.abs(Math.cos(rel)) * m.dims[2]) / 2;
    const besideHead = (p: Pose): boolean => {
      const l = toLocal({ x: p.cx, y: p.cy }, anchorFoot);
      const gap = Math.abs(l.x) - anchorFoot.w / 2 - hx;
      return gap >= -0.002 && gap <= NIGHT_GAP_MAX_M + 1e-6 && Math.abs(l.y - hy + anchorFoot.d / 2) <= NIGHT_GAP_MAX_M + 1e-6;
    };
    const night = bed && m.role === 'nightstand';
    const tuck = tucked(m.role, anchor.role) ? new Set([anchor.id]) : new Set<string>();
    // LF6 (cn22: bàn xoay 180°, ghế đứng yên vẫn được miễn "kê dưới bàn" → chồng thân bàn): thành viên KHÔNG đi theo neo
    // đã dời/xoay mất quan hệ kê dưới — kiểm chồng neo như mọi món; chồng thì tư thế neo bị bỏ (null).
    const ok = (p: Pose): boolean => checkPoseWith(m, p, room, blocks, specsOf(m, []), p === stay && moved ? NO_IGNORE : tuck).ok;
    let fit: Pose | undefined;
    // Món đã xác nhận đứng yên, không kiểm lại (chồng sẵn là lỗi dữ liệu, không chặn cả cụm).
    // F7: …trừ khi neo đã dời/xoay mà đè lên nó — miễn "kê dưới bàn" (seatIds) chỉ đúng khi quan hệ giữ nguyên.
    if (!m.movable) {
      if (moved && rectsOverlap(footprintOf(m.dims, stay), anchorFoot)) return null;
      fit = stay;
    } else if (!night || !changed) fit = [follow, stay].find(ok);
    else {
      // Tủ đầu giường: theo cứng nếu vẫn kề đầu giường; không thì xếp lại sát cạnh dài phía đầu (bên cũ trước,
      // khe 0,01 → 0,15 m), rồi bên kia; hết chỗ mới đứng yên (gãy).
      const own = toLocal({ x: m.box.cx, y: m.box.cy }, anchor.box).x < 0 ? -1 : 1;
      const snaps = [own, -own].flatMap((s) => NIGHT_GAPS_M.map((g) => poseAt(m, s * (anchorFoot.w / 2 + g + hx), hy - anchorFoot.d / 2)));
      fit = [...(besideHead(follow) ? [follow] : []), ...snaps, stay].find(ok);
    }
    if (fit === undefined) return null;
    if (night && changed ? !besideHead(fit) : moved && fit === stay) broken.push(m.id);
    blocks.push({ ...footprintOf(m.dims, fit), id: m.id, origin: 'set' });
    out.push({ id: m.id, pose: fit });
  }
  return { members: out, broken };
};

/** Khoảng chỉ số ô [lo, hi] theo một trục chứa mọi tâm ô cách hình (tâm `c`, nửa bao `half`) ≤ `pad` m — dư 1 ô mỗi phía. */
const cellSpan = (c: number, half: number, pad: number, o: number, cell: number, n: number): readonly [number, number] => [
  Math.max(0, Math.floor((c - half - pad - o) / cell) - 1),
  Math.min(n - 1, Math.ceil((c + half + pad - o) / cell) + 1),
];
/** Nửa cạnh hộp bao trục của hình chữ nhật xoay. */
const halfOf = (r: Rect): readonly [number, number] => {
  const t = (r.rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const sn = Math.abs(Math.sin(t));
  return [(c * r.w + sn * r.d) / 2, (sn * r.w + c * r.d) / 2];
};
/** Ô có tâm trong outline (theo cỡ ô) — dùng lại giữa các lần dựng lưới cùng phòng. */
const INSIDE = new WeakMap<readonly Point[], { readonly cell: number; readonly inside: Uint8Array }>();

/**
 * Lưới chiếm chỗ: ô 0,10 m (phòng > 80 m² → 0,15; số ô > MAX_GRID_CELLS → nở ô) phủ hộp bao outline; tự do khi tâm trong
 * outline và cách mọi footprint ≥ 0,30 m. Mỗi footprint chỉ duyệt ô trong hộp bao đã nở của nó (cùng kết quả như quét
 * cả lưới: cách < 0,30 m ⇒ tâm ô nằm trong hộp bao nở 0,30 m).
 */
export const accessGrid = (room: LayoutRoom, footprints: readonly Rect[]): Grid => {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const spanX = Math.max(...xs) - x0;
  const spanY = Math.max(...ys) - y0;
  const countOf = (c: number): number => Math.max(1, Math.ceil(spanX / c)) * Math.max(1, Math.ceil(spanY / c));
  let cell = areaOf(room.outline) > COARSE_GRID_M2 ? COARSE_CELL_M : FINE_CELL_M;
  if (countOf(cell) > MAX_GRID_CELLS) {
    cell = Math.sqrt((spanX * spanY) / MAX_GRID_CELLS);
    while (countOf(cell) > MAX_GRID_CELLS) cell *= 1.01;
  }
  const nx = Math.max(1, Math.ceil(spanX / cell));
  const ny = Math.max(1, Math.ceil(spanY / cell));
  let hit = INSIDE.get(room.outline);
  if (hit?.cell !== cell) {
    const inside = new Uint8Array(nx * ny);
    const outlineMm = room.outline.map(toPointMm);
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        if (outlineContains(outlineMm, toPointMm({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell }))) inside[j * nx + i] = 1;
      }
    }
    hit = { cell, inside };
    INSIDE.set(room.outline, hit);
  }
  const free = hit.inside.slice();
  for (const f of footprints) {
    const [hx, hy] = halfOf(f);
    const [i0, i1] = cellSpan(f.cx, hx, BODY_CLEAR_M, x0, cell, nx);
    const [j0, j1] = cellSpan(f.cy, hy, BODY_CLEAR_M, y0, cell, ny);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const k = j * nx + i;
        if (free[k] === 1 && distToRect({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell }, f) < BODY_CLEAR_M - 1e-9) free[k] = 0;
      }
    }
  }
  return { x0, y0, cell, nx, ny, free };
};

/**
 * BFS 4 hướng trên ô tự do, nguồn = ô có tâm trong một vùng `sources`. Đạt khi MỖI nhóm `targets` có một hình
 * với tới được (một ô đã tới cách hình ≤ 0,30 m — người đứng mép vùng). Không ô nguồn nào → false.
 */
export const canReach = (grid: Grid, sources: readonly Rect[], targets: readonly (readonly Rect[])[]): boolean => {
  const seen = reachedOf(grid, sources);
  return seen !== null && reachesAll(grid, seen, targets);
};
/** BFS từ `sources`: 1 = ô tới được; `null` = không ô nguồn nào. */
const reachedOf = (grid: Grid, sources: readonly Rect[]): Uint8Array | null => {
  const { x0, y0, cell, nx, ny, free } = grid;
  const centre = (k: number): Point => ({ x: x0 + ((k % nx) + 0.5) * cell, y: y0 + (Math.floor(k / nx) + 0.5) * cell });
  const seen = new Uint8Array(nx * ny);
  const queue = new Int32Array(nx * ny);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < nx * ny; k += 1) {
    if (free[k] === 1 && sources.some((s) => pointInRect(centre(k), s))) {
      seen[k] = 1;
      queue[tail] = k;
      tail += 1;
    }
  }
  if (tail === 0) return null;
  while (head < tail) {
    const k = queue[head] ?? 0;
    head += 1;
    const i = k % nx;
    const next = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k >= nx ? k - nx : -1, k + nx < nx * ny ? k + nx : -1];
    for (const q of next) {
      if (q < 0 || seen[q] === 1 || free[q] !== 1) continue;
      seen[q] = 1;
      queue[tail] = q;
      tail += 1;
    }
  }
  return seen;
};
/** Mỗi nhóm `targets` có một hình mà một ô đã tới cách ≤ 0,30 m — chỉ duyệt ô trong hộp bao đã nở của hình. */
const reachesAll = (grid: Grid, seen: Uint8Array, targets: readonly (readonly Rect[])[]): boolean => {
  const { x0, y0, cell, nx, ny } = grid;
  const near = (z: Rect): boolean => {
    const [hx, hy] = halfOf(z);
    const [i0, i1] = cellSpan(z.cx, hx, BODY_CLEAR_M, x0, cell, nx);
    const [j0, j1] = cellSpan(z.cy, hy, BODY_CLEAR_M, y0, cell, ny);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        if (seen[j * nx + i] === 1 && distToRect({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell }, z) <= BODY_CLEAR_M + 1e-9) return true;
      }
    }
    return false;
  };
  return targets.every((group) => group.some(near));
};

const needGroupsOf = (specs: readonly UseSpec[], foot: Rect): Rect[][] =>
  specs.filter((s) => s.need).map((s) => s.sides.map((side) => zoneRect(foot, side, s.depthM, s.skipBackM)));
/** Đích BFS món phụ: chỗ đứng 0,6 m phía trước (tựa tường) hoặc một phía bất kỳ. */
const reachGroupsOf = (wallBack: boolean, foot: Rect): Rect[][] => [
  (wallBack ? (['front'] as const) : (['front', 'back', 'left', 'right'] as const)).map((s) =>
    zoneRect(foot, s, SECONDARY_REACH_M),
  ),
];

export interface PlacedPiece {
  readonly id: string;
  readonly role: string;
  /** Footprint đứng sàn (m). */
  readonly rect: Rect;
}

const issueKey = (i: Pick<LayoutIssue, 'kind' | 'id' | 'with'>): string => `${i.kind}|${i.id}|${i.with ?? ''}`;
const tucked = (a: string, b: string): boolean =>
  (SEAT_ROLES.has(a) && TABLE_ROLES.has(b)) || (SEAT_ROLES.has(b) && TABLE_ROLES.has(a));
const sumOverlap = (r: Rect, bs: readonly Rect[]): number =>
  bs.reduce((s, b) => s + (rectsOverlap(r, b) ? overlapAreaMm2(r, b) : 0), 0);

/**
 * Lỗi bố trí tính trên hình học (không biết nguồn → origin 'data'; diffIssues gán lại). Thứ tự theo id, tất định.
 * wall: ra ngoài outline hoặc cắt thân tường; swing: chồng vùng mở / vùng trước cửa; overlap: hai footprint chồng
 * (trừ ghế kê dưới bàn) hoặc chồng khối cố định; use: vùng need không đạt; access: món chính không có lối từ cửa.
 */
export const layoutIssuesOf = (room: LayoutRoom, pieces: readonly PlacedPiece[]): LayoutIssue[] => {
  // ponytail: trần MAX_ISSUE_PIECES món đầu theo id (phòng thật ≪ 64); cần sổ đủ cho phòng lớn hơn thì chia ô không gian.
  const sorted = [...pieces].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_ISSUE_PIECES);
  const walls = room.blocks.filter((b) => b.origin === 'wall');
  const solids = room.blocks.filter((b) => b.origin === 'fixed' || b.origin === 'set');
  // LD: vùng trước cửa rộng chỉ tính khi mặt bằng cuối che hết mọi dải lối của cửa (như checkPoseWith).
  const feetAll = [...solids, ...sorted.map((p) => p.rect)];
  const doorZones = [
    ...room.blocks.filter((b) => b.origin === 'swing'),
    ...room.doors.filter((d) => approachShut(d, feetAll, walls)).map(doorApproachRect),
  ];
  const issues: LayoutIssue[] = [];
  const m2 = (v: number): number => Math.round(v * 1000) / 1000;
  const footprints = [...walls, ...solids, ...sorted.map((p) => p.rect)];
  const grid = room.doors.length > 0 && sorted.some((p) => MAIN_ROLES.has(p.role)) ? accessGrid(room, footprints) : null;
  // Một BFS cho cả phòng: nguồn (ô cửa) và lưới như nhau với mọi món.
  const seen = grid === null ? null : reachedOf(grid, doorSeedsOf(room.doors, grid.cell));
  sorted.forEach((p, i) => {
    const wallM2 = sumOverlap(p.rect, walls);
    if (!insideM(p.rect, room.outline, 0) || wallM2 > MIN_ISSUE_M2) issues.push({ kind: 'wall', id: p.id, m2: m2(wallM2), origin: 'data' });
    const swingM2 = sumOverlap(p.rect, doorZones);
    if (swingM2 > MIN_ISSUE_M2) issues.push({ kind: 'swing', id: p.id, m2: m2(swingM2), origin: 'data' });
    for (const s of solids) {
      const a = rectsOverlap(p.rect, s) ? overlapAreaMm2(p.rect, s) : 0;
      if (a > MIN_ISSUE_M2) issues.push({ kind: 'overlap', id: p.id, with: s.id ?? s.origin, m2: m2(a), origin: 'data' });
    }
    for (const q of sorted.slice(i + 1)) {
      if (tucked(p.role, q.role) || !rectsOverlap(p.rect, q.rect)) continue;
      const a = overlapAreaMm2(p.rect, q.rect);
      if (a > MIN_ISSUE_M2) issues.push({ kind: 'overlap', id: p.id, with: q.id, m2: m2(a), origin: 'data' });
    }
    const others = [...walls, ...doorZones.filter((z) => z.origin === 'swing'), ...solids, ...sorted.filter((q) => q.id !== p.id && !tucked(p.role, q.role)).map((q) => q.rect)];
    for (const spec of USE_ZONES[p.role] ?? []) {
      if (!spec.need) continue;
      const clear = spec.sides.some((s) => {
        const z = zoneRect(p.rect, s, spec.depthM, spec.skipBackM);
        return insideM(z, room.outline, 0) && !others.some((b) => rectsOverlap(z, b));
      });
      if (!clear) issues.push({ kind: 'use', id: p.id, with: spec.sides.join('/'), origin: 'data' });
    }
    if (grid !== null && MAIN_ROLES.has(p.role) && (seen === null || !reachesAll(grid, seen, needGroupsOf(USE_ZONES[p.role] ?? [], p.rect)))) {
      issues.push({ kind: 'access', id: p.id, origin: 'data' });
    }
  });
  return issues;
};

/** Lỗi có trong `baseline` (hình học đã lưu) → 'data'; lỗi mới sau khi luật bố trí → 'rule'. Khoá [kind, id, with]. */
export const diffIssues = (baseline: readonly LayoutIssue[], after: readonly LayoutIssue[]): LayoutIssue[] => {
  const known = new Set(baseline.map(issueKey));
  return after.map((i) => ({ ...i, origin: known.has(issueKey(i)) ? 'data' : 'rule' }));
};

export interface Candidate {
  readonly modelId: string;
  /** Cỡ thật [rộng, cao, sâu] (m). */
  readonly dims: Dims;
  /** Chi phí mẫu của bộ chọn (thấp = tốt); thiếu = 0. */
  readonly cost?: number;
}
export interface SearchBudget {
  readonly models?: number;
  readonly poses?: number;
  readonly bfs?: number;
}
export interface SearchOptions {
  /** Thành viên cụm của món (tủ đầu giường, ghế của bàn, bàn trà của sofa). */
  readonly members?: readonly Piece[];
  readonly budget?: SearchBudget;
  /**
   * M18 LW — lượt 2: chỉ gọi khi lượt 1 (dời ≤ MAX_SHIFT_M) không đặt được. Tư thế `posesOf(…, far)` ở mọi tường của phòng;
   * mọi kiểm hợp lệ giữ nguyên, lối từ cửa bắt buộc với MỌI vai (không phạt-mà-nhận như món phụ lượt 1).
   */
  readonly far?: boolean;
  /**
   * M18 FA — lượt cuối trước khi ẩn: vùng sử dụng (USE_ZONES, kể cả `need`) thành ràng buộc MỀM. Tư thế vi phạm mềm ít nhất
   * thắng (hoà → chi phí như cũ, nên chỗ cũ được giữ); ràng buộc CỨNG và lối từ cửa tới MÓN vẫn bắt buộc. `move.why` ghi
   * các vùng thiếu để sổ quyết định và chip giao diện nêu lý do.
   */
  readonly relax?: boolean;
}
export type SearchResult =
  | { readonly pose: Pose; readonly modelId: string; readonly move: LayoutMove; readonly tried: Tried }
  | { readonly unplaced: { readonly reason: string; readonly tried: Tried } };

interface Feasible {
  readonly model: Candidate;
  readonly pose: Pose;
  readonly fit: ClusterFit;
  readonly cost: number;
  /** Vùng sử dụng `need` bị thiếu mà tư thế vẫn được nhận (chỉ lượt `relax`); rỗng ở lượt thường. */
  readonly relaxed: readonly string[];
}

/**
 * Tìm chỗ cho `piece` với tối đa K_MODELS mẫu × K_POSES tư thế (mẫu sắp theo cost rồi modelId — không phụ thuộc
 * thứ tự truyền vào). `placed` = footprint đồ đã chốt khác (không gồm chính món và cụm của nó). Chi phí = cost mẫu +
 * chi phí dời/xoay + 0,5 mỗi quan hệ cụm gãy + 4 × m² vùng soft bị lấn; hoà → modelId rồi toạ độ mm. Món chính: ≤ MAX_BFS
 * tư thế tốt nhất được kiểm lối từ cửa. Không chỗ → `unplaced` với lý do có số thử.
 */
export const searchPlacement = (
  room: LayoutRoom,
  piece: Piece,
  candidates: readonly Candidate[],
  placed: readonly Block[],
  opts: SearchOptions = {},
): SearchResult => {
  const maxModels = opts.budget?.models ?? K_MODELS;
  const maxPoses = opts.budget?.poses ?? K_POSES;
  const maxBfs = opts.budget?.bfs ?? MAX_BFS;
  const members = opts.members ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const fixedMembers = members.filter((m) => !m.movable);
  const movableMembers = members.filter((m) => m.movable);
  const base: Block[] = [
    ...placed.filter((b) => b.id === undefined || (b.id !== piece.id && !memberIds.has(b.id))),
    ...fixedMembers.map((m) => ({ ...m.box, id: m.id, origin: 'fixed' as const })),
  ];
  const models = [...candidates]
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.modelId.localeCompare(b.modelId))
    .slice(0, maxModels);
  let poses = 0;
  let bfs = 0;
  const rejects = new Map<string, number>();
  const feasible: Feasible[] = [];
  // Ghế kê dưới bàn của chính cụm không chặn bàn (cả khi ghế đã xác nhận, nằm trong base).
  const seatIds = new Set(TABLE_ROLES.has(piece.role) ? members.filter((m) => SEAT_ROLES.has(m.role)).map((m) => m.id) : []);
  const specsByModel = new Map<string, readonly UseSpec[]>();
  for (const model of models) {
    const p: Piece = { ...piece, dims: model.dims };
    const specs = specsOf(p, members);
    specsByModel.set(model.modelId, specs);
    for (const pose of posesOf(p, room, maxPoses, opts.far === true)) {
      poses += 1;
      const check = checkPoseWith(p, pose, room, base, specs, seatIds, opts.relax === true);
      if (!check.ok) {
        rejects.set(check.reason, (rejects.get(check.reason) ?? 0) + 1);
        continue;
      }
      const withAnchor = [...base, { ...footprintOf(p.dims, pose), id: piece.id, origin: 'set' as const }];
      const fit = placeCluster(room, p, pose, [...fixedMembers, ...movableMembers], withAnchor);
      if (fit === null) {
        rejects.set('cụm đi kèm không vừa', (rejects.get('cụm đi kèm không vừa') ?? 0) + 1);
        continue;
      }
      const cost = (model.cost ?? 0) + poseCost(pose) + BROKEN_COST * fit.broken.length + SOFT_COST_PER_M2 * check.softM2;
      feasible.push({ model, pose, fit, cost, relaxed: check.relaxed ?? [] });
    }
  }
  // FA: ít vi phạm mềm hơn luôn thắng (ở lượt thường mọi `relaxed` đều rỗng → thứ tự không đổi).
  feasible.sort(
    (a, b) =>
      a.relaxed.length - b.relaxed.length ||
      mm(a.cost) - mm(b.cost) ||
      a.model.modelId.localeCompare(b.model.modelId) ||
      mm(a.pose.cx) - mm(b.pose.cx) ||
      mm(a.pose.cy) - mm(b.pose.cy) ||
      mm(a.pose.rot) - mm(b.pose.rot),
  );
  // M18 FA — lượt nới chỉ nới VÙNG SỬ DỤNG: lối từ cửa vẫn là ràng buộc CỨNG cho mọi vai (cả vai phụ),
  // không thì món phụ được nhận ở chỗ không vào được ("chỉ phạt") — Codex M18-8 P1.
  const hardAccess = MAIN_ROLES.has(piece.role) || opts.far === true || opts.relax === true;
  const needsAccess = (hardAccess || SECONDARY_ROLES.has(piece.role)) && room.doors.length > 0;
  let chosen: Feasible | undefined;
  let unreached = false;
  if (!needsAccess) chosen = feasible[0];
  else {
    const fixedFeet = room.blocks.filter((b) => b.origin === 'wall' || b.origin === 'fixed' || b.origin === 'set');
    const reaches = (f: Feasible): boolean => {
      const foot = footprintOf(f.model.dims, f.pose);
      const memberFeet = f.fit.members.map((mp) => {
        const m = members.find((x) => x.id === mp.id);
        return footprintOf(m?.dims ?? [0, 0, 0], mp.pose);
      });
      const grid = accessGrid(room, [...fixedFeet, ...base.filter((b) => b.origin !== 'approach' && b.origin !== 'swing'), foot, ...memberFeet]);
      // FA: ở lượt `relax` vùng `need` là mềm nên đích BFS là chỗ đứng cạnh MÓN (lối từ cửa tới món vẫn cứng).
      const targets =
        hardAccess && opts.relax !== true ? needGroupsOf(specsByModel.get(f.model.modelId) ?? [], foot) : reachGroupsOf(piece.wallBack, foot);
      return canReach(grid, doorSeedsOf(room.doors, grid.cell), targets);
    };
    // Món phụ: tư thế không tới được chỉ bị cộng ACCESS_COST; dừng khi tư thế sau không thể rẻ hơn tư thế tốt nhất.
    let best: { f: Feasible; cost: number; reach: boolean } | undefined;
    for (const f of feasible) {
      if (bfs >= maxBfs) break;
      if (!hardAccess && best !== undefined && mm(f.cost) >= mm(best.cost)) break;
      bfs += 1;
      const reach = reaches(f);
      if (hardAccess) {
        if (reach) {
          chosen = f;
          break;
        }
        continue;
      }
      const cost = f.cost + (reach ? 0 : ACCESS_COST);
      if (best === undefined || mm(cost) < mm(best.cost)) best = { f, cost, reach };
      if (reach) break;
    }
    // F8: món chính — các tư thế rẻ nhất thường là một chùm gần trùng (cùng mẫu, cùng cạnh, cùng góc, trượt 0,1 m) nên
    // hỏng lối cùng lúc và ăn hết MAX_BFS. Khi cả chùm đó hỏng: kiểm thêm tư thế rẻ nhất của mỗi nhóm (mẫu, cạnh, góc)
    // chưa kiểm, theo thứ tự chi phí, tối đa thêm maxBfs BFS (trần 2 × maxBfs, tất định).
    // ponytail: một đại diện mỗi nhóm — nhóm có đại diện hỏng mà tư thế trượt xa hơn tới được vẫn bị bỏ.
    if (hardAccess && chosen === undefined) {
      const groupOf = (f: Feasible): string => `${f.model.modelId}|${f.pose.edge ?? -1}|${mm(f.pose.rot)}`;
      const seen = new Set(feasible.slice(0, bfs).map(groupOf));
      const limit = bfs + maxBfs;
      for (const f of feasible.slice(bfs)) {
        if (bfs >= limit) break;
        const g = groupOf(f);
        if (seen.has(g)) continue;
        seen.add(g);
        bfs += 1;
        if (reaches(f)) {
          chosen = f;
          break;
        }
      }
    }
    if (!hardAccess) {
      chosen = best?.f ?? feasible[0];
      unreached = best !== undefined && !best.reach;
    }
  }
  const tried: Tried = { models: models.length, poses, bfs };
  if (chosen === undefined) {
    // Có tư thế qua mọi kiểm hình học mà không tư thế nào có lối → lý do là lối đi, không phải lý do loại nhiều nhất.
    const wayless = needsAccess && hardAccess && feasible.length > 0;
    const top = wayless
      ? (['không có lối từ cửa tới khoảng sử dụng', feasible.length] as const)
      : [...rejects.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const head = piece.movable ? 'Không tìm được chỗ' : 'Món đã xác nhận, không tự dời';
    const why = top === undefined ? (models.length === 0 ? 'không có mẫu' : 'không có tư thế') : top[0];
    return { unplaced: { reason: `${head}: ${why} (thử ${models.length} mẫu, ${poses} tư thế)`, tried } };
  }
  const { pose, model, fit, relaxed } = chosen;
  const roleVi = ROLE_VI[piece.role] ?? 'món';
  const turn = pose.turnDeg >= 1 ? `, xoay ${Math.round(pose.turnDeg)}°` : '';
  const act = pose.shiftM > STILL_M || turn !== '' ? `Dời ${vi(pose.shiftM)} m${turn}` : 'Giữ chỗ';
  const cluster = fit.members.length > 0 ? `; cụm: ${fit.members.length} món` : '';
  const broken = fit.broken.length > 0 ? `, ${fit.broken.length} món không đi theo` : '';
  const noWay = unreached ? '; chưa có lối từ cửa tới món (chỉ phạt)' : '';
  // FA: nhận vi phạm mềm thay vì ẩn món — lý do vào sổ quyết định; `layoutIssuesOf` sinh lỗi 'use' tương ứng cho giao diện.
  const soft = relaxed.length > 0 ? `; nhận ${[...new Set(relaxed)].join('; ')}` : '';
  const why = `${act} để ${roleVi} cỡ thật ${vi(model.dims[0])} × ${vi(model.dims[2])} m không cắt tường/đồ khác${cluster}${broken}${noWay}${soft}`;
  const move: LayoutMove = {
    id: piece.id,
    modelId: model.modelId,
    from: piece.box,
    to: pose,
    members: fit.members,
    cluster: fit.members.map((m) => m.id),
    broken: fit.broken,
    why,
    tried,
  };
  return { pose, modelId: model.modelId, move, tried };
};

const metresOf = (p: Point): Point => ({ x: p.x / MM_PER_M, y: p.y / MM_PER_M });
const rectM = (r: Rect): Rect => ({
  cx: r.cx / MM_PER_M,
  cy: r.cy / MM_PER_M,
  w: r.w / MM_PER_M,
  d: r.d / MM_PER_M,
  rotationDeg: r.rotationDeg,
});
/** Khối cách hộp bao phòng quá mức này (m) bị bỏ. */
const NEAR_M = 1;

/**
 * LayoutRoom (m) từ phòng + đồ thị (mm): cạnh (roomEdges), cửa đi trên cạnh phòng, khối tường + vùng mở cửa gần phòng.
 * Đồ cố định/đồ đã đặt bên gọi tự thêm (qua `placed` của searchPlacement hoặc `extra`).
 */
/** Nối các đoạn liền nhau (kẽ ≤ 1 mm) của danh sách đoạn đã sắp. */
const joinSpans = (xs: readonly Span[]): Span[] =>
  [...xs].sort((p, q) => p.from - q.from).reduce<Span[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last !== undefined && s.from <= last.to + 1e-3) acc[acc.length - 1] = { from: last.from, to: Math.max(last.to, s.to) };
    else acc.push({ ...s });
    return acc;
  }, []);
/**
 * LF6: đỉnh thẳng hàng của outline (chỗ vách khác chạm vào tường) chia một bức tường thành hai cạnh → `freeSpans` theo
 * từng cạnh không đủ dài cho đầu giường/tủ dù cả bức tường đủ (nt03t ngủ 3: tường 2,84 m chia 1,22 + 1,62 → giường cỡ
 * thật 0 tư thế). Gộp cạnh liền kề cùng hướng, cùng pháp tuyến trong; nửa dày tường lấy lớn nhất (an toàn).
 */
const mergeCollinear = (edges: readonly LayoutEdge[]): LayoutEdge[] => {
  const same = (p: LayoutEdge, q: LayoutEdge): boolean => {
    if (p.lengthM <= 0 || q.lengthM <= 0) return false;
    const dp = { x: (p.b.x - p.a.x) / p.lengthM, y: (p.b.y - p.a.y) / p.lengthM };
    const dq = { x: (q.b.x - q.a.x) / q.lengthM, y: (q.b.y - q.a.y) / q.lengthM };
    return Math.hypot(p.b.x - q.a.x, p.b.y - q.a.y) < 1e-3 && Math.abs(dp.x * dq.y - dp.y * dq.x) < 1e-3 && dp.x * dq.x + dp.y * dq.y > 0;
  };
  const join = (p: LayoutEdge, q: LayoutEdge): LayoutEdge => {
    const shift = (xs: readonly Span[]): Span[] => xs.map((s) => ({ from: s.from + p.lengthM, to: s.to + p.lengthM }));
    return {
      a: p.a,
      b: q.b,
      lengthM: p.lengthM + q.lengthM,
      inward: p.inward,
      wallHalfM: Math.max(p.wallHalfM, q.wallHalfM),
      walled: joinSpans([...p.walled, ...shift(q.walled)]),
      openings: joinSpans([...p.openings, ...shift(q.openings)]),
    };
  };
  const out: LayoutEdge[] = [];
  for (const e of edges) {
    const last = out[out.length - 1];
    if (last !== undefined && same(last, e)) out[out.length - 1] = join(last, e);
    else out.push(e);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 2 && first !== undefined && last !== undefined && same(last, first)) out.splice(0, 1, join(last, first)), out.pop();
  return out;
};
export const layoutRoomOf = (
  room: Pick<Room, 'id' | 'levelId' | 'outline'>,
  graph: SpatialGraph,
  extra: readonly Block[] = [],
): LayoutRoom => {
  const edgesMm = roomEdges(room, graph);
  const edges: LayoutEdge[] = mergeCollinear(edgesMm.map((e) => ({
    a: metresOf(e.a),
    b: metresOf(e.b),
    lengthM: e.lengthMm / MM_PER_M,
    inward: e.inwardNormal,
    wallHalfM: e.wallHalfMm / MM_PER_M,
    walled: e.walled.map((s) => ({ from: s.fromMm / MM_PER_M, to: s.toMm / MM_PER_M })),
    openings: e.openings.map((s) => ({ from: s.fromMm / MM_PER_M, to: s.toMm / MM_PER_M })),
  })));
  const walls = new Map(graph.walls.filter((w) => w.levelId === room.levelId).map((w) => [w.id, w]));
  /** LD: cửa lùa/cố định của phòng — không cánh quét; vùng 0,6 m cả bề rộng thừa với vùng trước cửa (dải lối) → bỏ. */
  const trackDoors = new Set<string>();
  const doors: LayoutDoor[] = graph.openings.flatMap((o) => {
    const wall = walls.get(o.wallId);
    if (o.kind !== 'door' || wall === undefined) return [];
    const { start, end } = wall.centreline;
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    if (!(len > 0)) return [];
    const t = o.offsetMm + o.widthMm / 2;
    const at = { x: start.x + ((end.x - start.x) * t) / len, y: start.y + ((end.y - start.y) * t) / len };
    let best: { d: number; door: LayoutDoor } | undefined;
    for (const e of edgesMm) {
      const dir = { x: (e.b.x - e.a.x) / e.lengthMm, y: (e.b.y - e.a.y) / e.lengthMm };
      const along = (at.x - e.a.x) * dir.x + (at.y - e.a.y) * dir.y;
      const off = Math.abs((at.x - e.a.x) * dir.y - (at.y - e.a.y) * dir.x);
      if (along < 0 || along > e.lengthMm || off > wall.thicknessMm / 2 + 50) continue;
      if (best !== undefined && best.d <= off) continue;
      best = {
        d: off,
        door: {
          at: metresOf({ x: e.a.x + dir.x * along, y: e.a.y + dir.y * along }),
          inward: e.inwardNormal,
          widthM: o.widthMm / MM_PER_M,
          wallHalfM: e.wallHalfMm / MM_PER_M,
        },
      };
    }
    if (best === undefined) return [];
    if (o.swing === 'sliding' || o.swing === 'fixed') trackDoors.add(o.id);
    return [best.door];
  });
  const xs = room.outline.map((p) => p.x / MM_PER_M);
  const ys = room.outline.map((p) => p.y / MM_PER_M);
  const near = (r: Rect): boolean => {
    const reach = Math.hypot(r.w, r.d) / 2 + NEAR_M;
    return (
      r.cx > Math.min(...xs) - reach &&
      r.cx < Math.max(...xs) + reach &&
      r.cy > Math.min(...ys) - reach &&
      r.cy < Math.max(...ys) + reach
    );
  };
  const blocks: Block[] = [
    ...wallRects(graph, room.levelId).map((r) => ({ ...rectM(r), origin: 'wall' as const })),
    ...doorSwingRects({ ...graph, openings: graph.openings.filter((o) => !trackDoors.has(o.id)) }, room.levelId).map((r) => ({
      ...rectM(r),
      origin: 'swing' as const,
    })),
  ].filter(near);
  return { id: room.id, outline: room.outline.map(metresOf), edges, doors, blocks: [...blocks, ...extra] };
};
