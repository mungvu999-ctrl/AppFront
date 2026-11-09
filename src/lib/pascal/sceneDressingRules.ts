/**
 * Đồ trang trí sinh ra (J10, bộ "an toàn"): đèn bàn trên tủ đầu giường, thảm dưới nhóm sofa,
 * thảm dưới giường, thảm chân trước bồn tắm/vòi sen. Chỉ là bản ghi `Furniture` trong bộ
 * nhớ, id `DRESS-<vai>-<id neo>`, không bao giờ lưu (toSpatial bỏ qua).
 *
 * Hàm thuần của (đồ thị, phong cách): phòng theo id, quy tắc theo thứ tự cố định, đồ theo
 * id. Mỗi món phải nằm trong phòng (lùi 100 mm), không chồng đồ khác (cách 50 mm — trừ món
 * "chủ" nó nằm trên/dưới) và không chồng vùng mở cửa; không đạt thì bỏ, không dời đồ thật.
 * Ngoại lệ: thảm phẳng được nằm trong vùng mở cửa (người đi qua thảm, cánh cửa lướt trên),
 * đèn bàn luôn đặt trên tủ đầu giường (món chủ đã hợp lệ).
 */

import { pointAtArcLength } from '@/domain/spatial/arc';
import type { Furniture, FurnitureId, FurnitureVariant, Millimetres, Point, Room, SpatialGraph } from '@/domain/spatial/types';

import { CATALOG_MODELS, VARIANT_MODEL, isServerModel, modelSrcOf, topFractionOf } from './furnitureCatalog';
import {
  doorSwingRects,
  rectCorners,
  rectInsidePolygon,
  rectOfFurniture,
  rectsOverlap,
  wallRects,
  type Rect,
} from './placement';
import { itemSlotsOf } from './sceneDressing';
import { modelFolderOf, roleOf, type FurnitureRole } from './sceneVariety';
import type { SceneStyle } from './sceneStyles';

const ROOM_INSET_MM = 100;
const FURNITURE_GAP_MM = 50;
/** Thảm thử cỡ đầy đủ rồi 80%, 60% (phòng hẹp). */
const RUG_SCALES = [1, 0.8, 0.6] as const;
/** Thảm phòng khách 2000 × 1400, mép sau luồn 300 mm dưới mặt trước sofa. */
const LIVING_RUG = { long: 2000, deep: 1400, underSofa: 300 } as const;
/** Thảm theo nhóm sofa: dài hơn sofa 400, phủ quá mép xa bàn nước 300; trần 3200 × 2600. */
const GROUP_RUG = { extraLong: 400, pastTable: 300, maxLong: 3200, maxDeep: 2600 } as const;
/** Thảm giường: rộng hơn giường 600, sâu 1400, phủ 2/3 phía chân giường. */
const BED_RUG = { extraWidth: 600, deep: 1400 } as const;
const BATH_MAT = { long: 700, deep: 450 } as const;
const NIGHTSTAND_HEIGHT_MM = 480;
/** Mặt bằng đèn bàn khi catalog thiếu mô hình (mm). */
const LAMP_FALLBACK_MM = 300;

/** Gối tựa 450 × 150 (mẫu `pillow`), cách nhau 60. */
const PILLOW = { w: 450, d: 150, gap: 60 } as const;
/** Chăn gấp 1200 × 500 (mẫu `throw-blanket`), mép cách chân giường 150. */
const THROW = { w: 1200, d: 500, fromFoot: 150 } as const;
/** Mặt nệm / mặt đệm ngồi theo tỉ lệ chiều cao mô hình (giường 0,71 m → nệm ≈ 0,46 m; sofa 0,74 → 0,43). */
const BED_MATTRESS_FRACTION = 0.65;
const SOFA_SEAT_FRACTION = 0.58;
/** Bề dày lưng sofa nằm trong hộp bao. */
const SOFA_BACK_MM = 220;
const SOFA_THREE_PILLOWS_MM = 1800;
const FRAME_FOLDER = 'fancy-picture-frame';
const FRAME_MIN_LIFT_MM = 1250;
const FRAME_ABOVE_HOST_MM = 300;
/** Tìm tường sau lưng món chủ: dò từ 300 trong hộp bao ra 400 ngoài, bước 10. */
const WALL_SEARCH = { from: -300, to: 400, step: 10 } as const;
const CURTAIN_USAGES: ReadonlySet<Room['usage']> = new Set(['livingRoom', 'bedroom']);
/** Tấm rèm phủ vào khung cửa sổ 150; vướng góc tường/đồ thì phủ sâu hơn. */
const CURTAIN_OVERLAPS_MM = [150, 300, 450] as const;
const CURTAIN_WALL_GAP_MM = 20;
/** Cửa sổ chặn khung tranh: thân cửa nở thêm mỗi phía tường. */
const WINDOW_CLEAR_MM = 300;
const DEFAULT_LEVEL_HEIGHT_MM = 2700;

