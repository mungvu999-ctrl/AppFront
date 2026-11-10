/**
 * Sửa cảnh cho đồ AI chưa xác nhận (hợp đồng `sceneLayer.ts`): luật chung dời/xoay/ẩn món đặt sai TRONG CẢNH,
 * mỗi lần sửa ghi một `SceneRepair` có lý do. Thuần, tất định, không đổi dữ liệu đã lưu — nơi gọi (cầu nối 3D)
 * chỉ trao đồ thị đã sửa cho `toPascalScene`, kho vẫn giữ bản gốc nên tự lưu ghi đúng dữ liệu gốc.
 *
 * Chỉ đụng món `classOf(f) === 'ai'`, không `suggested`, không thang, không thảm/tấm mỏng (luật 0 thì xét cả gợi ý và
 * thảm: viền/thảm ngoài nhà vẫn hiện trong cảnh). Thứ tự luật cố định:
 *   0. `outside` — món nằm ngoài nhà (`outsideAllRooms`): đặt lại vào phòng cùng tầng có vai hợp lệ gần nhất (chỗ
 *      cách món ≤ 3 m: dịch giữ góc rồi áp tường), không có thì ẩn.
 *   0b. `fit` (vòng 6, `?disable=fit`) — hộp AI theo hồ sơ cỡ vai (`libraryRoles.json` `profiles`): xoay đúng trục +
 *      kẹp cạnh về [p10, p90]; món sai nặng hoặc kẹp sinh lỗi đặt đồ mới thì giữ nguyên.
 *   1. `roomMismatch`  — thiết bị vệ sinh trong phòng ngủ/khách/bếp: dời sát tường phòng tắm/WC cùng tầng gần nhất
 *      còn chỗ (bồn cầu/bồn tắm chỉ sang phòng chưa có món cùng loại), không có thì ẩn.
 *   2. `duplicateFixture` — phòng có ≥ 2 bồn cầu/bồn tắm: giữ một (người xác nhận > lớn hơn), ẩn món AI thừa.
 *   3. `outsideRoom` / `wallOverlap` / `doorSwing` — lòi khỏi outline phòng, lấn tường hoặc chắn vùng mở cửa > 50 mm
 *      (`doorSwing`: vòng 6, `?disable=door`): dịch vào chỗ hợp lệ gần nhất (≤ 1,5 m), không được thì giữ nguyên (lỗi
 *      còn trên chip với lý do "chắn lối mở cửa").
 *   4. `notAgainstWall` — tủ áo/kệ/tủ bếp lưng cách tường > 150 mm: dời áp lưng vào tường gần nhất còn chỗ (≤ 1,5 m).
 *   5. `overlap` — hai món chồng > 30 % món nhỏ: giữ món ưu tiên (người > AI; giường/sofa/tủ > đồ nhỏ; lớn hơn),
 *      món kia dịch; không được thì chỉ ẩn khi nó là món nhỏ/`other` chồng lên đồ chính, còn lại giữ nguyên. Món bám
 *      tường (`hugsWall`) chỉ TRƯỢT DỌC TƯỜNG (trục x riêng, giữ khoảng cách tường), không có chỗ thì giữ nguyên;
 *      dãy tủ chờm nhau ≤ 150 mm dọc tường (`cabinetRun`) không phải chồng.
 *   6. `facing` — bồn cầu đối diện lavabo: xoay 90° món AI nếu chỗ mới hợp lệ.
 * Vị trí mới phải hợp lệ như `sceneFurnish.ts`: trong outline lùi 100 mm, tâm không trong phòng khác, cách đồ khác
 * ≥ 50 mm, không lấn vùng mở cửa, không cắt tường. Bất biến: món bám tường đang bám tường thì mọi lần dời đều giữ
 * lưng cách tường ≤ 150 mm (`backOnWall`). Luật chạy lặp tới điểm dừng (≤ MAX_ROUNDS vòng) nên
 * `repairScene(repairScene(g).graph)` không sửa thêm gì.
 */

import { outlineContains } from '@/domain/rooms/area';
import type { Furniture, FurnitureId, Point, Room, SpatialGraph } from '@/domain/spatial/types';
import { degrees } from '@/domain/units/types';
import { FURNITURE_KIND_LABELS, toPointMm } from '@/lib/commands/business/shared';

import { orientDetectedFurniture } from './orientDetected';
import {
  cabinetRun,
  doorSwingRects,
  hugsWall,
  outsideAllRooms,
  furnitureFacingDeg,
  overlapAreaMm2,
  rectInsidePolygon,
  rectOfFurniture,
  rectsOverlap,
  roomEdges,
  tuckedSeat,
  wallRects,
  type Rect,
} from './placement';
import LIBRARY_ROLES_JSON from './libraryRoles.json' with { type: 'json' };
import { SANITARY_LABELS, sanitaryPlacementIssues, sanitaryRoleOf } from './sanitaryRules';
import { classOf, SCENE_RULES_OFF, type SceneRepair, type SceneRepairAction } from './sceneLayer';
import { roleOf } from './sceneVariety';
import { furnishingUsageOf } from './structureFixes';

/**
 * Hồ sơ cỡ vai (luật `fit`): p10/p50/p90 cạnh dài/ngắn (mm) + trung vị rộng/sâu của mẫu thư viện thuộc vai, đo từ GLB
 * (`libraryRoles.json` `profiles`, nguồn ghi ở `profilesSource`). Vai < 5 mẫu không có hồ sơ → không kẹp.
 */
interface RoleProfile {
  readonly n: number;
  readonly long: readonly [number, number, number];
  readonly short: readonly [number, number, number];
  readonly aspect: number;
}
const PROFILES = (LIBRARY_ROLES_JSON as unknown as { readonly profiles?: Readonly<Record<string, RoleProfile>> }).profiles ?? {};
/** Xoay trục khi vai dài/ngắn rõ (rộng/sâu mẫu lệch ≥ 1,3) mà hộp AI lệch NGƯỢC quá 1,4. */
const AXIS_ROLE_RATIO = 1.3;
const AXIS_BOX_RATIO = 1.4;
/**
 * Dải kẹp = [p10 ÷ 1,25 ; p90 × 1,25]: mẫu thư viện chưa phủ hết cỡ đồ thật (giường 1,6 m, ghế ăn 0,45 m nằm dưới p10
 * của thư viện) — kẹp đúng p10/p90 làm đổi cỡ cả đồ chuẩn. Ngoài 1,25 mới là hộp dò lệch (ghế sâu 0,30 m, tủ sâu 0,36 m).
 */
