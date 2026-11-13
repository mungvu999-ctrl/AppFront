import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import { entitiesOfKind } from '@/lib/commands/business/shared';
import { formatNumber } from '@/lib/format/number';
import {
  isMeasuredScaleImplausible,
  isScaleMissing,
  scaleStateOf,
  type ScaleSource,
  type ScaleState,
  type WireScaleState,
} from '@/lib/viewmodel/provisionalScale';

/**
 * Trạng thái cổng chung của tầng: ba lớp bắt buộc Tường · Cửa và nội thất · Phòng,
 * đếm từ CÙNG đồ thị các màn duyệt ghi cờ `reviewed` (cùng luật với `layerGateOf`):
 * tường/phòng trống thì chưa xong, cửa và nội thất trống thì xong (tầng có thể không có cửa).
 */
export type RequiredLayerKey = 'walls' | 'objects' | 'rooms';

export interface LayerCount {
  readonly reviewed: number;
  readonly total: number;
}

export type FloorReviewCounts = Readonly<Record<RequiredLayerKey, LayerCount>>;

export interface FloorReviewLayerState extends LayerCount {
  readonly key: RequiredLayerKey;
  readonly label: string;
  readonly done: boolean;
}

export interface FloorReviewGateState {
  readonly layers: readonly FloorReviewLayerState[];
  /** Lớp bắt buộc đầu tiên chưa xong; `null` khi cả ba xong. */
  readonly next: FloorReviewLayerState | null;
}

export const REQUIRED_LAYER_LABELS: Readonly<Record<RequiredLayerKey, string>> = {
  walls: 'Tường',
  objects: 'Cửa và nội thất',
  rooms: 'Phòng',
};

/** Chữ gọn trên cổng để không tràn ở 1024/768: "Cửa 0/12". */
const CONDITION_LABELS: Readonly<Record<RequiredLayerKey, string>> = {
  walls: 'Tường',
  objects: 'Cửa',
  rooms: 'Phòng',
};

const ORDER: readonly RequiredLayerKey[] = ['walls', 'objects', 'rooms'];
const EMPTY_COUNT: LayerCount = { reviewed: 0, total: 0 };

const countOf = (items: readonly { readonly reviewed: boolean }[]): LayerCount => ({
  reviewed: items.filter((item) => item.reviewed).length,
  total: items.length,
});

export function floorReviewCountsOf(graph: NormalizedSpatial | null, levelId: string): FloorReviewCounts {
  if (graph === null) {
    return { walls: EMPTY_COUNT, objects: EMPTY_COUNT, rooms: EMPTY_COUNT };
  }

  const walls = entitiesOfKind(graph, 'wall').filter((wall) => wall.levelId === levelId);
  const wallIds = new Set<string>(walls.map((wall) => wall.id));
  const openings = entitiesOfKind(graph, 'opening').filter((opening) => wallIds.has(opening.wallId));
  const furniture = entitiesOfKind(graph, 'furniture').filter((item) => item.levelId === levelId);
  const rooms = entitiesOfKind(graph, 'room').filter((room) => room.levelId === levelId);

  return { walls: countOf(walls), objects: countOf([...openings, ...furniture]), rooms: countOf(rooms) };
}

export function floorReviewGateOf(counts: FloorReviewCounts): FloorReviewGateState {
  const layers = ORDER.map((key): FloorReviewLayerState => {
    const { reviewed, total } = counts[key];
    const allReviewed = reviewed >= total;

    return { key, label: REQUIRED_LAYER_LABELS[key], reviewed, total, done: key === 'objects' ? allReviewed : total > 0 && allReviewed };
  });

  return { layers, next: layers.find((layer) => !layer.done) ?? null };
}

/** Chữ điều kiện trên cổng: "Tường 3/81", "Cửa 0/12". */
export const floorReviewConditionLabel = (layer: FloorReviewLayerState): string =>
  `${CONDITION_LABELS[layer.key]} ${layer.reviewed}/${layer.total}`;

const PENDING_NOUNS: Readonly<Record<RequiredLayerKey, string>> = {
  walls: 'tường',
  objects: 'cửa và nội thất',
  rooms: 'phòng',
};

/**
 * UX-22: câu nhắc phần chưa xong khi cổng cho đi tiếp sang Mô hình 3D
 * ("Còn 28 tường, 34 cửa và nội thất chưa duyệt; tỷ lệ chưa xác nhận"). Xong cả thì `null`.
 */
