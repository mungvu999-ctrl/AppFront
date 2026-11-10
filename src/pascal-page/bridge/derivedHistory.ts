/**
 * Node dẫn xuất qua hoàn tác (Ctrl+Z/Ctrl+Y). Cầu nối dựng lại cảnh từ kho giữa phiên (sửa cảnh tính lại, bật/tắt
 * "Hiện dữ liệu gốc", nhận gợi ý) mà KHÔNG ghi bước hoàn tác; lịch sử của editor giữ ảnh chụp cả cây, nên Ctrl+Z
 * sau một lượt dựng lại trả về cả các node dẫn xuất CŨ: món AI ở vị trí đã sửa cảnh cũ, đồ `DRESS-`/`LIGHT-` của
 * lượt dựng trước. So với mốc, chúng trông như người dùng vừa sửa → lượt lưu ghi vị trí sửa tự động về máy chủ,
 * nhận nuôi đồ sinh thành đồ thật (nhân đôi), hay ghi `dressingOff` cho đồ sinh "bị xoá".
 *
 * `restoreDerived` gỡ chuyện đó trước khi so: node dẫn xuất trùng một bản cầu nối từng trao cho editor (mà không
 * phải bản hiện hành) là trạng thái cũ do hoàn tác, không phải sửa → thay bằng bản hiện hành (vắng thì bỏ); món AI
 * người dùng đã đụng thì thay bằng node của chính nó ở dữ liệu trước khi đụng (hoàn tác thật về máy chủ). Thấy dấu
 * hoàn tác (một node như vậy, hoặc phần dẫn xuất của cảnh khớp trọn một lượt dựng cũ) thì node dẫn xuất của bản hiện
 * hành mà cảnh thiếu (đồ sinh, món từng bị sửa cảnh ẩn) cũng được trả lại — không thì lượt lưu ghi "xoá" chúng.
 * Sau lượt lưu cầu nối dựng lại cảnh.
 */

import type { FurnitureId, SpatialGraph } from '@/domain/spatial/types';
import { bodyOfPascalId, toPascalId } from '@/lib/pascal/ids';
import { dressNodeIdOf, isGeneratedNodeId } from '@/lib/pascal/sceneDressing';
import { REPAIR_FIELD } from '@/lib/pascal/sceneLayer';
import type { RepairSession } from '@/lib/pascal/sceneRepair';
import { SUGGESTED_OUTLINE_PREFIX } from '@/lib/pascal/toPascal';
import type { PascalNode, PascalNodeId, PascalScene } from '@/lib/pascal/types';

/** Một lượt cầu nối trao cảnh cho editor: node dẫn xuất và món bị sửa cảnh ẩn (vắng khỏi cảnh). */
interface DerivedRecord {
  readonly nodes: ReadonlyMap<PascalNodeId, PascalNode>;
  readonly hidden: ReadonlySet<PascalNodeId>;
}

export interface DerivedHistory {
  /** Mọi bản node dẫn xuất cầu nối từng trao cho editor trong phiên, theo id. */
  readonly versions: Map<PascalNodeId, PascalNode[]>;
  /** Các lượt trước lượt hiện hành (cũ → mới). */
  readonly older: DerivedRecord[];
  /** Cảnh editor sau lượt nạp/dựng lại gần nhất. */
  latest: PascalScene | null;
  latestHidden: ReadonlySet<PascalNodeId>;
}

export const createDerivedHistory = (): DerivedHistory => ({ versions: new Map(), older: [], latest: null, latestHidden: new Set() });

/** Giữ chừng này lượt cũ để so khớp trọn (lịch sử editor giới hạn 50 bước). */
const MAX_OLDER = 50;

const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Tấm viền gợi ý `item_DRESS-suggested-<F>`: có bản ghi đứng sau, `suggestionEditOf` lo cả Ctrl+Z về gợi ý. */
const isSuggestedOutline = (id: PascalNodeId): boolean => bodyOfPascalId(id).startsWith(SUGGESTED_OUTLINE_PREFIX);

/** Đồ sinh theo luật, hoặc món mang `SceneRepair` (vị trí trong cảnh không phải dữ liệu đã lưu). */
export const isDerivedNode = (node: PascalNode): boolean => {
  if (isSuggestedOutline(node.id)) return false;
  if (isGeneratedNodeId(node.id)) return true;
  const appfront = (node.metadata as { appfront?: { fields?: Record<string, unknown> } } | undefined)?.appfront;
  return node.type === 'item' && appfront?.fields?.[REPAIR_FIELD] !== undefined;
};

