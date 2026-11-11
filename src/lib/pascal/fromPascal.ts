/**
 * Một lượt thay đổi trong Pascal thành **một lệnh** của AppFront.
 *
 * Đây là chỗ duy nhất mã Pascal chạm được vào bản vẽ, và nó cố ý đi qua đúng
 * con đường mọi công cụ khác đi: `createCommand` với ảnh chụp đầy đủ hai phía,
 * nên `Ctrl+Z` hoàn tác một lượt sửa trong Pascal y như hoàn tác một lượt kéo
 * tường (A8, A10). Không có đường tắt nào ghi thẳng vào store.
 *
 * ## Ba thứ file này từ chối làm
 *
 * - **Không ghi khi không có gì đổi.** Nạp một bản vẽ vào Pascal rồi đọc ngược
 *   ra phải cho **0** lệnh. Đó là phép so từng trường ở cuối file, và nó là
 *   hàng rào cuối cùng trước đồng hồ tự lưu.
 * - **Không tự đặt dấu xác minh.** Ảnh chụp "sau" lấy từ `toSpatialGraph`, và
 *   hàm đó chỉ trả dấu xác minh về cho node do chính AppFront viết ra (A5).
 * - **Không đoán loại.** Node Pascal thuộc loại AppFront không có thì lượt
 *   thay đổi bị từ chối kèm mã, chứ không bị lặng lẽ bỏ.
 *
 * Cổng lọc thay đổi ma (`guard.ts`) chạy **trước** file này. Hai thứ tách nhau
 * vì chúng trả lời hai câu khác nhau: cổng hỏi "lượt ghi này có thật không",
 * còn đây hỏi "lượt ghi thật ấy đổi những gì".
 *
 * ## File này CHƯA có nơi gọi thật, và đó là một quyết định đã ghi
 *
 * Tính tới 2026-09-29, `fromPascal.ts` · `toSpatial.ts` · `diff.ts` · `guard.ts`
 * — **1 232 dòng** — chỉ được gọi từ chính bài kiểm của chúng. Màn
 * `screens/viewer/PascalViewer` là màn **xem**: nó gọi `toPascal.ts` một chiều
 * và không bao giờ đọc ngược ra.
 *
 * **Đây không phải mã chết bỏ quên.** `docs/pascal/00-quyet-dinh.md` bản 4 ghi
 * người dùng chọn «chỉ-xem trước (core+viewer), mở sửa sau» ngày 2026-09-28, và
 * ghi rõ phạm vi "xem + sửa" **bị hoãn chứ không bị rút**. Bốn file này là nền
 * cho Bước 10, dựng xong và có hàng rào trước khi cần tới.
 *
 * Ghi ra ở đây vì CLAUDE.md phân biệt đúng chuyện này cho `src/lib/query` và
 * `src/lib/mutations` («đã có nơi gọi thật — không còn là tầng logic chờ màn đầu
 * tiên cắm vào. Đây chưa từng là mã chết»). Bốn file này thì **vẫn đang** chờ,
 * nên đừng đọc bài kiểm xanh của chúng thành "đường sửa đã chạy".
 */

import { outlineContains } from '@/domain/rooms/area';
import { readKindFromId, type EntityKind, type IdByKind } from '@/domain/spatial/ids';
import {
  isEntityOfKind,
  type EntityByKind,
  type NormalizedSpatial,
  type SpatialEntity,
} from '@/domain/spatial/normalize';
import type { Furniture, Room } from '@/domain/spatial/types';
import {
  buildCommand,
  formatCount,
  toPointMm,
  type CommandContext,
  type CommandRefusal,
} from '@/lib/commands/business/shared';
import { changeForAdd, changeForRemove, changeForUpdate } from '@/lib/commands/createCommand';
import type { Command, EntityChange, EntityChangeOfKind } from '@/lib/commands/types';
import { formatLength } from '@/lib/format/measure';
import { err, ok, type Result } from '@/lib/http/types';

import { sameValue } from './diff';
import type { PascalCommit } from './guard';
import { appFrontIdOf, bodyOfPascalId } from './ids';
import { roofIdOfSegment, roofNodeIdOf } from './roofs';
import { undoFloorTransforms } from './floorAlignment';
import { isGeneratedNodeId } from './sceneDressing';
import { DRESSING_OFF_MAX } from './sceneLayer';
import {
  adoptableRoomOf,
  isEditedGenerated,
  isLooseGenerated,
  toSpatialGraph,
  type PascalIdBook,
} from './toSpatial';
import type { PascalNodeType, PascalScene } from './types';