export function floorPendingText(gate: FloorReviewGateState, scale: FloorScaleState | null): string | null {
  const counts = gate.layers
    .filter((layer) => layer.reviewed < layer.total)
    .map((layer) => `${formatNumber(layer.total - layer.reviewed, { fractionDigits: 0 })} ${PENDING_NOUNS[layer.key]}`);
  const parts = [
    ...(counts.length > 0 ? [`${counts.join(', ')} chưa duyệt`] : []),
    ...(scale !== null && scale !== 'confirmed' ? ['tỷ lệ chưa xác nhận'] : []),
  ];

  return parts.length === 0 ? null : `Còn ${parts.join('; ')}`;
}

/**
 * Tỷ lệ tầng đã do người đặt: tài liệu tầng không mang `scaleStatus: 'unresolved'`
 * (máy suy ra / mặc định dự án, chưa ai xác nhận — xem `api/schemas/spatialLayer.ts`)
 * và tầng có `scaleMillimetresPerPixel`.
 */
export function scaleIsConfirmed(scaleStatus: 'unresolved' | undefined, millimetresPerPixel: number | undefined): boolean {
  return scaleStatus !== 'unresolved' && millimetresPerPixel !== undefined;
}

/**
 * Bước 1 Tỷ lệ của tầng (UX-R1 K12/K25, UX-R2 K50): `confirmed` người đã đặt; `check` máy đo được,
 * cần kiểm; `missing` máy không đo được (nguồn mặc định dự án, hoặc chưa có tỷ lệ), hoặc máy đo ra
 * hình vô lý (`implausible`, Codex P1) — khoá các bước sau. Chữ và màu: `SCALE_STATE_VIEWS`.
 */
export type FloorScaleState = ScaleState;

export function floorScaleStateOf(
  scaleStatus: 'unresolved' | undefined,
  scaleSource: ScaleSource | undefined,
  millimetresPerPixel: number | undefined,
  implausible = false,
  scaleState?: WireScaleState,
): FloorScaleState {
  // R9: máy chủ nói rõ trạng thái thì theo nó; hình vô lý vẫn là chưa có (trừ tỷ lệ người đặt).
  if (scaleState !== undefined && millimetresPerPixel !== undefined) {
    const state = scaleStateOf(scaleStatus, scaleSource, scaleState);
    return implausible && state !== 'confirmed' ? 'missing' : state;
  }
  if (scaleIsConfirmed(scaleStatus, millimetresPerPixel)) return 'confirmed';
  return millimetresPerPixel === undefined || isScaleMissing(scaleSource) || implausible ? 'missing' : 'check';
}

/** Tường của tầng cho ra tỷ lệ vô lý: trung vị độ dày < 50 mm hoặc khung khối tường < 3 m (`isMeasuredScaleImplausible`). */
export function scaleImplausibleOf(graph: NormalizedSpatial, levelId: string): boolean {
  const walls = entitiesOfKind(graph, 'wall').filter((wall) => wall.levelId === levelId);
  if (walls.length === 0) return false;
  const points = walls.flatMap((wall) => [wall.centreline.start, wall.centreline.end]);
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  const frameMm = Math.max(span(points.map((point) => point.x)), span(points.map((point) => point.y)));
  return isMeasuredScaleImplausible(walls.map((wall) => wall.thicknessMm), frameMm);
}

/** Lý do khoá các bước sau Tỷ lệ — cùng một câu ở thanh bước, ở cổng và ở `useScaleLock`. */
export const SCALE_LOCK_REASON = 'Đặt tỷ lệ trước: tầng này chưa có tỷ lệ đúng';

/**
 * Tầng kế để sang khi tầng này xong: tầng đầu tiên (theo thứ tự, bắt đầu sau tầng này rồi vòng lại)
 * chưa biết là xong. `isDone` chỉ trả true khi chắc chắn; không có tầng nào → `null` (sang 3D).
 */
export function nextFloorOf<F extends { readonly id: string }>(
  floors: readonly F[],
  floorId: string,
  isDone: (floorId: string) => boolean,
): F | null {
  const at = floors.findIndex((floor) => floor.id === floorId);
  const rotated = [...floors.slice(at + 1), ...floors.slice(0, Math.max(at, 0))];
  return rotated.find((floor) => floor.id !== floorId && !isDone(floor.id)) ?? null;
}
