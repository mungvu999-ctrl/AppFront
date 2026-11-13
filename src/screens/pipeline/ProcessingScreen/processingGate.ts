/**
 * MỘT nguồn trạng thái cho chip `.state`, tiêu đề khung bước, hàng điều kiện của
 * cổng và nút chính (NGUYEN-TAC-BO-CUC §1). Hàm thuần trên `ProcessingScreenProps`,
 * không chạm tầng dữ liệu nào.
 *
 * Quyết định của chủ dự án: tỷ lệ bản vẽ là ĐIỀU KIỆN CHẶN. Xong mà chưa có tỷ lệ
 * (0 chuỗi kích thước, hoặc chưa đọc được số liệu) thì nút chính là "Hiệu chỉnh tỷ
 * lệ", không mời sang Duyệt tầng.
 */

import { SCALE_ESTIMATED_NOTE, SCALE_PROPOSED_LABEL, SCALE_STATE_VIEWS } from '@/lib/viewmodel/provisionalScale';

import type { ProcessingReviewReason, ProcessingScreenProps } from './types';

export type ProcessingGateKind = 'running' | 'needs-scale' | 'needs-review' | 'ready' | 'error';

export interface ProcessingGateAction {
  readonly label: string;
  readonly note?: string;
  readonly isForward: boolean;
  readonly onClick: () => void;
}

/** Một lý do "cần xem lại" (N16 `readiness`): câu cho người đọc và màn sửa được nó. */
export interface ProcessingGateReviewRow {
  /** Khoá dòng: lý do, hoặc mã kiểm khi `geometrySuspect` tách theo `readiness.checks`. */
  readonly key: string;
  readonly reason: ProcessingReviewReason;
  readonly sentence: string;
  /** `scale` → nút Đặt tỷ lệ; `review` → nút Sang Duyệt tầng. */
  readonly target: 'scale' | 'review';
}

export interface ProcessingGateModel {
  readonly kind: ProcessingGateKind;
  readonly chipLabel: string;
  readonly chipVariant: 'neutral' | 'attention' | 'verified' | 'violation';
  readonly title: string;
  readonly doneStepsLabel: string;
  readonly isAiDone: boolean;
  readonly scaleValue: string;
  readonly scaleNote?: string;
  readonly isScaleOk: boolean;
  readonly action?: ProcessingGateAction;
  /** Tỷ lệ chưa kiểm (máy đoán/mặc định): lối đi tiếp mềm, không chặn cứng. */
  readonly secondaryAction?: ProcessingGateAction;
  /** UX-30: "Xem mô hình 3D" cạnh nút chính khi AI đã xong. */
  readonly viewerAction?: ProcessingGateAction;
  /** Kết quả hiện trên hàng bước, theo `step.id`. */
  readonly resultByStepId: ReadonlyMap<string, string>;
  readonly warnStepIds: readonly string[];
  /** Có khi `kind` là `needs-review`: mỗi lý do một dòng. */
  readonly reviewRows?: readonly ProcessingGateReviewRow[];
}

export const GATE_LABEL = 'Để sang Duyệt tầng';
export const CALIBRATE_LABEL = 'Đặt tỷ lệ';
export const GO_REVIEW_LABEL = 'Sang Duyệt tầng';
export const VIEW_3D_LABEL = 'Xem mô hình 3D';
export const WAITING_NOTE = 'Khi AI xong, nút sang Duyệt tầng hiện ở đây.';

const NO_DIMENSION_NOTE = 'Không đọc được số kích thước nào';
const NO_METRIC_NOTE = 'Chưa đọc được số liệu của lượt xử lý';
// U11: brochure không ghi số vẫn có cửa đi chính (~900 mm) để đo.
const CALIBRATE_NOTE = 'Đo một đoạn đã biết chiều dài, như số ghi trên bản vẽ hoặc bề rộng cửa đi chính (900 mm), hoặc nhập diện tích căn in trên brochure. Khoảng 1 phút.';

/** Câu cho từng lý do của N16 `readiness` (FIX-P0-15, thiết kế H5 §2.2). */
export const REVIEW_REASON_SENTENCE: Readonly<Record<ProcessingReviewReason, string>> = {
  scaleUnresolved: 'Tỷ lệ bản vẽ mới là tạm, chưa ai kiểm: kích thước và diện tích có thể sai.',
  criticalIssues: 'Mô hình còn lỗi nghiêm trọng cần sửa ở Duyệt tầng.',
  geometrySuspect: 'Hình học của tầng có chỗ đáng ngờ: nên kiểm lại tường và phòng ở Duyệt tầng.',
  fallbackWallModel: 'Tường được dò bằng mô hình dự phòng, độ chính xác thấp hơn: nên kiểm lại tường.',
  fallbackObjectModel: 'Cửa và đồ vật được dò bằng mô hình dự phòng, có thể thiếu hoặc sai chỗ.',
  fallbackTextModel: 'Chữ và số kích thước được đọc bằng mô hình dự phòng, có thể đọc sai.',
};