/** Vì sao một lượt thay đổi của Pascal không thành lệnh được. */
export type PascalRefusalCode = 'PASCAL_NO_CHANGE' | 'PASCAL_UNKNOWN_NODE' | 'PASCAL_WALL_BELOW_OPENING';

/**
 * Lời từ chối, mang thêm một mã máy đọc được.
 *
 * Mở rộng `CommandRefusal` chứ không dựng một hình dạng thứ hai: mọi nơi đang
 * nhận lời từ chối của tầng lệnh nhận được cái này mà không phải sửa gì.
 */
export interface PascalRefusal extends CommandRefusal {
  readonly code: PascalRefusalCode;
}

/** Lệnh dựng được, hoặc lý do không dựng được. */
export type PascalEditResult = Result<Command, PascalRefusal>;

/** Tên lệnh cho mọi thay đổi đến từ màn Pascal. */
export const PASCAL_COMMAND_TYPE = 'pascal.edit';

/** Mọi thứ cần để dựng một lệnh từ một lượt thay đổi. */
export interface PascalEditInput {
  /** Bản vẽ **trước** thay đổi; ảnh chụp "trước" lấy từ đây. */
  readonly graph: NormalizedSpatial;
  /** Cảnh Pascal **sau** thay đổi. */
  readonly scene: PascalScene;
  /** Node nào Pascal khai là đã đổi. */
  readonly commit: PascalCommit;
  readonly actorId: string;
  /** Sổ id của phiên, để đối tượng mới giữ nguyên id qua nhiều lượt sửa. */
  readonly idBook?: PascalIdBook;
  /** Node món tự sinh không phòng nhận nuôi mà người dùng đã sửa so với lúc nạp: riêng chúng thành đồ thật. */
  readonly adoptNodeIds?: readonly string[];
  /** Chỉ dùng cho bài kiểm và lượt chạy lại. */
  readonly id?: CommandContext['id'];
  /** Chỉ dùng cho bài kiểm và lượt chạy lại. */
  readonly timestamp?: string;
}

/** Loại đối tượng AppFront ứng với từng loại node Pascal. */
const KIND_OF_NODE_TYPE: Readonly<Record<PascalNodeType, EntityKind | null>> = {
  site: null,
  building: null,
  level: 'level',
  wall: 'wall',
  door: 'opening',
  window: 'opening',
  zone: 'room',
  // Sàn dựng ra từ đường bao phòng (`slab_<id phòng>`): sơn sàn là sửa phòng ấy (W3a,
  // `Room.finish`/`floorMaterial`). Tấm sàn tự vẽ không có id phòng nên vẫn bị bỏ qua.
  slab: 'room',
  item: 'furniture',
  // Trần dựng ra từ đường bao phòng, như sàn: không sở hữu đối tượng nào.
  ceiling: null,
  'structural-grid': 'axis',
  // Thang dựng từ đồ đạc `stair`; đoạn thang `sseg_<id đồ>` mang cùng id nên sửa nó = sửa món đồ.
  stair: 'furniture',
  'stair-segment': 'furniture',
  roof: 'roof',
  'roof-segment': 'roof',
};

/** Tên tiếng Việt của từng loại, cho câu mô tả trong nhật ký hoạt động. */
const KIND_LABELS: Readonly<Record<EntityKind, string>> = {
  level: 'tầng',
  wall: 'tường',
  opening: 'ô mở',
  furniture: 'đồ đạc',
  room: 'phòng',
  axis: 'trục định vị',
  dimension: 'kích thước',
  roof: 'mái',
};

/**
 * Loại đối tượng của một node đã đổi.
 *
 * Ba câu trả lời, và cả ba đều cần thiết: một loại đối tượng; `'structural'`
 * cho khu đất và công trình, hai node tổng hợp **không** có đối tượng tương
 * ứng và đổi chúng không phải là lỗi; `null` cho node không đọc nổi.
 */
/**
 * Tiền tố id của mặt mái và phụ kiện mái (máng, ống xả, ô thoáng…). Node đã xoá mang tiền tố này
 * không phải đối tượng AppFront: mặt mái của mái chưa lưu, hoặc máng Pascal tự sinh lại.
 */