const BAND_TOL = 1.25;
/** Vai dài tuỳ chỗ (tủ âm tường 2,4 m, sofa góc, bàn họp là thật): cạnh dài không kẹp xuống, chỉ kẹp lên và kẹp sâu. */
const FREE_LONG_ROLES: ReadonlySet<string> = new Set(['closet', 'dresser', 'bookshelf', 'sofa', 'desk', 'diningTable']);
const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const metres = (n: number): string => (n / 1000).toFixed(2).replace('.', ',');

/** Lùi khỏi outline phòng (≈ mặt trong tường), như `sceneFurnish`. */
const INSET_MM = 100;
/** Khe tối thiểu tới đồ khác. */
const GAP_MM = 50;
/** Dung sai lòi/lấn: hộp dò sát tường thường lấn vài chục mm, chưa phải lỗi (cùng mức `scenePlacementIssues`). */
const SLACK_MM = 50;
/** Dịch tối đa khi đưa món về chỗ hợp lệ. */
const MAX_SHIFT_MM = 1500;
/** Bước lưới dò chỗ. */
const STEP_MM = 50;
/** Lưng tủ cách tường quá mức này là "không bám tường". */
const BACK_GAP_MM = 150;
/** Chồng quá tỉ lệ này của món nhỏ là lỗi (cùng mức `scenePlacementIssues`). */
const OVERLAP_MAX_FRACTION = 0.3;
/** Cao dưới mức này (mm) là thảm/tấm mỏng: không sửa, không chắn. */
const FLAT_MAX_MM = 50;
/** Dịch tối đa khi xoay bồn cầu/lavabo đối diện. */
const FACING_SHIFT_MM = 300;
const MAX_ROUNDS = 6;
/** Đặt lại món ngoài nhà: chỗ mới cách món tối đa chừng này; xa hơn là món dò nhầm ngoài bản vẽ nhà (chú thích, khung tên) → ẩn. */
const RELOCATE_MAX_MM = 3000;

/**
 * Chính sách ẩn (cần chủ dự án xác nhận): đồ chính (giường, sofa/ghế dài, bàn lớn, tủ áo, tủ bếp, thang) KHÔNG bao giờ
 * bị ẩn — không có chỗ hợp lệ thì giữ chỗ gốc và để lỗi trên chip. `hidden` chỉ dành cho thiết bị vệ sinh sai phòng
 * không còn chỗ ở WC, bồn cầu/bồn tắm thứ hai, và món nhỏ/`other` chồng lên đồ chính.
 */
const MAIN_KINDS: ReadonlySet<Furniture['kind']> = new Set(['bed', 'wardrobe', 'kitchenCabinet', 'stair']);
/** Bàn có cạnh dài từ mức này (mm) là bàn lớn (bàn ăn); món có cạnh dài dưới MINOR_LONG_MM là món nhỏ. */
const BIG_TABLE_LONG_MM = 1200;
const MINOR_LONG_MM = 900;
const longSideOf = (f: Furniture): number => Math.max(f.boundingBox.max.x - f.boundingBox.min.x, f.boundingBox.max.y - f.boundingBox.min.y);
const isMain = (f: Furniture): boolean =>
  MAIN_KINDS.has(f.kind) ||
  ['sofa', 'bench'].includes(roleOf(f)) ||
  (f.kind === 'table' && longSideOf(f) >= BIG_TABLE_LONG_MM);
const isMinor = (f: Furniture): boolean => !isMain(f) && (f.kind === 'other' || longSideOf(f) < MINOR_LONG_MM);
const MAJOR_ROLES: ReadonlySet<string> = new Set(['singleBed', 'doubleBed', 'sofa', 'closet']);
const BATH_NAME = /\b(wc|toilet|bath)|vệ sinh|tắm/iu;

/** Ghế cách mép bàn tới mức này coi là ghế của bàn (đi theo khi bàn dời). */
const SEAT_REACH_MM = 300;
const isTable = (f: Furniture): boolean => f.kind === 'table' || f.kind === 'kitchenCabinet';
const tucked = tuckedSeat;
const isFlat = (f: Furniture): boolean => f.heightMm !== undefined && f.heightMm < FLAT_MAX_MM;
const repairable = (f: Furniture): boolean =>
  classOf(f) === 'ai' && f.suggested !== true && f.kind !== 'stair' && !isFlat(f);
const isBath = (room: Room): boolean => furnishingUsageOf(room) === 'bathroom' || BATH_NAME.test(room.name);
/** Vai hợp lệ của món trong phòng (luật `outside`): thiết bị vệ sinh vào phòng tắm/WC (lavabo cả bếp), phòng tắm chỉ
 * nhận thêm máy giặt; giường/tủ áo vào phòng ngủ, tủ bếp vào bếp; hành lang/cầu thang không nhận gì; phòng chưa rõ
 * công năng nhận mọi món không phải đồ vệ sinh. */
const SOLE_USAGE: Partial<Record<Furniture['kind'], Room['usage']>> = { bed: 'bedroom', wardrobe: 'bedroom', kitchenCabinet: 'kitchen' };
const fitsRoom = (f: Furniture, room: Room): boolean => {
  const usage = furnishingUsageOf(room);
  if (f.kind === 'sanitaryFixture' || f.kind === 'shower') return isBath(room) || (usage === 'kitchen' && sanitaryRoleOf(f) === 'basin');
  if (isBath(room)) return f.kind === 'washingMachine';
  if (usage === 'corridor' || usage === 'stairwell') return false;
  const sole = SOLE_USAGE[f.kind];
  return sole === undefined || usage === 'other' || usage === sole;
};
/** Khoảng cách từ điểm tới phòng (0 khi điểm trong phòng). */
const distToRoom = (room: Room, p: Point): number => {
  if (containsPoint(room, p)) return 0;
  return Math.min(
    ...room.outline.map((a, i) => {
      const b = room.outline[(i + 1) % room.outline.length] as Point;
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
      return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }),
  );
};