const RUG_ROLES: ReadonlySet<FurnitureRole> = new Set(['rug', 'roundRug']);
const VASE_HOST_ROLES: ReadonlySet<FurnitureRole> = new Set(['diningTable', 'coffeeTable', 'nightstand']);
const SOFA_GROUP_ROLES: ReadonlySet<FurnitureRole> = new Set(['sofa', 'armchair', 'coffeeTable']);
const BED_ROLES: ReadonlySet<FurnitureRole> = new Set(['doubleBed', 'singleBed']);
const WET_ROLES: ReadonlySet<FurnitureRole> = new Set(['shower', 'bathtub']);

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const wrapDeg = (deg: number): number => {
  const wrapped = Math.round((((deg % 360) + 360) % 360) * 100) / 100;
  return wrapped === 360 ? 0 : wrapped;
};

/** Trục riêng của món: x (theo `w`) và y (theo `d`, mặt trước). */
const axesOf = (rotationDeg: number): readonly [Point, Point] => {
  const t = (rotationDeg * Math.PI) / 180;
  return [
    { x: Math.cos(t), y: Math.sin(t) },
    { x: -Math.sin(t), y: Math.cos(t) },
  ];
};

/**
 * Hình đặt theo khung của món chủ: tâm = tâm chủ + u·x + v·y, cỡ `sizeX × sizeY` theo trục
 * của chủ. Cạnh dài luôn là `w` (xoay thêm 90° nếu cần) — mô hình thảm dài theo x và
 * toPascal co đều, đặt ngược sẽ ra thảm bé.
 */
const rectAt = (host: Rect, u: number, v: number, sizeX: number, sizeY: number): Rect => {
  const [ex, ey] = axesOf(host.rotationDeg);
  const cx = Math.round(host.cx + ex.x * u + ey.x * v);
  const cy = Math.round(host.cy + ex.y * u + ey.y * v);
  const w = Math.round(sizeX);
  const d = Math.round(sizeY);
  return w >= d
    ? { cx, cy, w, d, rotationDeg: wrapDeg(host.rotationDeg) }
    : { cx, cy, w: d, d: w, rotationDeg: wrapDeg(host.rotationDeg + 90) };
};

/**
 * Hình cỡ `w × d` (theo trục riêng của nó) đặt trong khung của `host`: `across` vuông góc,
 * `along` dọc trục `frontAxis` của chủ; mặt trước (+y riêng của món) quay theo `frontSign` của trục ấy.
 */
const facing = (
  host: Rect,
  frontAxis: 0 | 1,
  across: number,
  along: number,
  w: number,
  d: number,
  frontSign: 1 | -1,
): Rect => {
  const [ex, ey] = axesOf(host.rotationDeg);
  const [u, v] = frontAxis === 1 ? [across, along] : [along, across];
  const turn = frontAxis === 1 ? (frontSign === 1 ? 0 : 180) : frontSign === 1 ? 270 : 90;
  return {
    cx: Math.round(host.cx + ex.x * u + ey.x * v),
    cy: Math.round(host.cy + ex.y * u + ey.y * v),
    w: Math.round(w),
    d: Math.round(d),
    rotationDeg: wrapDeg(host.rotationDeg + turn),
  };
};

/** Chiều cao dựng của món (mm) như toPascal khớp mô hình: `heightMm`, không thì cỡ catalog × tỉ lệ chung. */
const hostHeightMm = (f: Furniture, style: SceneStyle, usage: Room['usage'] | undefined): number => {
  if (f.heightMm !== undefined) return f.heightMm;
  const dims = CATALOG_MODELS[modelFolderOf(f, style, usage) ?? '']?.dimensions;
  if (dims === undefined) return 0;
  const w = (f.boundingBox.max.x - f.boundingBox.min.x) / 1000;
  const d = (f.boundingBox.max.y - f.boundingBox.min.y) / 1000;
  return dims[1] * Math.min(w / dims[0], d / dims[2], 1.25) * 1000;
};