const ROOF_PART_PREFIXES: ReadonlySet<string> = new Set([
  'rseg', 'gutter', 'downspout', 'rvent', 'bvent', 'tvent', 'eyebrow-vent',
  'chimney', 'cupola', 'dormer', 'skylight', 'solarpanel', 'leanto',
]);

/** Sửa/xoá một mặt mái là sửa mái cha của nó: quy id mặt mái về id node mái. */
const roofOwnerOf = (nodeId: string, scene: PascalScene, graph: NormalizedSpatial): string => {
  const node = scene.nodes[nodeId];

  if (node?.type === 'roof-segment') {
    return node.parentId ?? nodeId;
  }

  if (node === undefined && nodeId.startsWith('rseg_')) {
    const roofs = graph.byKind.roof
      .map((id) => graph.byId[id])
      .filter((entity): entity is EntityByKind['roof'] => entity !== undefined && isEntityOfKind('roof', entity));
    const owner = roofIdOfSegment(roofs, nodeId);

    return owner === null ? nodeId : roofNodeIdOf(owner);
  }

  return nodeId;
};

const kindOfNode = (
  nodeId: string,
  scene: PascalScene,
  idBook: PascalIdBook,
): EntityKind | 'structural' | null => {
  // Đèn trần và đồ bày biện do AppFront sinh ra: không phải đồ đạc, kể cả khi đã bị xoá khỏi cảnh.
  if (isGeneratedNodeId(nodeId)) {
    return 'structural';
  }

  const node = scene.nodes[nodeId];

  if (node !== undefined) {
    return KIND_OF_NODE_TYPE[node.type] ?? 'structural';
  }

  if (ROOF_PART_PREFIXES.has(nodeId.slice(0, Math.max(0, nodeId.indexOf('_'))))) {
    return 'structural';
  }

  // Node đã bị xoá khỏi cảnh: loại đọc từ id, qua sổ id nếu nó do Pascal đẻ.
  const remembered = idBook.get(nodeId);

  return readKindFromId(remembered ?? bodyOfPascalId(nodeId));
};

/** Id AppFront của một node, dù node ấy do AppFront viết ra hay Pascal đẻ. */
const appFrontIdFor = <K extends EntityKind>(
  kind: K,
  nodeId: string,
  idBook: PascalIdBook,
): IdByKind[K] | null => {
  const direct = appFrontIdOf(kind, nodeId);

  if (direct !== null) {
    return direct;
  }

  // Id do `toSpatialGraph` vừa cấp trong chính lượt này; sổ id là chỗ nó ghi lại.
  const remembered = idBook.get(nodeId);

  return remembered !== undefined && readKindFromId(remembered) === kind
    ? (remembered as IdByKind[K])
    : null;
};

/** Thực thể đang có trong bản vẽ, hoặc `undefined`. */
const graphEntity = (graph: NormalizedSpatial, id: string): SpatialEntity | undefined =>
  graph.byId[id];

/**
 * Một thay đổi của một loại cụ thể, nhìn như một thay đổi bất kỳ.
 *
 * `EntityChangeOfKind<K>` và hợp `EntityChange` là **cùng một thứ** khi `K` đã
 * cụ thể, nhưng TypeScript không nối được hai phép truy chỉ số trong khi `K`
 * còn là tham số kiểu. Đây đúng là hạn chế mà `createCommand.ts` đã ghi lại ở
 * `idOfEntity`, và cách chữa cũng vậy: khẳng định lại đúng một lần, ở một chỗ.
 */
const asChange = <K extends EntityKind>(change: EntityChangeOfKind<K>): EntityChange =>
  change as EntityChange;

/**
 * R3-F1 — trường I1 mà `toSpatialGraph` chưa viết ra (đồ đạc: `variant` ·
 * `heightMm` · `liftMm`; phòng: `finish`). Không mang từ "trước" sang thì một
 * lượt sửa bất kỳ xoá chúng khỏi bản vẽ, và phép so "có đổi gì không" luôn ra
 * "đổi". Chỉ lấp khi "sau" thiếu: tường/ô mở/tầng luôn có `heightMm` nên không
 * bị đụng. Khi `toSpatial` viết được các trường này thì bỏ hàm này đi.
 *
 * `edited` · `clearAreaM2` · `detectedThicknessMm`: máy chủ tự đặt, về kho sau lượt PUT và `toSpatial` không viết ra.
 * Thiếu chúng thì món/phòng/tường không ai sửa cũng ra "đổi" và mất dấu duyệt. Sửa thật thì `clearAreaM2` cũ chỉ sống
 * tới khi PUT trả về: lượt gửi không mang nó, máy chủ tính lại.
 */
