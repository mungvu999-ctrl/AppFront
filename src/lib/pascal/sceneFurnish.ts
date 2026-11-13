/**
 * Bày đồ cho phòng trống (J10, U12c). Bản vẽ CubiCasa và bản quét AI chỉ có đồ cố định (tủ,
 * WC, tủ áo) nên phòng ngủ/phòng khách lên cảnh trống trơn. Ở đây sinh thêm vài món theo LUẬT
 * chung — chỉ từ công năng, outline, cửa và đồ thật của phòng, không bao giờ theo id/kích thước
 * của một bản vẽ cụ thể — và không bao giờ lưu về đồ thị.
 *
 * Mỗi món sinh ra phải hợp lệ (placement.ts): nằm trong outline lùi 100 mm, cách mọi đồ thật
 * và đồ sinh trước ≥ 50 mm, không lấn vùng mở cửa. Món nào không hợp lệ thì thử cạnh kế, rồi
 * bỏ — không bao giờ xê dịch đồ thật. Thứ tự cố định (phòng theo id, luật theo thứ tự) nên
 * cùng đồ thị luôn ra cùng kết quả, không có sửa ảo khi so diff.
 */

import { computeArea, computeLargestInnerRectangle, outlineContains } from '@/domain/rooms/area';
import type {
  Furniture,
  FurnitureId,
  FurnitureKind,
  FurnitureVariant,
  Point,
  Room,
  SpatialGraph,
} from '@/domain/spatial/types';
import type { PointMm } from '@/domain/units/compare';
import { degrees, millimetres } from '@/domain/units/types';

import { modelSrcOf } from './furnitureCatalog';
import {
  BED_SIDE_MM,
  CHAIR_CLEAR_MM,
  DOOR_APPROACH_MM,
  OPENING_MARGIN_MM,
  doorSwingRects,
  furnitureFacingDeg,
  rectInsidePolygon,
  rectOfFurniture,
  rectsOverlap,
  roomEdges,
  wallRects,
  type Rect,
  type RoomEdge,
} from './placement';
import type { SceneStyle } from './sceneStyles';
import { roleOf } from './sceneVariety';

/** Lùi khỏi outline phòng. */
const INSET_MM = 100;
/** Khe tối thiểu giữa hai món. */
const GAP_MM = 50;
/** Đặt cách mép lùi/khe thêm 1 mm để tâm làm tròn về mm nguyên vẫn hợp lệ. */
const SLACK_MM = 1;
/** Bàn nước đặt trước sofa một lối đi. */
const COFFEE_TABLE_REACH_MM = 450;
/** Khoảng giữa bàn nước và ghế bành. */
const ARMCHAIR_REACH_MM = 300;
/** Lưới tâm thử cho bàn ăn. */
const GRID_MM = 200;

/** Ngưỡng diện tích (m²) và cạnh ngắn (mm) của từng luật. */
const BEDROOM_MIN_M2 = 6;
const DOUBLE_BED_MIN_M2 = 9;
const DOUBLE_BED_MIN_SHORT_MM = 2600;
// Phòng khách nhà phố thường 8–10 m²: vẫn đủ một sofa 2 m (V5 D1).
const LIVING_MIN_M2 = 8;
const KITCHEN_DINING_MIN_M2 = 10;
/** Bếp 9–10 m² (hoặc bộ 4 ghế không vừa): bàn nhỏ 2 ghế. */
const KITCHEN_SMALL_TABLE_MIN_M2 = 9;
const LIVING_DINING_MIN_M2 = 18;
/** Phòng ngủ từ mức này có thêm tủ, bàn làm việc/ghế bành. */
const BEDROOM_EXTRAS_MIN_M2 = 12;
/** Phòng 'other' (trong nhà) từ mức này bày thành phòng đọc/ngồi. */
const OTHER_MIN_M2 = 8;
/** Mật độ: khoảng 1 món đứng trên sàn mỗi 2,5 m² (dày như bản render Blender); phòng có ít hơn coi là thưa. */
const M2_PER_PIECE = 2.5;
/** Đầu đoạn trống chừa thêm cho tường vuông góc dày (tường ngoài 300 mm). */
const END_CLEAR_MM = 160;
/** Bù mật độ: tối đa một cây mỗi phòng (cây lặp lại trông như kho cây). */
const MAX_FILL_PLANTS = 1;
/** Hành lang được bày từ mức này (m²) và bề rộng này (mm); luôn chừa lối đi 900 mm. */
const CORRIDOR_MIN_M2 = 8;
const CORRIDOR_MIN_WIDTH_MM = 1800;
const WALKWAY_MM = 900;
/** Phòng tắm có cạnh ngắn (hình chữ nhật trong lớn nhất) từ mức này thì thử thêm bồn tắm. */
const BATHTUB_MIN_SHORT_MM = 1700;
/** Ban công/lô-gia từ mức này có chậu cây dọc lan can; ghế nằm từ OTHER_MIN_M2. */
const OUTDOOR_MIN_M2 = 2;
/** Tường phủ dưới tỉ lệ chu vi này: đồ thị tường không mô tả phòng (mẫu mock, dò hỏng) → coi mọi cạnh có tường. */
const MIN_WALLED_FRACTION = 0.25;
/** Bếp mở từ mức này (m²) mà tầng không có phòng khách: bày thêm bộ sofa. */
const OPEN_KITCHEN_LIVING_MIN_M2 = 18;
/** Dãy tủ bếp dưới: dài tối đa, ngắn nhất đáng đặt. */
const BASE_RUN_MAX_MM = 3600;
const BASE_RUN_MIN_MM = 1200;
/** Dãy từ mức này có cả chậu lẫn bếp nấu; ngắn hơn chỉ chậu. */
const RUN_HOB_MIN_MM = 1600;
/** Lối đi giữa hai cửa (rộng); chỗ kéo ghế quanh bàn ăn là CHAIR_CLEAR_MM (placement.ts). */
const DOOR_PATH_MM = 900;
/** Phòng tắm từ mức này có thêm khu tắm vòi sen (góc tắm nhỏ 800 khi 900 không vừa). */
const SHOWER_MIN_M2 = 2;
/**
 * Phòng 'other'/hành lang rộng từ mức này (m², cạnh ngắn hình chữ nhật trong lớn nhất mm) là
 * phòng sinh hoạt bị gọi chung: bày như phòng khách (khu khách + khu ăn) thay vì để trống.
 */
const OPEN_LIVING_MIN_M2 = 25;
const OPEN_LIVING_MIN_SHORT_MM = 2400;
/** Khoảng trống sau lưng ghế ăn tới đồ khác (lối đi, chỗ đứng trước tủ bếp). */
const DINING_BACK_CLEAR_MM = 600;
/** Vùng xem TV trước sofa khi chưa có TV (sâu, mm). */
const SOFA_VIEW_MM = 3000;
/** Bếp mở trong phòng khách: dãy từ mức này (mm, kể cả tủ lạnh) được ưu tiên đoạn xa cửa. */
const OPEN_KITCHEN_RUN_MM = 2400;
/** Chậu dọc lan can: khe giữa hai chậu, tối đa số chậu mỗi phòng. */
const PLANTER_SPACING_MM = 400;
const MAX_PLANTERS = 6;
/** Phòng ngoài trời: lát decking hoặc tên ban công/sân hiên (vi, en, fi). */
const OUTDOOR_NAME = /ban công|sân thượng|hiên|terrace|balcon|patio|ulkotila|parveke|terassi/i;

interface Piece {
  readonly role: string;
  readonly kind: FurnitureKind;
  readonly variant?: FurnitureVariant;
  /** Rộng theo x riêng (dọc tường), sâu theo y riêng; mặt trước là +y riêng (K1). */
  readonly w: number;
  readonly d: number;
  readonly heightMm?: number;
  /** Đặt trên món khác (TV trên kệ). */
  readonly liftMm?: number;
  /** Mẫu riêng (thư mục) khi variant không nói đúng mẫu — vai trò vẫn theo variant. */
  readonly model?: string;
}