const labelOf = (f: Furniture): string => {
  const role = sanitaryRoleOf(f);
  return role === null ? FURNITURE_KIND_LABELS[f.kind] : SANITARY_LABELS[role];
};
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const roomName = (room: Room): string => `“${room.name.trim() || 'phòng không tên'}”`;
const mm = (n: number): string => `${Math.round(n)} mm`;
const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);
const centroidOf = (room: Room): Point => ({
  x: room.outline.reduce((s, p) => s + p.x, 0) / room.outline.length,
  y: room.outline.reduce((s, p) => s + p.y, 0) / room.outline.length,
});
const containsPoint = (room: Room, p: Point): boolean =>
  room.outline.length >= 3 && outlineContains(room.outline.map(toPointMm), toPointMm(p));

/** Lệch lưới trong bán kính `max`, gần trước (hoà: theo góc, cố định) — dùng chung cho mọi lần dò. */
const offsetsCache = new Map<number, readonly Point[]>();
const offsetsWithin = (max: number): readonly Point[] => {
  const cached = offsetsCache.get(max);
  if (cached !== undefined) return cached;
  const n = Math.floor(max / STEP_MM);
  const out: Point[] = [];
  for (let i = -n; i <= n; i += 1)
    for (let j = -n; j <= n; j += 1) if (Math.hypot(i, j) * STEP_MM <= max) out.push({ x: i * STEP_MM, y: j * STEP_MM });
  out.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y) || Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
  offsetsCache.set(max, out);
  return out;
};

interface Placed {
  readonly centre: Point;
  readonly rotationDeg: number;
}

interface Step {
  readonly id: FurnitureId;
  readonly rule: string;
  readonly reasonVi: string;
  /** `null` = ẩn. */
  readonly after: Furniture | null;
}

/** Món sau khi dời/xoay: tâm + hộp dịch theo, góc 0 ghi 360 để `orientDetected` không quay lại lần nữa. */
// ponytail: 360 thay 0 là mẹo giữ góc đã chọn qua `orientDetected` (chỉ quay món góc đúng 0); cần thì thêm cờ `facingFixed`.
const movedTo = (f: Furniture, at: Placed, roomId: Room['id'] | undefined): Furniture => {
  const dx = Math.round(at.centre.x) - f.centre.x;
  const dy = Math.round(at.centre.y) - f.centre.y;
  const rot = ((at.rotationDeg % 360) + 360) % 360;
  const { min, max } = f.boundingBox;
  return {
    ...f,
    centre: { x: f.centre.x + dx, y: f.centre.y + dy } as Furniture['centre'],
    boundingBox: {
      min: { x: min.x + dx, y: min.y + dy },
      max: { x: max.x + dx, y: max.y + dy },
    } as Furniture['boundingBox'],
    rotationDeg: degrees(rot === 0 ? 360 : rot),
    ...(roomId === undefined ? {} : { roomId }),
  };
};

const rectAt = (f: Furniture, at: Placed): Rect => ({ ...rectOfFurniture(f), cx: at.centre.x, cy: at.centre.y, rotationDeg: at.rotationDeg });

/** Món với hộp cục bộ mới `w × d` (mm) đặt tại `at` (luật `fit`); góc 0 ghi 360 như `movedTo`. */
const reshaped = (f: Furniture, at: Placed, w: number, d: number): Furniture => {
  const moved = movedTo(f, at, f.roomId);
  const { x, y } = moved.centre;
  return {
    ...moved,
    boundingBox: { min: { x: x - w / 2, y: y - d / 2 }, max: { x: x + w / 2, y: y + d / 2 } } as Furniture['boundingBox'],
  };
};