const READ_ONLY_KEYS = ['variant', 'heightMm', 'liftMm', 'finish', 'edited', 'clearAreaM2', 'detectedThicknessMm'] as const;

const carriedFrom = (before: object, after: object): Readonly<Record<string, unknown>> => {
  const was = before as Readonly<Record<string, unknown>>;
  const now = after as Readonly<Record<string, unknown>>;

  return Object.fromEntries(
    READ_ONLY_KEYS.filter((key) => now[key] === undefined && was[key] !== undefined).map((key) => [
      key,
      was[key],
    ]),
  );
};

/**
 * Siêu dữ liệu duyệt của một lượt **sửa** đến từ Pascal — hàng rào A5, và C2.
 *
 * `toSpatialGraph` đã chặn node Pascal tự đẻ mang dấu xác minh về. Còn một lỗ
 * nhỏ hơn: một đối tượng **cũ** của AppFront đi sang Pascal mang theo
 * `metadata.appfront`, và bên kia tường sửa được túi siêu dữ liệu ấy. Sửa
 * `reviewed` thành `true` là đủ để một bức tường chưa ai duyệt về với dấu xanh.
 * Nên `confidence` và `source` luôn lấy từ ảnh chụp "trước": Pascal đổi được
 * hình học, không đổi được phán quyết của người duyệt.
 *
 * Hàm này giữ cả ba trường, vì nó còn phục vụ phép so "có đổi gì không".
 * `changeBetween` mới là chỗ bỏ `reviewed` đi, và chỉ khi lượt sửa là thật
 * (04 §C2 — "mất dấu xác minh").
 */
const withReviewOfPrevious = <K extends EntityKind>(
  before: EntityByKind[K],
  after: EntityByKind[K],
): EntityByKind[K] => ({
  ...carriedFrom(before, after),
  ...after,
  confidence: before.confidence,
  source: before.source,
  reviewed: before.reviewed,
});

/** Một thay đổi của đúng một thực thể, hoặc `null` khi thực thể không đổi. */
const changeBetween = <K extends EntityKind>(
  kind: K,
  before: SpatialEntity | undefined,
  after: SpatialEntity | undefined,
): EntityChange | null => {
  const from = before !== undefined && isEntityOfKind(kind, before) ? before : null;
  const to = after !== undefined && isEntityOfKind(kind, after) ? after : null;

  if (from === null) {
    return to === null ? null : asChange(changeForAdd(kind, to));
  }

  if (to === null) {
    return asChange(changeForRemove(kind, from));
  }

  const settled = withReviewOfPrevious<K>(from, to);

  /* Hình học không đổi: không có lệnh. `reviewed` lấy từ "trước", nên một cú sửa
     túi `metadata.appfront` bên Pascal không duyệt được gì — duyệt chỉ ở màn QC (A5). */
  if (sameValue(from, settled)) {
    return null;
  }

  /* C2 — lượt sửa này là thật, nên dấu xác minh KHÔNG sống sót qua nó. Đặt
     `reviewed` sau phép so chứ không trong `withReviewOfPrevious`: so trước
     thì một bức tường đã duyệt mà không ai đụng tới cũng thành "đã đổi", và
     lượt nạp lại sinh ra một lệnh từ hư không. */
  /* 23R-C-006 — tên không phải hình học: cùng định nghĩa với
     `NON_GEOMETRY_KEYS` của vendor (`core/src/schema/review.ts`). Lượt sửa chỉ
     đổi `name` thì dấu xác minh sống sót, như panel Pascal vẫn hiển thị. */
  const nameOnly = sameValue({ ...from, name: undefined }, { ...settled, name: undefined });

  return asChange(
    changeForUpdate(kind, from, nameOnly ? settled : { ...settled, reviewed: false }),
  );
};