/** Câu cho từng mã kiểm hình học (N16 `readiness.checks`): chuyện gì và nên làm gì. Mã lạ dùng câu của `geometrySuspect`. */
export const GEOMETRY_CHECK_SENTENCE: Readonly<Record<string, string>> = {
  OPEN_ENVELOPE: 'Tường bao ngoài chưa khép kín, mô hình 3D sẽ bị hở: hãy nối các đoạn tường ngoài ở Duyệt tầng.',
  WALL_FRAGMENTS: 'Tường bị vỡ thành nhiều mảnh ngắn: hãy gộp hoặc vẽ lại các đoạn tường ở Duyệt tầng.',
  MULTIPLE_PLANS: 'Tờ có nhiều mặt bằng: hãy cắt từng căn thành một bản vẽ riêng rồi xử lý lại.',
  ROOMS_WITHOUT_DOOR: 'Có phòng không có cửa vào: hãy thêm cửa còn thiếu ở Duyệt tầng.',
  ROOM_USAGE_UNKNOWN: 'Nhiều phòng chưa rõ công năng: hãy đặt tên phòng ở bước Phòng.',
  ROTATED_PLAN: 'Bản vẽ có vẻ bị xoay, chữ đọc theo chiều dọc: hãy xoay ảnh cho chữ đọc xuôi rồi tải lại.',
};

/** Một dòng cho mỗi lý do; `geometrySuspect` có mã kiểm thì tách thành một dòng cho mỗi mã. */
function reviewRowsOf(
  reasons: readonly ProcessingReviewReason[],
  checks: readonly string[],
): ProcessingGateReviewRow[] {
  return reasons.flatMap((reason): ProcessingGateReviewRow[] => {
    if (reason === 'geometrySuspect' && checks.length > 0) {
      return checks.map((code) => ({
        key: code,
        reason,
        sentence: GEOMETRY_CHECK_SENTENCE[code] ?? REVIEW_REASON_SENTENCE.geometrySuspect,
        target: 'review',
      }));
    }

    return [{ key: reason, reason, sentence: REVIEW_REASON_SENTENCE[reason], target: reason === 'scaleUnresolved' ? 'scale' : 'review' }];
  });
}

/** Thứ tự `metricLabels` của hook: tường, "cửa, nội thất", chuỗi kích thước, phòng, diện tích. */
function resultsOf(props: ProcessingScreenProps): ReadonlyMap<string, string> {
  const metrics = props.summary?.metricLabels ?? [];
  // ponytail: số liệu là TỔNG mọi tầng, chỉ gắn lên hàng bước khi dự án có một tầng;
  // nhiều tầng cần kết quả từng bước theo tầng (CẦN BE `stepDetails`).
  if (props.state !== 'success' || metrics.length < 5 || props.floors.length > 1) return new Map();
  const [walls, objects, dimensions, rooms, area] = metrics;
  return new Map([
    ['wallSegmentation', walls ?? ''],
    ['openingAndFurnitureDetection', objects ?? ''],
    ['dimensionReading', dimensions ?? ''],
    ['spatialDataBuild', `${rooms ?? ''}, ${area ?? ''}`],
  ]);
}

