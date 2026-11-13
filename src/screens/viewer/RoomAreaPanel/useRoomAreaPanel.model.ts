/**
 * Nửa THUẦN của hook màn S-33 — mọi phép biến `Room` thành dòng, nhóm, dải và
 * ô tổng, không một lời gọi React nào.
 *
 * Tách ra khỏi `useRoomAreaPanel.ts` vì hai lý do, cả hai đều đã có tiền lệ
 * trong repo: một hàm thuần kiểm được không cần `renderHook` (đúng thứ
 * `deriveRoomLabelScreenState` của màn anh em S-17 làm), và phần "nối dây" của
 * hook thì ngắn lại đủ để đọc hết trong một màn hình.
 *
 * ## R-61 — file này KHÔNG chứa một công thức nào của riêng nó
 *
 * Diện tích, tổng, chu vi, đếm ô mở, nhãn công năng, câu chú giải cách tính:
 * tất cả gọi `src/domain`, thứ đã có ngưỡng độ phủ 90%. Cụ thể:
 *
 * | Con số | Hàm được gọi |
 * |---|---|
 * | diện tích một phòng | `selectRoomsWithArea` → `computeArea` (đã tính sẵn) |
 * | tổng phụ của một nhóm | `totalArea(outlines)` — cộng ở mm², làm tròn MỘT lần |
 * | chu vi | `computePerimeter(outline)` |
 * | mm → m | `millimetresToMetres` |
 * | số cửa / số cửa sổ | `openingsOfRoom` + `countOpeningsByKind` |
 * | nhãn công năng | `describeUsage` |
 * | câu chú giải | `explainRoom` — lấy NGUYÊN VĂN |
 * | mọi chuỗi số | `formatNumber` (A15: dấu phẩy thập phân, đơn vị nằm ngoài) |
 *
 * Thứ file này TỰ làm chỉ có ba: gộp nhóm theo một trường đã có sẵn, sắp xếp,
 * và quy ba tông màu. Gộp và sắp xếp là SẮP XẾP chứ không phải công thức
 * (phán quyết PQ-7 của điều phối viên); ba tông là một quyết định giao diện mà
 * kiểu `RoomAreaTone` đã ép sẵn.
 *
 * Không một phép cộng dồn viết tay, không một lượt định dạng số nào đi vòng qua
 * `formatNumber`, và không chỗ nào cộng lại hai con số ĐÃ làm tròn.
 */

import { AREA_DECIMALS, computePerimeter, explainRoom, totalArea } from '@/domain/rooms/area';
import { describeUsage } from '@/domain/rooms/classify';
import { MIN_TRUSTED_ROOM_AREA_M2 } from '@/domain/rooms/detect';
import { isEntityOfKind, type NormalizedSpatial } from '@/domain/spatial/normalize';
import { countOpeningsByKind, openingsOfRoom } from '@/domain/spatial/roomOpenings';
import type { Level, Opening, Room, RoomUsage, Wall } from '@/domain/spatial/types';
import { compareNearly, type PointMm } from '@/domain/units/compare';
import { millimetres, millimetresToMetres, type SquareMetres } from '@/domain/units/types';
import { toPointMm } from '@/lib/commands/business/shared';
import { formatNumber } from '@/lib/format/number';
import { confidenceLevel } from '@/lib/format/semantic';
import { measureTextOfState, type ScaleState } from '@/lib/viewmodel/provisionalScale';
import { UNNAMED_ROOM_LABEL } from '@/lib/viewmodel/toViewModel';
import type { RoomWithArea } from '@/store/graphSelectors';

import type {
  RoomAreaBand,
  RoomAreaGroup,
  RoomAreaGrouping,
  RoomAreaLevelOption,
  RoomAreaRow,
  RoomAreaScreenState,
  RoomAreaSort,
  RoomAreaStatus,
  RoomAreaTone,
  RoomAreaTotals,
} from './roomAreaTypes';

/* -------------------------------------------------------------------------- */
/* Hằng số — không con số nào viết bằng tay (R-71).                            */
/* -------------------------------------------------------------------------- */

