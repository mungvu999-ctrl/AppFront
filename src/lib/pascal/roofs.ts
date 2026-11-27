/**
 * Mái: `Roof` của bản vẽ ⇄ node Pascal `roof` + `roof-segment` (roof-contract.md).
 *
 * Máy chủ không hiểu hình học mái, và AppFront cũng không: `Roof.nodes` là node Pascal nguyên
 * dạng bỏ `parentId`/`children`. Lượt đi gắn lại cây (mái dưới tầng, mặt mái dưới mái); lượt
 * về gỡ cây ra. Id node mái theo lệ `ids.ts` (`roof_RF-…`), id mặt mái giữ nguyên `rseg_…`.
 *
 * GĐ6: cờ realism details bật mà mặt mái thiếu `fascia` / `metadata.autoGutter` thì lượt đi
 * bật chúng, và ghi tên khoá đã bật vào `metadata.appfrontDefaults` để lượt về gỡ đúng các
 * khoá còn giữ giá trị mặc định ấy: nạp rồi đọc ngược ra vẫn 0 lệnh.
 * ponytail: ống máng (gutter) và phụ kiện con của mặt mái không lưu; Pascal chỉ sinh lại máng
 * khi mặt mái được sửa. Cần giữ thì nới hợp đồng cho node cháu.
 */

import type { LevelId, ReviewMetadata, Roof, RoofId } from '@/domain/spatial/types';
import { isDetailsEnabled } from '@/pascal-page/realism/details';

import { toPascalId } from './ids';
import type { PascalNode, PascalNodeId, PascalRoofNode, PascalRoofSegmentNode, PascalScene } from './types';

/** Node mái + tối đa 32 mặt mái (roof-contract.md). */
export const ROOF_MAX_NODES = 33;
/** JSON của cả mái ≤ 64 KB (roof-contract.md). */
export const ROOF_MAX_BYTES = 64 * 1024;

const DEFAULTED_KEY = 'appfrontDefaults';

type Blob = Readonly<Record<string, unknown>>;

const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as Blob) } : {};

/** Id node Pascal của một mái. */
export const roofNodeIdOf = (roofId: RoofId): PascalNodeId => toPascalId('roof', roofId);

const isSegmentBlob = (node: Blob): boolean =>
  node.type === 'roof-segment' && typeof node.id === 'string' && node.id.startsWith('rseg_');

/** Bật diềm + máng tự động cho mặt mái thiếu chúng khi cờ details bật. */
const withDetailDefaults = (segment: Blob): Blob => {
  if (!isDetailsEnabled()) return segment;

  const metadata = recordOf(segment.metadata);
  const defaulted = [
    ...(segment.fascia === undefined ? ['fascia'] : []),
    ...(metadata.autoGutter === undefined ? ['autoGutter'] : []),
  ];

  if (defaulted.length === 0) return segment;

  return {
    ...segment,
    ...(segment.fascia === undefined ? { fascia: true } : {}),
    metadata: {
      ...metadata,
      ...(metadata.autoGutter === undefined ? { autoGutter: true } : {}),
      [DEFAULTED_KEY]: defaulted,
    },
  };
};

/**
 * Node Pascal của một mái, gắn dưới `levelNodeId`, hoặc lý do không dựng được.
 * Phần tử đầu là node `roof`, các phần tử sau là `roof-segment` của nó.
 */
export const roofNodesOf = (roof: Roof, levelNodeId: PascalNodeId): readonly PascalNode[] | string => {
  const [head, ...rest] = roof.nodes;

  if (head?.type !== 'roof') return 'Mái này thiếu dữ liệu nên chưa lưu được.';
  if (!rest.every(isSegmentBlob)) return 'Mái có phần tử không phải một mặt mái ("roof-segment") hợp lệ.';

  const roofNodeId = roofNodeIdOf(roof.id);
  const segments = rest.map(
    (segment) =>
      ({ ...withDetailDefaults(segment), object: 'node', parentId: roofNodeId, children: [] }) as unknown as PascalRoofSegmentNode,
  );
  const roofNode = {
    ...head,
    object: 'node',
    id: roofNodeId,
    type: 'roof',
    parentId: levelNodeId,
    children: segments.map((segment) => segment.id),
    metadata: {
      ...recordOf(head.metadata),
      appfront: { confidence: roof.confidence, source: roof.source, reviewed: roof.reviewed },
    },
  } as unknown as PascalRoofNode;

  return [roofNode, ...segments];
};