/** Mặt đặt đồ của món chủ (mm trên sàn): mặt đo từ GLB (`topFractionOf`) × cao; mẫu chưa đo thì `fraction` × cao. */
export const hostTopMm = (f: Furniture, style: SceneStyle, usage: Room['usage'] | undefined, fraction = 1): number =>
  (topFractionOf(modelFolderOf(f, style, usage) ?? '') ?? fraction) * hostHeightMm(f, style, usage);

/**
 * Khung tranh áp tường sau lưng món chủ (trục `axis`, phía `back`): dò ra xa dần tới khi chạm thân
 * tường, lấy vị trí cuối còn chưa chạm. Không chạm tường nào trong tầm dò = món không tựa tường.
 */
const againstWall = (
  host: Rect,
  axis: 0 | 1,
  back: 1 | -1,
  half: number,
  w: number,
  d: number,
  walls: readonly Rect[],
): Rect | undefined => {
  let last: Rect | undefined;
  for (let t = WALL_SEARCH.from; t <= WALL_SEARCH.to; t += WALL_SEARCH.step) {
    const r = facing(host, axis, 0, back * (half + t + d / 2), w, d, (-back) as 1 | -1);
    if (walls.some((wall) => rectsOverlap(r, wall))) return last;
    last = r;
  }
  return undefined;
};

interface WindowOnWall {
  readonly id: string;
  /** Khung của cửa sổ: x dọc tường, y pháp tuyến trái; tâm ở tâm lỗ cửa trên tim tường. */
  readonly frame: Rect;
  readonly width: number;
  readonly thickness: number;
  /** Phía của phòng dọc trục y của `frame`. */
  readonly inward: 1 | -1;
}

/** Cửa sổ trên các tường cùng tầng giáp phòng này (phía phòng = đầu dò 150 mm ra khỏi tường nằm trong outline). */
const windowsOfRoom = (graph: SpatialGraph, room: Room): WindowOnWall[] => {
  const walls = new Map(graph.walls.filter((w) => w.levelId === room.levelId).map((w) => [w.id as string, w]));
  return [...graph.openings]
    .filter((o) => o.kind === 'window')
    .sort(byId)
    .flatMap((o) => {
      const wall = walls.get(o.wallId);
      if (wall === undefined) return [];
      const { start, end } = wall.centreline;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!(length > 1)) return [];
      // Tường cong: tâm cửa sổ trên cung (đo dọc cung), hướng theo tiếp tuyến tại đó; thẳng → như cũ.
      const { point, tangent: dir } = pointAtArcLength(start, end, wall.curveOffsetMm, o.offsetMm + o.widthMm / 2);
      const frame: Rect = {
        cx: point.x,
        cy: point.y,
        w: o.widthMm,
        d: wall.thicknessMm,
        rotationDeg: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
      };
      const probe = (side: 1 | -1): boolean =>
        rectInsidePolygon(
          { ...frame, cx: frame.cx - dir.y * side * (wall.thicknessMm / 2 + 150), cy: frame.cy + dir.x * side * (wall.thicknessMm / 2 + 150), w: 1, d: 1 },
          room.outline,
          0,
        );
      const inward = probe(1) ? 1 : probe(-1) ? -1 : 0;
      return inward === 0 ? [] : [{ id: o.id, frame, width: o.widthMm, thickness: wall.thicknessMm, inward }];
    });
};

/** Thân cửa sổ cả tầng, nở `WINDOW_CLEAR_MM` mỗi phía tường: khung tranh không treo đè lên. */
const windowRects = (graph: SpatialGraph, levelId: Room['levelId']): Rect[] =>
  graph.rooms
    .filter((r) => r.levelId === levelId)
    .flatMap((r) => windowsOfRoom(graph, r))
    .map((win) => ({ ...win.frame, d: win.thickness + 2 * WINDOW_CLEAR_MM }));

const distanceToOutline = (p: Point, outline: readonly Point[]): number =>
  Math.min(
    ...outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length] as Point;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }),
  );

/**
 * Phía "ra phòng" của món dọc trục riêng `axis` (0 = x, 1 = y): đầu cách mép phòng xa hơn
 * (lưng sofa, đầu giường tựa tường). Bằng nhau thì phía +, như mặt trước +y của K1.
 */