/**
 * Đơn vị của ô tổng và của cột diện tích.
 *
 * Đứng RIÊNG chứ không nối vào chuỗi số: `formatArea` dính " m²" vào kết quả
 * nên nó sai chỗ ở đây (xem khối chú thích đầu `roomAreaTypes.ts`); nó chỉ đúng
 * chỗ trong một câu văn, và câu văn duy nhất của màn là `explain`, do
 * `explainRoom` tự viết.
 */
export const AREA_UNIT_LABEL = 'm²';

/**
 * Chữ số thập phân của hai cột đo bằng mét (chu vi, chiều cao thông thuỷ).
 *
 * Suy ra từ `AREA_DECIMALS` chứ không viết lại số 2: `src/lib/format/measure.ts`
 * giữ đúng hai chữ số cho cả diện tích lẫn độ dài đọc bằng mét, nên cả bảng đọc
 * ở cùng một độ mịn thay vì mỗi cột một kiểu.
 */
const METRE_DECIMALS = AREA_DECIMALS;

/** Số đếm là số nguyên: "14 phòng", "2 cửa". */
const COUNT_DECIMALS = 0;

/** Tầng của một phòng không tra được trong đồ thị. */
const UNKNOWN_LEVEL_LABEL = 'Tầng chưa xác định';

/** Nhãn phạm vi của ô tổng khi bộ chọn tầng đang mở hết. */
export const WHOLE_BUILDING_LABEL = 'toàn nhà';

/** Ba tông của thanh xếp chồng, kèm nhãn tiếng Việt viết thường (A6). */
const TONE_LABELS: Readonly<Record<RoomAreaTone, string>> = {
  'wall-strong': 'Phòng ở',
  'wall-mid': 'Khu phụ trợ',
  neutral: 'Lưu thông và khác',
};

/** Thứ tự dải trên thanh, đậm trước — cùng thứ tự legend của `lib/coloring`. */
const TONE_ORDER: readonly RoomAreaTone[] = ['wall-strong', 'wall-mid', 'neutral'];

/**
 * Chín công năng gom về ĐÚNG ba tông (PQ-9).
 *
 * `src/lib/coloring/modes.ts` gom chín công năng thành NĂM nhóm
 * (`living` · `sleeping` · `service` · `circulation` · `other`) và bảng màu của nó có
 * năm token. Kiểu `RoomAreaTone` chỉ cho ba, nên hai lượt gộp nữa xảy ra ở đây:
 * `living` + `sleeping` thành "phòng ở", `circulation` + `other` thành lát
 * trung tính. Bản đồ là một `Record` ĐẦY ĐỦ, nên thêm một công năng vào
 * `RoomUsage` sẽ hỏng ở đây thay vì lặng lẽ rơi vào "khác".
 */
const TONE_BY_USAGE: Readonly<Record<RoomUsage, RoomAreaTone>> = {
  livingRoom: 'wall-strong',
  bedroom: 'wall-strong',
  kitchen: 'wall-mid',
  bathroom: 'wall-mid',
  utility: 'wall-mid',
  corridor: 'neutral',
  stairwell: 'neutral',
  loggia: 'neutral',
  other: 'neutral',
};

/** Thứ tự nhóm khi gộp theo công năng: phòng ở trước, phần phụ trợ sau. */
const USAGE_ORDER: readonly RoomUsage[] = [
  'livingRoom',
  'bedroom',
  'kitchen',
  'bathroom',
  'utility',
  'corridor',
  'stairwell',
  'loggia',
  'other',
];

/* -------------------------------------------------------------------------- */
/* Đọc đồ thị.                                                                 */
/* -------------------------------------------------------------------------- */

/** Những gì một dòng cần ngoài chính `Room`: tầng của nó, tường và ô mở. */
export interface RoomAreaGraph {
  readonly levels: readonly Level[];
  readonly walls: readonly Wall[];
  readonly openings: readonly Opening[];
  /**
   * R10 làn S: trạng thái tỷ lệ của từng tầng. Mọi m² và mét ở bảng này suy ra từ tỷ lệ, và đây là
   * bảng người dùng đọc số nhiều nhất trong 3D — tầng vắng mặt ở đây coi như tin được.
   */
  readonly scaleStates?: Readonly<Record<string, ScaleState>>;
}