const DOUBLE_BED: Piece = { role: 'bed', kind: 'bed', variant: 'bed', w: 1600, d: 2000 };
// Không variant → vai trò giường đơn theo hộp bao.
const SINGLE_BED: Piece = { role: 'bed', kind: 'bed', w: 900, d: 2000 };
const NIGHTSTAND: Piece = { role: 'nightstand', kind: 'table', variant: 'nightstand', w: 450, d: 400 };
const SOFA: Piece = { role: 'sofa', kind: 'other', variant: 'sofa', w: 2000, d: 900 };
// Không variant: bàn thấp trong phòng khách → vai trò bàn nước.
const COFFEE_TABLE: Piece = { role: 'coffeeTable', kind: 'table', w: 1100, d: 600, heightMm: 400 };
// Kệ TV thấp tựa tường (mẫu `tv-stand`; variant `cabinet` để vai trò là tủ thấp, không bị đoán là sofa),
// TV đứng trên mặt kệ (P3) — trước đây TV chân đế đứng thẳng trên sàn như tấm chắn.
const TV_STAND_HEIGHT_MM = 450;
const TV_STAND: Piece = {
  role: 'tvStand',
  kind: 'other',
  variant: 'cabinet',
  model: 'tv-stand',
  w: 1600,
  d: 400,
  heightMm: TV_STAND_HEIGHT_MM,
};
const TV: Piece = { role: 'tv', kind: 'other', variant: 'tv', w: 1300, d: 300, liftMm: TV_STAND_HEIGHT_MM };
const ARMCHAIR: Piece = { role: 'armchair', kind: 'chair', variant: 'armchair', w: 650, d: 650 };
const DINING_TABLE: Piece = { role: 'diningTable', kind: 'table', variant: 'table', w: 1400, d: 800 };
const CHAIR: Piece = { role: 'chair', kind: 'chair', variant: 'chair', w: 450, d: 450 };
const SMALL_TABLE: Piece = { role: 'smallTable', kind: 'table', w: 900, d: 700 };
// Chỉ dùng variant đã có mô hình (VARIANT_MODEL); cỡ gần mô hình catalog.
const WARDROBE: Piece = { role: 'wardrobe', kind: 'wardrobe', variant: 'wardrobe', w: 1800, d: 600 };
const DRESSER: Piece = { role: 'dresser', kind: 'other', variant: 'cabinet', w: 1200, d: 600 };
const BOOKSHELF: Piece = { role: 'bookshelf', kind: 'other', variant: 'shelves', w: 900, d: 350 };
// Không variant: bàn ≤ 0,8 × 1,6 m ở phòng ngủ/'other' → vai trò bàn làm việc (sceneVariety).
const DESK: Piece = { role: 'desk', kind: 'table', w: 1200, d: 600 };
const DESK_CHAIR: Piece = { role: 'deskChair', kind: 'chair', w: 500, d: 500 };
const FLOOR_LAMP: Piece = { role: 'floorLamp', kind: 'other', variant: 'floorLamp', w: 500, d: 500 };
const SIDE_TABLE: Piece = { role: 'sideTable', kind: 'table', variant: 'sideTable', w: 450, d: 450 };
const PLANT: Piece = { role: 'plant', kind: 'other', variant: 'plant', w: 600, d: 600 };
const LOUNGER: Piece = { role: 'lounger', kind: 'chair', variant: 'lounger', w: 860, d: 1900 };
// Luống dài sát lan can (mẫu bush / planter-long, cùng tỉ lệ dài ≈ 3:1).
const PLANTER: Piece = { role: 'planter', kind: 'other', variant: 'planter', w: 1200, d: 400 };
// Bếp: dãy tủ dưới (dài theo đoạn tường), tủ treo nông phía trên, tủ lạnh một đầu dãy; chậu và
// mặt bếp mỏng 20 mm nằm trên mặt đá (toPascal nâng lên counterTopMmOf, dãy có chậu dùng mẫu chậu).
const BASE_RUN: Piece = { role: 'baseRun', kind: 'kitchenCabinet', variant: 'baseRun', w: BASE_RUN_MAX_MM, d: 600 };
const UPPER_RUN: Piece = { role: 'upperRun', kind: 'kitchenCabinet', variant: 'upperRun', w: BASE_RUN_MAX_MM, d: 350 };
const FRIDGE: Piece = { role: 'fridge', kind: 'other', variant: 'fridge', w: 700, d: 700 };
const SINK: Piece = { role: 'sink', kind: 'sanitaryFixture', variant: 'sink', w: 800, d: 450, heightMm: 20 };
const HOB: Piece = { role: 'hob', kind: 'other', variant: 'hob', w: 600, d: 500, heightMm: 20 };
// Phòng tắm: nhận diện đồ đã tắt nên bản vẽ không còn cấp thiết bị vệ sinh (mẫu toilet / bathroom-sink / shower-square).
const WC: Piece = { role: 'wc', kind: 'sanitaryFixture', variant: 'wc', w: 400, d: 700 };
const BASIN: Piece = { role: 'basin', kind: 'sanitaryFixture', variant: 'basin', w: 600, d: 450 };
const SHOWER: Piece = { role: 'shower', kind: 'shower', variant: 'shower', w: 900, d: 900 };
const SMALL_SHOWER: Piece = { ...SHOWER, w: 800, d: 800 };
// Không variant: thiết bị vệ sinh dài ≥ 1,4 m → vai trò bồn tắm (sceneVariety, mẫu `bathtub`).
const BATHTUB: Piece = { role: 'bathtub', kind: 'sanitaryFixture', w: 1700, d: 750 };
// Bù mật độ: tủ thấp làm tủ chén ở phòng khách; hành lang có bàn console nông + ghế băng.
const SIDEBOARD: Piece = { ...DRESSER, role: 'sideboard' };
const CONSOLE: Piece = { role: 'console', kind: 'other', variant: 'cabinet', w: 1000, d: 350 };
const BENCH: Piece = { role: 'bench', kind: 'chair', variant: 'bench', w: 1200, d: 400 };

interface Span {
  readonly from: number;
  readonly to: number;
}

interface RankedEdge {
  readonly edge: RoomEdge;
  readonly span: Span;
}

interface Ctx {
  readonly room: Room;
  /** Công năng lưu trong đồ thị (khác `room.usage` khi phòng 'other' rộng được bày như phòng khách). */
  readonly storedUsage: Room['usage'];
  /** Outline (mm) các phòng khác cùng tầng: đồ của phòng này không đứng (tâm) trong phòng khác. */
  readonly others: readonly (readonly PointMm[])[];
  readonly swings: readonly Rect[];
  /** Vùng đứng trước cửa + lối 900 mm giữa các cửa của phòng (P4): mọi món đứng trên sàn tránh. */
  readonly clear: readonly Rect[];
  /** Chỉ vùng đứng trước cửa: món chính (giường, sofa) không còn chỗ ngoài lối đi thì lùi về đây. */
  readonly approach: readonly Rect[];
  /** Thân tường cùng tầng (wallRects). */
  readonly walls: readonly Rect[];
  /** Đoạn trống khi cả cửa đi lẫn cửa sổ chặn — cho món cao (tủ áo, giá sách, TV). */
  readonly clearSpans: readonly RankedEdge[];
  /** Cạnh phòng có cả cửa sổ (cùng thứ tự outline). */
  readonly windowEdges: readonly RoomEdge[];
  /** Đồ chiếm chỗ cùng tầng: đồ thật (trừ thảm) + đồ đã sinh; được nối thêm khi đặt. */
  readonly taken: Rect[];
  readonly out: Furniture[];
}

const lengthOf = (span: Span): number => span.to - span.from;

const toMm = (p: Point): PointMm => ({ x: millimetres(p.x), y: millimetres(p.y) });

/** Trục riêng x, y của một góc xoay trên mặt bằng. */
const axesOf = (rotationDeg: number): readonly [Point, Point] => {
  const t = (rotationDeg * Math.PI) / 180;
  return [
    { x: Math.cos(t), y: Math.sin(t) },
    { x: -Math.sin(t), y: Math.cos(t) },
  ];
};

const directionOf = (edge: RoomEdge): Point => ({
  x: (edge.b.x - edge.a.x) / edge.lengthMm,
  y: (edge.b.y - edge.a.y) / edge.lengthMm,
});

const turn = (rotationDeg: number, byDeg: number): number => (rotationDeg + byDeg) % 360;

/**
 * Các đoạn trống của cạnh sau khi trừ các khoảng cửa (mỗi bên thêm 100 mm) và — trừ khi `open` —
 * mọi đoạn không có tường thật phía sau (phòng thông nhau, khe giữa hai tường): lưng sofa/TV/giường
 * không được quay ra chỗ trống. Theo thứ tự dọc cạnh.
 */
const freeSpans = (edge: RoomEdge, open = false): Span[] => {
  const blocked: Span[] = edge.openings.map((o) => ({ from: o.fromMm - OPENING_MARGIN_MM, to: o.toMm + OPENING_MARGIN_MM }));
  if (!open) {
    let wallEnd = 0;
    for (const w of edge.walled) {
      if (w.fromMm > wallEnd) blocked.push({ from: wallEnd, to: w.fromMm });
      wallEnd = w.toMm;
    }
    if (edge.lengthMm > wallEnd) blocked.push({ from: wallEnd, to: edge.lengthMm });
  }
  blocked.sort((p, q) => p.from - q.from || p.to - q.to);
  const spans: Span[] = [];
  let cursor = 0;
  for (const b of blocked) {
    if (b.from > cursor) spans.push({ from: cursor, to: b.from });
    cursor = Math.max(cursor, b.to);
  }
  if (edge.lengthMm > cursor) spans.push({ from: cursor, to: edge.lengthMm });
  return spans;
};