/** Node Pascal → phần tử của `Roof.nodes`: bỏ cây, bỏ túi AppFront, gỡ mặc định GĐ6 còn nguyên. */
const storedNodeOf = (node: PascalNode): Blob => {
  const rest = { ...(node as unknown as Record<string, unknown>) };

  delete rest.parentId;
  delete rest.children;
  const metadata = recordOf(rest.metadata);
  const defaulted = metadata[DEFAULTED_KEY];

  delete metadata.appfront;
  delete metadata[DEFAULTED_KEY];

  if (Array.isArray(defaulted)) {
    if (defaulted.includes('fascia') && rest.fascia === true) delete rest.fascia;
    if (defaulted.includes('autoGutter') && metadata.autoGutter === true) delete metadata.autoGutter;
  }

  return { ...rest, metadata };
};

/** Mặt mái con của một node mái, theo đúng thứ tự `children`. */
export const roofSegmentsOf = (scene: PascalScene, roofNode: PascalRoofNode): readonly PascalRoofSegmentNode[] =>
  roofNode.children
    .map((childId) => scene.nodes[childId])
    .filter((node): node is PascalRoofSegmentNode => node?.type === 'roof-segment');

/** Một mái của bản vẽ từ node Pascal, hoặc lý do không lưu được. */
export const roofOf = (
  scene: PascalScene,
  roofNode: PascalRoofNode,
  id: RoofId,
  levelId: LevelId,
  review: ReviewMetadata,
): Roof | string => {
  const segments = roofSegmentsOf(scene, roofNode);

  if (segments.length + 1 > ROOF_MAX_NODES) {
    return `Mái có ${String(segments.length)} mặt, quá ${String(ROOF_MAX_NODES - 1)} mặt mà bản vẽ lưu được.`;
  }

  const roof: Roof = {
    ...review,
    id,
    levelId,
    nodes: [storedNodeOf({ ...roofNode, id: roofNodeIdOf(id) }), ...segments.map(storedNodeOf)],
  };

  if (JSON.stringify(roof).length > ROOF_MAX_BYTES) {
    return 'Mái quá lớn (quá 64 KB) nên chưa lưu được.';
  }

  return roof;
};

/** Mặt mái `rseg_…` của mái nào trong danh sách, theo `Roof.nodes`. */
export const roofIdOfSegment = (roofs: readonly Roof[], segmentNodeId: PascalNodeId): RoofId | null =>
  roofs.find((roof) => roof.nodes.some((node) => node.id === segmentNodeId))?.id ?? null;

/**
 * NHA-09 - "Duyệt mái" là ngoại lệ DUY NHẤT của hàng rào A5 ở `fromPascal.ts` (phán quyết duyệt luôn lấy từ ảnh
 * chụp "trước", không lấy từ cảnh). Thẻ `RoofTrustCard` đổi túi `metadata.appfront` của node mái, và chỉ hai bước
 * chuyển sau được nhận từ cảnh: mái máy dựng chưa duyệt -> người đã duyệt (bấm "Duyệt mái"), và chiều ngược lại
 * (hoàn tác đúng cú bấm đó). Mọi cặp khác, và mọi loại thực thể khác, trả `null`: giữ phán quyết của "trước".
 *
 * Phán quyết nhận được là của chính lượt lưu này, kể cả khi mái vừa được sửa trong cùng lượt: `changeBetween`
 * nhận ra nó qua `reviewed` khác "trước" và không áp C2 lên lượt đó.
 *
 * shortcut: một lượt lưu (bộ tự lưu gom 1 giây) không cho biết sửa trước hay duyệt trước, nên "duyệt rồi sửa ngay
 * trong cùng lượt" cũng được ghi là đã duyệt. Cùng một người, cách nhau dưới 1 giây. Nâng cấp khi cần phân biệt:
 * ghi dấu hình mái lúc duyệt vào túi và so lại ở lượt lưu.
 */
export const roofVerdictOf = (
  kind: string,
  before: Pick<ReviewMetadata, 'source' | 'reviewed'>,
  after: Pick<ReviewMetadata, 'source' | 'reviewed'>,
): Pick<ReviewMetadata, 'source' | 'reviewed'> | null => {
  if (kind !== 'roof') return null;
  const approved =
    before.source === 'ai' && !before.reviewed && after.source === 'human' && after.reviewed;
  const undone =
    before.source === 'human' && before.reviewed && after.source === 'ai' && !after.reviewed;

  return approved || undone ? { source: after.source, reviewed: after.reviewed } : null;
};