const NO_GRAPH: RoomAreaGraph = Object.freeze({
  levels: Object.freeze([]) as readonly Level[],
  walls: Object.freeze([]) as readonly Wall[],
  openings: Object.freeze([]) as readonly Opening[],
  scaleStates: Object.freeze({}) as Readonly<Record<string, ScaleState>>,
});

const levelsOf = (spatial: NormalizedSpatial): readonly Level[] => {
  const found: Level[] = [];

  for (const id of spatial.byKind.level) {
    const entity = spatial.byId[id];

    if (entity !== undefined && isEntityOfKind('level', entity)) {
      found.push(entity);
    }
  }

  return found.sort((left, right) => left.order - right.order);
};

const wallsOf = (spatial: NormalizedSpatial): readonly Wall[] => {
  const found: Wall[] = [];

  for (const id of spatial.byKind.wall) {
    const entity = spatial.byId[id];

    if (entity !== undefined && isEntityOfKind('wall', entity)) {
      found.push(entity);
    }
  }

  return found;
};

const openingsOf = (spatial: NormalizedSpatial): readonly Opening[] => {
  const found: Opening[] = [];

  for (const id of spatial.byKind.opening) {
    const entity = spatial.byId[id];

    if (entity !== undefined && isEntityOfKind('opening', entity)) {
      found.push(entity);
    }
  }

  return found;
};

/**
 * Tầng, tường, ô mở của đồ thị đang mở.
 *
 * `SpatialGraph` phẳng: không có trường `byLevel` nào cho phòng (mục 5 của hợp
 * đồng toán), nên lọc theo tầng là `room.levelId === level.id` ở nơi cần.
 */
export function graphOf(
  spatial: NormalizedSpatial | null,
  scaleStates: Readonly<Record<string, ScaleState>> = {},
): RoomAreaGraph {
  if (spatial === null) {
    return NO_GRAPH;
  }

  return { levels: levelsOf(spatial), walls: wallsOf(spatial), openings: openingsOf(spatial), scaleStates };
}

const outlineOf = (room: Room): readonly PointMm[] => room.outline.map(toPointMm);

const outlinesOf = (entries: readonly RoomWithArea[]): readonly (readonly PointMm[])[] =>
  entries.map((entry) => outlineOf(entry.room));

/* -------------------------------------------------------------------------- */
/* Chuỗi số — mọi lượt định dạng đi qua `formatNumber` (A15).                   */
/* -------------------------------------------------------------------------- */

/**
 * Một độ dài đo bằng mm, đọc bằng mét, KHÔNG kèm đơn vị. Vắng mặt ra "—".
 *
 * Nhận `number` chứ không nhận `Millimetres`: `src/domain/spatial/types.ts` khai
 * `Millimetres` RIÊNG của nó là một `number` trần (dòng 16), nên `Level.heightMm`
 * không mang nhãn đơn vị của `src/domain/units/types`. `millimetres()` dán nhãn
 * lại trước khi quy đổi, để phép đổi mm → m vẫn là phép đổi CỦA DOMAIN chứ
 * không phải một phép chia viết ở màn.
 */
const metresText = (valueMm: number | undefined): string =>
  formatNumber(valueMm === undefined ? undefined : millimetresToMetres(millimetres(valueMm)), {
    fractionDigits: METRE_DECIMALS,
  });

/**
 * Tổng diện tích của một tập phòng — cộng ở mm², làm tròn ĐÚNG một lần.
 *
 * Chính là hàm `selectTotalAreaM2` của kho gọi, chỉ khác ở chỗ nhận một tập đã
 * lọc. Dùng nó cho mọi tổng phụ; đừng bao giờ cộng lại các số đã làm tròn.
 */
export const subtotalOf = (entries: readonly RoomWithArea[]): SquareMetres =>
  totalArea(outlinesOf(entries));

/** Một diện tích m², hai chữ số thập phân, KHÔNG kèm đơn vị. */
export const areaText = (areaM2: SquareMetres | number): string =>
  formatNumber(areaM2, { fractionDigits: AREA_DECIMALS });

/** Một số đếm. */
export const countText = (count: number): string =>
  formatNumber(count, { fractionDigits: COUNT_DECIMALS });