/**
 * V4 — món đồ đã dời ra khỏi phòng của nó sang một phòng khác cùng tầng thì
 * `roomId` theo sang. Tâm vẫn trong phòng cũ, hoặc không phòng nào chứa: giữ
 * nguyên — kể cả tâm nằm đúng trên đường bao phòng cũ (cách cạnh ≤ 1 mm).
 * Chỉ áp cho món mà lượt này dời thật: dữ liệu cũ có món nằm lệch phòng, đổi
 * chúng khi không ai chạm tới là ghi từ hư không.
 */
export const withRoomOfCentre = (item: Furniture, rooms: readonly Room[]): Furniture => {
  const { x, y } = item.centre;
  const contains = (room: Room): boolean =>
    room.levelId === item.levelId && outlineContains(room.outline.map(toPointMm), toPointMm(item.centre));
  const onEdge = (room: Room): boolean =>
    room.outline.some((a, index) => {
      const b = room.outline[(index + 1) % room.outline.length] ?? a;
      const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / length2));

      return Math.hypot(x - (a.x + t * (b.x - a.x)), y - (a.y + t * (b.y - a.y))) <= 1;
    });
  const current = rooms.find((room) => room.id === item.roomId);

  if (current !== undefined && (contains(current) || onEdge(current))) return item;

  const next = rooms.find(contains);

  return next === undefined ? item : { ...item, roomId: next.id };
};

/**
 * K6/A2-05/F-06 — sửa (cả sơn) một mục đã duyệt thì dấu "đã duyệt" bị bỏ (luật C2 ở `changeBetween`,
 * không đổi). Câu báo cho người dùng, một câu mỗi loại; nơi gọi đưa vào `onNotice` sau khi lưu được.
 */
export const reviewLostNotices = (command: Command): string[] => {
  const kinds = new Set(
    command.changes.flatMap((change) =>
      change.before !== null && change.after !== null && change.before.reviewed && !change.after.reviewed ? [change.kind] : [],
    ),
  );

  return [...kinds].map(
    (kind) => `Bạn vừa sửa ${KIND_LABELS[kind]} đã duyệt nên dấu "đã duyệt" được bỏ. Hãy duyệt lại ở bước Duyệt tầng.`,
  );
};

/** Câu mô tả cho nhật ký hoạt động: đếm theo việc, rồi đếm theo loại. */
const describe = (changes: readonly EntityChange[]): string => {
  const countOf = new Map<string, number>();

  for (const change of changes) {
    const verb = change.before === null ? 'thêm' : change.after === null ? 'xoá' : 'sửa';
    const key = `${verb} ${KIND_LABELS[change.kind]}`;

    countOf.set(key, (countOf.get(key) ?? 0) + 1);
  }

  const parts = [...countOf].map(([key, count]) => `${key} ${formatCount(count)}`);

  return `Từ màn 3D: ${parts.join(', ')}.`;
};

/**
 * #20 (A9) — tường không được thấp hơn đỉnh ô mở cao nhất trên nó.
 *
 * Chỉ soát những tường mà lượt này chạm tới: tường đổi, và tường chứa ô mở
 * đổi. Câu trả về là lời từ chối; `validateCommit` hoàn lại lượt sửa và nói
 * câu ấy cho người dùng, nên không có gì đã ghi phải hoàn tác bằng tay.
 */
const wallBelowOpening = (
  changes: readonly EntityChange[],
  after: ReturnType<typeof toSpatialGraph>['graph'],
): string | null => {
  const touched = new Set<string>();

  for (const change of changes) {
    const entity = change.after;

    if (entity === null || entity === undefined) continue;
    if (change.kind === 'wall') touched.add(entity.id);
    if (change.kind === 'opening' && 'wallId' in entity) touched.add(entity.wallId);
  }

  for (const wall of after.walls) {
    if (!touched.has(wall.id)) continue;

    const tops = after.openings
      .filter((opening) => opening.wallId === wall.id)
      .map((opening) => opening.sillHeightMm + opening.heightMm);
    const highest = Math.max(...tops);

    if (tops.length > 0 && wall.heightMm < highest) {
      return `Tường cao ${formatLength(wall.heightMm)}, thấp hơn đỉnh ô mở cao nhất trên nó (${formatLength(highest)}). Hạ ô mở trước, hoặc giữ tường cao ít nhất ${formatLength(highest)}.`;
    }
  }

  return null;
};