const openSideOf = (host: Rect, axis: 0 | 1, outline: readonly Point[]): 1 | -1 => {
  const e = axesOf(host.rotationDeg)[axis];
  const half = (axis === 0 ? host.w : host.d) / 2;
  const end = (sign: number): Point => ({ x: host.cx + e.x * half * sign, y: host.cy + e.y * half * sign });
  return distanceToOutline(end(-1), outline) > distanceToOutline(end(1), outline) ? -1 : 1;
};

/** Phần thêm của món sinh ra: độ nâng, hoặc mẫu AppFront theo `model` (đồ trang trí không có variant). */
type Extra = Pick<Furniture, 'liftMm' | 'heightMm' | 'model' | 'slots'>;

const generatedOf = (
  id: string,
  room: Room,
  rect: Rect,
  variant: FurnitureVariant | undefined,
  extra: Extra,
): Furniture => ({
  id: id as FurnitureId,
  levelId: room.levelId,
  roomId: room.id,
  kind: 'other',
  centre: { x: rect.cx, y: rect.cy },
  boundingBox: {
    min: { x: rect.cx - rect.w / 2, y: rect.cy - rect.d / 2 },
    max: { x: rect.cx + rect.w / 2, y: rect.cy + rect.d / 2 },
  },
  rotationDeg: rect.rotationDeg,
  ...(variant === undefined ? {} : { variant }),
  ...extra,
  source: 'ai',
  reviewed: false,
  confidence: 1,
});

/** Các món trang trí của cả đồ thị; `graph.furniture` đã gồm đồ tự bày (sceneFurnish). */
const isOwnDressed = (folder: string | null): boolean =>
  folder !== null && (CATALOG_MODELS[folder]?.dressed === true || isServerModel(folder));