/* -------------------------------------------------------------------------- */
/* Một dòng.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Chấm trạng thái của một dòng — ba giá trị, không bao giờ bốn (A4).
 *
 * `reviewed` đến TỪ `Room.reviewed` và từ không đâu khác: A5 nói xanh "đã xác
 * minh" chỉ đánh dấu việc người duyệt, nên một phòng AI đọc ở 99% vẫn không
 * chạm tới nó. Hai giá trị còn lại lặp lại đúng hai luật đã có: ngưỡng diện
 * tích `MIN_TRUSTED_ROOM_AREA_M2` của `detect.ts` (dưới ngưỡng là `suspect`) và
 * ngưỡng độ tin cậy của `confidenceLevel` — không ngưỡng nào viết lại ở đây.
 */
export function statusOf(room: Room, areaM2: SquareMetres): RoomAreaStatus {
  if (room.reviewed) {
    return 'reviewed';
  }

  if (compareNearly(areaM2, MIN_TRUSTED_ROOM_AREA_M2) < 0) {
    return 'suspect';
  }

  return confidenceLevel(room.confidence) === 'certain' ? 'trusted' : 'suspect';
}

/**
 * Bề rộng thanh tỷ trọng: 0..1 so với phòng lớn nhất TRONG NHÓM.
 *
 * Đây là hình học của bố cục, không phải một con số người đọc — nó không bao
 * giờ thành chữ, nên nó không đi qua `formatNumber` và đó không phải ngoại lệ
 * của A15 (xem khối chú thích đầu `roomAreaTypes.ts`).
 */
const ratioOf = (value: number, largest: number): number =>
  largest > 0 ? Math.min(1, Math.max(0, value / largest)) : 0;

/** Dấu ước lượng cho số của MỘT tầng; tầng không có trạng thái thì để số trần. */
const markOf = (graph: RoomAreaGraph, levelId: string) => {
  const state = graph.scaleStates?.[String(levelId)];
  return (text: string): string => (state === undefined ? text : measureTextOfState(text, state));
};

/** Dấu cho tổng phụ của một nhóm: nhóm có tầng nào chưa tin được thì cả tổng mang dấu. */
const groupMarkOf = (graph: RoomAreaGraph, entries: readonly RoomWithArea[]) => {
  const states = entries.map((entry) => graph.scaleStates?.[String(entry.room.levelId)]);
  const loose = states.find((state) => state !== undefined && state !== 'measured' && state !== 'confirmed');
  return (text: string): string => (loose === undefined ? text : measureTextOfState(text, loose));
};

/** Một phòng, đã định dạng xong. `largestAreaM2` là phòng lớn nhất cùng nhóm. */
export function buildRow(
  entry: RoomWithArea,
  graph: RoomAreaGraph,
  largestAreaM2: number,
): RoomAreaRow {
  const room = entry.room;
  const outline = outlineOf(room);
  const level = graph.levels.find((candidate) => candidate.id === room.levelId);
  // Tên tạm do lượt lưu đặt (spatialLayerOf) vẫn là chưa đặt tên.
  const isUnnamed = room.name.trim() === '' || room.name === UNNAMED_ROOM_LABEL;
  const counts = countOpeningsByKind(openingsOfRoom(room, graph.walls, graph.openings));

  return {
    id: room.id,
    name: isUnnamed ? UNNAMED_ROOM_LABEL : room.name,
    isUnnamed,
    usage: room.usage,
    usageLabel: describeUsage(room.usage),
    levelId: room.levelId,
    levelName: level?.name ?? UNKNOWN_LEVEL_LABEL,
    areaText: markOf(graph, room.levelId)(areaText(entry.areaM2)),
    areaRatio: ratioOf(entry.areaM2, largestAreaM2),
    perimeterText: markOf(graph, room.levelId)(metresText(computePerimeter(outline))),
    // Chiều cao thông thuỷ là thuộc tính CỦA TẦNG (`Level.heightMm`), không của
    // từng phòng — đồ thị không lưu chiều cao riêng cho phòng, và trừ một hằng
    // số dày sàn không có nguồn là đúng thứ R-61 cấm.
    clearHeightText: metresText(level?.heightMm),
    doorCountText: countText(counts.doorCount),
    windowCountText: countText(counts.windowCount),
    status: statusOf(room, entry.areaM2),
    // Nguyên văn đầu ra của domain. Đặc tả viết "tính theo mép trong tường";
    // chữ thật của `explainRoom` là "mép thông thuỷ" (PQ-5), và câu của hàm là
    // câu đúng vì nó mô tả chính phép tính vừa chạy.
    explain: explainRoom(isUnnamed ? { outline } : { outline, name: room.name }),
  };
}

