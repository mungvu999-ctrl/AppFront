import {
  ALIGNMENT_WARNING_THRESHOLD_MM,
  MIN_MATCHED_AXES,
  alignFloors,
  wallBoundsOf,
  type FloorTransform,
} from '@/domain/axes/alignFloors';
import { detectAxes } from '@/domain/axes/detect';
import type { SpatialGraph } from '@/domain/spatial/types';
import { millimetres } from '@/domain/units/types';

/**
 * Phép biến đổi hiển thị mỗi tầng (báo cáo 2.8.2): chỉ tầng căn được — đủ trục
 * khớp và sai lệch trong ngưỡng, hoặc thiếu trục nhưng dời theo tâm khung bao tường
 * (`method: 'bbox'`) — mới có mục; tầng gốc, tầng đã khớp sẵn hay
 * tầng không căn được thì vắng mặt, nghĩa là giữ nguyên toạ độ đã lưu.
 * Không đụng dữ liệu: kết quả chỉ để dựng cảnh 3D.
 */
export const floorDisplayTransformsOf = (graph: SpatialGraph): ReadonlyMap<string, FloorTransform> => {
  const finite = (...values: number[]): boolean => values.every(Number.isFinite);
  const levels = graph.levels.filter((level) => finite(level.elevationMm, level.heightMm));
  const report = alignFloors(
    levels.map((level) => {
      const walls = graph.walls
        .filter(
          (wall) =>
            wall.levelId === level.id &&
            finite(wall.centreline.start.x, wall.centreline.start.y, wall.centreline.end.x, wall.centreline.end.y, wall.thicknessMm, wall.heightMm),
        )
        .map((wall) => ({
            id: wall.id,
            kind: 'loadBearing' as const, // detectAxes không đọc kind
            centreline: {
              start: { x: millimetres(wall.centreline.start.x), y: millimetres(wall.centreline.start.y) },
              end: { x: millimetres(wall.centreline.end.x), y: millimetres(wall.centreline.end.y) },
            },
            thicknessMm: millimetres(wall.thicknessMm),
            baseElevationMm: millimetres(level.elevationMm),
            topElevationMm: millimetres(level.elevationMm + wall.heightMm),
          }));
      return {
        levelId: level.id,
        name: level.name,
        floorElevationMm: millimetres(level.elevationMm),
        clearHeightMm: millimetres(level.heightMm),
        axes: detectAxes(walls),
        wallBoundsMm: wallBoundsOf(walls.map((wall) => wall.centreline)),
      };
    }),
  );
  const transforms = new Map<string, FloorTransform>();

  for (const floor of report.floors) {
    const { rotationDeg, translationMm } = floor.transform;
    const isIdentity = rotationDeg === 0 && translationMm.x === 0 && translationMm.y === 0;

    if (
      !floor.isBase &&
      !isIdentity &&
      (floor.method === 'bbox' ||
        (floor.matchedAxisCount >= MIN_MATCHED_AXES && floor.maxResidualMm <= ALIGNMENT_WARNING_THRESHOLD_MM))
    ) {
      transforms.set(floor.levelId, floor.transform);
    }
  }

  return transforms;
};

/* -------------------------------------------------------------------------- */
/* Áp lên cảnh Pascal (chỉ hiển thị) và gỡ ra khi đọc về.                     */
/* -------------------------------------------------------------------------- */

/** Khoá trong `metadata.appfront` của node TẦNG; mọi con trực tiếp của tầng đi theo nó. */
export const FLOOR_TRANSFORM_KEY = 'floorTransform';

interface Rigid { readonly rotationDeg: number; readonly tx: number; readonly tz: number }
type Pt = readonly [number, number];
type AnyNode = Record<string, unknown> & { readonly id: string; readonly type: string };

const turn = ([x, z]: Pt, deg: number): [number, number] => {
  const rad = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(rad) * 1e12) / 1e12;
  const s = Math.round(Math.sin(rad) * 1e12) / 1e12;
  // Mặt bằng (x, y) ứng với Pascal (x, z); xoay ngược chiều kim đồng hồ trên mặt bằng.
  return [x * c - z * s + 0, x * s + z * c + 0];
};

const forwardPoint = (p: Pt, t: Rigid): [number, number] => {
  const [x, z] = turn(p, t.rotationDeg);
  return [x + t.tx, z + t.tz];
};

const inversePoint = ([x, z]: Pt, t: Rigid): [number, number] => turn([x - t.tx, z - t.tz], -t.rotationDeg);