/** Đoạn trống dài nhất (hoà: đoạn đầu). */
const widestSpan = (edge: RoomEdge): Span =>
  freeSpans(edge).reduce((best, s) => (lengthOf(s) > lengthOf(best) ? s : best), { from: 0, to: 0 });

/** Tâm và góc của món tựa lưng vào cạnh tại vị trí `t` dọc cạnh, mặt trước quay vào phòng. */
const againstEdge = (edge: RoomEdge, t: number, piece: Piece): { at: Point; rotationDeg: number } => {
  const e = directionOf(edge);
  // Tường ngoài dày 300 mm: nửa dày (150) vượt mức lùi 100, lưng món phải tránh thân tường.
  const off = Math.max(INSET_MM, edge.wallHalfMm) + SLACK_MM + piece.d / 2;
  return {
    at: { x: edge.a.x + e.x * t + edge.inwardNormal.x * off, y: edge.a.y + e.y * t + edge.inwardNormal.y * off },
    rotationDeg: furnitureFacingDeg(edge.inwardNormal),
  };
};

const furnitureOf = (ctx: Ctx, piece: Piece, at: Point, rotationDeg: number, n?: number): Furniture => {
  const cx = Math.round(at.x);
  const cy = Math.round(at.y);
  return {
    id: `DRESS-${piece.role}-${ctx.room.id}${n === undefined ? '' : `-${n}`}` as FurnitureId,
    levelId: ctx.room.levelId,
    roomId: ctx.room.id,
    kind: piece.kind,
    ...(piece.variant === undefined ? {} : { variant: piece.variant }),
    ...(piece.heightMm === undefined ? {} : { heightMm: millimetres(piece.heightMm) }),
    ...(piece.liftMm === undefined ? {} : { liftMm: millimetres(piece.liftMm) }),
    ...(piece.model === undefined ? {} : { model: { id: `appfront-decor-${piece.model}`, src: modelSrcOf(piece.model) } }),
    centre: { x: cx, y: cy },
    boundingBox: {
      min: { x: cx - piece.w / 2, y: cy - piece.d / 2 },
      max: { x: cx + piece.w / 2, y: cy + piece.d / 2 },
    },
    rotationDeg: degrees(rotationDeg),
    source: 'ai',
    reviewed: false,
    confidence: 1,
  };
};

/** Đặt món nếu hợp lệ; trả về món đã đặt hoặc null (bỏ qua). */
const place = (ctx: Ctx, piece: Piece, at: Point, rotationDeg: number, n?: number): Furniture | null => {
  const item = furnitureOf(ctx, piece, at, rotationDeg, n);
  const rect = rectOfFurniture(item);
  const valid =
    rectInsidePolygon(rect, ctx.room.outline, INSET_MM) &&
    // Outline hai phòng chồng nhau (dò phòng lệch): không bày đồ của phòng này vào phòng kia.
    !ctx.others.some((outline) => outlineContains(outline, toMm(item.centre))) &&
    !ctx.taken.some((other) => rectsOverlap(rect, other, GAP_MM)) &&
    !ctx.swings.some((swing) => rectsOverlap(rect, swing)) &&
    !ctx.clear.some((zone) => rectsOverlap(rect, zone)) &&
    // Kể cả tường ngăn không nằm trên outline (bàn bếp F1 từng xuyên tường đông).
    !ctx.walls.some((wall) => rectsOverlap(rect, wall));
  if (!valid) return null;
  ctx.taken.push(rect);
  ctx.out.push(item);
  return item;
};

/** Gỡ món vừa đặt cuối cùng (bộ bàn + ghế: ghế không vừa thì bỏ cả bàn). */
const unplaceLast = (ctx: Ctx): void => {
  ctx.taken.pop();
  ctx.out.pop();
};

/**
 * Cạnh phòng (roomEdges); tường phủ dưới 25 % chu vi thì đồ thị tường không mô tả phòng này (mẫu
 * mock chỉ có mẩu tường 1 m, phòng dò thiếu tường) → coi mọi cạnh có tường như trước bench-3d.
 */
const edgesOf = (room: Room, graph: SpatialGraph): RoomEdge[] => {
  const edges = roomEdges(room, graph);
  const total = edges.reduce((sum, e) => sum + e.lengthMm, 0);
  const walled = edges.reduce((sum, e) => sum + e.walled.reduce((t, w) => t + w.toMm - w.fromMm, 0), 0);
  if (walled >= MIN_WALLED_FRACTION * total) return edges;
  return edges.map((e) => ({ ...e, walled: [{ fromMm: 0, toMm: e.lengthMm }] }));
};

/**
 * Cạnh phòng xếp theo đoạn trống giảm dần, rồi theo thứ tự cạnh. Chỉ CỬA ĐI chặn đoạn trống:
 * đầu giường/lưng sofa tựa dưới cửa sổ là bình thường, còn để cửa sổ chặn thì phòng nhỏ không
 * còn cạnh nào đủ dài (nguyên nhân chính của phòng trống, V5 D1).
 */
const rankedEdges = (room: Room, graph: SpatialGraph): RankedEdge[] =>
  edgesOf(room, { ...graph, openings: graph.openings.filter((o) => o.kind === 'door') })
    .map((edge, index) => ({ edge, span: widestSpan(edge), index }))
    .sort((p, q) => lengthOf(q.span) - lengthOf(p.span) || p.index - q.index);

/** MỌI đoạn trống của mọi cạnh (dài trước, rồi thứ tự cạnh, rồi dọc cạnh); `open` = kể cả đoạn không tường. */
const allSpans = (edges: readonly RoomEdge[], open = false): RankedEdge[] =>
  edges
    .flatMap((edge, index) => freeSpans(edge, open).map((span) => ({ edge, span, index })))
    .sort((p, q) => lengthOf(q.span) - lengthOf(p.span) || p.index - q.index || p.span.from - q.span.from);

/**
 * Vị trí thử dọc đoạn trống: giữa đoạn, rồi sát hai đầu (nửa món + lùi đủ tường vuông góc).
 * Đồ thật như tủ áo hay chiếm giữa tường; trượt về một đầu thường còn chỗ (V5 D1).
 */
const endsOf = (span: Span, half: number): [number, number] => {
  const end = half + END_CLEAR_MM + SLACK_MM;
  return [span.from + end, span.to - end];
};
const slotsOf = (span: Span, half: number): number[] => [
  ...new Set([(span.from + span.to) / 2, ...endsOf(span, half)]),
];

/** Món tựa tường ở chỗ hợp lệ đầu tiên: đoạn dài trước; `ends` = chỉ sát hai đầu (góc phòng). */
const alongWall = (
  ctx: Ctx,
  spans: readonly RankedEdge[],
  piece: Piece,
  n?: number,
  ends = false,
): { item: Furniture; edge: RoomEdge; t: number } | null => {
  for (const { edge, span } of spans) {
    if (lengthOf(span) < piece.w) continue;
    for (const t of ends ? endsOf(span, piece.w / 2) : slotsOf(span, piece.w / 2)) {
      const spot = againstEdge(edge, t, piece);
      const item = place(ctx, piece, spot.at, spot.rotationDeg, n);
      if (item !== null) return { item, edge, t };
    }
  }
  return null;
};

/** Hai món nhỏ sát hai đầu một món tựa cạnh (đèn cây / bàn phụ cạnh sofa, ghế bành). */
const flank = (ctx: Ctx, edge: RoomEdge, t: number, hostW: number, pieces: readonly Piece[]): void => {
  const sides = [-1, 1];
  for (const piece of pieces) {
    for (const side of [...sides]) {
      const spot = againstEdge(edge, t + side * (hostW / 2 + GAP_MM + SLACK_MM + piece.w / 2), piece);
      if (place(ctx, piece, spot.at, spot.rotationDeg) !== null) {
        sides.splice(sides.indexOf(side), 1);
        break;
      }
    }
  }
};

/** Bàn + ghế quay vào bàn; ghế không vừa thì gỡ bàn. */
const deskSet = (ctx: Ctx, spans: readonly RankedEdge[]): boolean => {
  for (const { edge, span } of spans) {
    if (lengthOf(span) < DESK.w) continue;
    for (const t of slotsOf(span, DESK.w / 2)) {
      const spot = againstEdge(edge, t, DESK);
      const desk = place(ctx, DESK, spot.at, spot.rotationDeg);
      if (desk === null) continue;
      const n = edge.inwardNormal;
      const reach = DESK.d / 2 + GAP_MM + SLACK_MM + DESK_CHAIR.d / 2;
      const at = { x: desk.centre.x + n.x * reach, y: desk.centre.y + n.y * reach };
      if (place(ctx, DESK_CHAIR, at, furnitureFacingDeg({ x: -n.x, y: -n.y })) !== null) return true;
      unplaceLast(ctx);
    }
  }
  return false;
};