/* -------------------------------------------------------------------------- */
/* Sắp xếp.                                                                    */
/* -------------------------------------------------------------------------- */

/** So sánh tiếng Việt có dấu, để "Ăn" không rơi sau "Bếp". */
const compareVietnamese = (left: string, right: string): number => left.localeCompare(right, 'vi');

const compareEntries = (sort: RoomAreaSort, left: RoomWithArea, right: RoomWithArea): number => {
  if (sort === 'area') {
    return right.areaM2 - left.areaM2;
  }

  if (sort === 'usage') {
    const byUsage = compareVietnamese(
      describeUsage(left.room.usage),
      describeUsage(right.room.usage),
    );

    return byUsage === 0 ? compareVietnamese(left.room.name, right.room.name) : byUsage;
  }

  return compareVietnamese(left.room.name, right.room.name);
};

/** Sắp xếp một nhóm. Không đụng mảng gốc — selector giữ tham chiếu của nó. */
export const sortEntries = (
  entries: readonly RoomWithArea[],
  sort: RoomAreaSort,
): readonly RoomWithArea[] => [...entries].sort((left, right) => compareEntries(sort, left, right));

/* -------------------------------------------------------------------------- */
/* Gộp nhóm.                                                                   */
/* -------------------------------------------------------------------------- */

const largestAreaOf = (entries: readonly RoomWithArea[]): number =>
  entries.length === 0 ? 0 : Math.max(...entries.map((entry) => entry.areaM2));

/** Một nhóm đã đủ tổng phụ, số lượng và các dòng đã sắp xếp. */
function buildGroup(
  key: string,
  label: string,
  entries: readonly RoomWithArea[],
  graph: RoomAreaGraph,
  sort: RoomAreaSort,
): RoomAreaGroup {
  const largest = largestAreaOf(entries);

  return {
    key,
    label,
    countText: countText(entries.length),
    // Tổng phụ đi qua domain: cộng ở mm², làm tròn MỘT lần. Không cộng các số
    // đã làm tròn của từng dòng lại với nhau.
    subtotalText: groupMarkOf(graph, entries)(areaText(totalArea(outlinesOf(entries)))),
    rows: sortEntries(entries, sort).map((entry) => buildRow(entry, graph, largest)),
  };
}

/**
 * Gộp danh sách phòng thành các nhóm, theo tầng hoặc theo công năng.
 *
 * Lọc theo một trường CÓ SẴN rồi sắp xếp — không phải một công thức mới (PQ-7).
 * Nhóm rỗng bị bỏ đi: một tầng chưa có phòng nào thì nói qua
 * {@link levelOptionsOf} và `missingLevelNames`, không qua một đầu nhóm trống.
 */