/** Một vòng luật trên danh sách đồ đã quay hướng; trả các bước sửa theo thứ tự. */
const runRules = (graph: SpatialGraph, start: readonly Furniture[], off: ReadonlySet<string>): Step[] => {
  const work = new Map(start.map((f) => [f.id, f]));
  const steps: Step[] = [];
  const done = new Set<string>();
  const commit = (step: Step): void => {
    const before = work.get(step.id);
    // Bất biến: món bám tường đang bám tường không bị dời ra xa tường (> BACK_GAP_MM).
    if (before !== undefined && step.after !== null && hugsWall(before) && backOnWall(before) && dist(before.centre, step.after.centre) >= 1 && !backOnWall(step.after)) return;
    steps.push(step);
    done.add(step.id);
    if (step.after === null) work.delete(step.id);
    else work.set(step.id, step.after);
    if (before !== undefined && step.after !== null && isTable(before)) moveSeats(before, step.after);
  };
  /** Bàn dời thì ghế AI kê quanh nó (cách mép ≤ SEAT_REACH_MM) dời theo cùng độ lệch nếu chỗ mới không cắt tường/cửa. */
  const moveSeats = (table: Furniture, moved: Furniture): void => {
    const dx = moved.centre.x - table.centre.x;
    const dy = moved.centre.y - table.centre.y;
    if (dx === 0 && dy === 0) return;
    const reach = rectOfFurniture(table);
    for (const seat of current()) {
      if (seat.kind !== 'chair' || seat.levelId !== table.levelId || live(seat.id) === undefined) continue;
      if (!rectsOverlap(rectOfFurniture(seat), reach, SEAT_REACH_MM)) continue;
      const at = { centre: { x: seat.centre.x + dx, y: seat.centre.y + dy }, rotationDeg: rectOfFurniture(seat).rotationDeg };
      const room = graph.rooms.find((r) => r.levelId === seat.levelId && containsPoint(r, at.centre));
      if (room === undefined || !valid(rectAt(seat, at), seat, room, [], true)) continue;
      commit({ id: seat.id, rule: 'overlap', reasonVi: `Ghế đi theo bàn: dịch ${mm(Math.hypot(dx, dy))}.`, after: movedTo(seat, at, room.id) });
    }
  };
  const current = (): Furniture[] => [...work.values()];
  const graphNow = (): SpatialGraph => ({ ...graph, furniture: current() });

  /** Mặt trước +y riêng → lưng ở −front; đẩy lùi BACK_GAP_MM mà chạm thân tường là đang bám tường. */
  const backOnWall = (f: Furniture, r: Rect = rectOfFurniture(f)): boolean => {
    const t = (r.rotationDeg * Math.PI) / 180;
    const back = { ...r, cx: r.cx + Math.sin(t) * BACK_GAP_MM, cy: r.cy - Math.cos(t) * BACK_GAP_MM };
    return levelOf(f.levelId).walls.some((w) => rectsOverlap(back, w));
  };
  /** Lệch trượt dọc tường (trục x riêng, gần trước, + trước −) tới `max`. */
  const slideOffsets = (f: Furniture, max: number): Point[] => {
    const t = (rectOfFurniture(f).rotationDeg * Math.PI) / 180;
    const out: Point[] = [];
    for (let k = 1; k * STEP_MM <= max; k += 1)
      for (const s of [1, -1]) out.push({ x: Math.cos(t) * s * k * STEP_MM, y: Math.sin(t) * s * k * STEP_MM });
    return out;
  };

  const levelCache = new Map<string, { walls: Rect[]; swings: Rect[] }>();
  const levelOf = (levelId: Furniture['levelId']) => {
    let hit = levelCache.get(levelId);
    if (hit === undefined) {
      hit = { walls: wallRects(graph, levelId), swings: doorSwingRects(graph, levelId) };
      levelCache.set(levelId, hit);
    }
    return hit;
  };

  /** Phòng chứa tâm món (ưu tiên `roomId`); tâm ngoài mọi phòng thì không có — luật không đoán chỗ cho món ấy. */
  const roomOf = (f: Furniture): Room | undefined => {
    const own = graph.rooms.find((r) => r.id === f.roomId && r.levelId === f.levelId);
    if (own !== undefined && containsPoint(own, f.centre)) return own;
    return graph.rooms.find((r) => r.levelId === f.levelId && containsPoint(r, f.centre));
  };

  /** `first` rồi các phòng cùng tầng phủ lên thân món, nhiều điểm mẫu (lưới 5 × 5) nhất trước. */
  const roomsUnder = (f: Furniture, first: Room): Room[] => {
    const r = rectOfFurniture(f);
    const t = (r.rotationDeg * Math.PI) / 180;
    const samples: Point[] = [];
    for (let i = -2; i <= 2; i += 1)
      for (let j = -2; j <= 2; j += 1) {
        const u = (i / 5) * r.w;
        const v = (j / 5) * r.d;
        samples.push({ x: r.cx + u * Math.cos(t) - v * Math.sin(t), y: r.cy + u * Math.sin(t) + v * Math.cos(t) });
      }
    const scored = graph.rooms
      .filter((room) => room.levelId === f.levelId && room.id !== first.id)
      .map((room) => ({ room, n: samples.filter((p) => containsPoint(room, p)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || (a.room.id < b.room.id ? -1 : 1));
    return [first, ...scored.map((x) => x.room)];
  };

  const priority = (f: Furniture): readonly [number, number, number] => [
    repairable(f) ? 0 : 1,
    MAJOR_ROLES.has(roleOf(f)) || f.kind === 'kitchenCabinet' ? 1 : 0,
    rectOfFurniture(f).w * rectOfFurniture(f).d,
  ];
  /** `a` thắng `b` (thứ tự toàn phần: hoà thì id nhỏ hơn thắng). */
  const outranks = (a: Furniture, b: Furniture): boolean => {
    const pa = priority(a);
    const pb = priority(b);
    for (let i = 0; i < pa.length; i += 1) if (pa[i] !== pb[i]) return (pa[i] as number) > (pb[i] as number);
    return a.id < b.id;
  };
  /** Vật chắn của `f`: mọi đồ đứng sàn cùng tầng (trừ cặp ghế–bàn); `strongerOnly` thì chỉ món ưu tiên hơn (món yếu hơn sẽ tự nhường ở luật chồng). */
  const obstaclesOf = (f: Furniture, strongerOnly = false): Rect[] =>
    current()
      .filter((o) => o.id !== f.id && o.levelId === f.levelId && (o.suggested !== true || f.suggested === true) && !isFlat(o) && !tucked(o, f) && (!strongerOnly || outranks(o, f)))
      .map(rectOfFurniture);

  /**
   * Chỗ hợp lệ như `sceneFurnish` (lùi 100 mm, khe 50 mm, không chạm vùng mở cửa/thân tường). `relaxed`: đúng ngưỡng
   * của bộ báo lỗi (`scenePlacementIssues`: lấn ≤ 50 mm) — phương án cuối trước khi phải ẩn món (phòng nhỏ vừa khít giường).
   */
  const valid = (rect: Rect, f: Furniture, room: Room, obstacles: readonly Rect[], relaxed = false): boolean => {
    const { walls, swings } = levelOf(f.levelId);
    const centre = { x: rect.cx, y: rect.cy };
    const slack = relaxed ? -SLACK_MM : 0;
    return (
      rectInsidePolygon(rect, room.outline, relaxed ? 0 : INSET_MM) &&
      !graph.rooms.some((r) => r.id !== room.id && r.levelId === room.levelId && containsPoint(r, centre)) &&
      !obstacles.some((o) => rectsOverlap(rect, o, relaxed ? 0 : GAP_MM)) &&
      !swings.some((s) => rectsOverlap(rect, s, slack)) &&
      !walls.some((w) => rectsOverlap(rect, w, slack))
    );
  };

  /**
   * Chỗ hợp lệ gần nhất giữ nguyên góc, trong bán kính `max`: đủ khe với mọi đồ trước, rồi chỉ với món ưu tiên hơn,
   * rồi ngưỡng nới (`valid` relaxed). Món bám tường đang bám tường: chỗ mới cũng phải bám tường (bất biến).
   */
  const nearestShift = (
    f: Furniture,
    room: Room,
    max: number,
    rotationDeg = rectOfFurniture(f).rotationDeg,
    offsets: readonly Point[] = offsetsWithin(max),
  ): Placed | null => {
    const keepWall = hugsWall(f) && backOnWall(f);
    for (const [strongerOnly, relaxed] of [[false, false], [true, false], [true, true]] as const) {
      const obstacles = obstaclesOf(f, strongerOnly);
      for (const o of offsets) {
        const at = { centre: { x: f.centre.x + o.x, y: f.centre.y + o.y }, rotationDeg };
        const rect = rectAt(f, at);
        if (valid(rect, f, room, obstacles, relaxed) && (!keepWall || backOnWall(f, rect))) return at;
      }
    }
    return null;
  };

  /** Chỗ áp lưng vào đoạn có tường thật của phòng, mặt quay vào phòng; gần `near` nhất trước. */
  const wallSpots = (f: Furniture, room: Room, near: Point, max = Infinity): Placed | null => {
    const { w, d } = rectOfFurniture(f);
    const obstacles = obstaclesOf(f);
    const spots: Placed[] = [];
    for (const edge of roomEdges(room, graph)) {
      const e = { x: (edge.b.x - edge.a.x) / edge.lengthMm, y: (edge.b.y - edge.a.y) / edge.lengthMm };
      const off = Math.max(INSET_MM, edge.wallHalfMm) + 1 + d / 2;
      const rotationDeg = furnitureFacingDeg(edge.inwardNormal);
      for (const span of edge.walled) {
        for (let t = span.fromMm + w / 2; t <= span.toMm - w / 2 + 1e-6; t += STEP_MM) {
          const centre = { x: edge.a.x + e.x * t + edge.inwardNormal.x * off, y: edge.a.y + e.y * t + edge.inwardNormal.y * off };
          if (dist(centre, f.centre) <= max) spots.push({ centre, rotationDeg });
        }
      }
    }
    spots.sort((p, q) => dist(p.centre, near) - dist(q.centre, near) || p.rotationDeg - q.rotationDeg);
    return spots.find((at) => valid(rectAt(f, at), f, room, obstacles)) ?? null;
  };

  const sanitary = () => sanitaryPlacementIssues(graphNow());
  const live = (id: string): Furniture | undefined => {
    const f = work.get(id as FurnitureId);
    return f !== undefined && repairable(f) && !done.has(id) ? f : undefined;
  };

  // 0. outside — mọi món AI (cả gợi ý, thảm), trừ thang.
  for (const f of current()) {
    if (classOf(f) !== 'ai' || f.kind === 'stair' || done.has(f.id) || !outsideAllRooms(f, graph.rooms)) continue;
    const targets = graph.rooms
      .filter((r) => r.levelId === f.levelId && r.outline.length >= 3 && fitsRoom(f, r))
      .map((room) => ({ room, d: distToRoom(room, f.centre) }))
      .filter((x) => x.d <= RELOCATE_MAX_MM)
      .sort((a, b) => a.d - b.d || (a.room.id < b.room.id ? -1 : 1));
    let placed: Step | null = null;
    for (const { room } of targets) {
      const at = nearestShift(f, room, MAX_SHIFT_MM) ?? wallSpots(f, room, f.centre, RELOCATE_MAX_MM);
      if (at === null) continue;
      placed = { id: f.id, rule: 'outside', reasonVi: `${capital(labelOf(f))} nằm ngoài nhà: dời vào ${roomName(room)} ${mm(dist(at.centre, f.centre))}.`, after: movedTo(f, at, room.id) };
      break;
    }
    commit(placed ?? { id: f.id, rule: 'outside', reasonVi: 'Món AI nằm ngoài nhà, không có chỗ hợp lệ', after: null });
  }

  /** Lỗi đặt đồ của riêng món `f` nếu nó chiếm `rect` (cùng ngưỡng `scenePlacementIssues`): mỗi lỗi một khoá. */
  const issuesAt = (f: Furniture, rect: Rect, room: Room): Set<string> => {
    const { walls, swings } = levelOf(f.levelId);
    const out = new Set<string>();
    if (!containsPoint(room, { x: rect.cx, y: rect.cy }) || !rectInsidePolygon(rect, room.outline, -SLACK_MM)) out.add('outside');
    if (walls.some((w) => rectsOverlap(rect, w, -SLACK_MM))) out.add('wall');
    if (swings.some((s) => rectsOverlap(rect, s, -SLACK_MM))) out.add('door');
    for (const o of current()) {
      if (o.id === f.id || o.levelId !== f.levelId || o.suggested === true || isFlat(o) || tucked(f, o) || cabinetRun(f, o)) continue;
      const r = rectOfFurniture(o);
      const smaller = Math.min(rect.w * rect.d, r.w * r.d);
      if (rectsOverlap(rect, r) && smaller > 0 && overlapAreaMm2(rect, r) / smaller > OVERLAP_MAX_FRACTION) out.add(`overlap:${o.id}`);
    }
    return out;
  };

  /*
   * 0b. fit — hộp AI theo hồ sơ vai: (1) vai dài/ngắn rõ mà hộp dài theo chiều sâu thì xoay 90° quanh tâm (dấu chân giữ
   * nguyên; mặt trước quay vào tâm phòng, món bám tường thì lưng phải còn áp tường); (2) cạnh ngoài [p10, p90] của vai thì
   * kẹp về biên (vai dài tuỳ chỗ không kẹp cạnh dài xuống), món bám tường giữ lưng áp tường. Món sai nặng (< ½ p10 hoặc
   * > 2× p90) để nguyên — không phóng thành đồ chuẩn, không ẩn. Kẹp/xoay mà sinh lỗi đặt đồ MỚI (va tường, chồng đồ,
   * lòi khỏi phòng, chắn cửa) thì giữ nguyên món.
   */
  if (!off.has('fit')) {
    for (const f of current()) {
      if (live(f.id) === undefined) continue;
      const room = roomOf(f);
      if (room === undefined) continue;
      const role = roleOf(f, furnishingUsageOf(room));
      const p = PROFILES[role];
      if (p === undefined) continue;
      const before = rectOfFurniture(f);
      const long = Math.max(before.w, before.d);
      const short = Math.min(before.w, before.d);
      if (long < p.long[0] / 2 || long > p.long[2] * 2 || short < p.short[0] / 2 || short > p.short[2] * 2) continue;

      // (1) trục: đổi hai cạnh, góc ±90° — chọn mặt trước hướng vào tâm phòng; món bám tường: lưng phải áp tường.
      const swap =
        Math.abs(Math.log(p.aspect)) > Math.log(AXIS_ROLE_RATIO) &&
        (p.aspect > 1 ? before.w / before.d < 1 / AXIS_BOX_RATIO : before.w / before.d > AXIS_BOX_RATIO);
      let rotationDeg = before.rotationDeg;
      let [w, d] = [before.w, before.d];
      if (swap) {
        const toward = (deg: number): number => {
          const t = (deg * Math.PI) / 180;
          const c = centroidOf(room);
          return -Math.sin(t) * (c.x - before.cx) + Math.cos(t) * (c.y - before.cy);
        };
        const swapped = (deg: number): Rect => ({ ...before, w: before.d, d: before.w, rotationDeg: deg });
        const turns = [before.rotationDeg + 90, before.rotationDeg - 90]
          .map((deg) => ((deg % 360) + 360) % 360)
          .sort((a, b) => toward(b) - toward(a));
        const keepWall = hugsWall(f) && backOnWall(f, before);
        const turn = turns.find((deg) => !keepWall || backOnWall(f, swapped(deg)));
        if (turn !== undefined) {
          rotationDeg = turn;
          [w, d] = [before.d, before.w];
        }
      }
      const turned = rotationDeg !== before.rotationDeg;

      // (2) cỡ: kẹp cạnh dài/ngắn về dải vai. Cạnh dài giữ trục của hộp; hộp gần vuông (lệch < 1,4) thì cạnh dài theo
      // trục dài của vai (tủ 0,48 × 0,50 kẹp thành rộng 0,67 dọc tường, không thành sâu 0,67).
      const freeLong = FREE_LONG_ROLES.has(role);
      const long2 = Math.round(clampTo(long, p.long[0] / BAND_TOL, freeLong ? Infinity : p.long[2] * BAND_TOL));
      const short2 = Math.round(clampTo(short, p.short[0] / BAND_TOL, p.short[2] * BAND_TOL));
      const sized = Math.abs(long2 - long) >= 1 || Math.abs(short2 - short) >= 1;
      if (!turned && !sized) continue;
      const squarish = Math.max(w, d) / Math.min(w, d) < AXIS_BOX_RATIO && Math.abs(Math.log(p.aspect)) > Math.log(AXIS_ROLE_RATIO);
      const longOnW = squarish ? p.aspect > 1 : w >= d;
      const [w2, d2] = sized ? (longOnW ? [long2, short2] : [short2, long2]) : [w, d];

      // Bám tường: lưng giữ nguyên chỗ, chiều sâu đổi thì tâm dịch theo mặt trước.
      const t = (rotationDeg * Math.PI) / 180;
      const front = { x: -Math.sin(t), y: Math.cos(t) };
      const onWall = hugsWall(f) && backOnWall(f, { ...before, w, d, rotationDeg });
      const shift = onWall ? (d2 - d) / 2 : 0;
      const at = { centre: { x: before.cx + front.x * shift, y: before.cy + front.y * shift }, rotationDeg };
      const after = { ...before, cx: at.centre.x, cy: at.centre.y, w: w2, d: d2, rotationDeg };

      const had = issuesAt(f, before, room);
      if ([...issuesAt(f, after, room)].some((k) => !had.has(k))) continue;

      const what = capital(labelOf(f));
      const parts = [
        ...(turned ? [`hộp AI dài theo chiều sâu, xoay 90° cho mặt trước dọc cạnh dài`] : []),
        ...(sized
          ? [
              `cỡ ${metres(long)} × ${metres(short)} m ngoài dải mẫu thật của vai (dài ${metres(p.long[0] / BAND_TOL)}${freeLong ? ' trở lên' : `–${metres(p.long[2] * BAND_TOL)}`}, sâu ${metres(p.short[0] / BAND_TOL)}–${metres(p.short[2] * BAND_TOL)} m): kẹp về ${metres(long2)} × ${metres(short2)} m`,
            ]
          : []),
      ];
      commit({ id: f.id, rule: 'fit', reasonVi: `${what}: ${parts.join('; ')}.`, after: reshaped(f, at, w2, d2) });
    }
  }

  // 1. roomMismatch
  for (const issue of sanitary().filter((i) => i.kind === 'roomMismatch')) {
    const f = live(issue.furnitureIds[0] ?? '');
    if (f === undefined) continue;
    const role = sanitaryRoleOf(f);
    const occupied = (room: Room): boolean =>
      (role === 'toilet' || role === 'bathtub') &&
      current().some((o) => o.id !== f.id && o.levelId === room.levelId && sanitaryRoleOf(o) === role && (o.roomId === room.id || containsPoint(room, o.centre)));
    const targets = graph.rooms
      .filter((r) => r.levelId === f.levelId && isBath(r) && !occupied(r))
      .sort((a, b) => dist(centroidOf(a), f.centre) - dist(centroidOf(b), f.centre) || (a.id < b.id ? -1 : 1));
    let placed: Step | null = null;
    for (const room of targets) {
      const at = wallSpots(f, room, f.centre);
      if (at === null) continue;
      placed = { id: f.id, rule: 'roomMismatch', reasonVi: `${issue.message}: dời sang ${roomName(room)} cùng tầng, áp tường.`, after: movedTo(f, at, room.id) };
      break;
    }
    commit(placed ?? { id: f.id, rule: 'roomMismatch', reasonVi: `${issue.message}; không phòng tắm/WC nào cùng tầng còn chỗ hợp lệ: ẩn trong cảnh.`, after: null });
  }

  // 2. duplicateFixture
  for (const issue of sanitary().filter((i) => i.kind === 'duplicateFixture')) {
    const items = issue.furnitureIds.flatMap((id) => work.get(id as FurnitureId) ?? []);
    const keep = [...items].sort((a, b) => (outranks(a, b) ? -1 : 1))[0];
    for (const f of items) {
      if (f === keep || live(f.id) === undefined) continue;
      commit({ id: f.id, rule: 'duplicateFixture', reasonVi: `${issue.message}: giữ một, ẩn ${labelOf(f)} thừa do AI dò.`, after: null });
    }
  }

  // 3. outsideRoom / wallOverlap
  for (const f of current()) {
    if (live(f.id) === undefined) continue;
    const room = roomOf(f);
    if (room === undefined) continue; // món ngoài mọi phòng: luật 0 đã xử lý (tâm ngoài nhà).
    const rect = rectOfFurniture(f);
    const rule = !rectInsidePolygon(rect, room.outline, -SLACK_MM)
      ? 'outsideRoom'
      : levelOf(f.levelId).walls.some((w) => rectsOverlap(rect, w, -SLACK_MM))
        ? 'wallOverlap'
        : !off.has('door') && levelOf(f.levelId).swings.some((s) => rectsOverlap(rect, s, -SLACK_MM))
          ? 'doorSwing'
          : null;
    if (rule === null) continue;
    const what =
      rule === 'outsideRoom' ? `lòi ra ngoài ${roomName(room)}` : rule === 'wallOverlap' ? `lấn vào tường ${roomName(room)}` : 'chắn lối mở cửa';
    // Phòng chứa tâm trước, rồi các phòng chứa phần lớn thân món (tâm rơi vào dải phòng hẹp cạnh phòng thật).
    let placed: Step | null = null;
    for (const target of roomsUnder(f, room)) {
      // Tủ áo/kệ/tủ bếp: ưu tiên chỗ áp lưng tường gần nhất (không để tủ đứng giữa phòng), rồi mới dịch giữ góc.
      const at = (hugsWall(f) ? wallSpots(f, target, f.centre, MAX_SHIFT_MM) : null) ?? nearestShift(f, target, MAX_SHIFT_MM);
      if (at === null) continue;
      const where = target.id === room.id ? 'dịch vào trong' : `dịch sang ${roomName(target)}`;
      placed = { id: f.id, rule, reasonVi: `${capital(labelOf(f))} ${what}: ${where} ${mm(dist(at.centre, f.centre))}.`, after: movedTo(f, at, target.id) };
      break;
    }
    // Không có chỗ: giữ nguyên chỗ gốc, lỗi còn trên chip (chính sách: luật này không ẩn món nào).
    if (placed !== null) commit(placed);
  }

  // 4. notAgainstWall
  for (const f of current()) {
    if (live(f.id) === undefined || !hugsWall(f)) continue;
    const room = roomOf(f);
    if (room === undefined) continue;
    if (backOnWall(f)) continue;
    const at = wallSpots(f, room, f.centre, MAX_SHIFT_MM);
    if (at === null) continue;
    const moved = dist(at.centre, f.centre) >= 1;
    commit({
      id: f.id,
      rule: 'notAgainstWall',
      reasonVi: `${capital(labelOf(f))} đứng cách tường quá ${mm(BACK_GAP_MM)}: ${moved ? `dời ${mm(dist(at.centre, f.centre))} ` : ''}áp lưng vào tường gần nhất.`,
      after: movedTo(f, at, room.id),
    });
  }

  // 5. overlap
  const standing = (): Furniture[] => current().filter((f) => f.suggested !== true && !isFlat(f));
  for (const a of standing()) {
    for (const b of standing()) {
      if (a.id >= b.id || a.levelId !== b.levelId || !work.has(a.id) || !work.has(b.id)) continue;
      const fa = work.get(a.id) as Furniture;
      const fb = work.get(b.id) as Furniture;
      const ra = rectOfFurniture(fa);
      const rb = rectOfFurniture(fb);
      const smaller = Math.min(ra.w * ra.d, rb.w * rb.d);
      if (!rectsOverlap(ra, rb) || !(smaller > 0) || overlapAreaMm2(ra, rb) / smaller <= OVERLAP_MAX_FRACTION) continue;
      if (tucked(fa, fb) || cabinetRun(fa, fb)) continue;
      const [keep, yield_] = outranks(fa, fb) ? [fa, fb] : [fb, fa];
      if (live(yield_.id) === undefined) continue;
      const room = roomOf(yield_);
      if (room === undefined) continue;
      const what = `${capital(labelOf(yield_))} chồng lên ${labelOf(keep)}`;
      // Món bám tường: chỉ trượt dọc tường đang bám, không đẩy ra giữa phòng; không có chỗ thì giữ nguyên (lỗi trên chip).
      if (hugsWall(yield_)) {
        const slid = backOnWall(yield_) ? nearestShift(yield_, room, MAX_SHIFT_MM, undefined, slideOffsets(yield_, MAX_SHIFT_MM)) : null;
        if (slid !== null)
          commit({ id: yield_.id, rule: 'overlap', reasonVi: `${what}: trượt dọc tường ${mm(dist(slid.centre, yield_.centre))} ra chỗ trống.`, after: movedTo(yield_, slid, room.id) });
        continue;
      }
      const at = nearestShift(yield_, room, MAX_SHIFT_MM);
      // Chỉ món nhỏ/`other` chồng lên đồ chính mới được ẩn; còn lại không có chỗ thì giữ nguyên, lỗi còn trên chip.
      if (at === null && !(isMinor(yield_) && isMain(keep))) continue;
      commit(
        at === null
          ? { id: yield_.id, rule: 'overlap', reasonVi: `${what}, không có chỗ trống trong vòng 1,5 m: ẩn trong cảnh.`, after: null }
          : { id: yield_.id, rule: 'overlap', reasonVi: `${what}: dịch ${mm(dist(at.centre, yield_.centre))} ra chỗ trống.`, after: movedTo(yield_, at, room.id) },
      );
    }
  }

  // 6. facing
  for (const issue of sanitary().filter((i) => i.kind === 'facing')) {
    for (const id of issue.furnitureIds) {
      const f = live(id);
      const room = f === undefined ? undefined : roomOf(f);
      if (f === undefined || room === undefined) continue;
      const base = rectOfFurniture(f).rotationDeg;
      const at = [90, 270].map((turn) => nearestShift(f, room, FACING_SHIFT_MM, (base + turn) % 360)).find((x) => x !== null);
      if (at === undefined || at === null) continue;
      commit({ id: f.id, rule: 'facing', reasonVi: `${issue.message}: xoay ${labelOf(f)} 90°.`, after: movedTo(f, at, room.id) });
      break;
    }
  }

  return steps;
};

const pick = (f: Furniture, withBox = false): SceneRepair['before'] => ({
  centre: f.centre,
  rotationDeg: f.rotationDeg,
  ...(f.roomId === undefined ? {} : { roomId: f.roomId }),
  ...(withBox ? { boundingBox: f.boundingBox } : {}),
});

/** Cạnh dài/ngắn của hộp (mm) — không phụ thuộc hộp đã đổi trục hay chưa. */
const sidesOf = (f: Furniture): readonly [number, number] => {
  const r = rectOfFurniture(f);
  return [Math.max(r.w, r.d), Math.min(r.w, r.d)];
};

const actionOf = (before: Furniture, after: Furniture | null): SceneRepairAction => {
  if (after === null) return 'hidden';
  const [l0, s0] = sidesOf(before);
  const [l1, s1] = sidesOf(after);
  if (Math.abs(l0 - l1) >= 1 || Math.abs(s0 - s1) >= 1) return 'rescaled';
  return dist(before.centre, after.centre) >= 1 ? 'moved' : 'rotated';
};

/**
 * Đồ thị cảnh đã sửa + danh sách sửa (một mục mỗi món, theo thứ tự lần sửa đầu). Món không sửa giữ nguyên đối
 * tượng gốc; món ẩn bị bỏ khỏi `furniture`.
 */
export const repairScene = (
  graph: SpatialGraph,
  /** Luật vòng 6 đã tắt (`?disable=fit,door`); mặc định theo URL trang. */
  off: ReadonlySet<string> = SCENE_RULES_OFF,
): { graph: SpatialGraph; repairs: readonly SceneRepair[] } => {
  const original = new Map(graph.furniture.map((f) => [f.id, f]));
  const log = new Map<FurnitureId, { rules: string[]; reasons: string[]; after: Furniture | null }>();
  let furniture: readonly Furniture[] = graph.furniture;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Quay hướng như cảnh 3D sẽ quay (đồ AI góc 0) để luật xét đúng hình người dùng thấy.
    const steps = runRules(graph, orientDetectedFurniture(furniture, graph.walls), off);
    if (steps.length === 0) break;
    const changed = new Map(steps.map((s) => [s.id, s.after]));
    furniture = furniture.flatMap((f) => {
      if (!changed.has(f.id)) return [f];
      const after = changed.get(f.id) ?? null;
      return after === null ? [] : [after];
    });
    for (const s of steps) {
      const entry = log.get(s.id) ?? { rules: [], reasons: [], after: null };
      if (!entry.rules.includes(s.rule)) entry.rules.push(s.rule);
      entry.reasons.push(s.reasonVi);
      entry.after = s.after;
      log.set(s.id, entry);
    }
  }

  if (log.size === 0) return { graph, repairs: [] };
  const repairs = [...log].map(([id, { rules, reasons, after }]): SceneRepair => {
    const before = original.get(id) as Furniture;
    return {
      furnitureId: id,
      action: actionOf(before, after),
      rule: rules.join('+'),
      reasonVi: reasons.join(' '),
      before: pick(before, rules.includes('fit')),
      ...(after === null ? {} : { after: pick(after, rules.includes('fit')) }),
    };
  });
  return { graph: { ...graph, furniture }, repairs };
};

/** Tra nhanh theo id — dạng `toPascalScene({ repairs })` dự kiến nhận. */
export const repairsById = (repairs: readonly SceneRepair[]): ReadonlyMap<FurnitureId, SceneRepair> =>
  new Map(repairs.map((r) => [r.furnitureId, r]));

/**
 * Phiên sửa cảnh của một lượt mở trang. Thay cho "chốt một lần lúc nạp": kết quả sửa cảnh là hàm thuần của ĐẦU VÀO
 * (tường/ô mở/phòng + đồ, với món người dùng đã đụng trong phiên coi như `human`), nhớ theo chữ ký đầu vào. Đầu vào
 * đổi (dời tường, đổi phòng, dời/xác nhận đồ, hoàn tác, nhận gợi ý) → tính lại; không đổi → trả đúng kết quả cũ
 * (cùng đầu vào → cùng kết quả, không "sửa ma").
 *
 * "Đã đụng" = hình học (tâm, góc, hộp, loại, tầng) khác lần đầu phiên thấy món ấy; dính tới hết phiên, như cờ
 * `edited` máy chủ tự đặt (H1, không gỡ được) — nên món vừa kéo không bị luật kéo đi chỗ khác trong lúc chờ PUT.
 * `roomId` không tính: tách phòng đổi nó mà người dùng không đụng món.
 */
export interface RepairSession {
  /** Món như lần đầu phiên thấy (trước mọi sửa của người dùng) — đích khi hoàn tác về một vị trí đã sửa cảnh. */
  readonly firstSeen: Map<FurnitureId, Furniture>;
  readonly touched: Set<FurnitureId>;
  /**
   * Phần sửa cảnh theo chữ ký đầu vào (đồ đã sửa, `null` = không sửa gì); vài mục vì cầu nối và chip đọc hai đồ thị hơi
   * khác (tầng chưa có tỷ lệ). Chỉ nhớ phần sửa, đồ thị ráp từ `stored` mỗi lượt: chữ ký không gồm tầng/mái/trục…
   */
  readonly cache: Map<string, { readonly furniture: readonly Furniture[] | null; readonly repairs: readonly SceneRepair[] }>;
}

export interface RepairResult {
  readonly graph: SpatialGraph;
  readonly repairs: readonly SceneRepair[];
}

export const createRepairSession = (): RepairSession => ({ firstSeen: new Map(), touched: new Set(), cache: new Map() });

const CACHE_MAX = 4;

const geometryOf = (f: Furniture): string =>
  JSON.stringify([f.centre, f.rotationDeg, f.boundingBox, f.kind, f.levelId]);

/** Sửa cảnh của đồ thị đã lưu `stored` trong phiên `session` (ghi nhận món đã đụng, nhớ theo chữ ký đầu vào). */
export const sessionRepairs = (session: RepairSession, stored: SpatialGraph): RepairResult => {
  for (const f of stored.furniture) {
    const first = session.firstSeen.get(f.id);
    if (first === undefined) session.firstSeen.set(f.id, f);
    else if (!session.touched.has(f.id) && geometryOf(first) !== geometryOf(f)) session.touched.add(f.id);
  }
  const furniture = stored.furniture.map((f) => (session.touched.has(f.id) && classOf(f) === 'ai' ? { ...f, edited: true } : f));
  const key = JSON.stringify([stored.walls, stored.openings, stored.rooms, furniture]);
  let hit = session.cache.get(key);
  if (hit === undefined) {
    const fixed = repairScene({ ...stored, furniture });
    hit = { furniture: fixed.repairs.length === 0 ? null : fixed.graph.furniture, repairs: fixed.repairs };
    // ponytail: bỏ mục cũ nhất khi đầy, không LRU thật — chỉ hai người đọc.
    if (session.cache.size >= CACHE_MAX) session.cache.delete(session.cache.keys().next().value as string);
    session.cache.set(key, hit);
  }
  if (hit.furniture === null) return { graph: stored, repairs: hit.repairs };
  // Món đã đụng chỉ mang `edited` tạm để luật bỏ qua: trao cho cảnh đúng bản đã lưu.
  const storedById = new Map(stored.furniture.map((f) => [f.id, f]));
  const fixedFurniture = hit.furniture.map((f) => (session.touched.has(f.id) ? (storedById.get(f.id) ?? f) : f));
  return { graph: { ...stored, furniture: fixedFurniture }, repairs: hit.repairs };
};