const bedSet = (ctx: Ctx, edges: readonly RankedEdge[], areaM2: number): boolean => {
  const inner = computeLargestInnerRectangle(ctx.room.outline.map(toMm));
  const short = inner === null ? 0 : Math.min(inner.widthMm, inner.heightMm);
  const big = short >= DOUBLE_BED_MIN_SHORT_MM && areaM2 >= DOUBLE_BED_MIN_M2;
  // Giường đôi không vừa chỗ nào thì vẫn thử giường đơn.
  for (const bed of big ? [DOUBLE_BED, SINGLE_BED] : [SINGLE_BED]) {
    for (const { edge, span } of edges) {
      if (lengthOf(span) < bed.w + 2 * BED_SIDE_MM) continue;
      for (const t of slotsOf(span, bed.w / 2 + BED_SIDE_MM)) {
        const spot = againstEdge(edge, t, bed);
        if (place(ctx, bed, spot.at, spot.rotationDeg) === null) continue;
        [-1, 1].forEach((side, i) => {
          const s = againstEdge(edge, t + side * (bed.w / 2 + GAP_MM + SLACK_MM + NIGHTSTAND.w / 2), NIGHTSTAND);
          place(ctx, NIGHTSTAND, s.at, s.rotationDeg, i + 1);
        });
        return true;
      }
    }
  }
  return false;
};

/** Giường ngoài vùng chừa cửa; không chỗ nào thì nới dần (relaxedCtxs). */
const furnishBedroom = (ctx: Ctx, edges: readonly RankedEdge[], areaM2: number): void => {
  relaxedCtxs(ctx).some((c) => bedSet(c, edges, areaM2));
};

/** Sofa ở chỗ hợp lệ đầu tiên dọc đoạn (giữa rồi hai đầu). */
const sofaOn = (ctx: Ctx, edge: RoomEdge, span: Span): { sofa: Furniture; t: number; rotationDeg: number } | null => {
  for (const t of slotsOf(span, SOFA.w / 2)) {
    const spot = againstEdge(edge, t, SOFA);
    const sofa = place(ctx, SOFA, spot.at, spot.rotationDeg);
    if (sofa !== null) return { sofa, t, rotationDeg: spot.rotationDeg };
  }
  return null;
};

/**
 * Kệ TV + TV trên kệ, trên cạnh đối diện mà TRỤC sofa cắt qua (phòng chữ L: không lấy cạnh lồi lệch
 * khỏi tầm nhìn), cạnh gần nhất trước; trong đoạn có tường thật không cửa đi/cửa sổ, gần trục nhất.
 */
const placeTv = (ctx: Ctx, sofa: Furniture, n: Point): boolean => {
  const facing = ctx.windowEdges
    .filter((other) => other.inwardNormal.x * n.x + other.inwardNormal.y * n.y < -0.99)
    .map((other) => {
      const f = directionOf(other);
      return {
        other,
        want: (sofa.centre.x - other.a.x) * f.x + (sofa.centre.y - other.a.y) * f.y,
        ahead: (other.a.x - sofa.centre.x) * n.x + (other.a.y - sofa.centre.y) * n.y,
      };
    })
    .filter(({ other, want, ahead }) => ahead > 0 && want >= 0 && want <= other.lengthMm)
    .sort((p, q) => p.ahead - q.ahead);
  const half = TV_STAND.w / 2;
  for (const { other, want } of facing) {
    const slots = freeSpans(other)
      .filter((s) => lengthOf(s) >= 2 * half)
      .map((s) => Math.min(Math.max(want, s.from + half), s.to - half))
      .sort((p, q) => Math.abs(p - want) - Math.abs(q - want));
    for (const t of slots) {
      const spot = againstEdge(other, t, TV_STAND);
      if (place(ctx, TV_STAND, spot.at, spot.rotationDeg) === null) continue;
      // TV áp lưng cùng mép sau với kệ.
      stack(ctx, TV, other, t);
      return true;
    }
  }
  return false;
};

/**
 * Bộ sofa: ưu tiên cạnh mà sofa có được TV đối diện (thử lần lượt các cạnh), không cạnh nào được
 * thì sofa ở chỗ hợp lệ đầu tiên, không TV. Rồi bàn nước, đèn cây + bàn phụ hai đầu sofa, và ghế bành
 * hai bên bàn nước quay vào bàn — cả nhóm quanh một tâm, không rải ghế dọc tường (P7).
 */
const furnishLiving = (strict: Ctx, edges: readonly RankedEdge[]): void => {
  const fits = edges.filter(({ span }) => lengthOf(span) >= SOFA.w);
  let found: { sofa: Furniture; t: number; rotationDeg: number; edge: RoomEdge } | null = null;
  // Ngoài vùng chừa cửa trước; không chỗ nào thì nới dần (relaxedCtxs).
  for (const ctx of relaxedCtxs(strict)) {
    for (const { edge, span } of fits) {
      const mark = ctx.out.length;
      const s = sofaOn(ctx, edge, span);
      if (s === null) continue;
      if (placeTv(ctx, s.sofa, edge.inwardNormal)) {
        found = { ...s, edge };
        break;
      }
      while (ctx.out.length > mark) unplaceLast(ctx);
    }
    for (const { edge, span } of found === null ? fits : []) {
      const s = sofaOn(ctx, edge, span);
      if (s === null) continue;
      found = { ...s, edge };
      break;
    }
    if (found !== null) break;
  }
  if (found === null) return;
  // Ngữ cảnh nới chỉ để có món chính (sofa, TV); đồ phụ dùng ngữ cảnh nghiêm, không vừa thì bỏ.
  const { sofa, t: sofaT, rotationDeg, edge } = found;
  const ctx = strict;

  const n = edge.inwardNormal;
  const e = directionOf(edge);
  const reach = SOFA.d / 2 + COFFEE_TABLE_REACH_MM + COFFEE_TABLE.d / 2;
  const coffee = place(
    ctx,
    // Bếp mở: roleOf không đoán bàn thấp trong bếp là bàn trà (C2) → nói rõ bằng variant `table` thấp.
    ctx.storedUsage === 'livingRoom' ? COFFEE_TABLE : { ...COFFEE_TABLE, variant: 'table' },
    { x: sofa.centre.x + n.x * reach, y: sofa.centre.y + n.y * reach },
    rotationDeg,
  );

  // Đèn cây một đầu sofa, bàn phụ đầu kia.
  flank(ctx, edge, sofaT, SOFA.w, [FLOOR_LAMP, SIDE_TABLE]);

  // Ghế bành hai bên bàn nước, quay mặt vào bàn.
  if (coffee !== null) {
    const side = COFFEE_TABLE.w / 2 + ARMCHAIR_REACH_MM + ARMCHAIR.w / 2;
    [1, -1].forEach((sign, i) => {
      const at = { x: coffee.centre.x + e.x * side * sign, y: coffee.centre.y + e.y * side * sign };
      place(ctx, ARMCHAIR, at, furnitureFacingDeg({ x: -e.x * sign, y: -e.y * sign }), i === 0 ? undefined : 2);
    });
  }
};

const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};

const rectDistance = (p: Point, r: Rect): number => {
  const [ex, ey] = axesOf(r.rotationDeg);
  const v = { x: p.x - r.cx, y: p.y - r.cy };
  const lx = Math.max(0, Math.abs(v.x * ex.x + v.y * ex.y) - r.w / 2);
  const ly = Math.max(0, Math.abs(v.x * ey.x + v.y * ey.y) - r.d / 2);
  return Math.hypot(lx, ly);
};

/** Vùng xem TV của bộ sofa đã sinh trong phòng: từ sofa tới TV (chưa có TV: sâu 3 m), rộng bằng sofa. */
const viewZones = (ctx: Ctx): Rect[] => {
  const mine = ctx.out.filter((f) => f.roomId === ctx.room.id);
  const tv = mine.find((f) => f.variant === 'tv');
  return mine
    .filter((f) => f.variant === 'sofa')
    .map((sofa) => {
      const [, front] = axesOf(sofa.rotationDeg);
      const depth = tv === undefined
        ? SOFA_VIEW_MM
        : Math.max(0, (tv.centre.x - sofa.centre.x) * front.x + (tv.centre.y - sofa.centre.y) * front.y);
      return {
        cx: sofa.centre.x + (front.x * depth) / 2,
        cy: sofa.centre.y + (front.y * depth) / 2,
        w: SOFA.w,
        d: depth,
        rotationDeg: sofa.rotationDeg,
      };
    });
};

/** Cửa đi của phòng: cạnh, bề rộng, tâm trên mặt bằng. */
interface Door {
  readonly edge: RoomEdge;
  readonly widthMm: number;
  readonly at: Point;
}