const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');
const isVec3 = (v: unknown): v is readonly [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');

/**
 * Đưa một con trực tiếp của tầng qua phép biến đổi (hoặc phép ngược). Con của con
 * (ô mở trong tường, mặt mái, nhánh thang, đồ đặt trên đồ) mang toạ độ cục bộ nên đi theo cha.
 * Góc quay: mặt bằng +θ = yaw −θ (cùng quy ước `yawOf`).
 */
const moveNode = (node: AnyNode, t: Rigid, inverse: boolean): AnyNode => {
  const point = (p: Pt): [number, number] => (inverse ? inversePoint(p, t) : forwardPoint(p, t));
  const dYaw = ((inverse ? 1 : -1) * t.rotationDeg * Math.PI) / 180;
  const out: Record<string, unknown> = { ...node };

  for (const key of ['start', 'end'] as const) {
    if (isPt(node[key])) out[key] = point(node[key]);
  }
  for (const key of ['polygon'] as const) {
    if (Array.isArray(node[key]) && (node[key] as unknown[]).every(isPt)) out[key] = (node[key] as Pt[]).map(point);
  }
  if (Array.isArray(node.holes)) {
    out.holes = (node.holes as unknown[]).map((hole) => (Array.isArray(hole) && hole.every(isPt) ? hole.map(point) : hole));
  }
  if (isVec3(node.position)) {
    const [x, z] = point([node.position[0], node.position[2]]);
    out.position = [x, node.position[1], z];
  }
  // Chỉ dời (khung bao): giữ nguyên góc, kể cả dấu của -0, để lượt về khớp từng bit.
  if (t.rotationDeg === 0) return out as AnyNode;
  if (typeof node.rotation === 'number') out.rotation = node.rotation + dYaw;
  else if (isVec3(node.rotation)) out.rotation = [node.rotation[0], node.rotation[1] + dYaw, node.rotation[2]];

  return out as AnyNode;
};

const rigidOf = (transform: FloorTransform): Rigid => ({
  rotationDeg: transform.rotationDeg,
  tx: transform.translationMm.x / 1000,
  tz: transform.translationMm.y / 1000,
});

const readRigid = (level: AnyNode): Rigid | null => {
  const appfront = (level.metadata as { appfront?: Record<string, unknown> } | undefined)?.appfront;
  const value = appfront?.[FLOOR_TRANSFORM_KEY] as Rigid | undefined;
  return value !== undefined && typeof value.rotationDeg === 'number' ? value : null;
};

/** Khoá trong `metadata.appfront` của node MÁI: vị trí + góc đã lưu, trước khi căn. */
const STORED_POSE_KEY = 'storedPose';
const POSE_KEYS = ['position', 'rotation'] as const;

/**
 * Mái lưu nguyên số thực (`roofs.ts`, không làm tròn mm), mà `(x + t) − t` và `(r − π/2) + π/2`
 * lệch một ulp (NO-579). Lượt đi cất vị trí + góc đã lưu; lượt về trả đúng giá trị ấy cho trường
 * nào vẫn bằng kết quả căn của nó (mái không bị dời/xoay), trường đã đổi thì gỡ phép căn như thường.
 */
const moveChild = (node: AnyNode, t: Rigid, inverse: boolean): AnyNode => {
  const moved = moveNode(node, t, inverse);
  if (node.type !== 'roof') return moved;
  const metadata = (node.metadata ?? {}) as { appfront?: Record<string, unknown> };

  if (!inverse) {
    const stored = { position: node.position, rotation: node.rotation };
    return { ...moved, metadata: { ...metadata, appfront: { ...metadata.appfront, [STORED_POSE_KEY]: stored } } };
  }

  const appfront = { ...metadata.appfront };
  const stored = appfront[STORED_POSE_KEY] as Partial<Record<(typeof POSE_KEYS)[number], unknown>> | undefined;
  if (stored === undefined) return moved;
  delete appfront[STORED_POSE_KEY];
  const shown = moveNode({ ...node, ...stored }, t, false);
  const out: Record<string, unknown> = { ...moved, metadata: { ...metadata, appfront } };

  for (const key of POSE_KEYS) {
    if (stored[key] !== undefined && JSON.stringify(shown[key]) === JSON.stringify(node[key])) out[key] = stored[key];
  }

  return out as AnyNode;
};

const moveChildren = <N>(nodes: Record<string, N>, level: AnyNode, t: Rigid, inverse: boolean): void => {
  for (const childId of (level.children as readonly string[] | undefined) ?? []) {
    const child = nodes[childId] as AnyNode | undefined;
    if (child !== undefined) nodes[childId] = moveChild(child, t, inverse) as N;
  }
};

/**
 * Lượt đi: tầng căn được thì mọi con trực tiếp được xoay + dời, và phép biến đổi
 * ghi vào `metadata.appfront.floorTransform` của node tầng. Sửa tại chỗ `nodes`.
 */
export const applyFloorTransforms = <N>(
  nodes: Record<string, N>,
  transforms: ReadonlyMap<string, FloorTransform>,
  levelNodeIdOf: (levelId: string) => string,
): void => {
  for (const [levelId, transform] of transforms) {
    const levelNodeId = levelNodeIdOf(levelId);
    const level = nodes[levelNodeId] as AnyNode | undefined;
    if (level === undefined) continue;
    const rigid = rigidOf(transform);
    const metadata = (level.metadata ?? {}) as { appfront?: Record<string, unknown> };
    nodes[levelNodeId] = {
      ...level,
      metadata: { ...metadata, appfront: { ...metadata.appfront, [FLOOR_TRANSFORM_KEY]: rigid } },
    } as N;
    moveChildren(nodes, level, rigid, false);
  }
};

/**
 * Lượt về: gỡ phép biến đổi để dữ liệu ghi lại đúng toạ độ đã lưu. Con mới thêm
 * dưới tầng đã căn cũng được gỡ (người dùng vẽ nó trên toạ độ đã căn).
 */
export const undoFloorTransforms = <S extends { readonly nodes: Record<string, unknown> }>(scene: S): S => {
  const levels = Object.values(scene.nodes).filter(
    (node): node is AnyNode => (node as AnyNode | undefined)?.type === 'level' && readRigid(node as AnyNode) !== null,
  );
  if (levels.length === 0) return scene;
  const nodes = { ...scene.nodes };
  for (const level of levels) {
    moveChildren(nodes, level, readRigid(level)!, true);
    // Bỏ khoá sau khi gỡ để gọi lại không gỡ lần hai (fromPascal gỡ trước rồi toSpatialGraph gỡ tiếp).
    const metadata = level.metadata as { appfront: Record<string, unknown> };
    const appfront = { ...metadata.appfront };
    delete appfront[FLOOR_TRANSFORM_KEY];
    nodes[level.id] = { ...level, metadata: { ...metadata, appfront } };
  }
  return { ...scene, nodes };
};