/**
 * Dựng lệnh cho một lượt thay đổi của Pascal.
 *
 * Trả lời từ chối khi lượt ấy không đổi gì (`PASCAL_NO_CHANGE`) hoặc khi nó
 * nhắc tới một node không quy được về loại đối tượng nào của bản vẽ
 * (`PASCAL_UNKNOWN_NODE`). Cả hai đều là lời từ chối **bình thường**, không
 * phải lỗi: lượt nạp đầu tiên gần như luôn rơi vào trường hợp thứ nhất.
 */
export const createPascalEditCommand = (input: PascalEditInput): PascalEditResult => {
  // Luôn có một sổ id, kể cả khi người gọi không giữ sổ nào: đối tượng Pascal
  // vừa vẽ được cấp id **trong** lượt đổi dưới đây, và không có sổ thì lượt
  // này không tìm lại được id vừa cấp — đối tượng mới sẽ lặng lẽ không vào lệnh.
  const idBook: PascalIdBook = input.idBook ?? new Map();
  /* Tầng căn (báo cáo 2.8.2) chỉ dời khi hiển thị: gỡ một lần ở đây để mọi so sánh với
     siêu dữ liệu đã lưu (đồ bày biện "đã dời chưa", toSpatialGraph) dùng toạ độ đã lưu. */
  const scene = undoFloorTransforms(input.scene);
  /* V4 — sửa (dời/xoay/kéo/sơn/đổi mẫu) một món bày biện sinh ra: RIÊNG món ấy thành đồ thật, id gốc vào
     `dressingOff`; anh em vẫn là lớp dẫn xuất (`toPascal` tính phòng như khi món còn là đồ sinh, nhận ra cặp qua
     `adoptedFurnitureIdOf`). Món đã nhận trong phiên (có trong sổ id) mà vẫn khác lúc nạp thì giữ nhận qua các lượt
     sau. Hoàn tác về đúng như cũ thì món lại là đồ sinh. Xoá thì ghi `Room.dressingOff` (H4). */
  const changedIds = new Set(input.commit.changedNodeIds);
  const adoptNodeIds = new Set(
    Object.values(scene.nodes)
      .filter((node) => (changedIds.has(node.id) || idBook.has(node.id)) && isEditedGenerated(node))
      .map((node) => node.id)
      .concat(input.adoptNodeIds ?? []),
  );
  const { graph: after, skipped } = toSpatialGraph(scene, idBook, adoptNodeIds);
  const afterById = new Map<string, SpatialEntity>();

  for (const entity of [
    ...after.levels,
    ...after.walls,
    ...after.openings,
    ...after.furniture,
    ...after.rooms,
    ...after.axes,
    ...(after.roofs ?? []),
  ]) {
    afterById.set(entity.id, entity);
  }

  const changes: EntityChange[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const changedId of input.commit.changedNodeIds) {
    const nodeId = roofOwnerOf(changedId, scene, input.graph);
    const kind = kindOfNode(nodeId, scene, idBook);

    if (kind === null) {
      unknown.push(nodeId);
      continue;
    }

    if (kind === 'structural') {
      continue;
    }

    const entityId = appFrontIdFor(kind, nodeId, idBook);

    if (entityId === null || seen.has(entityId)) {
      continue;
    }

    seen.add(entityId);

    const before = graphEntity(input.graph, entityId);
    const now = afterById.get(entityId);

    /* N1 — node còn trong cảnh mà không thành đối tượng: không bao giờ là một lần xoá. Từ chối
       kèm lý do (dòng bỏ qua của nó, nếu có) thay vì ghi xoá thứ người dùng vẫn đang thấy. */
    if (now === undefined && before !== undefined && scene.nodes[nodeId] !== undefined) {
      const reason = skipped.find((entry) => entry.id === nodeId)?.reason;

      return err({
        type: PASCAL_COMMAND_TYPE,
        code: 'PASCAL_UNKNOWN_NODE',
        reasons: [reason ?? 'Đối tượng này vẫn còn trong cảnh nhưng không đọc lại được nên thay đổi bị từ chối.'],
      });
    }
    // V4 — đồ thật vừa dời: `roomId` theo phòng mới chứa tâm nó.
    const moved =
      now !== undefined &&
      before !== undefined &&
      isEntityOfKind('furniture', now) &&
      isEntityOfKind('furniture', before) &&
      !sameValue(before.centre, now.centre);
    const change = changeBetween(kind, before, moved ? withRoomOfCentre(now, after.rooms) : now);

    if (change !== null) {
      changes.push(change);
    }
  }

  /* Món sinh đã thành đồ thật: sửa tiếp là cập nhật; hoàn tác về như lúc nạp hay xoá hẳn thì đồ thật ấy đi theo. */
  for (const nodeId of input.commit.changedNodeIds) {
    const node = scene.nodes[nodeId];
    const minted =
      isGeneratedNodeId(nodeId) && (node === undefined || isLooseGenerated(node) || adoptableRoomOf(node) !== null)
        ? idBook.get(nodeId)
        : undefined;

    if (minted === undefined || seen.has(minted)) continue;
    const now = afterById.get(minted);
    const change = changeBetween(
      'furniture',
      graphEntity(input.graph, minted),
      now !== undefined && isEntityOfKind('furniture', now) ? withRoomOfCentre(now, after.rooms) : undefined,
    );

    seen.add(minted);
    if (change !== null) changes.push(change);
  }

  /* H4 — xoá món tự bày, sơn trần (node "kết cấu", vòng trên bỏ qua) là sửa phòng của nó:
     `dressingOff` / `ceilingMaterial` mới. */
  for (const room of after.rooms) {
    const before = graphEntity(input.graph, room.id);

    if (seen.has(room.id) || before === undefined || !isEntityOfKind('room', before)) continue;
    if (sameValue(before.dressingOff ?? [], room.dressingOff ?? []) && before.ceilingMaterial === room.ceilingMaterial) {
      continue;
    }

    const change = changeBetween('room', before, room);

    if (change !== null) {
      seen.add(room.id);
      changes.push(change);
    }
  }

  /* R3-F2, N2 — node vừa đổi mà rơi vào danh sách bỏ qua (đồ gắn trần, tường hỏng số đo, sàn
     tự vẽ…) không thành đối tượng được; lặng lẽ bỏ là mất thứ người dùng vừa làm. Từ chối kèm lý do. */
  const changed = new Set(
    input.commit.changedNodeIds.flatMap((nodeId) => [nodeId, roofOwnerOf(nodeId, scene, input.graph)]),
  );
  const dropped = skipped.find((entry) => changed.has(entry.id));

  if (dropped !== undefined) {
    return err({ type: PASCAL_COMMAND_TYPE, code: 'PASCAL_UNKNOWN_NODE', reasons: [dropped.reason] });
  }

  if (unknown.length > 0) {
    return err({
      type: PASCAL_COMMAND_TYPE,
      code: 'PASCAL_UNKNOWN_NODE',
      reasons: [
        `Có ${formatCount(unknown.length)} đối tượng vừa sửa chưa lưu được trong bản này, nên thay đổi chưa được ghi.`,
      ],
    });
  }

  if (changes.length === 0) {
    return err({
      type: PASCAL_COMMAND_TYPE,
      code: 'PASCAL_NO_CHANGE',
      reasons: ['Thay đổi này không làm bản vẽ khác đi nên không có gì để ghi.'],
    });
  }

  /* `Room.dressingOff` không rơi dấu của món đã nhận (rơi = món mọc đôi): đầy trần thì từ chối nhận thêm, giữ nguyên dữ liệu. */
  const full = after.rooms.find((room) => (room.dressingOff ?? []).length > DRESSING_OFF_MAX);

  if (full !== undefined) {
    return err({
      type: PASCAL_COMMAND_TYPE,
      code: 'PASCAL_UNKNOWN_NODE',
      reasons: [
        `Phòng "${full.name}" đã có ${formatCount(DRESSING_OFF_MAX)} món bày sẵn được sửa hoặc xoá, chưa nhận thêm được. Món đã được đặt về như cũ.`,
      ],
    });
  }

  const tooLow = wallBelowOpening(changes, after);

  if (tooLow !== null) {
    return err({ type: PASCAL_COMMAND_TYPE, code: 'PASCAL_WALL_BELOW_OPENING', reasons: [tooLow] });
  }

  const context: CommandContext = {
    graph: input.graph,
    actorId: input.actorId,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
  };

  return ok(buildCommand(PASCAL_COMMAND_TYPE, describe(changes), changes, context));
};