/** Cạnh của `rankedEdges` chỉ mang cửa đi. */
const doorsOf = (edges: readonly RankedEdge[]): Door[] =>
  edges.flatMap(({ edge }) => {
    const e = directionOf(edge);
    return edge.openings.map((o) => {
      const t = (o.fromMm + o.toMm) / 2;
      return { edge, widthMm: o.toMm - o.fromMm, at: { x: edge.a.x + e.x * t, y: edge.a.y + e.y * t } };
    });
  });

const angleOf = (v: Point): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** Lối đi 900 mm nối tâm từng cặp cửa. */
const doorPathsOf = (doors: readonly Door[]): Rect[] =>
  doors.flatMap((p, i) =>
    doors.slice(i + 1).map((q) => ({
      cx: (p.at.x + q.at.x) / 2,
      cy: (p.at.y + q.at.y) / 2,
      w: Math.hypot(q.at.x - p.at.x, q.at.y - p.at.y),
      d: DOOR_PATH_MM,
      rotationDeg: angleOf({ x: q.at.x - p.at.x, y: q.at.y - p.at.y }),
    })),
  );

/** Vùng đứng trước mỗi cửa phía trong phòng: rộng cửa + 100 mỗi bên, sâu 900 tính từ mặt tường. */
const doorApproachOf = (doors: readonly Door[]): Rect[] =>
  doors.map(({ edge, widthMm, at }) => {
    const off = edge.wallHalfMm + DOOR_APPROACH_MM / 2;
    return {
      cx: at.x + edge.inwardNormal.x * off,
      cy: at.y + edge.inwardNormal.y * off,
      w: widthMm + 2 * OPENING_MARGIN_MM,
      d: DOOR_APPROACH_MM,
      rotationDeg: angleOf(directionOf(edge)),
    };
  });

/**
 * Vùng phải chừa của phòng (P4): trước mỗi cửa + lối giữa các cửa. Phòng tắm: vùng mở cửa đã là chỗ
 * đứng (thêm 900 thì không còn chỗ cho thiết bị); hành lang: chính nó là lối, bù dọc một tường đã chừa
 * 900 mm nên không vẽ lối xuyên ngang.
 */
const clearZonesOf = (usage: Room['usage'], edges: readonly RankedEdge[]): Pick<Ctx, 'clear' | 'approach'> => {
  if (usage === 'bathroom') return { clear: [], approach: [] };
  const doors = doorsOf(edges);
  const approach = doorApproachOf(doors);
  return { approach, clear: [...approach, ...(usage === 'corridor' ? [] : doorPathsOf(doors))] };
};

/**
 * Các mức nới cho món chính (giường, sofa), cùng phòng (chung `taken`/`out`): đủ vùng chừa → bỏ lối giữa
 * các cửa → chỉ vùng mở cánh như trước P4. Phòng nhiều cửa/phòng nhỏ vẫn có giường, sofa.
 */
const relaxedCtxs = (ctx: Ctx): Ctx[] => [ctx, { ...ctx, clear: ctx.approach }, { ...ctx, clear: [] }];

/**
 * Bàn ăn gần tường chứ không trôi giữa phòng: quét lưới 200 mm các tâm trong phòng, lấy tâm GẦN
 * tường nhất mà bàn + ghế hai phía vẫn vừa (sau lưng ghế còn 600 mm tới đồ khác), ngoài lối đi giữa
 * các cửa và vùng xem TV trước sofa; hoà thì gần dãy tủ bếp, rồi xa đồ khác. Không chỗ nào đủ cả bộ
 * ghế thì lùi về cách cũ: tâm xa tường/đồ nhất, ghế nào vừa thì đặt. Cạnh dài song song cạnh dài
 * nhất của phòng; tối đa 4 ghế quanh bàn.
 */