export function buildGroups(
  entries: readonly RoomWithArea[],
  grouping: RoomAreaGrouping,
  sort: RoomAreaSort,
  graph: RoomAreaGraph,
): readonly RoomAreaGroup[] {
  if (grouping === 'usage') {
    return USAGE_ORDER.map((usage) =>
      buildGroup(
        usage,
        describeUsage(usage),
        entries.filter((entry) => entry.room.usage === usage),
        graph,
        sort,
      ),
    ).filter((group) => group.rows.length > 0);
  }

  return graph.levels
    .map((level) =>
      buildGroup(
        level.id,
        level.name,
        entries.filter((entry) => entry.room.levelId === level.id),
        graph,
        sort,
      ),
    )
    .filter((group) => group.rows.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Thu gọn — năm phòng lớn nhất TOÀN MÀN.                                      */
/* -------------------------------------------------------------------------- */

/**
 * Sức chứa của tấm trượt thu gọn: năm phòng.
 *
 * Cùng con số `COLLAPSED_ROW_CAPACITY` của `RoomAreaPanel.chrome.tsx`, và hai
 * chỗ là cố ý: view giữ một cái chặn phòng hờ cho bất kỳ nguồn `groups` nào,
 * còn đây là PHÉP CHỌN thật sự. Sau khi hàm dưới chạy, phép cắt ở view thành
 * một lượt không làm gì — đúng thứ nó nên là.
 */
export const COLLAPSED_ROOM_COUNT = 5;

/** Khoá và nhãn của nhóm duy nhất khi panel thu gọn. */
const COLLAPSED_GROUP_KEY = 'collapsed-largest';
export const COLLAPSED_GROUP_LABEL = 'Năm phòng lớn nhất';

/**
 * Một nhóm duy nhất chứa năm phòng lớn nhất trên TOÀN màn, giảm dần.
 *
 * Đặc tả trạng thái 7: "tấm trượt đáy chỉ hiện tổng và năm phòng lớn nhất".
 * Phép chọn này KHÔNG làm được ở view: `RoomAreaRow.areaRatio` là tỷ lệ TRONG
 * NHÓM, nên hai hàng ở hai nhóm khác nhau không so được với nhau, và phẳng hoá
 * `groups` rồi cắt năm hàng đầu chỉ cho ra "năm hàng đầu của nhóm đầu". Chọn là
 * việc của hook (PQ-7).
 *
 * Không một công thức mới nào ở đây (R-61): diện tích vẫn là `entry.areaM2` do
 * `selectRoomsWithArea` tính, tổng phụ vẫn do `buildGroup` gọi `totalArea`, và
 * mọi chuỗi vẫn đi qua `formatNumber`. Thứ hàm này tự làm chỉ có sắp xếp và
 * cắt — hai phép mà PQ-7 cho phép.
 *
 * Ít hơn năm phòng thì lấy hết; không phòng nào thì không nhóm nào, để trạng
 * thái `empty` là thứ lên tiếng chứ không phải một đầu nhóm trống.
 */
export function collapseToLargest(
  entries: readonly RoomWithArea[],
  graph: RoomAreaGraph,
): readonly RoomAreaGroup[] {
  if (entries.length === 0) {
    return [];
  }

  return [
    buildGroup(
      COLLAPSED_GROUP_KEY,
      COLLAPSED_GROUP_LABEL,
      sortEntries(entries, 'area').slice(0, COLLAPSED_ROOM_COUNT),
      graph,
      'area',
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Thanh xếp chồng — tối đa ba dải.                                            */
/* -------------------------------------------------------------------------- */

/**
 * Ba dải, mỗi dải một tông, tỷ lệ so với tổng của chính danh sách đang hiện.
 *
 * Tổng của mỗi dải và tổng chung đều gọi `totalArea`, nên tỷ lệ là thương của
 * hai số domain đã tính — không phải của hai số đã làm tròn cộng tay. Dải rỗng
 * bị bỏ, nên "tối đa ba" đúng cả khi bản vẽ chỉ có phòng ở.
 */
export function buildBands(entries: readonly RoomWithArea[]): readonly RoomAreaBand[] {
  const whole = totalArea(outlinesOf(entries));

  if (whole <= 0) {
    return [];
  }

  return TONE_ORDER.map((tone) => {
    const share = totalArea(
      outlinesOf(entries.filter((entry) => TONE_BY_USAGE[entry.room.usage] === tone)),
    );

    return { key: tone, label: TONE_LABELS[tone], ratio: share / whole, tone };
  }).filter((band) => band.ratio > 0);
}

/* -------------------------------------------------------------------------- */
/* Bộ chọn tầng và ô tổng.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Một mục cho mỗi tầng, kèm cờ "tầng này đã có diện tích chưa".
 *
 * `hasArea` sai khi tầng chưa có phòng nào đo được — đó là nguyên liệu của
 * trạng thái "một phần", nơi màn GỌI TÊN các tầng còn thiếu thay vì hiện một
 * bảng thiếu mà không nói gì.
 */
export function levelOptionsOf(
  entries: readonly RoomWithArea[],
  graph: RoomAreaGraph,
): readonly RoomAreaLevelOption[] {
  return graph.levels.map((level) => ({
    id: level.id,
    name: level.name,
    hasArea: totalArea(outlinesOf(entries.filter((entry) => entry.room.levelId === level.id))) > 0,
  }));
}

/** Ô tổng: giá trị thô cho `useCountUp`, chuỗi đã chạy số, đơn vị đứng riêng. */
export function buildTotals(input: {
  readonly totalM2: number;
  readonly totalText: string;
  readonly scopeLabel: string;
  readonly roomCount: number;
}): RoomAreaTotals {
  return {
    totalM2: input.totalM2,
    totalText: input.totalText,
    unitLabel: AREA_UNIT_LABEL,
    caption: `Tổng diện tích sàn ${input.scopeLabel} — ${countText(input.roomCount)} phòng`,
  };
}

/* -------------------------------------------------------------------------- */
/* Bảy trạng thái (A11).                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bảy trạng thái, suy ra từ dữ liệu THẬT — hàm thuần, kiểm được không cần hook.
 *
 * Thứ tự các nhánh không tuỳ tiện, và nó lặp lại đúng thứ tự của màn anh em
 * S-17 (`deriveRoomLabelScreenState`): vai chỉ xem đi trước vì một người xem
 * thu gọn panel vẫn là một người xem; `error` đi trước `loading` vì một lượt đã
 * hỏng thì không còn "đang tải" nữa; `collapsed` đi sau `empty` vì thu gọn một
 * bảng rỗng thì thứ cần nói vẫn là "chưa có phòng nào".
 *
 * KHÔNG có `useState` nào cho việc đang tải: `spatialLoaded` là "kho đã có đồ
 * thị và cổng nạp kho không còn đang nạp" — đọc thẳng `state.spatial` và
 * `state.spatialLoading` (B-V8-04). Lượt nạp là của cổng `ProjectSpatialGate`,
 * không phải của panel, nên panel không tự giữ cờ nào.
 */
export function deriveRoomAreaScreenState(input: {
  readonly isViewerRole: boolean;
  readonly hasWriteFailure: boolean;
  readonly spatialLoaded: boolean;
  readonly isCollapsed: boolean;
  readonly visibleRoomCount: number;
  readonly unnamedCount: number;
  readonly missingLevelCount: number;
}): RoomAreaScreenState {
  if (input.isViewerRole) {
    return 'forbidden';
  }

  if (input.hasWriteFailure) {
    return 'error';
  }

  if (!input.spatialLoaded) {
    return 'loading';
  }

  if (input.visibleRoomCount === 0) {
    return 'empty';
  }

  if (input.isCollapsed) {
    return 'collapsed';
  }

  return input.unnamedCount === 0 && input.missingLevelCount === 0 ? 'ready' : 'partial';
}

/* -------------------------------------------------------------------------- */
/* Chép bảng ra chữ.                                                           */
/* -------------------------------------------------------------------------- */

/** Ngăn cột bằng tab, để bản dán rơi đúng ô trong một bảng tính. */
const COLUMN_SEPARATOR = '\t';

/**
 * Bảng đang hiện, dưới dạng chữ.
 *
 * Chép lại đúng những chuỗi đã có trên màn — không định dạng lại lần thứ hai,
 * nên bản dán ra và bản đọc trên màn không bao giờ lệch nhau một chữ số.
 */
export function tableAsText(groups: readonly RoomAreaGroup[], totals: RoomAreaTotals): string {
  const lines: string[] = [];

  for (const group of groups) {
    lines.push(
      [group.label, group.countText, group.subtotalText].join(COLUMN_SEPARATOR),
    );

    for (const row of group.rows) {
      lines.push(
        [
          row.name,
          row.usageLabel,
          row.areaText,
          row.perimeterText,
          row.clearHeightText,
          row.doorCountText,
          row.windowCountText,
        ].join(COLUMN_SEPARATOR),
      );
    }
  }

  lines.push([totals.caption, totals.totalText, totals.unitLabel].join(COLUMN_SEPARATOR));

  return lines.join('\n');
}