export function deriveProcessingGate(props: ProcessingScreenProps): ProcessingGateModel {
  const total = props.steps.length;
  const done = props.steps.filter((step) => step.status === 'done').length;
  const runningIndex = props.steps.findIndex((step) => step.status === 'running');
  const doneStepsLabel = `${String(done)}/${String(total)} bước`;
  // Người xem (`forbidden`) không có trạng thái success riêng: đủ mọi bước xong là AI đã xong, đừng ghi "Đang chạy" mãi.
  const isAiDone = props.state === 'success' || (props.state === 'forbidden' && total > 0 && done === total);
  const summary = props.summary;
  const noDimension = summary?.noDimensionSentence !== undefined;
  // Tầng đã có tỷ lệ đặt tay thì không thiếu, dù không đọc được chuỗi kích thước.
  const scaleKnown = summary?.scaleKnown === true;
  const scaleMissing = !scaleKnown && (noDimension || (summary?.metricLabels.length ?? 0) === 0);
  const base = {
    doneStepsLabel,
    isAiDone,
    ...(isAiDone && summary?.onOpenViewer3d !== undefined
      ? { viewerAction: { label: VIEW_3D_LABEL, isForward: true, onClick: summary.onOpenViewer3d } }
      : {}),
    resultByStepId: resultsOf(props),
    warnStepIds: isAiDone && noDimension && !scaleKnown ? ['dimensionReading'] : [],
  };

  if (props.state === 'error') {
    return {
      ...base,
      kind: 'error',
      chipLabel: 'Không đọc được tiến độ',
      chipVariant: 'violation',
      title: 'Chưa đọc được các bước',
      scaleValue: 'Chờ AI xong',
      isScaleOk: false,
    };
  }

  if (!isAiDone) {
    return {
      ...base,
      kind: 'running',
      // Chip chỉ nói "đang chạy"; số bước nằm ở tiêu đề, khỏi hai số "bước 5/6" và "4/6 bước" cạnh nhau (U27).
      chipLabel: 'Đang chạy',
      chipVariant: 'neutral',
      title:
        runningIndex < 0
          ? 'AI đang chờ chạy'
          : `AI đang chạy bước ${String(runningIndex + 1)}/${String(total)}`,
      scaleValue: 'Chờ AI đọc kích thước',
      isScaleOk: false,
    };
  }

  if (scaleMissing || summary === undefined) {
    return {
      ...base,
      kind: 'needs-scale',
      // Tên + màu trạng thái tỷ lệ dùng chung mọi màn (`SCALE_STATE_VIEWS`).
      chipLabel: `Xong · ${SCALE_STATE_VIEWS.missing.name.toLowerCase()}`,
      chipVariant: SCALE_STATE_VIEWS.missing.statusCode,
      title: 'Còn 1 việc: đặt tỷ lệ',
      scaleValue: 'Chưa có',
      scaleNote: noDimension ? NO_DIMENSION_NOTE : NO_METRIC_NOTE,
      isScaleOk: false,
      ...(summary !== undefined
        ? {
            action: {
              label: CALIBRATE_LABEL,
              note: CALIBRATE_NOTE,
              isForward: false,
              onClick: summary.onCalibrateScale,
            },
            // Duyệt tầng mở ở bước Tỷ lệ khi tỷ lệ chưa có, không nhảy thẳng sang Tường với tỷ lệ tạm (U28).
            secondaryAction: { label: GO_REVIEW_LABEL, isForward: true, onClick: summary.onCalibrateScale },
          }
        : {}),
    };
  }

  // `needsReview` không bao giờ ra 'ready' (FIX-P0-15): tỷ lệ tạm mà có kích thước từng báo "Sẵn sàng".
  const reasons: readonly ProcessingReviewReason[] = summary.reviewReasons ?? [];
  // Tỷ lệ ước lượng nói trước nguồn tỷ lệ: người đọc cần biết số nào chưa đáng tin.
  // R9: máy chủ có `scaleState` thì câu trạng thái + lý do thay câu cũ.
  const scaleNote =
    summary.scaleStateNote ?? (summary.scaleEstimated === true ? SCALE_ESTIMATED_NOTE : summary.scaleSourceNote);
  const stateLabel = summary.scaleStateLabel;
  if (reasons.length > 0) {
    const rows = reviewRowsOf(reasons, summary.reviewChecks ?? []);
    const isScaleUnresolved = reasons.includes('scaleUnresolved');
    const calibrate = {
      label: CALIBRATE_LABEL,
      note: CALIBRATE_NOTE,
      isForward: false,
      onClick: summary.onCalibrateScale,
    };
    const review = { label: GO_REVIEW_LABEL, isForward: true, onClick: summary.onReviewWalls };
    return {
      ...base,
      kind: 'needs-review',
      chipLabel: 'Xong · cần xem lại',
      chipVariant: 'attention',
      title: rows.length === 1 ? 'Còn 1 việc cần xem lại' : `Còn ${String(rows.length)} việc cần xem lại`,
      scaleValue: stateLabel ?? (isScaleUnresolved ? 'Cần kiểm' : SCALE_PROPOSED_LABEL),
      ...(scaleNote !== undefined ? { scaleNote } : {}),
      isScaleOk: !isScaleUnresolved,
      reviewRows: rows,
      // Đặt tỷ lệ đi trước; Duyệt tầng vẫn mở (lối mềm như tỷ lệ chưa kiểm, không chặn cứng).
      action: isScaleUnresolved ? calibrate : review,
      // Tỷ lệ chưa kiểm: "Sang Duyệt tầng" mở ở bước Tỷ lệ (bước đầu của Duyệt tầng), không bỏ qua nó (U28).
      ...(isScaleUnresolved ? { secondaryAction: { ...review, onClick: summary.onCalibrateScale } } : {}),
    };
  }

  return {
    ...base,
    kind: 'ready',
    chipLabel: `Xong ${doneStepsLabel}`,
    chipVariant: 'verified',
    title: 'Sẵn sàng duyệt tầng',
    scaleValue:
      scaleKnown && noDimension
        ? 'Đã đặt'
        : (stateLabel ?? (scaleNote !== undefined ? 'Máy đề xuất' : SCALE_PROPOSED_LABEL)),
    ...(scaleNote !== undefined ? { scaleNote } : {}),
    isScaleOk: true,
    action: { label: GO_REVIEW_LABEL, isForward: true, onClick: summary.onReviewWalls },
  };
}