const furnishDining = (ctx: Ctx, edges: readonly RankedEdge[], small: boolean, viewFallback: boolean): boolean => {
  const tablePiece = small ? SMALL_TABLE : DINING_TABLE;
  const outline = ctx.room.outline;
  const outlineMm = outline.map(toMm);
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const kitchen = ctx.out.filter((f) => f.roomId === ctx.room.id && f.variant === 'baseRun').map(rectOfFurniture);
  const candidates: { at: Point; score: number; wall: number; item: number; cook: number }[] = [];
  for (let x = Math.ceil(Math.min(...xs) / GRID_MM) * GRID_MM; x <= Math.max(...xs); x += GRID_MM) {
    for (let y = Math.ceil(Math.min(...ys) / GRID_MM) * GRID_MM; y <= Math.max(...ys); y += GRID_MM) {
      const at = { x, y };
      if (!outlineContains(outlineMm, toMm(at))) continue;
      const wall = Math.min(...outline.map((a, i) => segmentDistance(at, a, outline[(i + 1) % outline.length] as Point)));
      const item = Math.min(Infinity, ...ctx.taken.map((r) => rectDistance(at, r)));
      const cook = Math.min(Infinity, ...kitchen.map((r) => rectDistance(at, r)));
      const score = Math.min(wall, item);
      if (score > tablePiece.d / 2) candidates.push({ at, score, wall, item, cook });
    }
  }
  candidates.sort((p, q) => q.score - p.score || p.at.x - q.at.x || p.at.y - q.at.y);
  // Bàn + ghế hai phía: nửa sâu bàn + khe + ghế, cộng mức lùi tường / lối sau lưng ghế.
  const seated = tablePiece.d / 2 + GAP_MM + SLACK_MM + CHAIR.d;
  const nearWall = candidates
    .filter((c) => c.wall >= seated + INSET_MM && c.item >= seated + DINING_BACK_CLEAR_MM)
    .sort(
      (p, q) =>
        Math.floor(p.wall / GRID_MM) - Math.floor(q.wall / GRID_MM) ||
        p.cook - q.cook ||
        q.item - p.item ||
        p.at.x - q.at.x ||
        p.at.y - q.at.y,
    );
  const views = viewZones(ctx);

  // Lối đi 900 mm nối tâm từng cặp cửa đi của phòng: bàn + chỗ kéo ghế không được chắn.
  const paths = doorPathsOf(doorsOf(edges));
  const blocksPath = (at: Point, rotationDeg: number, keepView: boolean): boolean => {
    const w = tablePiece.w + 2 * CHAIR_CLEAR_MM;
    const d = tablePiece.d + 2 * CHAIR_CLEAR_MM;
    return [...paths, ...(keepView ? views : [])].some((path) => rectsOverlap({ cx: at.x, cy: at.y, w, d, rotationDeg }, path));
  };

  const longest = [...edges].sort((p, q) => q.edge.lengthMm - p.edge.lengthMm)[0]?.edge;
  if (longest === undefined) return false;
  const along = furnitureFacingDeg(longest.inwardNormal);
  // Bàn nhỏ: 2 ghế đối diện giữa hai cạnh dài.
  const seats = small
    ? ([
        [0, -1],
        [0, 1],
      ] as const)
    : ([
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const);

  // Phòng chật: thà bàn đứng trong vùng xem TV còn hơn không có bàn (lượt cuối như trước).
  for (const [list, allSeats, keepView] of [
    [nearWall, true, true],
    [candidates, false, true],
    ...(viewFallback ? ([[candidates, false, false]] as const) : []),
  ] as const) {
    for (const { at } of list) {
      for (const rotationDeg of [along, turn(along, 90)]) {
        if (blocksPath(at, rotationDeg, keepView)) continue;
        const mark = ctx.out.length;
        const table = place(ctx, tablePiece, at, rotationDeg);
        if (table === null) continue;
        const [ex, ey] = axesOf(rotationDeg);
        const ly = tablePiece.d / 2 + GAP_MM + SLACK_MM + CHAIR.d / 2;
        const placed = seats.filter(([sx, sy], i) => {
          const lx = (sx * tablePiece.w) / 4;
          const seat = { x: table.centre.x + ex.x * lx + ey.x * sy * ly, y: table.centre.y + ex.y * lx + ey.y * sy * ly };
          // Ghế phía −y quay +y vào bàn; phía +y quay ngược lại.
          return place(ctx, CHAIR, seat, sy < 0 ? rotationDeg : turn(rotationDeg, 180), i + 1) !== null;
        }).length;
        if (!allSeats || placed === seats.length) return true;
        while (ctx.out.length > mark) unplaceLast(ctx);
      }
    }
  }
  return false;
};

/** Phòng ngủ ≥ 12 m²: tủ áo (hoặc tủ thấp) nếu chưa có, rồi góc bàn làm việc hoặc ghế bành. */
const furnishBedroomExtras = (ctx: Ctx, edges: readonly RankedEdge[], present: ReadonlySet<string>): void => {
  const doorSpans = allSpans(edges.map(({ edge }) => edge));
  if (!['closet', 'dresser', 'bookshelf'].some((role) => present.has(role))) {
    // Tủ áo cao không che cửa sổ; tủ thấp thì được.
    if (alongWall(ctx, ctx.clearSpans, WARDROBE) === null) alongWall(ctx, doorSpans, DRESSER);
  }
  if (!present.has('desk') && !present.has('armchair') && !deskSet(ctx, doorSpans)) {
    alongWall(ctx, doorSpans, ARMCHAIR, undefined, true);
  }
};

/** Phòng 'other' trong nhà: phòng đọc (bàn + ghế + giá sách + đèn cây) hoặc góc ngồi. */
const furnishStudy = (ctx: Ctx, edges: readonly RankedEdge[]): void => {
  const doorSpans = allSpans(edges.map(({ edge }) => edge));
  if (deskSet(ctx, doorSpans)) {
    alongWall(ctx, ctx.clearSpans, BOOKSHELF);
    alongWall(ctx, doorSpans, FLOOR_LAMP, undefined, true);
    return;
  }
  const first = alongWall(ctx, doorSpans, ARMCHAIR, 1);
  if (first === null) return;
  // Ghế bành thứ hai cạnh ghế đầu, bàn phụ ở giữa.
  const step = ARMCHAIR.w / 2 + GAP_MM + SLACK_MM + SIDE_TABLE.w;
  for (const side of [1, -1]) {
    const tableSpot = againstEdge(first.edge, first.t + side * (ARMCHAIR.w / 2 + GAP_MM + SLACK_MM + SIDE_TABLE.w / 2), SIDE_TABLE);
    if (place(ctx, SIDE_TABLE, tableSpot.at, tableSpot.rotationDeg) === null) continue;
    const chairSpot = againstEdge(first.edge, first.t + side * (step + GAP_MM + SLACK_MM + ARMCHAIR.w / 2), ARMCHAIR);
    place(ctx, ARMCHAIR, chairSpot.at, chairSpot.rotationDeg, 2);
    return;
  }
};

/**
 * Ngoài trời: ghế nằm (phòng đủ rộng) rồi hàng chậu cây dọc mọi đoạn tường/lan can trống, cách
 * nhau PLANTER_SPACING_MM, tối đa MAX_PLANTERS — như bản render Blender. Chỉ mô hình đã đăng ký.
 */
const furnishOutdoor = (ctx: Ctx, edges: readonly RankedEdge[], areaM2: number): void => {
  // Lan can hở (không có tường trong đồ thị) vẫn bày chậu được.
  const spans = allSpans(
    edges.map(({ edge }) => edge),
    true,
  );
  if (areaM2 >= OTHER_MIN_M2) alongWall(ctx, spans, LOUNGER);
  let n = 1;
  for (const { edge, span } of spans) {
    const [first, last] = endsOf(span, PLANTER.w / 2);
    for (let t = first; t <= last && n <= MAX_PLANTERS; t += PLANTER.w + PLANTER_SPACING_MM) {
      const spot = againstEdge(edge, t, PLANTER);
      if (place(ctx, PLANTER, spot.at, spot.rotationDeg, n) !== null) n += 1;
    }
  }
};

/** Món chồng lên/treo trên món đã đặt (tủ treo, chậu, mặt bếp): không xét chồng, không chiếm chỗ thêm. */
const stack = (ctx: Ctx, piece: Piece, edge: RoomEdge, t: number): void => {
  const spot = againstEdge(edge, t, piece);
  ctx.out.push(furnitureOf(ctx, piece, spot.at, spot.rotationDeg));
};

/** Cùng một cạnh (mỗi lần gọi roomEdges cho đối tượng mới). */
const sameEdge = (p: RoomEdge, q: RoomEdge): boolean =>
  p.a.x === q.a.x && p.a.y === q.a.y && p.b.x === q.b.x && p.b.y === q.b.y;

/**
 * Đoạn cho dãy bếp mở trong phòng khách (P1), sau khi đã có bộ sofa + TV: đoạn đủ dãy + tủ lạnh (≥ 2,4 m)
 * xa khu xem TV nhất trước (phòng chia hai vùng khách | bếp-ăn), rồi đoạn ngắn hơn theo độ dài. Chưa có
 * sofa thì xa các cửa nhất.
 */
const openKitchenSpans = (ctx: Ctx, edges: readonly RankedEdge[]): RankedEdge[] => {
  const all = allSpans(edges.map((r) => r.edge));
  const mine = ctx.out.filter((f) => f.roomId === ctx.room.id && (f.variant === 'sofa' || f.variant === 'tv'));
  const anchors = mine.length > 0 ? [mine.reduce((m, f) => ({ x: m.x + f.centre.x / mine.length, y: m.y + f.centre.y / mine.length }), { x: 0, y: 0 })] : doorsOf(edges).map((d) => d.at);
  const far = ({ edge, span }: RankedEdge): number => {
    const e = directionOf(edge);
    const t = (span.from + span.to) / 2;
    return Math.min(Infinity, ...anchors.map((p) => Math.hypot(p.x - edge.a.x - e.x * t, p.y - edge.a.y - e.y * t)));
  };
  const roomy = (r: RankedEdge): boolean => lengthOf(r.span) - 2 * (END_CLEAR_MM + SLACK_MM) >= OPEN_KITCHEN_RUN_MM;
  return [...all.filter(roomy).sort((p, q) => far(q) - far(p)), ...all.filter((r) => !roomy(r))];
};

/**
 * Bếp chưa có tủ thật: dãy tủ dưới (≤ 3,6 m) dọc đoạn có tường, không cửa đi, dài nhất; tủ lạnh ở
 * đầu dãy nếu đủ chỗ; chậu (+ bếp nấu khi dãy ≥ 1,6 m) trên mặt đá; tủ treo phía trên khi đoạn đó
 * không có cửa sổ. Dãy dài nhất ở đầu đoạn không vừa (đồ đã đặt chiếm một phần đoạn) thì thử dãy ngắn
 * dần (bước 600 tới BASE_RUN_MIN_MM) trượt dọc đoạn; chỉ hết các lựa chọn đó mới bỏ bếp.
 */
const kitchenRun = (ctx: Ctx, spans: readonly RankedEdge[]): boolean => {
  const end = END_CLEAR_MM + SLACK_MM;
  const fridgeGap = GAP_MM + SLACK_MM + FRIDGE.w;
  const tryRun = (edge: RoomEdge, span: Span, runW: number, runT: number): boolean => {
    const run = { ...BASE_RUN, w: runW };
    const spot = againstEdge(edge, runT, run);
    if (place(ctx, run, spot.at, spot.rotationDeg) === null) return false;
    if (runT + runW / 2 + fridgeGap <= span.to - end) {
      const f = againstEdge(edge, runT + runW / 2 + GAP_MM + SLACK_MM + FRIDGE.w / 2, FRIDGE);
      place(ctx, FRIDGE, f.at, f.rotationDeg);
    }
    if (runW >= RUN_HOB_MIN_MM) {
      stack(ctx, SINK, edge, runT + runW / 4);
      stack(ctx, HOB, edge, runT - runW / 4);
    } else stack(ctx, SINK, edge, runT);
    const clear = ctx.clearSpans.some(
      (c) => sameEdge(c.edge, edge) && c.span.from <= runT - runW / 2 && c.span.to >= runT + runW / 2,
    );
    if (clear) stack(ctx, { ...UPPER_RUN, w: runW }, edge, runT);
    return true;
  };
  const usable = spans.filter(({ span }) => lengthOf(span) - 2 * end >= BASE_RUN_MIN_MM);
  // Lượt đầu như cũ: dãy dài nhất (chừa tủ lạnh nếu đủ) ở đầu mỗi đoạn.
  for (const { edge, span } of usable) {
    const room = lengthOf(span) - 2 * end;
    const runW = Math.min(BASE_RUN_MAX_MM, room >= BASE_RUN_MIN_MM + fridgeGap ? room - fridgeGap : room);
    if (tryRun(edge, span, runW, span.from + end + runW / 2)) return true;
  }
  for (const { edge, span } of usable) {
    const top = Math.min(BASE_RUN_MAX_MM, lengthOf(span) - 2 * end);
    const widths = [...new Set([...Array.from({ length: Math.floor((top - BASE_RUN_MIN_MM) / 600) + 1 }, (_, i) => top - 600 * i), BASE_RUN_MIN_MM])];
    for (const runW of widths) {
      const lo = span.from + end + runW / 2;
      const hi = span.to - end - runW / 2;
      const ts = [...Array.from({ length: Math.floor((hi - lo) / GRID_MM) + 1 }, (_, i) => lo + GRID_MM * i), hi];
      if (ts.some((t) => tryRun(edge, span, runW, t))) return true;
    }
  }
  return false;
};

/** Dãy bếp ngoài vùng chừa cửa; không đoạn nào được thì nới dần (relaxedCtxs). */
const furnishKitchenRun = (
  ctx: Ctx,
  edges: readonly RankedEdge[],
  spans: readonly RankedEdge[] = allSpans(edges.map((r) => r.edge)),
): void => {
  relaxedCtxs(ctx).some((c) => kitchenRun(c, spans));
};

/**
 * Phòng tắm chưa có thiết bị thật: bồn cầu sát góc, lavabo ở đoạn tường còn trống, rồi (≥ 3 m²)
 * khu tắm vòi sen ở góc còn trống xa cửa nhất — thiết bị chính trước để khu tắm không chiếm chỗ của
 * chúng ở phòng nhỏ. Mọi món tựa tường thật, ngoài vùng mở cửa.
 */
const furnishBathroom = (ctx: Ctx, edges: readonly RankedEdge[], areaM2: number): void => {
  const spans = allSpans(edges.map(({ edge }) => edge));
  // Dò tường thiếu (vách kính, khe tường): đoạn không tường là lựa chọn cuối, còn hơn phòng tắm trống.
  const open = allSpans(
    edges.map(({ edge }) => edge),
    true,
  );
  // Thiết bị nào cũng ưu tiên góc (chừa giữa tường cho món sau), rồi giữa đoạn, rồi đoạn không tường.
  const fixture = (piece: Piece): Furniture | null =>
    alongWall(ctx, spans, piece, undefined, true)?.item ??
    alongWall(ctx, spans, piece)?.item ??
    alongWall(ctx, open, piece)?.item ??
    null;
  fixture(WC);
  fixture(BASIN);
  // Bồn tắm (phòng đủ rộng) đã là chỗ tắm: không thêm khu sen giành chỗ.
  if (furnishBathtub(ctx, edges) || areaM2 < SHOWER_MIN_M2) return;
  for (const shower of [SHOWER, SMALL_SHOWER]) {
    const corners = [spans, open]
      .flatMap((list) =>
        list.flatMap(({ edge, span }) =>
          lengthOf(span) < shower.w ? [] : endsOf(span, shower.w / 2).map((t) => againstEdge(edge, t, shower)),
        ),
      )
      .map((spot) => ({ spot, far: Math.min(Infinity, ...ctx.swings.map((r) => rectDistance(spot.at, r))) }))
      // Sắp ổn định: hoà khoảng cách thì giữ thứ tự đoạn.
      .sort((p, q) => q.far - p.far);
    if (corners.some(({ spot }) => place(ctx, shower, spot.at, spot.rotationDeg) !== null)) return;
  }
  // Không góc nào trống (bồn cầu, lavabo đã chiếm hai góc): khu sen nhỏ giữa một đoạn tường.
  fixture(SMALL_SHOWER);
};

/** Bồn tắm dọc đoạn tường còn trống khi cạnh ngắn của phòng ≥ 1,7 m (sau thiết bị chính). */
const furnishBathtub = (ctx: Ctx, edges: readonly RankedEdge[]): boolean => {
  const inner = computeLargestInnerRectangle(ctx.room.outline.map(toMm));
  if (inner === null || Math.min(inner.widthMm, inner.heightMm) < BATHTUB_MIN_SHORT_MM) return false;
  return alongWall(ctx, allSpans(edges.map(({ edge }) => edge)), BATHTUB, undefined, true) !== null;
};

interface FillEntry {
  readonly piece: Piece;
  /** Tối đa bấy nhiêu món cùng variant trong phòng (kể cả đồ thật/đồ bộ chính). */
  readonly max: number;
  /** Món cao: không che cửa sổ (clearSpans). */
  readonly tall?: boolean;
  /** Bỏ qua khi phòng đã có món mang một trong các vai này (tủ áo thật → không thêm tủ thấp). */
  readonly unless?: readonly string[];
}

/** Danh sách bù theo công năng, thử theo thứ tự tới khi đủ mật độ; cuối cùng tối đa một cây. */
const FILL_LISTS: Partial<Record<Room['usage'], readonly FillEntry[]>> = {
  // Tủ chén, giá sách, đèn cây thứ hai — ghế bành chỉ đi theo bộ sofa (cạnh bàn nước), không rải dọc tường (P7).
  livingRoom: [
    { piece: SIDEBOARD, max: 1 },
    { piece: BOOKSHELF, max: 1, tall: true },
    { piece: FLOOR_LAMP, max: 2 },
  ],
  bedroom: [
    { piece: DRESSER, max: 1, unless: ['closet', 'dresser', 'bookshelf'] },
    { piece: ARMCHAIR, max: 1 },
  ],
  corridor: [
    { piece: CONSOLE, max: 1 },
    { piece: BENCH, max: 1 },
  ],
  other: [
    { piece: BOOKSHELF, max: 1, tall: true },
    { piece: ARMCHAIR, max: 2 },
    { piece: FLOOR_LAMP, max: 1 },
  ],
};

/**
 * Bù mật độ tới ~1 món đứng / 2,5 m²: danh sách theo công năng rồi một cây ở góc. Hành lang chỉ
 * bày dọc MỘT cạnh dài và món đủ nông để còn lối đi 900 mm.
 */
const fillRoom = (ctx: Ctx, edges: readonly RankedEdge[], mine: () => readonly Furniture[], target: number): void => {
  let doorSpans = allSpans(edges.map(({ edge }) => edge));
  let tallSpans = ctx.clearSpans;
  let maxDepth = Infinity;
  if (ctx.room.usage === 'corridor') {
    const inner = computeLargestInnerRectangle(ctx.room.outline.map(toMm));
    const width = inner === null ? 0 : Math.min(inner.widthMm, inner.heightMm);
    const along = [...edges].sort((p, q) => q.edge.lengthMm - p.edge.lengthMm)[0]?.edge;
    if (along === undefined || width < CORRIDOR_MIN_WIDTH_MM) return;
    doorSpans = doorSpans.filter((s) => s.edge === along);
    tallSpans = [];
    maxDepth = width - 2 * INSET_MM - SLACK_MM - WALKWAY_MM;
  }
  const count = (): number => mine().filter(standsOnFloor).length;
  for (const { piece, max, tall, unless = [] } of FILL_LISTS[ctx.room.usage] ?? []) {
    if (piece.d > maxDepth || mine().some((f) => unless.includes(roleOf(f, ctx.room.usage)))) continue;
    const spans = tall === true ? tallSpans : doorSpans;
    // Cùng variant khác mẫu (kệ TV `cabinet` mẫu tv-stand) không tính là cùng món.
    const same = (f: Furniture): boolean => f.variant === piece.variant && f.model === undefined;
    for (let n = 1; count() < target && mine().filter(same).length < max; n += 1) {
      // Vai `…Fill`: id riêng, không trùng món cùng loại của bộ chính (DRESS-armchair-R-2 của phòng đọc).
      if (alongWall(ctx, spans, { ...piece, role: `${piece.role}Fill` }, n) === null) break;
    }
  }
  for (let n = 1; count() < target && n <= MAX_FILL_PLANTS && PLANT.d <= maxDepth; n += 1) {
    if (alongWall(ctx, doorSpans, PLANT, n, true) === null) return;
  }
};

/** Bù mật độ chỉ cho các công năng này, từ cùng ngưỡng với luật chính. */
const FILL_MIN_M2: Partial<Record<Room['usage'], number>> = {
  bedroom: BEDROOM_MIN_M2,
  livingRoom: LIVING_MIN_M2,
  other: OTHER_MIN_M2,
  kitchen: KITCHEN_SMALL_TABLE_MIN_M2,
  corridor: CORRIDOR_MIN_M2,
};

const DINING_USAGES: ReadonlySet<Room['usage'] | undefined> = new Set([undefined, 'kitchen', 'livingRoom']);

const isRug = (f: Furniture): boolean => {
  const role = roleOf(f);
  return role === 'rug' || role === 'roundRug';
};

/** Ngoài trời: lát decking hoặc tên ban công/sân hiên — không bày đồ trong nhà. */
const isOutdoor = (room: Room): boolean => room.finish === 'decking' || OUTDOOR_NAME.test(room.name);

/**
 * Phòng 'other'/hành lang trong nhà, rộng (≥ 25 m², cạnh ngắn ≥ 2,4 m): thực chất là phòng sinh
 * hoạt chưa gọi tên — bày như phòng khách (sofa + TV + khu ăn) thay vì phòng đọc lẻ loi hay để trống.
 */
const isOpenLiving = (room: Room): boolean => {
  if ((room.usage !== 'other' && room.usage !== 'corridor') || isOutdoor(room)) return false;
  const outline = room.outline.map(toMm);
  if (computeArea(outline) < OPEN_LIVING_MIN_M2) return false;
  const inner = computeLargestInnerRectangle(outline);
  return inner !== null && Math.min(inner.widthMm, inner.heightMm) >= OPEN_LIVING_MIN_SHORT_MM;
};

/** Món đứng trên sàn được tính vào mật độ: không thảm, không treo/đặt trên món khác. */
const standsOnFloor = (f: Furniture): boolean => !isRug(f) && (f.liftMm ?? 0) <= 0;

// Chữ ký J10 nhận phong cách; luật bày đồ hiện chưa phụ thuộc nó (mô hình chọn theo phong cách ở toPascal).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const furnishEmptyRooms = (graph: SpatialGraph, _style: SceneStyle): readonly Furniture[] => {
  const out: Furniture[] = [];
  const stored = new Map(graph.rooms.map((r) => [r.id, r.usage]));
  const rooms = [...graph.rooms]
    .map((r) => (isOpenLiving(r) ? { ...r, usage: 'livingRoom' as const } : r))
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const outlinesMm = new Map(rooms.map((r) => [r.id, r.outline.map(toMm)]));
  const inRoom = (f: Furniture, room: Room): boolean =>
    f.roomId === room.id ||
    (f.roomId === undefined &&
      f.levelId === room.levelId &&
      outlineContains(outlinesMm.get(room.id) ?? [], toMm(f.centre)));
  /** Công năng phòng của món (theo roomId, không có thì phòng chứa tâm món). */
  const usageOfItem = (f: Furniture): Room['usage'] | undefined => rooms.find((r) => inRoom(f, r))?.usage;
  const isDiningTable = (f: Furniture): boolean =>
    f.kind === 'table' && !['nightstand', 'coffeeTable', 'desk'].includes(roleOf(f, usageOfItem(f)));
  // Thảm nằm dưới đồ nên không chiếm chỗ.
  const solid = graph.furniture.filter((f) => !isRug(f));
  const areaOf = (room: Room): number => computeArea(outlinesMm.get(room.id) ?? []);
  // Bếp mở trong phòng khách (P1): tầng không có phòng bếp (cũng không tủ bếp thật) → phòng khách lớn
  // nhất từ 18 m² nhận dãy tủ bếp; bàn ăn (lượt 1) tự về gần dãy tủ.
  const kitchenLiving = new Set(
    [...new Set(rooms.map((r) => r.levelId))].flatMap((levelId) => {
      const onLevel = rooms.filter((r) => r.levelId === levelId);
      if (onLevel.some((r) => r.usage === 'kitchen')) return [];
      if (graph.furniture.some((f) => f.levelId === levelId && f.kind === 'kitchenCabinet')) return [];
      const host = onLevel
        .filter((r) => r.usage === 'livingRoom' && !isOutdoor(r) && areaOf(r) >= OPEN_KITCHEN_LIVING_MIN_M2)
        .sort((p, q) => areaOf(q) - areaOf(p))[0];
      return host === undefined ? [] : [host.id];
    }),
  );

  // Lượt 0: giường, sofa, bàn ăn trong bếp, phòng 'other'; lượt 1: bàn ăn phòng khách rồi bù
  // mật độ — để bàn của bếp (bất kể thứ tự id phòng) chặn được bàn thứ hai cùng tầng (V5 D10).
  for (const pass of [0, 1]) for (const room of rooms) {
    const real = graph.furniture.filter((f) => inRoom(f, room));
    const areaM2 = areaOf(room);
    const outdoor = isOutdoor(room);
    // Mỗi tầng một bộ bàn ăn: bàn (thật hoặc đã sinh) ở BẤT KỲ phòng nào cùng tầng — kể cả bếp mở
    // thông phòng khách — chặn bộ thứ hai, theo cả hai chiều bếp ↔ phòng khách (V5 D10, F1).
    // Bàn ở phòng ngủ/phòng làm việc là bàn làm việc, không tính.
    const levelHasDining = [...graph.furniture, ...out].some(
      (f) => f.levelId === room.levelId && DINING_USAGES.has(usageOfItem(f)) && isDiningTable(f),
    );
    const needsBed =
      pass === 0 && room.usage === 'bedroom' && areaM2 >= BEDROOM_MIN_M2 && !real.some((f) => f.kind === 'bed');
    // Bếp mở rộng mà tầng không có phòng khách: bếp kiêm phòng khách, bày cả bộ sofa.
    const openKitchen =
      room.usage === 'kitchen' &&
      areaM2 >= OPEN_KITCHEN_LIVING_MIN_M2 &&
      !rooms.some((r) => r.levelId === room.levelId && r.usage === 'livingRoom');
    const needsSofa =
      pass === 0 &&
      ((room.usage === 'livingRoom' &&
        areaM2 >= LIVING_MIN_M2 &&
        !real.some((f) => f.kind === 'chair' || roleOf(f, room.usage) === 'sofa')) ||
        (openKitchen && !real.some((f) => roleOf(f, 'livingRoom') === 'sofa')));
    const openKitchenLiving = kitchenLiving.has(room.id);
    const needsKitchenRun =
      pass === 0 &&
      (room.usage === 'kitchen' || openKitchenLiving) &&
      !real.some((f) => f.kind === 'kitchenCabinet');
    const needsTable =
      ((pass === 0 && room.usage === 'kitchen' && areaM2 >= KITCHEN_SMALL_TABLE_MIN_M2) ||
        (pass === 1 && room.usage === 'livingRoom' && areaM2 >= LIVING_DINING_MIN_M2)) &&
      !levelHasDining;
    const target = Math.floor(areaM2 / M2_PER_PIECE);
    const sparse = real.filter(standsOnFloor).length < target;
    const needsOther = pass === 0 && room.usage === 'other' && !outdoor && areaM2 >= OTHER_MIN_M2 && sparse;
    // Ban công/lô-gia: luôn có chậu dọc lan can (đồ thật như máy giặt vẫn được tránh).
    const needsOutdoor =
      pass === 0 && (room.usage === 'loggia' || (room.usage === 'other' && outdoor)) && areaM2 >= OUTDOOR_MIN_M2;
    const needsBath =
      pass === 0 &&
      room.usage === 'bathroom' &&
      !real.some((f) => f.kind === 'sanitaryFixture' || f.kind === 'shower');
    const needsFill = pass === 1 && sparse && !outdoor && areaM2 >= (FILL_MIN_M2[room.usage] ?? Infinity);
    if (!needsBed && !needsSofa && !needsTable && !needsOther && !needsOutdoor && !needsBath && !needsFill && !needsKitchenRun) continue;

    const edges = rankedEdges(room, graph);
    const ctx: Ctx = {
      room,
      storedUsage: stored.get(room.id) ?? room.usage,
      others: rooms.filter((r) => r.levelId === room.levelId && r.id !== room.id).map((r) => outlinesMm.get(r.id) ?? []),
      swings: doorSwingRects(graph, room.levelId),
      ...clearZonesOf(room.usage, edges),
      walls: wallRects(graph, room.levelId),
      clearSpans: allSpans(edgesOf(room, graph)),
      windowEdges: edgesOf(room, graph),
      taken: [...solid, ...out].filter((f) => f.levelId === room.levelId).map(rectOfFurniture),
      out,
    };
    if (needsKitchenRun && !openKitchenLiving) furnishKitchenRun(ctx, edges);
    if (needsBed) furnishBedroom(ctx, edges, areaM2);
    if (needsSofa) furnishLiving(ctx, edges);
    // Phòng khách kiêm bếp: bộ sofa + TV chọn chỗ trước, dãy bếp lấy phần tường xa khu xem TV.
    if (needsKitchenRun && openKitchenLiving) furnishKitchenRun(ctx, edges, openKitchenSpans(ctx, edges));
    if (needsTable) {
      const small = room.usage === 'kitchen' && areaM2 < KITCHEN_DINING_MIN_M2;
      // Bộ 4 ghế không vừa thì bàn nhỏ 2 ghế; chỉ khi cả hai không vừa ngoài vùng xem TV mới chịu đứng
      // trong vùng đó (phòng khách kiêm bếp 18–25 m²: bàn nhỏ còn hơn bàn chắn giữa sofa và TV).
      const sizes = small ? [true] : [false, true];
      // Vùng chừa cửa nới dần như món chính; lối giữa các cửa vẫn giữ cho cả bộ bàn ghế (furnishDining).
      const levels = relaxedCtxs(ctx);
      const fitted = levels.some((c) => sizes.some((sm) => furnishDining(c, edges, sm, false)));
      if (!fitted) sizes.some((sm) => furnishDining(levels[levels.length - 1] ?? ctx, edges, sm, true));
    }
    if (needsOther) furnishStudy(ctx, edges);
    if (needsOutdoor) furnishOutdoor(ctx, edges, areaM2);
    if (needsBath) furnishBathroom(ctx, edges, areaM2);
    if (needsFill) {
      const mine = (): Furniture[] => [...real, ...out.filter((f) => f.roomId === room.id)];
      if (room.usage === 'bedroom' && areaM2 >= BEDROOM_EXTRAS_MIN_M2) {
        furnishBedroomExtras(ctx, edges, new Set(mine().map((f) => roleOf(f, room.usage))));
      }
      fillRoom(ctx, edges, mine, target);
    }
  }
  return out;
};
