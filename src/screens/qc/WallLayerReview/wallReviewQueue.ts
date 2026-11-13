/**
 * Hàng đợi duyệt của màn Duyệt lớp tường (demo Z/S-15 vòng 9) — phần thuần, không React.
 *
 * MỘT thứ tự duy nhất cho danh sách trái, nút "Duyệt tiếp" ở cổng, phím J và tự chuyển sau
 * "Duyệt": không chuẩn lên đầu, rồi đúng chuẩn chưa duyệt, rồi đã duyệt (trong mỗi nhóm giữ thứ
 * tự mã hiển thị). "Không chuẩn" = lệch quá `WALL_THICKNESS_TOLERANCE_MM` so với chuẩn gần nhất
 * (qua `isStandardThickness`, thang sáu bậc `STANDARD_THICKNESSES_MM`); chuẩn đích khi đổi là
 * `standardizeThickness` (bậc gần nhất, hoà về bậc nhỏ; cột BTCT = xem tay, không tự đổi). Màn
 * không viết ngưỡng nào, chữ đọc từ thang và ngưỡng của domain.
 */

import type { FlowGateCondition } from '@/components/shell/FlowGate';
import { isEntityOfKind, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { DataSource, Level, LevelId, Wall, WallId } from '@/domain/spatial/types';
import { WALL_THICKNESS_TOLERANCE_MM } from '@/domain/walls/thicknessTolerance';
import { centrelineLength } from '@/domain/walls/types';
import { formatNumber } from '@/lib/format/number';
import type { ScaleSource, ScaleStatus, WireScaleState } from '@/lib/viewmodel/provisionalScale';
import { measureTextOfState, scaleStateOf } from '@/lib/viewmodel/provisionalScale';
import { CONCRETE_COLUMN_THRESHOLD_MM, standardizeThickness, standardTierRangeOf } from '@/lib/geometry/standardize';

import { WALL_THICKNESS_CHOICES, type WallThicknessChoice } from './types';
import { wallThicknessBandOf } from './wallLayerHatch';
import { isLowConfidence, isStandardThickness, toGeometryWall, wallLengthNumberOf, type WallGeometryReason } from './wallLayerReviewGateway';

/** Ba nhóm của danh sách, đúng thứ tự hàng đợi. */
export type WallQueueGroup = 'nonStandard' | 'standard' | 'reviewed';

/** Bố cục L23: lý do máy nghi một đoạn — theo hình (`geometryReasonsOf`) hoặc dưới ngưỡng tin cậy. */
export type WallReviewReason = WallGeometryReason | 'uncertain';

/** Thứ tự nhóm lý do trên danh sách và trong hàng đợi J/K. */
export const WALL_REASON_ORDER: readonly WallReviewReason[] = ['uncertain', 'short', 'dangling', 'overlap'];

/** Tên nhóm, cũng là câu lý do trên thẻ hỏi. */
export const WALL_REASON_TITLE: Readonly<Record<WallReviewReason, string>> = {
  uncertain: 'Máy chưa chắc là tường',
  short: 'Ngắn hơn bề dày tường',
  dangling: 'Đứng riêng, một đầu không nối',
  overlap: 'Chồng lên đoạn khác',
};

/** Phần thêm của một hàng mà `WallRowViewModel` (đóng băng) không mang — đã định dạng sẵn (A15). */
export interface WallRowExtra {
  /** Chiều dài tim tường, số mm nguyên không đơn vị ("1.369"; tỷ lệ tạm "≈1.369"; thiếu tỷ lệ "–") — đầu cột ghi "Dài, mm". */
  readonly lengthText: string;
  /** Độ dày đo, số mm nguyên không đơn vị ("278"). */
  readonly thicknessText: string;
  /** Hàng đúng chuẩn mà số đo lệch chuẩn: "≈110". `null` khi khớp đúng hoặc không chuẩn. */
  readonly nearText: string | null;
  readonly group: WallQueueGroup;
  /** Chuẩn đích khi đổi về chuẩn; `null` = không đổi tự động được, cần xem tay. */
  readonly targetMm: WallThicknessChoice | null;
  /** Một câu cho khối độ dày của thanh tra. */
  readonly note: string;
  /** Bố cục L23: lý do máy nghi (vắng = không chia theo lý do). */
  readonly reason?: WallReviewReason | null;
}

export interface WallBulkGroup {
  readonly targetMm: WallThicknessChoice;
  readonly count: number;
  /** Khoảng số đo về chuẩn này, từ thang domain ("261–350"). */
  readonly rangeText: string;
}

/** Xem trước "Đổi n/N tường về chuẩn…". */
export interface WallBulkPlan {
  readonly groups: readonly WallBulkGroup[];
  /** Số tường sẽ đổi. */
  readonly changeCount: number;
  /** Số tường không chuẩn chưa duyệt (mẫu số trên nút). */
  readonly totalCount: number;
  /** Dày quá ngưỡng cột BTCT: giữ ở nhóm Không chuẩn để xem tay. */
  readonly manualCount: number;
  /** "trên 450 mm" — biên xem tay, đọc từ ngưỡng cột của domain. */
  readonly manualRangeText: string;
  readonly targets: readonly { readonly wallId: WallId; readonly targetMm: WallThicknessChoice }[];
}

/** Mọi thứ hàng đợi đưa cho view (cổng, danh sách, thanh tra, thanh phím). */
export interface WallReviewQueue {
  readonly extras: ReadonlyMap<string, WallRowExtra>;
  /** Tường không chuẩn CHƯA duyệt của cả tầng (không theo bộ lọc) — cho dòng trạng thái. */
  readonly nonStandardCount: number;
  readonly bulk: WallBulkPlan;
  /** Đoạn kế trong hàng đợi sau đoạn đang chọn; `null` khi hết việc. */
  readonly nextWallId: WallId | null;
  readonly nextWallLabel: string | null;
  /** ≤3 điều kiện của cổng: Tường, và Cửa/Phòng khi tầng có dữ liệu đó. */
  readonly conditions: readonly FlowGateCondition[];
  /** "Lệch không quá 30 mm" — đọc từ hằng domain, không gõ số. */
  readonly toleranceText: string;
  /** Mọi đoạn cùng một độ tin cậy thì độ tin cậy không giúp quyết định: ẩn. */
  readonly showConfidence: boolean;
  /** Câu khoá đổi độ dày (chưa có tỷ lệ hoặc trung vị < 50 mm); `null` = được đổi. Cùng quy tắc `useThicknessStandardization`. */
  readonly lockText?: string | null | undefined;
  readonly onStandardize: (wallId: WallId) => void;
  readonly onBulkStandardize: () => void;
  /** U17: số đoạn máy chắc chắn (đúng chuẩn, không lý do nghi) còn chờ duyệt — cả tầng. */
  readonly confidentCount?: number | undefined;
  /** U17: duyệt mọi đoạn máy chắc chắn trong MỘT bước hoàn tác; vắng = không có nút. */
  readonly onApproveConfident?: (() => void) | undefined;
  /** Mở màn Độ dày tường của tầng (nút "Đưa N tường về chuẩn"); vắng = không có nút. */
  readonly onOpenThickness?: (() => void) | undefined;
}

const RANK: Readonly<Record<WallQueueGroup, number>> = { nonStandard: 0, standard: 1, reviewed: 2 };

export const queueGroupOf = (wall: Wall): WallQueueGroup =>
  wall.reviewed ? 'reviewed' : isStandardThickness(wall.thicknessMm) ? 'standard' : 'nonStandard';

/** Tường CHƯA DUYỆT kế tiếp sau `fromId`, quay vòng về đầu danh sách. */
export function nextUnreviewedWallId(walls: readonly Wall[], fromId: WallId | null): WallId | null {
  if (walls.length === 0) {
    return null;
  }

  const start = fromId === null ? -1 : walls.findIndex((wall) => wall.id === fromId);
  const after = walls.slice(start + 1).find((wall) => !wall.reviewed);

  if (after !== undefined) {
    return after.id;
  }

  const wrapped = walls.slice(0, start + 1).find((wall) => !wall.reviewed);

  return wrapped?.id ?? null;
}

/** Tường chưa duyệt mà máy chưa chắc (dưới ngưỡng tin cậy) đứng đầu nhóm của nó (K15). */
const uncertainRankOf = (wall: Wall, threshold: number | undefined, suspectIds?: ReadonlySet<string>): number =>
  !wall.reviewed && isLowConfidence(wall, threshold, suspectIds) ? 0 : 1;

/** Hạng theo lý do (L23): nhóm lý do theo `WALL_REASON_ORDER`, đoạn không lý do đứng sau. */
const reasonRankOf = (wall: Wall, reasonOf: (wall: Wall) => WallReviewReason | null): number => {
  const reason = reasonOf(wall);
  return reason === null ? WALL_REASON_ORDER.length : WALL_REASON_ORDER.indexOf(reason);
};

/**
 * Xếp theo hàng đợi, trong mỗi nhóm "máy chưa chắc" lên trước; còn lại giữ thứ tự vào (sort ổn định).
 * Có `reasonOf` (bố cục L23): đoạn chưa duyệt xếp theo lý do trước, rồi mới theo độ dày.
 */
export const sortByReviewQueue = (
  walls: readonly Wall[],
  threshold?: number,
  suspectIds?: ReadonlySet<string>,
  reasonOf?: (wall: Wall) => WallReviewReason | null,
): readonly Wall[] =>
  [...walls].sort(
    (a, b) =>
      (reasonOf === undefined
        ? 0
        : Number(a.reviewed) - Number(b.reviewed) || (a.reviewed ? 0 : reasonRankOf(a, reasonOf) - reasonRankOf(b, reasonOf))) ||
      RANK[queueGroupOf(a)] - RANK[queueGroupOf(b)] ||
      uncertainRankOf(a, threshold, suspectIds) - uncertainRankOf(b, threshold, suspectIds),
  );

const isChoice = (value: unknown): value is WallThicknessChoice =>
  typeof value === 'number' && (WALL_THICKNESS_CHOICES as readonly number[]).includes(value);

/** Chuẩn đích theo `standardizeThickness` (tường máy đo: luật bù nét, U19); cột BTCT (xem tay) → `null`. */
export const thicknessTargetOf = (thicknessMm: number, source: DataSource = 'human'): WallThicknessChoice | null => {
  const { standardized } = standardizeThickness(thicknessMm, source);

  return isChoice(standardized) ? standardized : null;
};

/** Khoảng số đo về một chuẩn, sinh từ thang sáu bậc: 300 → "261–350", 100 → "≤125". */
function roundingRangeOf(targetMm: WallThicknessChoice, source: DataSource = 'human'): string {
  const { fromMm, toMm } = standardTierRangeOf(targetMm, source);

  return fromMm === null ? `≤${mm(toMm)}` : `${mm(fromMm)}–${mm(toMm)}`;
}

const mm = (value: number): string => formatNumber(value, { fractionDigits: 0 });

export const toleranceTextOf = (): string => `lệch không quá ${mm(WALL_THICKNESS_TOLERANCE_MM)} mm`;

function noteOf(wall: Wall, targetMm: WallThicknessChoice | null): string {
  const band = wallThicknessBandOf(wall.thicknessMm);

  if (band !== null) {
    /* UX-10/16: số lệch chuẩn không bị gọi là "đúng chuẩn" — nói số thật, gần chuẩn nào, và không tự đổi. */
    return band === wall.thicknessMm
      ? `Đúng chuẩn ${mm(band)} mm.`
      : `Hiện ${mm(wall.thicknessMm)} mm, gần chuẩn ${mm(band)} mm (${toleranceTextOf()}). Không tự đổi.`;
  }

  if (targetMm !== null) {
    const diff = targetMm - wall.thicknessMm;

    return `Thuộc khoảng ${roundingRangeOf(targetMm, wall.source)} mm nên về ${mm(targetMm)} mm, ${diff > 0 ? 'thiếu' : 'dư'} ${mm(Math.abs(diff))} mm.`;
  }

  return `Dày trên ${mm(CONCRETE_COLUMN_THRESHOLD_MM)} mm: dày bất thường, có thể là cột BTCT. Cần xem tay.`;
}

/** Số của cột "Dài, mm": cùng số với thanh tra, mang dấu ước lượng theo trạng thái tỷ lệ của tầng. */
function queueLengthTextOf(
  wall: Wall,
  level: Level,
  scaleStatus?: ScaleStatus,
  scaleSource?: ScaleSource,
  scaleState?: WireScaleState,
): string | null {
  const number = wallLengthNumberOf(centrelineLength(toGeometryWall(wall, level)), scaleStatus, scaleSource);
  if (number === null) return null;
  return measureTextOfState(number, scaleStateOf(scaleStatus, scaleSource, scaleState));
}

export function rowExtraOf(
  wall: Wall,
  level: Level | null,
  scaleStatus?: ScaleStatus,
  scaleSource?: ScaleSource,
  reason?: WallReviewReason | null,
  scaleState?: WireScaleState,
): WallRowExtra {
  const group = queueGroupOf(wall);
  const band = wallThicknessBandOf(wall.thicknessMm);
  const targetMm = band === null ? thicknessTargetOf(wall.thicknessMm, wall.source) : null;

  return {
    /* R10 làn S: từ R9 dải "tỷ lệ tạm" chỉ còn hiện ở tầng BỊ KHOÁ, nên tầng ước lượng không còn
       cảnh báo nào gần cột này — từng hàng phải tự mang dấu, không ỷ vào dải trên đầu màn. */
    lengthText: level === null ? '–' : (queueLengthTextOf(wall, level, scaleStatus, scaleSource, scaleState) ?? '–'),
    thicknessText: mm(wall.thicknessMm),
    nearText: band !== null && band !== wall.thicknessMm ? `≈${mm(band)}` : null,
    group,
    targetMm,
    note: noteOf(wall, targetMm),
    ...(reason === undefined ? {} : { reason }),
  };
}

export function bulkPlanOf(walls: readonly Wall[]): WallBulkPlan {
  const pending = walls.filter((wall) => queueGroupOf(wall) === 'nonStandard');
  const targets = pending.flatMap((wall) => {
    const targetMm = thicknessTargetOf(wall.thicknessMm, wall.source);

    return targetMm === null ? [] : [{ wallId: wall.id, targetMm, source: wall.source }];
  });
  const groups = WALL_THICKNESS_CHOICES.map((targetMm) => {
    const inGroup = targets.filter((target) => target.targetMm === targetMm);
    /* Nhóm toàn tường máy đo thì khoảng theo luật bù nét (U19); có tường người gõ thì luật gần nhất. */
    const source: DataSource = inGroup.every((target) => target.source === 'ai') ? 'ai' : 'human';

    return { targetMm, count: inGroup.length, rangeText: roundingRangeOf(targetMm, source) };
  }).filter((group) => group.count > 0);

  return {
    groups,
    changeCount: targets.length,
    totalCount: pending.length,
    manualCount: pending.length - targets.length,
    manualRangeText: `trên ${mm(CONCRETE_COLUMN_THRESHOLD_MM)} mm`,
    targets: targets.map(({ wallId, targetMm }) => ({ wallId, targetMm })),
  };
}

/**
 * U17: đoạn máy chắc chắn — chưa duyệt, độ dày đúng chuẩn, không lý do nghi theo hình, không dưới
 * ngưỡng tin cậy. Đây là những đoạn người duyệt chỉ bấm "Duyệt" lần lượt; duyệt hết một lượt cho nhanh.
 */
export function confidentWallsOf(
  walls: readonly Wall[],
  suspectIds?: ReadonlySet<string>,
  reasonOf?: (wall: Wall) => WallReviewReason | null,
): readonly Wall[] {
  return walls.filter(
    (wall) =>
      queueGroupOf(wall) === 'standard' &&
      (reasonOf?.(wall) ?? null) === null &&
      !isLowConfidence(wall, undefined, suspectIds),
  );
}

/** Câu nhật ký hoàn tác (và nhãn nút) của lượt duyệt hàng loạt. */
export const approveAllLabelOf = (count: number): string => `Duyệt ${mm(count)} đoạn máy chắc chắn`;

/** Câu nhật ký hoàn tác của lượt đổi hàng loạt. */
export const bulkLabelOf = (count: number): string => `Đổi ${mm(count)} tường về chuẩn`;

/**
 * Điều kiện cổng: Tường luôn có; Cửa (cửa đi, cửa sổ, nội thất) và Phòng chỉ khi tầng có dữ liệu
 * đó trong đồ thị — "xong" = mọi đối tượng đã duyệt. Không có dữ liệu thì không bịa điều kiện.
 */
export function gateConditionsOf(
  graph: NormalizedSpatial | null,
  levelId: LevelId | null,
  wallsDone: boolean,
): readonly FlowGateCondition[] {
  const conditions: FlowGateCondition[] = [{ label: 'Tường', done: wallsDone }];

  if (graph === null || levelId === null) {
    return conditions;
  }

  const onLevel = (graph.byLevel[levelId] ?? []).flatMap((id) => {
    const entity = graph.byId[id];

    return entity === undefined ? [] : [entity];
  });
  const objects = onLevel.filter((entity) => isEntityOfKind('opening', entity) || isEntityOfKind('furniture', entity));
  const rooms = onLevel.filter((entity) => isEntityOfKind('room', entity));

  if (objects.length > 0) {
    conditions.push({ label: 'Cửa', done: objects.every((entity) => entity.reviewed) });
  }

  if (rooms.length > 0) {
    conditions.push({ label: 'Phòng', done: rooms.every((entity) => entity.reviewed) });
  }

  return conditions;
}

/** Độ tin cậy có khác nhau giữa các đoạn không. */
export const hasConfidenceSpread = (walls: readonly Wall[]): boolean =>
  walls.some((wall) => wall.confidence !== walls[0]?.confidence);