const derivedOf = (scene: PascalScene): Map<PascalNodeId, PascalNode> =>
  new Map(Object.values(scene.nodes).filter(isDerivedNode).map((node) => [node.id, node]));

/** Ghi cảnh editor vừa nạp/dựng lại làm bản hiện hành; `hidden` = node của món sửa cảnh ẩn (`item_<id>`). */
export const recordDerived = (history: DerivedHistory, scene: PascalScene, hidden: Iterable<PascalNodeId> = []): void => {
  if (history.latest !== null) {
    history.older.push({ nodes: derivedOf(history.latest), hidden: history.latestHidden });
    if (history.older.length > MAX_OLDER) history.older.shift();
  }
  history.latest = scene;
  history.latestHidden = new Set(hidden);
  for (const node of derivedOf(scene).values()) {
    const seen = history.versions.get(node.id) ?? [];
    if (!seen.some((v) => sameJson(v, node))) history.versions.set(node.id, [...seen, node]);
  }
};

/** Phần dẫn xuất của `nodes` khớp trọn một lượt dựng cũ (khác lượt hiện hành): cảnh là ảnh chụp cũ do hoàn tác. */
const matchesOlder = (history: DerivedHistory, nodes: Readonly<Record<PascalNodeId, PascalNode>>): boolean => {
  const current = Object.values(nodes).filter(isDerivedNode);
  return history.older.some(
    (record) =>
      current.length === record.nodes.size &&
      current.every((node) => {
        const then = record.nodes.get(node.id);
        return then !== undefined && sameJson(then, node);
      }) &&
      [...record.hidden].every((id) => nodes[id] === undefined),
  );
};

const zoneFieldOf = (node: PascalNode | undefined, key: 'dressIds' | 'dressingOff'): unknown =>
  node?.type === 'zone' ? (node.metadata as { appfront?: { fields?: Record<string, unknown> } } | undefined)?.appfront?.fields?.[key] : undefined;

const childrenOf = (node: PascalNode | undefined): readonly PascalNodeId[] | null =>
  node !== undefined && 'children' in node ? node.children : null;

const unlink = (nodes: Record<PascalNodeId, PascalNode>, id: PascalNodeId): void => {
  const parentId = nodes[id]?.parentId;
  const parent = parentId == null ? undefined : nodes[parentId];
  const children = childrenOf(parent);
  if (parent !== undefined && children !== null) nodes[parent.id] = { ...parent, children: children.filter((c) => c !== id) } as PascalNode;
  delete nodes[id];
};

const link = (nodes: Record<PascalNodeId, PascalNode>, node: PascalNode): void => {
  if (nodes[node.id] !== undefined && nodes[node.id]?.parentId !== node.parentId) unlink(nodes, node.id);
  nodes[node.id] = node;
  const parent = node.parentId == null ? undefined : nodes[node.parentId];
  const children = childrenOf(parent);
  if (parent !== undefined && children !== null && !children.includes(node.id)) {
    nodes[parent.id] = { ...parent, children: [...children, node.id] } as PascalNode;
  }
};

/**
 * Cảnh để so/lưu: node dẫn xuất cũ do hoàn tác → bản hiện hành. `touchedTarget(id)` trả node đích cho món người dùng đã
 * đụng (dữ liệu trước khi đụng), `undefined` = món chưa đụng (dùng bản hiện hành). `restored` = có thay gì.
 */