export const dressingOf = (graph: SpatialGraph, style: SceneStyle): readonly Furniture[] => {
  const out: Furniture[] = [];
  const placed = graph.furniture.map((f) => ({ id: f.id as string, levelId: f.levelId, rect: rectOfFurniture(f) }));

  for (const room of [...graph.rooms].sort(byId)) {
    const swings = doorSwingRects(graph, room.levelId);
    const walls = wallRects(graph, room.levelId);
    const windows = windowRects(graph, room.levelId);
    const levelHeightMm = graph.levels.find((l) => l.id === room.levelId)?.heightMm ?? DEFAULT_LEVEL_HEIGHT_MM;
    const inRoom = graph.furniture
      .filter((f) => f.roomId === room.id)
      .sort(byId)
      .map((f) => ({ f, rect: rectOfFurniture(f), role: roleOf(f, room.usage) }));
    const withRole = (roles: ReadonlySet<FurnitureRole>) => inRoom.filter((item) => roles.has(item.role));
    const hasRug = withRole(RUG_ROLES).length > 0;

    const put = (id: string, rect: Rect, variant: FurnitureVariant | undefined, extra: Extra = {}): void => {
      out.push(generatedOf(id, room, rect, variant, extra));
      placed.push({ id, levelId: room.levelId, rect });
    };

    /**
     * Lấy hình hợp lệ đầu tiên trong `candidates`; `hosts` = món được phép nằm chồng;
     * `overSwings` = món phẳng (thảm) được nằm trong vùng mở cửa.
     */
    const tryPlace = (
      id: string,
      candidates: readonly Rect[],
      hosts: ReadonlySet<string>,
      variant: FurnitureVariant | undefined,
      extra: Extra = {},
      insetMm: number = ROOM_INSET_MM,
      overSwings = false,
    ): boolean => {
      const rect = candidates.find(
        (r) =>
          rectInsidePolygon(r, room.outline, insetMm) &&
          (overSwings || !swings.some((s) => rectsOverlap(r, s))) &&
          !walls.some((w) => rectsOverlap(r, w)) &&
          !placed.some(
            (p) => p.levelId === room.levelId && !hosts.has(p.id) && rectsOverlap(r, p.rect, FURNITURE_GAP_MM),
          ),
      );
      if (rect === undefined) return false;
      put(id, rect, variant, extra);
      return true;
    };

    // (1) Đèn bàn giữa mặt tủ đầu giường phòng ngủ, cao bằng tủ; cỡ mô hình, không vượt mặt tủ.
    // Luôn đặt: nằm gọn trên mặt tủ (đã hợp lệ), không thể chồng sàn/tường/cửa. Catalog chưa có cờ
    // "đèn bật" — variant `tableLamp` là móc cho lớp ánh sáng.
    if (room.usage === 'bedroom') {
      const lamp = CATALOG_MODELS[VARIANT_MODEL.tableLamp?.folder ?? '']?.dimensions;
      const lampW = lamp === undefined ? LAMP_FALLBACK_MM : lamp[0] * 1000;
      const lampD = lamp === undefined ? LAMP_FALLBACK_MM : lamp[2] * 1000;
      for (const { f, rect } of inRoom.filter((item) => item.role === 'nightstand')) {
        const top = rectAt(rect, 0, 0, Math.min(lampW, rect.w), Math.min(lampD, rect.d));
        // Vai đã có đồ thật phủ (đèn đã nhận khi người dùng sửa cả phòng — V4 — giờ đứng trên tủ `F-…` mới):
        // không sinh thêm. Không kiểm thì `DRESS-tableLamp-<id tủ mới>` mọc cạnh đèn đã nhận (id cũ nhúng host cũ).
        const covered = graph.furniture.some(
          (g) => g.id !== f.id && g.levelId === room.levelId && (g.variant === 'tableLamp' || (g.liftMm ?? 0) > 0) && rectsOverlap(top, rectOfFurniture(g)),
        );
        if (covered) continue;
        put(`DRESS-tableLamp-${f.id}`, top, 'tableLamp', { liftMm: f.heightMm ?? NIGHTSTAND_HEIGHT_MM });
      }
    }

    // (2) Một thảm dưới nhóm sofa: dài theo sofa, mép sau luồn dưới mặt trước, phủ bàn trà.
    if (room.usage === 'livingRoom' && !hasRug) {
      const group = withRole(SOFA_GROUP_ROLES);
      const hosts = new Set<string>(group.map((item) => item.f.id));
      for (const { rect } of group.filter((item) => item.role === 'sofa')) {
        const depthAxis = rect.w >= rect.d ? 1 : 0;
        const depth = depthAxis === 1 ? rect.d : rect.w;
        const front = openSideOf(rect, depthAxis, room.outline);
        // Cỡ theo nhóm: phủ tới quá mép xa nhất của bàn nước phía trước sofa.
        const axis = axesOf(rect.rotationDeg)[depthAxis];
        const frontPlane = depth / 2 - LIVING_RUG.underSofa;
        const reach = Math.max(
          0,
          ...group
            .filter((item) => item.role === 'coffeeTable')
            .flatMap((item) => rectCorners(item.rect))
            .map((c) => front * ((c.x - rect.cx) * axis.x + (c.y - rect.cy) * axis.y) - frontPlane),
        );
        const sofaLong = depthAxis === 1 ? rect.w : rect.d;
        const fullLong = Math.min(GROUP_RUG.maxLong, Math.max(LIVING_RUG.long, sofaLong + GROUP_RUG.extraLong));
        const fullDeep = Math.min(GROUP_RUG.maxDeep, Math.max(LIVING_RUG.deep, reach + GROUP_RUG.pastTable));
        const candidates = RUG_SCALES.map((k) => {
          const long = fullLong * k;
          const deep = fullDeep * k;
          const offset = front * (depth / 2 - LIVING_RUG.underSofa + deep / 2);
          return depthAxis === 1 ? rectAt(rect, 0, offset, long, deep) : rectAt(rect, offset, 0, deep, long);
        });
        if (tryPlace(`DRESS-rug-${room.id}`, candidates, hosts, 'rug', {}, ROOM_INSET_MM, true)) break;
      }
    }

    // (3) Thảm dưới 2/3 phía chân mỗi giường (đầu giường = đầu gần mép phòng hơn).
    if (room.usage === 'bedroom' && !hasRug) {
      for (const { f, rect } of withRole(BED_ROLES)) {
        const lengthAxis = rect.d >= rect.w ? 1 : 0;
        const length = lengthAxis === 1 ? rect.d : rect.w;
        const width = lengthAxis === 1 ? rect.w : rect.d;
        const foot = openSideOf(rect, lengthAxis, room.outline);
        const candidates = RUG_SCALES.map((k) => {
          const across = (width + BED_RUG.extraWidth) * k;
          const deep = BED_RUG.deep * k;
          const offset = foot * (-length / 2 + length / 3 + deep / 2);
          return lengthAxis === 1 ? rectAt(rect, 0, offset, across, deep) : rectAt(rect, offset, 0, deep, across);
        });
        tryPlace(`DRESS-rug-${f.id}`, candidates, new Set([f.id]), 'rug', {}, ROOM_INSET_MM, true);
      }
    }

    // (4) Thảm chân sát mặt thoáng nhất của vòi sen/bồn tắm (phía ra phòng).
    for (const { f, rect } of withRole(WET_ROLES)) {
      const faces = (
        [
          [1, 1],
          [1, -1],
          [0, 1],
          [0, -1],
        ] as const
      ).map(([axis, sign], order) => {
        const reach = sign * ((axis === 1 ? rect.d : rect.w) / 2 + BATH_MAT.deep / 2);
        const mat =
          axis === 1
            ? rectAt(rect, 0, reach, BATH_MAT.long, BATH_MAT.deep)
            : rectAt(rect, reach, 0, BATH_MAT.deep, BATH_MAT.long);
        return { mat, order, room: distanceToOutline({ x: mat.cx, y: mat.cy }, room.outline) };
      });
      // Xa mép phòng trước; bằng nhau giữ thứ tự +y, −y, +x, −x. Ưu tiên mặt ngoài vùng mở cửa;
      // không còn mặt nào thì thảm (phẳng) nằm trong vùng mở cửa.
      faces.sort((a, b) => b.room - a.room || a.order - b.order);
      const mats = faces.map((face) => face.mat);
      const hosts = new Set<string>([f.id]);
      const id = `DRESS-bathMat-${f.id}`;
      if (!tryPlace(id, mats, hosts, 'rug')) tryPlace(id, mats, hosts, 'rug', {}, ROOM_INSET_MM, true);
    }

    // ---- Đồ trang trí AppFront (FE3D-FIX-004 D): sau 4 quy tắc trên, nên không đổi kết quả của chúng. ----
    /** Đồ trang trí không có variant: mẫu AppFront theo `model`, cỡ thật của GLB, khe theo phong cách. */
    const decor = (folder: string, liftMm: number): Extra => {
      const slots = itemSlotsOf(folder, style) as Furniture['slots'];
      return {
        model: { id: `appfront-decor-${folder}`, src: modelSrcOf(folder) },
        liftMm: Math.round(liftMm) as Millimetres,
        heightMm: Math.round((CATALOG_MODELS[folder]?.dimensions[1] ?? 0) * 1000) as Millimetres,
        ...(slots === undefined ? {} : { slots }),
      };
    };
    // Mặt đặt đồ đo từ GLB (nệm, đệm ngồi, mặt bàn); tỉ lệ mặc định chỉ cho mẫu chưa đo.
    const topOf = (f: Furniture, fraction = 1): number => hostTopMm(f, style, room.usage, fraction);
    /** Món chủ + mọi thảm (thật và sinh ra): đồ trang trí nằm trên/treo trên thảm được. */
    const over = (...ids: string[]): ReadonlySet<string> =>
      new Set([...ids, ...withRole(RUG_ROLES).map((i) => i.f.id as string), ...out.filter((o) => o.variant === 'rug').map((o) => o.id as string)]);

    // (6) Chăn gấp ở chân giường, trên mặt nệm. (5) Gối tựa đầu giường đã bỏ (review2): mẫu `double-bed`
    // của mọi giường có sẵn 3 gối, gối dựng thêm cắt vào đầu giường.
    for (const { f, rect } of withRole(BED_ROLES)) {
      // Mẫu thư viện máy chủ đã dựng sẵn chăn gối: chăn gấp thêm sẽ lơ lửng/cắt vào nệm.
      if (isOwnDressed(modelFolderOf(f, style, room.usage))) continue;
      const lengthAxis = rect.d >= rect.w ? 1 : 0;
      const length = lengthAxis === 1 ? rect.d : rect.w;
      const foot = openSideOf(rect, lengthAxis, room.outline);
      const lift = topOf(f, BED_MATTRESS_FRACTION);
      const throwAlong = foot * (length / 2 - THROW.d / 2 - THROW.fromFoot);
      tryPlace(
        `DRESS-throw-${f.id}`,
        [facing(rect, lengthAxis, 0, throwAlong, THROW.w, THROW.d, foot)],
        over(f.id),
        undefined,
        decor('throw-blanket', lift),
      );
    }

    // (7) Gối sofa: 3 nếu sofa dài, không thì 2 — tựa lưng sofa, trên mặt đệm ngồi.
    for (const { f, rect } of withRole(new Set<FurnitureRole>(['sofa']))) {
      if (isOwnDressed(modelFolderOf(f, style, room.usage))) continue;
      const depthAxis = rect.w >= rect.d ? 1 : 0;
      const depth = depthAxis === 1 ? rect.d : rect.w;
      const long = depthAxis === 1 ? rect.w : rect.d;
      const front = openSideOf(rect, depthAxis, room.outline);
      const along = -front * (depth / 2 - SOFA_BACK_MM - PILLOW.d / 2);
      const step = PILLOW.w + PILLOW.gap + 20;
      const across = long >= SOFA_THREE_PILLOWS_MM ? [-step, 0, step] : [-step / 2, step / 2];
      across.forEach((a, n) =>
        tryPlace(
          `DRESS-pillow-${f.id}-${n}`,
          [facing(rect, depthAxis, a, along, PILLOW.w, PILLOW.d, front)],
          over(f.id),
          undefined,
          decor('pillow', topOf(f, SOFA_SEAT_FRACTION)),
        ),
      );
    }

    // (8) Bình gốm giữa mặt bàn ăn và bàn phụ (đầu giường đã có đèn thì vướng đèn → bỏ).
    for (const { f, rect } of withRole(VASE_HOST_ROLES)) {
      const vase = CATALOG_MODELS[VARIANT_MODEL.vase?.folder ?? '']?.dimensions;
      if (vase === undefined) continue;
      tryPlace(
        `DRESS-vase-${f.id}`,
        [rectAt(rect, 0, 0, vase[0] * 1000, vase[2] * 1000)],
        over(f.id),
        'vase',
        { liftMm: Math.round(topOf(f)) as Millimetres },
      );
    }

    // (9) Khung tranh trên tường sau lưng sofa / đầu giường, nếu đoạn tường ấy trống (không cửa sổ, không đồ).
    for (const { f, rect, role } of inRoom.filter((item) => item.role === 'sofa' || BED_ROLES.has(item.role))) {
      const bed = BED_ROLES.has(role);
      const axis = bed ? (rect.d >= rect.w ? 1 : 0) : rect.w >= rect.d ? 1 : 0;
      const back = -openSideOf(rect, axis, room.outline) as 1 | -1;
      const half = (axis === 1 ? rect.d : rect.w) / 2;
      const frame = CATALOG_MODELS[FRAME_FOLDER]?.dimensions;
      if (frame === undefined) continue;
      const [fw, fh, fd] = [frame[0] * 1000, frame[1] * 1000, frame[2] * 1000];
      const mount = againstWall(rect, axis, back, half, fw, fd, walls);
      if (mount === undefined) continue;
      // Tranh trên ĐỈNH món (đầu giường, tựa lưng sofa), không phải mặt đặt đồ.
      const lift = Math.max(FRAME_MIN_LIFT_MM, hostHeightMm(f, style, room.usage) + FRAME_ABOVE_HOST_MM);
      if (windows.some((w) => rectsOverlap(mount, w)) || lift + fh > levelHeightMm) continue;
      tryPlace(`DRESS-frame-${f.id}`, [mount], over(f.id), undefined, decor(FRAME_FOLDER, lift), 0);
    }

    // (10) Rèm hai bên mỗi cửa sổ phòng khách / phòng ngủ: áp mặt tường phía phòng, chừa cửa đi.
    if (CURTAIN_USAGES.has(room.usage)) {
      for (const win of windowsOfRoom(graph, room)) {
        const [cw, , cd] = CATALOG_MODELS['curtain']?.dimensions ?? [0, 0, 0];
        const panelW = cw * 1000;
        const panelD = cd * 1000;
        (['L', 'R'] as const).forEach((side) => {
          const sign = side === 'L' ? -1 : 1;
          const candidates = CURTAIN_OVERLAPS_MM.map((overlap) =>
            facing(win.frame, 1, sign * (win.width / 2 + panelW / 2 - overlap), win.inward * (win.thickness / 2 + panelD / 2 + CURTAIN_WALL_GAP_MM), panelW, panelD, win.inward),
          );
          tryPlace(`DRESS-curtain-${win.id}-${side}`, candidates, over(), undefined, decor('curtain', 0), 0);
        });
      }
    }
  }

  return out;
};