export const restoreDerived = (
  history: DerivedHistory,
  scene: PascalScene,
  touchedTarget: (id: PascalNodeId) => PascalNode | undefined,
): { readonly scene: PascalScene; readonly restored: boolean } => {
  const latest = history.latest;
  if (latest === null) return { scene, restored: false };
  const nodes: Record<PascalNodeId, PascalNode> = { ...scene.nodes };
  let restored = false;

  for (const [id, node] of Object.entries(scene.nodes)) {
    if (!isDerivedNode(node)) continue;
    const now = latest.nodes[id];
    if (now !== undefined && sameJson(now, node)) continue;
    // Bản chưa từng trao cho editor = người dùng vừa sửa node ấy: để lượt lưu xử lý như thường. Kể cả sửa không dời
    // (sơn/đổi mẫu/kéo cỡ) món đang mang sửa cảnh: vị trí sửa tự động đi theo lượt lưu — CHỦ Ý (HOP-DONG-LOP-CANH §3):
    // người dùng thao tác lên món ở chỗ đang thấy nên chỗ đó được chốt như xác nhận.
    if (!(history.versions.get(id) ?? []).some((v) => sameJson(v, node))) continue;
    restored = true;
    const target = touchedTarget(id) ?? now;
    if (target === undefined) unlink(nodes, id);
    else link(nodes, target);
  }
  /* ponytail: hoàn tác và "xoá đúng phần khác giữa hai lượt dựng" trông như nhau lúc lưu (vd. bật "Hiện dữ liệu gốc"
     rồi xoá món duy nhất từng bị ẩn): chọn trả lại (lượt xoá bị nuốt) chứ không ghi xoá. Hết lẫn khi viết lại lịch sử
     zundo lúc dựng lại (main.tsx) thay cho so lúc lưu. */
  const wasHidden = new Set(history.older.flatMap((record) => [...record.hidden]));
  const missing = Object.values(latest.nodes).filter((node) => nodes[node.id] === undefined && ((isGeneratedNodeId(node.id) && !isSuggestedOutline(node.id)) || wasHidden.has(node.id)));
  if (missing.length > 0 && (restored || matchesOlder(history, scene.nodes))) {
    missing.forEach((node) => link(nodes, node));
    restored = true;
  }
  if (restored) {
    // Danh sách đồ sinh của phòng (`dressIds`, H4) cũng là dẫn xuất: theo bản hiện hành, không thì món sinh vắng trong
    // bản hiện hành bị ghi thành "đã xoá" (`dressingOff`). `dressingOff` đi cùng: `toSpatial` CỘNG trường này với món
    // vắng trong `dressIds`, nên giữ bản cũ của ảnh chụp làm rơi món xoá ở lượt sau ảnh chụp. Lấy bản hiện hành, trừ món
    // ảnh chụp còn node (`scene` gốc, trước khi gỡ) — tức hoàn tác chính lượt xoá ấy.
    for (const node of Object.values(nodes)) {
      const latestZone = latest.nodes[node.id];
      const dressIds = zoneFieldOf(latestZone, 'dressIds');
      if (node.type !== 'zone' || dressIds === undefined) continue;
      const latestOff = zoneFieldOf(latestZone, 'dressingOff');
      const dressingOff = (Array.isArray(latestOff) ? latestOff : []).filter(
        (id): id is string => typeof id === 'string' && scene.nodes[dressNodeIdOf(id)] === undefined,
      );
      if (sameJson(zoneFieldOf(node, 'dressIds'), dressIds) && sameJson(zoneFieldOf(node, 'dressingOff') ?? [], dressingOff)) continue;
      const metadata = node.metadata as { appfront: { fields: Record<string, unknown> } };
      nodes[node.id] = {
        ...node,
        metadata: { ...metadata, appfront: { ...metadata.appfront, fields: { ...metadata.appfront.fields, dressIds, dressingOff } } },
      } as unknown as PascalNode;
    }
  }
  return restored ? { scene: { ...scene, nodes }, restored } : { scene, restored };
};

/**
 * `touchedTarget` cho `restoreDerived`: node của món người dùng đã đụng trong phiên, dựng từ dữ liệu lúc phiên mới thấy
 * nó (trước mọi sửa) — Ctrl+Z về vị trí đã sửa cảnh thành hoàn tác thật về dữ liệu gốc. Dựng lười một lần mỗi lượt lưu.
 */
export const touchedTargetFor = (
  session: RepairSession,
  stored: () => SpatialGraph | null,
  build: (graph: SpatialGraph) => PascalScene,
): ((nodeId: PascalNodeId) => PascalNode | undefined) => {
  let built: PascalScene | null = null;
  return (nodeId) => {
    const touched = [...session.touched].find((id) => toPascalId('item', id) === nodeId);
    if (touched === undefined) return undefined;
    if (built === null) {
      const graph = stored();
      if (graph === null) return undefined;
      const original = (id: FurnitureId) => session.firstSeen.get(id);
      built = build({ ...graph, furniture: graph.furniture.map((f) => (session.touched.has(f.id) ? (original(f.id) ?? f) : f)) });
    }
    return built.nodes[nodeId];
  };
};
