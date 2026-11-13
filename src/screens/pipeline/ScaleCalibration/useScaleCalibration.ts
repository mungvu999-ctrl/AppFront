/**
 * Nửa "suy nghĩ" của màn Hiệu chỉnh tỷ lệ — mọi thứ ba file view cần, đã xong.
 *
 * `types.ts` là hợp đồng props DUY NHẤT của màn; hook này trả về đúng
 * {@link UseScaleCalibrationResult}, không hơn không kém. Mọi chuỗi người đọc
 * được ghép và định dạng ở đây (A15), nên view không còn con số thô nào phải làm
 * tròn, chia, hay đổi đơn vị.
 *
 * ## Không một phép chia nào trong file này
 *
 * Tỷ lệ là thứ màn này tồn tại để tìm, nên nó là thứ màn này TUYỆT ĐỐI không
 * được tự tính. `4800` và `400` đi vào `createScale` của `src/domain/units/scale`
 * (M-02), `12 mm/px` đi ra. Cùng lý lẽ đó áp cho mọi phép chia khác: quy một
 * toạ độ pixel về tỷ lệ `0..1` của khung ảnh cũng là một phép đổi đơn vị, và nó
 * đi qua {@link frameScaleOf} — một `Scale` thật, dựng bằng chính `createScale`,
 * trong đó "một khung ảnh" đóng vai đơn vị lớn và "một pixel ảnh" đóng vai đơn
 * vị nhỏ. Không có ký tự `/` làm phép chia ở bất kỳ đâu trong file này.
 *
 * ## Bắt điểm: `snapToTargets`, và chỉ nó
 *
 * M-03 có ba cửa vào; cửa đúng cho một con trỏ là `snapToTargets`, vì chính nó
 * giữ bảng ưu tiên `SNAP_PRIORITY` (đỉnh tường → giao điểm → trung điểm → chân
 * vuông góc → **lưới**). Gọi thêm `snapToGrid` bên cạnh nó là dựng lại nhánh
 * cuối của bảng đó ở ngoài, tức mở đường cho hai câu trả lời khác nhau cho cùng
 * một con trỏ. Lưới 50 mm, bán kính bắt 120 mm là **mặc định của chính hàm**
 * (`SNAP_THRESHOLDS`), nên không con số nào được viết ở đây (R-71).
 *
 * `snapAngle` thì gọi thẳng: nó là thứ khoá đoạn theo trục khi giữ Shift, và
 * bước khoá lấy từ `ORTHOGONAL_LOCK_STEP_DEG` của `src/domain/measure`. Góc là
 * đại lượng không đơn vị nên nhánh này chạy được cả khi bản vẽ chưa có tỷ lệ —
 * còn bắt điểm vào lưới mi-li-mét thì không, và hook nói ra điều đó bằng cách
 * đơn giản là không bắt: một lưới 50 mm trên bản vẽ chưa biết tỷ lệ là một con
 * số không có nghĩa.
 *
 * ## Chạy số: 260 ms ở đây, 120 ms ở view
 *
 * `useCountUp` chạy đúng một tốc độ — `standard`, 260 ms — và chính chú thích
 * của nó (`lib/motion/useCountUp.ts:28-34`) giải thích vì sao 240 ms của đặc tả
 * không tồn tại. Đó đúng là quyết định C2, nên nhãn tỷ lệ sau khi áp chạy số
 * qua hook. Con số pixel lúc ĐANG KÉO thì không: nó phải bám con trỏ, và một
 * lượt chạy 260 ms sẽ hiện một con số không phải chỗ con trỏ đang đứng. Slot
 * 120 ms của nó là một chuyển tiếp CSS ở canvas (`cssDurationMs('instant')`),
 * đúng như bảng 1.2 của hợp đồng props phân công.
 *
 * ## Trạng thái máy chủ (R-64)
 *
 * Không một ô trạng thái tự viết nào cho việc đang tải, cũng không cho lỗi đọc:
 * cả hai thuộc về tầng query. `useState` ở đây chỉ giữ trạng thái của riêng giao diện: cách xác định đang chọn, hàng
 * đang chọn/đang rê, đoạn đang vẽ, nội dung ô nhập, phạm vi áp, panel thu gọn,
 * kích thước canvas, toạ độ con trỏ.
 *
 * ## Thứ tự bảy trạng thái
 *
 * `types.ts` viết bảy bất biến dưới dạng "⟺". Hai trong số đó không thể cùng
 * đúng theo nghĩa hai chiều tuyệt đối: khi chưa đọc được chuỗi kích thước nào
 * mà người dùng đã kéo một đoạn, màn vừa "rỗng" (bất biến 3) vừa "dở dang"
 * (bất biến 4). Thứ tự ở đây chọn nghĩa dùng được: `loading` → `error` →
 * `forbidden` → `collapsed` → `success` → `partial` (đã bắt tay vào làm) →
 * `empty`. Mọi cờ mà bất biến nhắc tới (`canvas.isImageLoading`,
 * `canvas.isInteractive`, `panel.areActionsHidden`,
 * `panel.statusCode`, `errorMessage`) được suy NGƯỢC từ trạng thái đã chọn, nên
 * chiều còn lại của mỗi "⟺" luôn đúng theo cấu trúc.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { isEntityOfKind } from '@/domain/spatial/normalize';
import { ORTHOGONAL_LOCK_STEP_DEG } from '@/domain/measure/constraints';
import {
  MAX_WALL_THICKNESS_MM,
  MIN_DOOR_WIDTH_MM,
  MIN_ROOM_AREA_M2,
  MIN_WALL_THICKNESS_MM,
} from '@/domain/rules/registry';
import { parseLength } from '@/domain/units/parse';
import {
  classifyScaleRange,
  compareScaleToAiEstimate,
  createScale,
  inferScale,
  inferWallThicknessFromScale,
  millimetresPerPixel,
  pixels,
  scaleFromRatio,
  type MillimetresPerPixel,
  type Pixels,
  type Scale,
  type ScaleInference,
  type ScaleMeasurement,
} from '@/domain/units/scale';
import { snapAngle, snapToTargets } from '@/domain/units/snap';
import type { PointMm } from '@/domain/units/compare';
import {
  degrees,
  degreesToRadians,
  millimetres,
  radians,
  radiansToDegrees,
  rectangleArea,
  type Millimetres,
} from '@/domain/units/types';
import { useAutosave, useFloorLayerAutosave } from '@/hooks/useAutosave';
import { appNotificationBus } from '@/hooks/useNotifications';
import { createUndoTicket } from '@/lib/mutations/undoTicket';
import type { FloorLayerSaveBlock } from '@/hooks/useAutosave';
import { useFloorLayer } from '@/hooks/useFloorLayer';
import { useFloorLayerReadFailure } from '../../qc/shared/floorLayerReadFailure';
import { useProjectConfidenceThreshold } from '@/hooks/useProjectConfidenceThreshold';
import { useSeparateUnitsFlag } from '@/hooks/useSeparateUnitsFlag';
import { useCanvasViewport } from '@/hooks/useCanvasViewport';
import { useCountUp } from '@/hooks/useCountUp';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useShortcut } from '@/hooks/useShortcut';
import { can } from '@/lib/auth/permissions';
import { describeError, toAppError } from '@/lib/errors';
import { readWireError } from '@/lib/errors/wireError';
import {
  formatArea,
  formatDrawingScaleRatio as formatDrawingScaleRatioBase,
  formatLength,
  formatScaleDensity as formatScaleDensityBase,
} from '@/lib/format/measure';
import { formatNumber, formatPercent, MISSING_VALUE } from '@/lib/format/number';
import { formatCombo, keyCapLabels, parseCombo } from '@/lib/input/shortcutRegistry';
import { MODIFIER_SHORTCUTS } from '@/lib/tools/shortcuts';
import { queryKeys } from '@/lib/query/queryKeys';
import { isScaleMissing, provisionalScaleNoticeOf, TINY_FOOTPRINT_MM } from '@/lib/viewmodel/provisionalScale';
import { ROUTES } from '@/routes/paths';
import { commit } from '@/store/commit';
import { useStore } from '@/store';
import type { SpatialPatch } from '@/domain/spatial/applyPatch';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Level } from '@/domain/spatial/types';
import type { ProjectRole } from '@/types/project';

import {
  createAppScaleCalibrationGateway,
  type ScaleCalibrationGateway,
  type ScaleDrawingSnapshot,
  type ScaleFloorTarget,
  type ScaleRawDimensionString,
  type ScaleDimensionChip,
  type ScaleRawSnapTarget,
  type ScaleRoomBoxPx,
} from './scaleCalibrationGateway';
import {
  buildScaleCheck,
  isFlatAreaImplausible,
  isPlanSizeImplausible,
  mmPerPxAt,
  mmPerPxFromFlatArea,
  noteRatioOf,
  outlinesAreaM2,
  parseFlatAreaM2,
  planSizeText,
  FLAT_SIZE_MISMATCH_PERCENT,
  ratioFromFlatSize,
  wallBoxPx,
  type PlanSizeMm,
} from './scaleCheck';
import type {
  DimensionStringRow,
  ImageRatioPoint,
  NudgeDirection,
  NudgeStep,
  ReferenceLineDraft,
  ReferenceLineEndpoint,
  ScaleApplyScope,
  ScaleApplyScopeOption,
  ScaleCalibrationActions,
  ScaleCalibrationMethod,
  FlatSizeEntryState,
  ScaleCalibrationState,
  ScaleCalibrationViewModel,
  ScaleComputationViewModel,
  ScaleCrossCheckRow,
  ScaleMethodOption,
  ScalePointerModifiers,
  ScaleReferenceStep,
  ScaleShortcutHint,
  ScaleWarning,
  ScaleWarningNotice,
  UseScaleCalibrationOptions,
  UseScaleCalibrationResult,
} from './types';

/* -------------------------------------------------------------------------- */
/* Chuỗi tiếng Việt của riêng hook.                                            */
/* Bản sao khai báo nằm ở notes/scale-calibration/i18n-keys.fragment.json.      */
/* -------------------------------------------------------------------------- */

const COPY = {
  canvasAltPrefix: 'Bản vẽ đã nắn của ',
  canvasAltEmpty: 'Chưa có bản vẽ nào để hiệu chỉnh.',
  currentScaleUnknown: 'Chưa có',
  derivedLineUnknown: 'chưa đủ dữ liệu để suy ra tỷ lệ nguyên đồ',
  // G3-31: màn tường đang dùng tỷ lệ tạm này; nói ra để hai màn không nói hai điều khác nhau.
  derivedLineProvisional: (density: string): string => `đang dùng tạm ${density} do máy ước, chưa được duyệt`,
  methodDimensionString: 'Từ chuỗi kích thước',
  methodReferenceLine: 'Vẽ đường tham chiếu',
  // UX-R3 U06/U11: số nhỏ thì phóng to; không có số thì đo cửa/giường cỡ chuẩn.
  // UX-R2 K27/K29: nói máy chưa đọc được, không nói bản vẽ thiếu số; chỉ cho người dùng làm gì.
  dimensionEmpty:
    'Máy chưa đọc được số kích thước nào để làm mốc. Phóng to bản vẽ cho rõ số, kéo dọc một đoạn có ghi số (ví dụ một số ở cạnh dưới) rồi nhập số đó. Bản vẽ không ghi số? Kéo dọc bề rộng cửa đi chính rồi nhập 900, hoặc chiều dài giường đôi rồi nhập 2000.',
  tooFewSamples: 'Chưa đủ chuỗi kích thước để suy ra tỷ lệ, nên phải đặt bằng tay.',
  lowConfidenceInference: 'Độ tin cậy chung còn thấp, nên tỷ lệ phải được xác nhận bằng tay.',
  realLengthPlaceholder: 'Số ghi trên đoạn',
  realLengthInvalid: 'Chiều dài thật phải là một số lớn hơn 0, ví dụ 4800.',
  referenceTooShort:
    'Đoạn quá ngắn — kéo giữa hai đầu một kích thước đã biết, hoặc dời đầu cuối bằng phím mũi tên.',
  shortcutFitView: 'Vừa khung',
  crossCheckWallThickness: 'Độ dày tường điển hình',
  crossCheckDoorWidth: 'Bề rộng cửa đi điển hình',
  chipsNone:
    'Máy không đọc được số kích thước trên bản vẽ này. Dùng ô Căn rộng × dài ở trên, hoặc kéo một đoạn rồi nhập chiều dài.',
  chipDragHint: (text: string): string =>
    `Kéo từ đầu đến cuối đường kích thước có số ${text}. Đoạn sẽ tự bắt vào đầu tường hoặc giao điểm gần nhất.`,
  liveMeasure: (pixelText: string, densityText: string): string => `Đo được ${pixelText} → ${densityText}`,
  doorWidthOdd: (width: string): string =>
    `Cửa đi theo tỷ lệ này rộng ${width}, bất thường (thường 700–1 000). Kiểm lại số đã nhập.`,
  crossCheckLargestRoomArea: 'Diện tích phòng lớn nhất',
  recalculationCaption: 'Đổi tỷ lệ sẽ tính lại mọi kích thước dẫn xuất của bản vẽ này.',
  scopeAllFloors: 'Mọi tầng',
  scopeThisFloor: 'Tầng này',
  shortcutCancelDrag: 'Huỷ đoạn đang kéo',
  shortcutUndoApplying: 'Hoàn tác lần áp đang gửi',
  shortcutRemeasure: 'Đo lại',
  shortcutConfirm: 'Xác nhận',
  shortcutNudgeFine: 'Nhích đầu đoạn một pixel',
  shortcutNudgeCoarse: 'Nhích đầu đoạn mười pixel',
  shortcutAxisLock: 'Khoá đoạn theo trục',
  // UX41 U04: đường bàn phím — đặt sẵn một đoạn giữa bản vẽ, rồi Tab tới hai đầu đoạn và nhích bằng mũi tên.
  shortcutPlaceSegment: 'Đặt đoạn đo giữa bản vẽ',
  noDrawingTitle: 'Tầng này chưa có bản vẽ',
  noDrawingNotice:
    'Chưa có bản vẽ nào được tải lên cho tầng này. Tải bản vẽ lên và chờ bước tiền xử lý xong rồi mới hiệu chỉnh tỷ lệ.',
  // Tiêu đề "Nắn ảnh thất bại nên bản vẽ có thể méo" là của view; câu này chỉ nói hậu quả và lối ra,
  // không nhắc lại tiêu đề (BUG-341). Khớp khoá `scaleCalibration.state.errorDescription`.
  // G3-31: tiền xử lý KHÔNG thất bại (màn Xử lý đánh ✓ đúng) — BE chỉ báo FRAME_NOT_FOUND mức cần chú ý.
  warpingNotice:
    'Bước tiền xử lý đã xong nhưng máy không tìm thấy khung bản vẽ, nên ảnh có thể chưa được nắn thẳng. Nếu thấy ảnh méo, quay lại bước tiền xử lý để nắn lại, vì tỷ lệ đo trên ảnh méo sẽ sai theo.',
  emptyNotice:
    'Máy chưa đọc được số kích thước nào để làm mốc. Phóng to bản vẽ cho rõ số, kéo dọc một đoạn có ghi số (ví dụ một số ở cạnh dưới) rồi nhập số đó. Bản vẽ không ghi số? Kéo dọc bề rộng cửa đi chính rồi nhập 900, hoặc chiều dài giường đôi rồi nhập 2000.',
  partialNotice:
    'Đã có đoạn tham chiếu nhưng chưa có chiều dài thật, hoặc một số chuỗi kích thước đọc được với độ tin cậy thấp.',
  forbiddenNotice:
    'Bản vẽ vẫn xem và phóng to được, nhưng không kéo được đường tham chiếu. Nhờ người có quyền sửa dự án đặt tỷ lệ giúp.',
  successNotice: 'Mọi kích thước dẫn xuất đã được tính lại theo tỷ lệ mới.',
  // K18: tầng có số kích thước máy đã đọc — mời chọn một số làm mốc thay vì nói "chưa đủ dữ liệu".
  pickDimensionNotice: (count: string): string =>
    `Máy đã đọc ${count} số kích thước trên bản vẽ. Chọn một số làm mốc, soi đoạn được tô rồi bấm Xác nhận tỷ lệ.`,
  // UX-R2 K05: máy đã chọn sẵn mốc tốt nhất — một câu dẫn duy nhất, một nút.
  preselectedNotice: (value: string): string =>
    `Máy chọn sẵn mốc ${value} mm (đoạn được tô). Thấy đúng thì bấm Xác nhận tỷ lệ.`,
  suggestionNotice: 'Đang dùng tỷ lệ máy ước lượng từ độ dày tường. Soi cỡ căn bên phải rồi bấm Xác nhận tỷ lệ.',
  suggestionOffer: (density: string): string => `Máy ước lượng từ độ dày tường: 1 px ≈ ${density} mm.`,
  suggestionUse: 'Dùng tỷ lệ này',
  // UX41 U01: máy đã đặt tạm một tỷ lệ (độ dày tường hoặc ghi chú tỷ lệ) — chọn sẵn, một nút, nói thật là ước lượng.
  autoSuggestionNotice: (density: string, size: string): string =>
    `Máy ước lượng sẵn 1 px ≈ ${density} mm${size}. Đây chỉ là ước lượng: cỡ căn đúng thì bấm Xác nhận tỷ lệ máy đề xuất, sai thì đo theo một cách bên dưới.`,
  // UX-02: tỷ lệ máy đặt khớp đúng ghi chú "TL 1:N" in trên PDF.
  noteSuggestionNotice: (ratio: string, density: string, size: string): string =>
    `Tỷ lệ lấy từ ghi chú TL 1:${ratio} trên bản vẽ: 1 px ≈ ${density} mm${size}. Thấy đúng thì bấm Xác nhận tỷ lệ máy đề xuất.`,
  // UX-02: máy đọc được chuỗi kích thước và chọn sẵn tỷ lệ — nói số đọc được, tỷ lệ và cỡ căn, một nút.
  machineProposalNotice: (count: string, density: string, size: string): string =>
    `Máy đọc được ${count} số kích thước, tỷ lệ đề xuất 1 px = ${density} mm${size}. Thấy đúng thì bấm Xác nhận tỷ lệ máy đề xuất; muốn tự đo thì chọn số khác hoặc kéo đoạn.`,
  machineApplyLabel: 'Xác nhận tỷ lệ máy đề xuất',
  // UX41 U01: nhập thẳng tỷ lệ ghi trên bản vẽ khi máy chủ biết DPI của ảnh.
  ratioEntryLabel: 'Hoặc nhập tỷ lệ ghi trên bản vẽ',
  ratioEntryPlaceholder: '1:100',
  ratioEntryInvalid: 'Nhập dạng 1:100 hoặc 100.',
  ratioEntryNotice: (ratio: string, density: string): string =>
    `Tỷ lệ 1:${ratio} ứng với 1 px ≈ ${density} mm. Bấm Xác nhận tỷ lệ để lưu.`,
  // UX-R4 U11: brochure không ghi số kích thước nhưng in diện tích căn — suy tỷ lệ từ diện tích.
  applyMissingHint: 'Thiếu: nhập rộng × dài của căn, hoặc kéo một đoạn rồi nhập chiều dài.',
  sizeEntryMismatch: (percent: string): string =>
    `Hai cạnh cho hai tỷ lệ khác nhau (lệch ${percent} %). Kiểm lại số đã nhập hoặc đo một đoạn.`,
  areaEntryLabel: 'Theo diện tích căn (m², số in trên brochure)',
  // UX-21: không gợi một con số — người dùng tưởng là số máy đo được.
  areaEntryPlaceholder: 'Số m² in trên brochure',
  areaEntryInvalid: 'Nhập diện tích bằng m², chỉ gồm số (dấu phẩy cho phần lẻ).',
  areaEntryHint: (size: string, density: string): string => `Căn rộng ${size}, 1 px ≈ ${density} mm.`,
  areaEntryNotice: (area: string, size: string): string =>
    `Căn ${area} m² thì rộng ${size}. Thấy đúng thì bấm Xác nhận tỷ lệ.`,
  // UX-R4 U06: ảnh chụp/JPG không mang cỡ in, nên ghi chú "TL 1/100" trên khung tên không đổi ra mm/px được.
  ratioPhotoNotice:
    'Ghi chú "TL 1/100" trên khung tên chỉ dùng được cho PDF: ảnh chụp hoặc JPG không biết cỡ in thật, nên hãy đo theo một số kích thước.',
  allFloorsOffline: 'Mất mạng nên một số tầng chưa lưu. Có mạng lại sẽ tự gửi, không cần bấm lại.',
  applyCommitLabel: 'Xác nhận tỷ lệ',
  applyNoSpatial: 'Chưa nạp dữ liệu không gian của tầng này, nên chưa áp được tỷ lệ.',
  applyFailed: 'Chưa lưu được tỷ lệ lên máy chủ, tầng giữ tỷ lệ cũ.',
  // UX41 U56: mất mạng thì không bắt người dùng bấm lại — tự gửi khi có mạng.
  applyOffline: 'Chưa lưu được tỷ lệ lên máy chủ vì mất mạng. Có mạng lại sẽ tự gửi, không cần bấm lại.',
  scaleConflict: 'Tầng này vừa được sửa ở nơi khác. Tải lại để xem bản mới nhất rồi áp lại tỷ lệ.',
  allFloorsReadFailed: 'Không tải được danh sách tầng để áp tỷ lệ.',
  allFloorsMessage:
    'Tầng chưa có bản vẽ sẽ không được áp. Sau khi áp, bước nắn và cắt bản vẽ của các tầng này sẽ khoá lại; muốn nắn lại thì tải bản vẽ mới.',
  allFloorsConfirm: 'Áp cho mọi tầng',
  allFloorsCancel: 'Huỷ',
  undoProvisional: 'Đã đặt lại tỷ lệ cũ; tỷ lệ này nay được coi là tỷ lệ bạn chọn.',
} as const;

/** G4b-14: toast nói tỷ lệ vừa lưu, không lặp tên nút. Ví dụ `"Đã áp tỷ lệ 12 mm/px cho 2 tầng"`. */
const appliedToastTitle = (ratioLabel: string, floorCount: number): string =>
  floorCount > 1 ? `Đã áp tỷ lệ ${ratioLabel} cho ${floorCount} tầng` : `Đã áp tỷ lệ ${ratioLabel} cho tầng này`;

/** Ví dụ `"Áp tỷ lệ này cho 3 tầng có bản vẽ?"`. */
const allFloorsTitle = (count: string): string => `Áp tỷ lệ này cho ${count} tầng có bản vẽ?`;

/** Báo cáo một lượt "áp mọi tầng": mỗi nhóm một câu, nhóm rỗng thì không nói. */
function allFloorsReport(report: AllFloorsReport): string {
  const names = (floors: readonly string[]): string => floors.join(', ');

  return [
    report.saved.length > 0 ? `Đã áp tỷ lệ cho ${formatNumber(report.saved.length)} tầng.` : null,
    report.failed.length > 0 ? `Không lưu được tỷ lệ cho: ${names(report.failed)}.` : null,
    report.blocked.length > 0 ? `Chưa gửi vì tầng đang bị khoá lưu: ${names(report.blocked)}.` : null,
    report.skipped.length > 0 ? `Bỏ qua vì chưa có bản vẽ: ${names(report.skipped)}.` : null,
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');
}

interface AllFloorsReport {
  readonly saved: readonly string[];
  readonly failed: readonly string[];
  readonly blocked: readonly string[];
  readonly skipped: readonly string[];
}

/** `Level` của `levelId` trong đồ thị, hoặc `null`. */
function levelIn(spatial: NormalizedSpatial | null, levelId: string): Level | null {
  const entity = spatial?.byId[levelId];

  return entity !== undefined && isEntityOfKind('level', entity) ? entity : null;
}

/**
 * UX41 U38: N16 trong cache sau khi máy chủ nhận tỷ lệ của một tầng ĐANG Ở KHO — bỏ hai khoá tạm,
 * revision theo kho. `level`/`layer`/`dimensions` giữ nguyên: kho là nguồn hình của tầng ấy, còn
 * `dimensions` của tài liệu đổi ra pixel theo tỷ lệ cũ của chính tài liệu. Lượt đọc lại sau thay hẳn.
 */
function confirmedLayerDocument(document: FloorLayerDocument, revision: number): FloorLayerDocument {
  const confirmed: FloorLayerDocument = { ...document, revision: Math.max(document.revision, revision), scaleBasis: 'human' };
  delete confirmed.scaleStatus;
  delete confirmed.scaleSource;

  return confirmed;
}

/** Câu người đọc của một lượt PUT hỏng. */
const failureText = (error: unknown): string => `${COPY.applyFailed} ${describeError(toAppError(error)).description}`;

/** Tỷ lệ dưới 1 mm/px vẫn phải đọc được (0,1 mm trên 400 px = 0,00025), không làm tròn về "0 mm/px" (14-C-019). */
const formatScaleDensity = (value: number): string =>
  formatScaleDensityBase(value, value > 0 && value < 1 ? { maxFractionDigits: 6 } : {});

/**
 * UX-R2 K32: tỷ lệ cũ → mới của từng tầng có bản vẽ. Tỷ lệ cũ lấy từ N15 mà
 * `readAllFloors` vừa đọc (`currentScale`), không từ kho — kho có thể chỉ giữ tầng đang mở.
 * Ví dụ `"ch-01: 1 mm/px → 13,9 mm/px"`; tầng chưa có tỷ lệ ghi "chưa có".
 */
function allFloorsChanges(targets: readonly ScaleFloorTarget[], ratio: MillimetresPerPixel): readonly string[] {
  const next = formatScaleDensity(ratio);

  return targets
    .filter((target) => target.hasDrawing)
    .map(
      ({ name, currentScale }) =>
        `${name}: ${currentScale === undefined ? 'chưa có' : formatScaleDensity(currentScale)} → ${next}`,
    );
}

/** "1:0" là vô nghĩa: tỷ lệ nguyên đồ làm tròn về 0 thì coi như chưa có (14-C-019). */
const formatDrawingScaleRatio = (value: number, shortEdgePx: number): string => {
  const label = formatDrawingScaleRatioBase(value, shortEdgePx);
  return label === '1:0' ? MISSING_VALUE : label;
};

/** Ví dụ `"1 pixel = 12 mm · bản vẽ ở tỷ lệ khoảng 1:100"`. */
const derivedLine = (millimetresLabel: string, ratioLabel: string): string =>
  `1 pixel = ${millimetresLabel} · bản vẽ ở tỷ lệ khoảng ${ratioLabel}`;

/** Ví dụ `"Có 2 chuỗi đọc được với độ tin cậy thấp, đã đánh dấu mức cần chú ý."`. */
const lowConfidenceNotice = (count: string): string =>
  `Có ${count} chuỗi đọc được với độ tin cậy thấp, đã đánh dấu mức cần chú ý.`;

/** Ví dụ `"OCR đọc được 4.800 ngay cạnh đoạn này."`. */
const realLengthHint = (value: string): string => `Máy đọc được ${value} ngay cạnh đoạn này.`;

/** Ví dụ `"khoảng hợp lý 60 mm – 400 mm"`. */
const expectedRange = (min: string, max: string): string => `khoảng hợp lý ${min} – ${max}`;

/** Ví dụ `"khoảng hợp lý từ 700 mm trở lên"` — khoảng chỉ có một đầu, và nói thật là vậy. */
const expectedRangeFrom = (min: string): string => `khoảng hợp lý từ ${min} trở lên`;

/** Ví dụ `"Giá trị này cho ra bức tường dày 3 m. Kiểm tra lại đơn vị hoặc chiều dài tham chiếu."`. */
const implausibleMessage = (thickness: string): string =>
  `Giá trị này cho ra bức tường dày ${thickness}. Kiểm tra lại đơn vị hoặc chiều dài tham chiếu.`;

/**
 * UX41 U34: cạnh dài khối tường quá mức này thì gần như chắc nhập sai (thừa một số 0, sai đơn vị):
 * căn hộ một tầng hiếm khi dài hơn 40 m. ponytail: ngưỡng cố định; nhà đất/nhiều căn thì nới.
 */
const HUGE_FOOTPRINT_MM = 40_000;

const planSizeMessage = (size: string): string =>
  `Tỷ lệ này cho căn ${size}, không giống một căn hộ. Kiểm lại số đã nhập (thừa hay thiếu số 0?) rồi mới xác nhận.`;

const PLAN_SIZE_CONFIRM_AGAIN = 'Cỡ căn trông vô lý. Kiểm lại số; nếu chắc chắn đúng, bấm Xác nhận tỷ lệ lần nữa.';

/** Ví dụ `"Tỷ lệ này lệch +25% so với ước tính 12 mm/px của AI. …"`. */
const deviationMessage = (percent: string, estimated: string): string =>
  `Tỷ lệ này lệch ${percent} so với ước tính ${estimated} của AI. ` +
  'Bạn vẫn áp được, nhưng nên kiểm lại chiều dài tham chiếu.';

/* -------------------------------------------------------------------------- */
/* Hằng của riêng màn.                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Bước nhích một đầu đoạn bằng phím mũi tên, tính bằng pixel ảnh.
 *
 * Hai con số này viết ở đây theo đúng chỉ dẫn của `types.ts` (`NudgeStep`):
 * view không được viết hằng số, nên chúng nằm ở hook, một chỗ duy nhất.
 */
const NUDGE_PX: Readonly<Record<NudgeStep, number>> = { fine: 1, coarse: 10 };

/** `< 1024px` — cùng mốc `InputQualityGate`, `FloorUploadScreen`, `ProcessingScreen`. */
const NARROW_VIEWPORT_QUERY = '(width < 1024px)';

const DEFAULT_ROLES: readonly ProjectRole[] = ['engineer'];

/** Hai đầu đoạn kéo cách hai đầu một số máy đọc không quá 2% khung thì coi là trùng (UX-R2 K29). */
const OCR_END_TOLERANCE = 0.02;

/** Một khung ảnh, đơn vị lớn của {@link frameScaleOf}. */
const ONE_IMAGE_FRAME = 1;

/** Đơn vị của con số pixel khi in ra. */
const PIXEL_SUFFIX = ' px';

const EMPTY_ROWS: readonly ScaleRawDimensionString[] = [];
const EMPTY_CHIPS: readonly ScaleDimensionChip[] = [];
const EMPTY_SNAP_TARGETS: readonly ScaleRawSnapTarget[] = [];

/* -------------------------------------------------------------------------- */
/* Quy đổi toạ độ — chỗ DUY NHẤT một phép chia xảy ra, và nó xảy ra ở domain.   */
/* -------------------------------------------------------------------------- */

/**
 * Khung ảnh, coi như một phép đo.
 *
 * Ảnh rộng `widthPx` pixel và rộng đúng một khung. Đó chính là hình dạng
 * `createScale` nhận: một chiều dài pixel cùng chiều dài thật nó ứng với. Nên
 * `pixelsToMillimetres` ở đây đọc là "pixel ảnh → tỷ lệ `0..1` của khung", và
 * `millimetresToPixels` đọc là chiều ngược lại. Phép chia nằm trong M-02, không
 * nằm ở màn — đúng luật màn này tồn tại để giữ.
 */
function frameScaleOf(edgePx: Pixels): Scale {
  return createScale({ pixelLength: edgePx, realLength: millimetres(ONE_IMAGE_FRAME) });
}

/**
 * Ảnh trong khung vuông, đã thành MỘT phép đổi cho cả hai trục. `null` khi tầng chưa được đo.
 *
 * Ảnh vẽ `object-contain` trong khung `aspect-square`: cạnh dài phủ kín khung, cạnh ngắn
 * nằm giữa với hai dải trống. Đổi riêng từng trục theo cạnh của nó (như trước) là kéo giãn
 * ảnh không vuông: cùng 0,6 khung ra 960 px theo ngang mà 720 px theo dọc (G52 14-C-026).
 */
interface ImageFrame {
  readonly widthPx: Pixels;
  readonly heightPx: Pixels;
  /** Khung ↔ pixel ảnh, theo cạnh dài — chung hai trục. */
  readonly edgeScale: Scale;
  /** Dải trống trước ảnh trên mỗi trục, pixel ảnh. */
  readonly insetX: Pixels;
  readonly insetY: Pixels;
}

function imageFrameOf(drawing: ScaleDrawingSnapshot | null): ImageFrame | null {
  if (drawing === null || drawing.widthPx === null || drawing.heightPx === null) {
    return null;
  }

  const edge = pixels(Math.max(drawing.widthPx, drawing.heightPx));

  return {
    widthPx: drawing.widthPx,
    heightPx: drawing.heightPx,
    edgeScale: frameScaleOf(edge),
    insetX: pixels((edge - drawing.widthPx) / 2),
    insetY: pixels((edge - drawing.heightPx) / 2),
  };
}

/** Một điểm trên ảnh, tính bằng pixel ảnh. */
interface PixelPoint {
  readonly x: Pixels;
  readonly y: Pixels;
}

/** Tỷ lệ `0..1` của khung → pixel ảnh. Chỉ có phép nhân. */
/** D1: cửa đi chính (cửa rộng nhất máy dò) thường 700–1 000 mm; ngoài khoảng → tỷ lệ đáng ngờ. */
const DOOR_WIDTH_TYPICAL_MM = { min: 700, max: 1000 } as const;

export function isDoorWidthOdd(widthMm: number): boolean {
  return widthMm < DOOR_WIDTH_TYPICAL_MM.min || widthMm > DOOR_WIDTH_TYPICAL_MM.max;
}

/** Bán kính bắt điểm, px màn hình (D1). */
const SNAP_RADIUS_SCREEN_PX = 8;

/** Điểm bắt gần nhất trong `radiusPx` (px ảnh); `null` khi không có. */
export function nearestSnapTarget(
  point: { readonly x: number; readonly y: number },
  targets: readonly ScaleRawSnapTarget[],
  radiusPx: number,
): ScaleRawSnapTarget | null {
  let best: ScaleRawSnapTarget | null = null;
  let bestDistance = radiusPx;

  for (const target of targets) {
    const distance = Math.hypot(target.xPx - point.x, target.yPx - point.y);

    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }

  return best;
}

function toPixelPoint(frame: ImageFrame, point: ImageRatioPoint): PixelPoint {
  return {
    x: pixels(frame.edgeScale.millimetresToPixels(millimetres(point.x)) - frame.insetX),
    y: pixels(frame.edgeScale.millimetresToPixels(millimetres(point.y)) - frame.insetY),
  };
}

/** Pixel ảnh → tỷ lệ `0..1` của khung. Phép chia do M-02 làm. */
function toRatioPoint(frame: ImageFrame, point: PixelPoint): ImageRatioPoint {
  return {
    x: frame.edgeScale.pixelsToMillimetres(pixels(point.x + frame.insetX)),
    y: frame.edgeScale.pixelsToMillimetres(pixels(point.y + frame.insetY)),
  };
}

/** Tài liệu N16 của tầng, đúng hình cổng trả (không import lớp API vào hook). */
type FloorLayerDocument = Awaited<ReturnType<ScaleCalibrationGateway['readLayer']>>;

/**
 * Kích thước N16 của tầng thành hàng mốc tỷ lệ (K18): mm trên đồ thị ÷ tỷ lệ tầng đã dựng = pixel ảnh,
 * cùng cách màn Kích thước đặt chúng lên ảnh. Kích thước người đã sửa số dùng số người sửa.
 */
function rowsFromLayerDimensions(document: FloorLayerDocument, frame: ImageFrame): readonly ScaleRawDimensionString[] {
  const ratio = document.level.scaleMillimetresPerPixel;

  if (ratio === undefined || ratio <= 0) {
    return EMPTY_ROWS;
  }

  const toPx = (point: { readonly x: number; readonly y: number }): PixelPoint => ({
    x: pixels(point.x / ratio),
    y: pixels(point.y / ratio),
  });

  return document.dimensions.flatMap((dimension) => {
    const start = toPx(dimension.line.start);
    const end = toPx(dimension.line.end);
    const pixelLength = segmentPixelLength(start, end);
    const realLength = millimetres(dimension.overrideValueMm ?? dimension.valueMm);

    if (!(pixelLength > 0) || !(realLength > 0)) {
      return [];
    }

    const min = toRatioPoint(frame, { x: pixels(Math.min(start.x, end.x)), y: pixels(Math.min(start.y, end.y)) });
    const max = toRatioPoint(frame, { x: pixels(Math.max(start.x, end.x)), y: pixels(Math.max(start.y, end.y)) });

    return [{ id: dimension.id, pixelLength, realLength, confidence: dimension.confidence, boundingBox: { min, max } }];
  });
}

/**
 * UX-02: máy không đọc được số — gợi sẵn đoạn đo dọc bức tường thẳng dài nhất (thường là tường
 * ngoài, nơi bản vẽ ghi số tổng). ponytail: dài nhất chưa chắc là tường ngoài; đủ làm gợi ý.
 */
function longestWallPixels(document: FloorLayerDocument | undefined): { readonly start: PixelPoint; readonly end: PixelPoint } | null {
  const ratio = document?.level.scaleMillimetresPerPixel;

  if (document === undefined || ratio === undefined || ratio <= 0) {
    return null;
  }

  let best: { readonly start: PixelPoint; readonly end: PixelPoint } | null = null;
  let bestLength = 0;

  for (const wall of document.layer.walls) {
    const start = { x: pixels(wall.centreline.start.x / ratio), y: pixels(wall.centreline.start.y / ratio) };
    const end = { x: pixels(wall.centreline.end.x / ratio), y: pixels(wall.centreline.end.y / ratio) };
    const length = segmentPixelLength(start, end);

    if (length > bestLength) {
      best = { start, end };
      bestLength = length;
    }
  }

  return best;
}

/**
 * Cỡ căn (hộp bao tường) theo tỷ lệ `ratio`, để người dùng soi bằng mắt (K17): tường N16 tính
 * bằng mm theo tỷ lệ tầng đã dựng, đổi về pixel rồi nhân tỷ lệ đang xét.
 */
function planSizeAt(document: FloorLayerDocument | undefined, ratio: number | null): PlanSizeMm | null {
  const built = document?.level.scaleMillimetresPerPixel;

  if (document === undefined || built === undefined || built <= 0 || ratio === null || ratio <= 0) {
    return null;
  }

  const xs: number[] = [];
  const ys: number[] = [];

  for (const wall of document.layer.walls) {
    xs.push(wall.centreline.start.x, wall.centreline.end.x);
    ys.push(wall.centreline.start.y, wall.centreline.end.y);
  }

  if (xs.length === 0) {
    return null;
  }

  const factor = ratio / built;

  return {
    widthMm: (Math.max(...xs) - Math.min(...xs)) * factor,
    heightMm: (Math.max(...ys) - Math.min(...ys)) * factor,
  };
}

/** D1: chữ trong ô rộng/dài (mm) → số; trống hoặc sai thì `NaN`. */
function parseMm(text: string): number {
  const value = Number(text.replace(/[.\s]/g, '').replace(',', '.'));
  return text.trim() === '' ? Number.NaN : value;
}

const EMPTY_SIZE_ENTRY: FlatSizeEntryState = { widthText: '', lengthText: '', isSwapped: false, isOuter: true };

/** Chiều dài một đoạn trên ảnh, tính bằng pixel. */
function segmentPixelLength(start: PixelPoint, end: PixelPoint): Pixels {
  return pixels(Math.hypot(end.x - start.x, end.y - start.y));
}

/* -------------------------------------------------------------------------- */
/* Định dạng — mọi con số thành chữ ở đây (A15).                                */
/* -------------------------------------------------------------------------- */

/** Ví dụ `"400 px"`. Số do `formatNumber` viết, hook không chọn số chữ số. */
function pixelLabel(value: Pixels | null): string {
  return value === null ? MISSING_VALUE : `${formatNumber(value)}${PIXEL_SUFFIX}`;
}

/** Ví dụ `"4.800 mm"`. */
function millimetreLabel(value: Millimetres | null): string {
  return value === null ? MISSING_VALUE : formatLength(value, { unit: 'mm' });
}

/** Ví dụ `"+25%"` / `"-4,5%"`. Dấu cộng phải ghép tay: `formatPercent` chỉ tự thêm dấu trừ. */
function signedPercentLabel(value: number): string {
  const written = formatPercent(value);
  return value > 0 ? `+${written}` : written;
}

/* -------------------------------------------------------------------------- */
/* Ngưỡng "khoảng hợp lý" của ba dòng kiểm chứng.                               */
/* -------------------------------------------------------------------------- */

/**
 * Diện tích phòng nhỏ nhất mà sổ luật còn coi là dùng được.
 *
 * `MIN_ROOM_AREA_M2` là một bảng theo công năng, không phải một con số, và số
 * `0` trong bảng nghĩa là "công năng này không có mức tối thiểu nào" chứ không
 * phải "không mét vuông nào cũng được". Nên mức nền chung là giá trị dương nhỏ
 * nhất trong bảng, tính ra chứ không chép lại.
 */
const SMALLEST_ROOM_MINIMUM_M2 = Math.min(
  ...Object.values(MIN_ROOM_AREA_M2).filter((value) => value > 0),
);

/* -------------------------------------------------------------------------- */
/* Trạng thái của phiên kéo.                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Đoạn tham chiếu, giữ theo PIXEL ẢNH.
 *
 * Pixel là đơn vị đoạn này được đo bằng, nên nó là đơn vị đúng để giữ; tỷ lệ
 * `0..1` mà view cần chỉ được dựng ra ở bước cuối, một lần, cho một khung ảnh
 * đã biết. Giữ theo tỷ lệ thì mỗi lần đo lại phải nhân ngược, và một tầng chưa
 * đo được độ phân giải sẽ khiến cả phiên kéo mất nghĩa giữa chừng.
 */
interface DragSession {
  readonly start: PixelPoint;
  readonly end: PixelPoint;
  readonly isDragging: boolean;
  readonly isAxisLocked: boolean;
  readonly snappedKind: ReferenceLineDraft['snappedKind'];
  readonly snappedEndpoint: ReferenceLineEndpoint | null;
  /** Đầu đang đi theo con trỏ — `end` khi vẽ mới, đầu của tay cầm khi kéo tay cầm (BUG-587). */
  readonly movingEndpoint: ReferenceLineEndpoint;
  /**
   * Lệch từ con trỏ tới tâm đầu đoạn lúc nhấn tay cầm (G51b): tay cầm 24 px, nên nhấn lệch
   * tâm rồi thả mà dời đầu đoạn tới con trỏ là vẽ ra một đoạn vài px. Vẽ mới thì 0.
   */
  readonly grabOffset: PixelPoint;
}

const NO_GRAB_OFFSET: PixelPoint = { x: pixels(0), y: pixels(0) };

/**
 * UX-49/UX-08: đoạn đo đã xác nhận được giữ theo tầng (tỉ lệ 0..1 trên ảnh), để mở lại màn Tỷ lệ
 * thấy ngay đoạn đã đo và chỉ cần sửa số. ponytail: lưu ở trình duyệt này; máy chủ chưa có chỗ
 * giữ đoạn đo (cần trường mới trong hợp đồng N16 nếu muốn thấy trên máy khác).
 */
const SAVED_SEGMENT_PREFIX = 'scale-segment:';

interface SavedSegment {
  readonly start: ImageRatioPoint;
  readonly end: ImageRatioPoint;
}

const isRatioPoint = (value: unknown): value is ImageRatioPoint =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as { x?: unknown }).x) &&
  Number.isFinite((value as { y?: unknown }).y);

export function readSavedSegment(floorId: string): SavedSegment | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SAVED_SEGMENT_PREFIX + floorId) ?? 'null');
    const segment = parsed as Partial<SavedSegment> | null;
    return segment !== null && isRatioPoint(segment.start) && isRatioPoint(segment.end)
      ? { start: segment.start, end: segment.end }
      : null;
  } catch {
    return null;
  }
}

export function writeSavedSegment(floorId: string, segment: SavedSegment): void {
  try {
    window.localStorage.setItem(SAVED_SEGMENT_PREFIX + floorId, JSON.stringify(segment));
  } catch {
    // Trình duyệt chặn bộ nhớ: mất đoạn đo khi mở lại, tỷ lệ vẫn lưu trên máy chủ.
  }
}

/** Điểm con trỏ cộng lệch lúc nhấn tay cầm — đầu đoạn đi theo đúng quãng con trỏ đi. */
const grabbed = (moving: PixelPoint, offset: PixelPoint): PixelPoint => ({
  x: pixels(moving.x + offset.x),
  y: pixels(moving.y + offset.y),
});

/** Đầu kia của một đoạn. */
const otherEndpoint = (endpoint: ReferenceLineEndpoint): ReferenceLineEndpoint =>
  endpoint === 'start' ? 'end' : 'start';

/** Bước nút "Phóng to"/"Thu nhỏ" — số tương tác giao diện, không phải tỷ lệ mm/px. */
const ZOOM_BUTTON_STEP = 1.25;
/** Phần trăm đầy đủ: `zoom` 1 là 100% của `ZoomCluster`, cả khung ảnh là 100% của bản đồ nhỏ. */
const FULL_PERCENT = 100;

/**
 * Vùng đang thấy của khung, phần trăm khung ảnh — phép ngược của `translate(x, y) scale(zoom)`
 * mà canvas đặt lên lớp ảnh. Chưa đo khung thì cả ảnh.
 */
function miniMapViewportOf(
  viewport: { readonly x: number; readonly y: number; readonly zoom: number },
  size: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, width: FULL_PERCENT, height: FULL_PERCENT };
  }

  return {
    x: (-viewport.x / (size.width * viewport.zoom)) * FULL_PERCENT,
    y: (-viewport.y / (size.height * viewport.zoom)) * FULL_PERCENT,
    width: FULL_PERCENT / viewport.zoom,
    height: FULL_PERCENT / viewport.zoom,
  };
}

/** Đầu đoạn phím mũi tên đang nhích. */
type NudgeTarget = ReferenceLineEndpoint;

/* -------------------------------------------------------------------------- */
/* Bản ghi một lượt đọc.                                                        */
/* -------------------------------------------------------------------------- */

interface ScaleCalibrationRecord {
  readonly drawing: ScaleDrawingSnapshot;
  readonly dimensionStrings: readonly ScaleRawDimensionString[];
  readonly referenceWallWidthPx: Pixels | null;
  readonly typicalDoorWidthPx: Pixels | null;
  readonly largestRoomBoxPx: ScaleRoomBoxPx | null;
  readonly snapTargets: readonly ScaleRawSnapTarget[];
  readonly dimensionChips: readonly ScaleDimensionChip[];
}

/* -------------------------------------------------------------------------- */
/* Tham số vào.                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tham số thật của hook.
 *
 * `types.ts` đóng băng trước khi `scaleCalibrationGateway.ts` tồn tại, nên cổng
 * dữ liệu được thêm bằng cách MỞ RỘNG ở đây — đúng cách hợp lệ duy nhất mà
 * chính `types.ts` chỉ ra.
 */
export interface UseScaleCalibrationHookOptions extends UseScaleCalibrationOptions {
  /** Cổng dữ liệu. Có mặc định thật bên trong; test và story cắm bản giả vào. */
  readonly gateway?: ScaleCalibrationGateway;
}

/* -------------------------------------------------------------------------- */
/* Hai hook phụ.                                                                */
/* -------------------------------------------------------------------------- */

function useNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    setIsNarrow(media.matches);
    const listener = (event: MediaQueryListEvent): void => {
      setIsNarrow(event.matches);
    };
    media.addEventListener('change', listener);
    return () => {
      media.removeEventListener('change', listener);
    };
  }, []);

  return isNarrow;
}

/** Cổng đã tiêm, hoặc bản thật dựng đúng một lần và chỉ khi cần. */
function useResolvedGateway(injected?: ScaleCalibrationGateway): ScaleCalibrationGateway {
  const fallbackRef = useRef<ScaleCalibrationGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createAppScaleCalibrationGateway();
  return fallbackRef.current;
}

/* -------------------------------------------------------------------------- */
/* Mốc của nhánh hoàn tác — cấp module (P2-4).                                  */
/* -------------------------------------------------------------------------- */

/**
 * Mốc sống qua lượt gắn lại màn, vì lịch sử zundo cũng sống qua nó: áp, rời màn, quay
 * lại, Ctrl+Z vẫn phải sinh một PUT. Khoá `projectId` + mã `Level`: đổi dự án thì xoá
 * hết; một lượt thay tầng từ ngoài (`serverReplaceSeq` tăng) cũng xoá, vì lượt ấy đã
 * xoá lịch sử nên không còn cú hoàn tác nào để gửi.
 */
interface RatioMarks {
  scope: string;
  /** Tỷ lệ máy chủ đã nhận gần nhất, theo `Level`. */
  readonly saved: Map<string, number>;
  /** Tầng từng ở tỷ lệ tạm, kèm tỷ lệ tạm ấy — hoàn tác về nó thì phải nói ra (bước 5). */
  readonly provisionalBefore: Map<string, number>;
}

const ratioMarks: RatioMarks = { scope: '', saved: new Map(), provisionalBefore: new Map() };

function ratioMarksFor(projectId: string): RatioMarks {
  const scope = `${projectId}#${useStore.getState().serverReplaceSeq}`;

  if (ratioMarks.scope !== scope) {
    ratioMarks.scope = scope;
    ratioMarks.saved.clear();
    ratioMarks.provisionalBefore.clear();
  }

  return ratioMarks;
}

/** Chỉ cho test: quên mọi mốc. */
export function __resetScaleRatioMarks(): void {
  ratioMarks.scope = '';
  ratioMarks.saved.clear();
  ratioMarks.provisionalBefore.clear();
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                        */
/* -------------------------------------------------------------------------- */

/** Hậu tố khoá đệm bản ghi hiệu chỉnh — xem ghi chú ở `useQuery` của hook. */
const SCALE_CALIBRATION_QUERY_SCOPE = 'scaleCalibration';

/** `(options) => UseScaleCalibrationResult` cho `ScaleCalibration.container.tsx`. */
export function useScaleCalibration(
  options: UseScaleCalibrationHookOptions,
): UseScaleCalibrationResult {
  const { floorId, projectId } = options;
  const roles = options.roles ?? DEFAULT_ROLES;
  const gateway = useResolvedGateway(options.gateway);

  const prefersReducedMotion = useReducedMotion();
  const detectedNarrow = useNarrowViewport();

  /* ---------------------------------------------------------------------- */
  /* Trạng thái máy chủ (R-64) — một khoá đệm cho bản vẽ của tầng.           */
  /* ---------------------------------------------------------------------- */

  /*
   * Hậu tố riêng (G25): các màn QC giữ ẢNH NỀN dưới đúng `drawing.byFloor(floorId)`
   * với hình khác; vào bằng SPA trong `staleTime` thì màn này đọc nhầm hình ấy và canvas
   * trắng. Nối hậu tố như `CAD_INSPECTION_QUERY_SCOPE` — vẫn mất hiệu lực theo tiền tố.
   */
  const query = useQuery({
    queryKey: [...queryKeys.drawing.byFloor(floorId), SCALE_CALIBRATION_QUERY_SCOPE],
    queryFn: async (): Promise<ScaleCalibrationRecord> => {
      const drawing = await gateway.readFloorDrawing({ floorId, projectId });

      if (!drawing.ok) {
        throw drawing.error;
      }

      const [strings, wallWidth, doorWidth, roomBox, targets, chips] = await Promise.all([
        gateway.readDimensionStrings({ floorId, projectId }),
        gateway.readReferenceWallWidth({ floorId, projectId }),
        gateway.readTypicalDoorWidth({ floorId, projectId }),
        gateway.readLargestRoomBox({ floorId, projectId }),
        gateway.readSnapTargets({ floorId, projectId }),
        gateway.readDimensionChips?.({ floorId, projectId }) ?? EMPTY_CHIPS,
      ]);

      return {
        drawing: drawing.data,
        dimensionStrings: strings.supported ? strings.value : EMPTY_ROWS,
        referenceWallWidthPx: wallWidth.supported ? wallWidth.value : null,
        typicalDoorWidthPx: doorWidth.supported ? doorWidth.value : null,
        largestRoomBoxPx: roomBox.supported ? roomBox.value : null,
        snapTargets: targets.supported ? targets.value : EMPTY_SNAP_TARGETS,
        dimensionChips: chips,
      };
    },
  });

  const record = query.data ?? null;
  const drawing = record?.drawing ?? null;

  /*
   * Đồ thị của tầng qua N16, cùng khoá và cùng khuôn nạp với các màn QC
   * (`useWallLayerReview.ts`): kho rỗng thì nạp vào kho, kho có đồ thị thì kho
   * thắng. `:floorId` của route là mã tầng API, đồ thị khoá theo mã `Level`. Trên
   * BE hai mã trùng; bộ mẫu API thì không (`L2` không phải `LevelId` hợp lệ), nên
   * `levelId` lấy từ chính tầng N16 trả (B-V5-01). Lượt đọc hỏng không chặn
   * khung vẽ; "Áp dụng tỷ lệ" khi ấy nói lý do tại chỗ.
   */
  const floorLayer = useFloorLayer({ projectId, floorId, read: gateway.readLayer });
  /* Gạch "độ tin cậy thấp" theo ngưỡng của dự án, không hằng 0,70 (BUG-354, như FIX-1603). */
  const confidenceThreshold = useProjectConfidenceThreshold(projectId, gateway.readConfidenceThreshold);
  /* Dự án "các tầng là căn hộ riêng" (K34): mỗi tầng một bản vẽ riêng, không áp một tỷ lệ cho mọi tầng. */
  const separateUnits = useSeparateUnitsFlag(projectId);
  const levelId: string = floorLayer.data?.level.id ?? floorId;
  /** `'unresolved'`: tỷ lệ trong `Level` là tỷ lệ tạm của pipeline, chưa ai chốt. */
  const isProvisional = floorLayer.scaleStatus === 'unresolved';
  const { isFloorBlocked, reloadFloor, saveBlock: layerSaveBlock, saveScale } = useFloorLayerAutosave({
    projectId,
    floorId: levelId,
    ...(gateway.apiClient !== undefined ? { apiClient: gateway.apiClient } : {}),
  });
  /* 409 của thân CHỈ tỷ lệ không khoá lớp nên bộ lưu không dựng dải; màn tự dựng dải "Tải lại",
     không thì mọi lần áp sau lặp 409 mà không có lối ra (BUG-598). */
  const [isScaleConflict, setScaleConflict] = useState(false);
  const saveBlock = useMemo<FloorLayerSaveBlock | null>(
    () =>
      layerSaveBlock ??
      (isScaleConflict
        ? {
            confirm: null,
            kind: 'reload',
            message: COPY.scaleConflict,
            onReload: () => {
              setScaleConflict(false);
              void reloadFloor(levelId);
            },
          }
        : null),
    [isScaleConflict, layerSaveBlock, levelId, reloadFloor],
  );
  const frame = useMemo(() => imageFrameOf(drawing), [drawing]);

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện.                                         */
  /* ---------------------------------------------------------------------- */

  const [method, setMethod] = useState<ScaleCalibrationMethod>('dimensionString');
  /** Mốc người dùng tự chọn; `null` = chưa chọn, màn dùng mốc máy chọn sẵn (UX-R2 K05). */
  const [pickedRowId, setSelectedRowId] = useState<string | null>(null);
  /** Tầng mà người dùng đã bấm "Dùng tỷ lệ này" (UX-R2); gắn theo tầng để đổi tầng không mang lựa chọn sang. */
  const [suggestionFloorId, setSuggestionFloorId] = useState<string | null>(null);
  const isSuggestionChosen = suggestionFloorId === floorId;
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragSession | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [nudgeTarget, setNudgeTarget] = useState<NudgeTarget>('end');
  const [realLengthText, setRealLengthText] = useState('');
  /** UX41 U01: chữ "1:100" người dùng gõ, gắn theo tầng để đổi tầng không mang sang. */
  const [ratioEntry, setRatioEntry] = useState<{ readonly floorId: string; readonly text: string } | null>(null);
  /** UX-R4 U11: diện tích căn (m²) người dùng gõ, gắn theo tầng như `ratioEntry`. */
  const [areaEntry, setAreaEntry] = useState<{ readonly floorId: string; readonly text: string } | null>(null);
  /** D1: ô "Căn rộng × dài (mm)" của tầng đang mở. */
  const [sizeEntry, setSizeEntry] = useState<(FlatSizeEntryState & { readonly floorId: string }) | null>(null);
  const [applyScope, setApplyScope] = useState<ScaleApplyScope>('thisFloor');
  const [isCollapsedByUser, setIsCollapsedByUser] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ readonly width: number; readonly height: number }>({
    width: 0,
    height: 0,
  });
  const [cursorPoint, setCursorPoint] = useState<ImageRatioPoint | null>(null);
  /** Kết quả lượt áp gần nhất: `success` chỉ khi MỌI `saveScale` của lượt ấy thành công (A5). */
  const [applyOutcome, setApplyOutcome] = useState<'success' | 'failed' | null>(null);
  const [isApplying, setApplying] = useState(false);
  /** UX41 U56: lượt áp vừa hỏng vì mất mạng, chờ sự kiện `online` để tự gửi lại. */
  const [isOfflinePending, setOfflinePending] = useState(false);
  /** UX41 U56: các tầng của lượt "áp mọi tầng" hỏng vì mất mạng, chờ `online` để gửi lại đúng tỷ lệ ấy. */
  const [offlineFloors, setOfflineFloors] = useState<{
    readonly ratio: MillimetresPerPixel;
    readonly targets: readonly ScaleFloorTarget[];
  } | null>(null);
  /** Câu của lượt áp/hoàn tác gần nhất — `applyBlockedNotice` của panel. */
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  /** Hộp thoại A9 đang mở cho "áp mọi tầng": tỷ lệ và danh sách đích đã đọc. */
  const [allFloors, setAllFloors] = useState<{
    readonly ratio: MillimetresPerPixel;
    readonly targets: readonly ScaleFloorTarget[];
    readonly changes: readonly string[];
  } | null>(null);

  const { viewport, pan, zoomTo, flyToBounds } = useCanvasViewport();

  /* ---------------------------------------------------------------------- */
  /* Tỷ lệ đã áp — nguồn sự thật là store, không phải một bản sao ở đây.      */
  /* ---------------------------------------------------------------------- */

  const levelRatio = useStore((state) => levelIn(state.spatial, levelId)?.scaleMillimetresPerPixel ?? null);
  /** Tầng tỷ lệ tạm coi như chưa hiệu chỉnh (`spatialLayer.ts`); tỷ lệ tạm chỉ còn nuôi `workingRatio`. */
  const storedRatio = isProvisional ? null : levelRatio;
  const provisionalRatio = isProvisional ? levelRatio : null;

  const appliedScale = useMemo<Scale | null>(
    () => (storedRatio === null ? null : scaleFromRatio(storedRatio)),
    [storedRatio],
  );

  /* ---------------------------------------------------------------------- */
  /* Ước tính của AI.                                                        */
  /* ---------------------------------------------------------------------- */

  /*
   * K18/K34: máy chủ chưa có lượt đọc chuỗi kích thước riêng (`readDimensionStrings` chưa hỗ trợ),
   * nhưng N16 đã mang các kích thước máy đọc — cùng nguồn màn Kích thước (#M-…). Đổi đường kích
   * thước (mm, theo tỷ lệ tầng đã dựng) về pixel ảnh để dùng làm mốc, thay vì báo "không đọc được số".
   * Đường và tỷ lệ lấy cùng một tài liệu N16 nên luôn khớp nhau, kể cả sau khi áp tỷ lệ mới.
   */
  const layerDocument = floorLayer.data;
  const layerRows = useMemo<readonly ScaleRawDimensionString[]>(
    () => (layerDocument === undefined || frame === null ? EMPTY_ROWS : rowsFromLayerDimensions(layerDocument, frame)),
    [frame, layerDocument],
  );
  const recordRows = record?.dimensionStrings ?? EMPTY_ROWS;
  const rawRows = recordRows.length > 0 ? recordRows : layerRows;

  const aiInference = useMemo<ScaleInference | null>(() => {
    if (rawRows.length === 0) {
      return null;
    }

    const measurements: readonly ScaleMeasurement[] = rawRows.map((row) => ({
      id: row.id,
      pixelLength: row.pixelLength,
      realLength: row.realLength,
    }));

    return inferScale(measurements);
  }, [rawRows]);

  const aiSuggestion = aiInference?.suggestedMillimetresPerPixel ?? null;

  /* ---------------------------------------------------------------------- */
  /* Hai vế của phép tính.                                                   */
  /* ---------------------------------------------------------------------- */

  /*
   * UX-R2 K05: tầng chưa xác nhận tỷ lệ thì chọn sẵn mốc tốt nhất (đọc chắc nhất, rồi dài nhất), để
   * người dùng chốt bằng một cú bấm. Tầng đã xác nhận thì không đề nghị gì khi người dùng chưa chạm.
   */
  const bestRowId = useMemo(() => {
    if (storedRatio !== null) {
      return null;
    }

    const best = rawRows
      .filter((row) => row.confidence >= confidenceThreshold)
      .reduce<ScaleRawDimensionString | null>(
        (top, row) =>
          top === null ||
          row.confidence > top.confidence ||
          (row.confidence === top.confidence && row.pixelLength > top.pixelLength)
            ? row
            : top,
        null,
      );

    return best?.id ?? null;
  }, [confidenceThreshold, rawRows, storedRatio]);
  const selectedRowId = pickedRowId ?? bestRowId;
  const selectedRow = rawRows.find((row) => row.id === selectedRowId) ?? null;

  const draftPixelLength = useMemo<Pixels | null>(
    () => (drag === null ? null : segmentPixelLength(drag.start, drag.end)),
    [drag],
  );

  const typedLength = useMemo<Millimetres | null>(() => {
    const parsed = parseLength(realLengthText, { defaultUnit: 'mm' });
    return parsed.ok ? parsed.value : null;
  }, [realLengthText]);

  /**
   * Hai vế đang xét: hàng đã chọn thắng, vì chọn một chuỗi kích thước là một
   * câu trả lời dứt khoát; đoạn vẽ tay chỉ nói lên điều gì khi đã có chiều dài.
   */
  /* Không có chuỗi kích thước thì chỉ còn đoạn tham chiếu — cùng luật `effectiveMethod` của panel (G52 14-C-016). */
  const computedMethod: ScaleCalibrationMethod = rawRows.length === 0 ? 'referenceLine' : method;
  const numerator: Millimetres | null =
    computedMethod === 'dimensionString' ? (selectedRow?.realLength ?? null) : typedLength;
  const denominator: Pixels | null =
    computedMethod === 'dimensionString' ? (selectedRow?.pixelLength ?? null) : draftPixelLength;

  /** Tỷ lệ đang đề nghị — do M-02 tính, không do màn chia. */
  const proposedScale = useMemo<Scale | null>(() => {
    if (numerator === null || denominator === null || numerator <= 0 || denominator <= 0) {
      return null;
    }

    return createScale({ pixelLength: denominator, realLength: numerator });
  }, [denominator, numerator]);

  /* UX-R2: tỷ lệ máy ước từ độ dày tường (N16 `suggestedScaleMmPerPx`), chỉ đề nghị khi chưa xác nhận. */
  const suggestedRatio = useMemo<MillimetresPerPixel | null>(() => {
    const value = floorLayer.data?.suggestedScaleMmPerPx;

    return value === undefined || storedRatio !== null ? null : millimetresPerPixel(value);
  }, [floorLayer.data?.suggestedScaleMmPerPx, storedRatio]);
  /*
   * UX41 U01: máy chủ đặt tạm tỷ lệ của pipeline (độ dày tường hoặc ghi chú tỷ lệ) vào `Level` dù
   * không đọc được số kích thước nào. Không có mốc nào khác thì chọn sẵn tỷ lệ ấy: một nút Xác nhận.
   * Tỷ lệ mặc định của dự án (`project_default`) là số sai, không chọn sẵn.
   */
  const pipelineRatio =
    suggestedRatio ?? (provisionalRatio !== null && floorLayer.scaleSource === 'pipeline' ? provisionalRatio : null);
  const sourceDpi = layerDocument?.sourceDpi ?? null;
  const ratioText = ratioEntry?.floorId === floorId ? ratioEntry.text : '';
  /** "1:100", "1/100" hoặc "100" → 100; chữ khác → `null`. */
  const ratioDenominator = useMemo<number | null>(() => {
    const match = /^\s*(?:1\s*[:/]\s*)?(\d+(?:[.,]\d+)?)\s*$/.exec(ratioText);
    const value = match?.[1] === undefined ? Number.NaN : Number(match[1].replace(',', '.'));

    return Number.isFinite(value) && value > 0 ? value : null;
  }, [ratioText]);
  const ratioEntryRatio = useMemo<MillimetresPerPixel | null>(
    () =>
      sourceDpi === null || ratioDenominator === null
        ? null
        : millimetresPerPixel(mmPerPxAt(ratioDenominator, sourceDpi)),
    [ratioDenominator, sourceDpi],
  );
  const areaText = areaEntry?.floorId === floorId ? areaEntry.text : '';
  const areaM2 = useMemo(() => parseFlatAreaM2(areaText), [areaText]);
  /** Diện tích căn ở tỷ lệ đã dựng: tổng các phòng; chưa có phòng thì hộp bao tường. */
  const builtAreaM2 = useMemo<number | null>(() => {
    if (layerDocument === undefined) {
      return null;
    }
    const rooms = outlinesAreaM2(layerDocument.layer.rooms.map((room) => room.outline));
    const box = planSizeAt(layerDocument, layerDocument.level.scaleMillimetresPerPixel ?? null);
    const area = rooms > 0 ? rooms : box === null ? 0 : (box.widthMm * box.heightMm) / 1_000_000;

    return area > 0 ? area : null;
  }, [layerDocument]);
  const areaEntryRatio = useMemo<MillimetresPerPixel | null>(() => {
    const built = layerDocument?.level.scaleMillimetresPerPixel;
    const value =
      areaM2 === null || builtAreaM2 === null || built === undefined
        ? null
        : mmPerPxFromFlatArea(areaM2, built, builtAreaM2);

    return value === null ? null : millimetresPerPixel(value);
  }, [areaM2, builtAreaM2, layerDocument?.level.scaleMillimetresPerPixel]);
  /** Cỡ căn ở tỷ lệ suy từ diện tích — để người dùng soi trước khi xác nhận (ví dụ ≈ 8,7 × 8,2 m). */
  const areaPlanSize = useMemo(() => planSizeAt(layerDocument, areaEntryRatio), [areaEntryRatio, layerDocument]);
  const sizeState: FlatSizeEntryState = sizeEntry?.floorId === floorId ? sizeEntry : EMPTY_SIZE_ENTRY;
  /** D1: tỷ lệ từ rộng × dài căn, đo trên hộp bao tường (mép ngoài hoặc tim tường). */
  const sizeEntryResult = useMemo(() => {
    const built = layerDocument?.level.scaleMillimetresPerPixel;
    if (layerDocument === undefined || built === undefined || built <= 0) {
      return null;
    }
    const box = wallBoxPx(
      layerDocument.layer.walls.map((wall) => ({
        x1: wall.centreline.start.x / built,
        y1: wall.centreline.start.y / built,
        x2: wall.centreline.end.x / built,
        y2: wall.centreline.end.y / built,
        thicknessPx: wall.thicknessMm / built,
      })),
      sizeState.isOuter,
    );
    return box === null
      ? null
      : ratioFromFlatSize(parseMm(sizeState.widthText), parseMm(sizeState.lengthText), box, sizeState.isSwapped);
  }, [layerDocument, sizeState]);
  const sizeEntryRatio = sizeEntryResult === null ? null : millimetresPerPixel(sizeEntryResult.mmPerPx);
  /** Tỷ lệ người dùng gõ thẳng (1:N, diện tích hoặc rộng × dài căn); các ô loại trừ nhau. */
  const typedRatio = ratioEntryRatio ?? areaEntryRatio ?? sizeEntryRatio;
  const isAutoSuggestion =
    floorLayer.scaleSource === 'pipeline' &&
    pipelineRatio !== null &&
    !isSuggestionChosen &&
    // UX-02: có số đọc được nhưng không số nào đủ chắc để chọn sẵn thì vẫn đề xuất tỷ lệ máy, không khoá nút.
    selectedRow === null &&
    drag === null &&
    proposedScale === null &&
    typedRatio === null;
  const isSuggestionActive = pipelineRatio !== null && (isSuggestionChosen || isAutoSuggestion);
  const proposedRatio =
    typedRatio ?? (isSuggestionActive ? pipelineRatio : (proposedScale?.millimetresPerPixel ?? null));

  /** Tỷ lệ dùng để bắt điểm và để suy ra ba dòng kiểm chứng, theo thứ tự tin cậy. */
  const workingRatio: MillimetresPerPixel | null = proposedRatio ?? storedRatio ?? provisionalRatio ?? aiSuggestion;

  /* ---------------------------------------------------------------------- */
  /* Tự lưu (D-07 / A7) — 800 ms là mặc định của chính `useAutosave`.         */
  /* ---------------------------------------------------------------------- */

  const saveScaleRef = useRef(saveScale);
  saveScaleRef.current = saveScale;

  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  /**
   * Nhánh hoàn tác (F-04x-2 bước 5): `useAutosave` gọi lại sau mỗi sửa có lịch sử; chỉ
   * tầng có tỷ lệ `Level` khác tỷ lệ máy chủ nhận gần nhất (mốc cấp module) mới sinh
   * PUT — sửa đồ thị khác không sinh PUT tỷ lệ. Hỏng thì ném lỗi gốc cho engine. Gửi
   * là hạ `success`: kết quả cũ không còn nói về tỷ lệ đang có.
   */
  const handleSave = useCallback(async (): Promise<void> => {
    const marks = ratioMarksFor(projectIdRef.current);

    for (const [id, saved] of marks.saved) {
      const ratio = levelIn(useStore.getState().spatial, id)?.scaleMillimetresPerPixel;

      if (ratio === undefined || ratio === saved) {
        continue;
      }

      setApplyOutcome(null);
      await saveScaleRef.current(id, ratio);
      marks.saved.set(id, ratio);

      if (marks.provisionalBefore.get(id) === ratio) {
        setApplyNotice(COPY.undoProvisional);
      }
    }
  }, []);

  const saveLabel = useAutosave(handleSave);

  /* ---------------------------------------------------------------------- */
  /* Bắt điểm (M-03).                                                        */
  /* ---------------------------------------------------------------------- */

  /** Điểm bắt máy dò (`detected-geometry`), px ảnh. */
  const snapTargetsPx = record?.snapTargets ?? EMPTY_SNAP_TARGETS;
  /** D1: bán kính bắt 8 px MÀN HÌNH, quy về px ảnh theo mức phóng hiện tại. */
  const snapRadiusPx = useMemo<number>(() => {
    const edge = frame === null ? 0 : Math.max(frame.widthPx, frame.heightPx);
    const screenPerImage = edge > 0 ? (Math.min(canvasSize.width, canvasSize.height) * viewport.zoom) / edge : 0;

    return screenPerImage > 0 ? SNAP_RADIUS_SCREEN_PX / screenPerImage : SNAP_RADIUS_SCREEN_PX;
  }, [canvasSize.height, canvasSize.width, frame, viewport.zoom]);

  /**
   * Một đầu đoạn sau khi đã khoá trục và đã bắt điểm.
   *
   * Khoá trục chạy trước và chạy được cả khi bản vẽ chưa có tỷ lệ, vì góc không
   * có đơn vị. Bắt điểm chạy sau và chỉ chạy khi đã có một tỷ lệ để quy đổi:
   * lưới 50 mm trên một bản vẽ chưa biết tỷ lệ không nói lên điều gì.
   */
  const resolveEndpoint = useCallback(
    (
      anchor: PixelPoint,
      moving: PixelPoint,
      isAxisLocked: boolean,
      isSnapDisabled = false,
    ): { readonly point: PixelPoint; readonly kind: ReferenceLineDraft['snappedKind'] } => {
      let point = moving;

      if (isAxisLocked) {
        const across = point.x - anchor.x;
        const up = point.y - anchor.y;
        const heading = radiansToDegrees(radians(Math.atan2(up, across)));
        const locked = snapAngle(heading, ORTHOGONAL_LOCK_STEP_DEG);
        const alongRadians = degreesToRadians(degrees(locked));
        const length = Math.hypot(across, up);
        point = {
          x: pixels(anchor.x + Math.cos(alongRadians) * length),
          y: pixels(anchor.y + Math.sin(alongRadians) * length),
        };
      }

      // Giữ Alt: không bắt gì cả (D1).
      if (isSnapDisabled) {
        return { point, kind: null };
      }

      // Đầu tường / giao điểm máy dò trong 8 px màn hình thắng; chạy cả khi chưa có tỷ lệ.
      const target = nearestSnapTarget(point, snapTargetsPx, snapRadiusPx);

      if (target !== null) {
        return { point: { x: target.xPx, y: target.yPx }, kind: target.kind };
      }

      if (workingRatio === null) {
        return { point, kind: null };
      }

      const scale = scaleFromRatio(workingRatio);
      const asMm: PointMm = {
        x: scale.pixelsToMillimetres(point.x),
        y: scale.pixelsToMillimetres(point.y),
      };
      const snapped = snapToTargets(asMm, []);

      return {
        point: {
          x: scale.millimetresToPixels(snapped.point.x),
          y: scale.millimetresToPixels(snapped.point.y),
        },
        kind: snapped.snapped ? snapped.kind : null,
      };
    },
    [snapRadiusPx, snapTargetsPx, workingRatio],
  );

  /* ---------------------------------------------------------------------- */
  /* Hành động.                                                              */
  /* ---------------------------------------------------------------------- */

  const onNavigateRef = useRef(options.onNavigate);
  onNavigateRef.current = options.onNavigate;

  const navigate = useCallback((path: string) => {
    onNavigateRef.current?.(path);
  }, []);

  const frameRef = useRef(frame);
  frameRef.current = frame;

  const onChangeMethod = useCallback((next: ScaleCalibrationMethod) => {
    setMethod(next);
  }, []);

  const onHoverDimensionRow = useCallback((rowId: string | null) => {
    setHighlightedRowId(rowId);
  }, []);

  const rowsRef = useRef(rawRows);
  rowsRef.current = rawRows;
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  /**
   * Chọn một chuỗi kích thước: tính ngay, rồi bay khung nhìn tới hộp bao của nó
   * trong 340 ms (R-07). `flyToBounds` tự đọc mức "giảm chuyển động" của hệ
   * điều hành, nên khung nhìn nhảy thẳng tới đích khi người dùng đã tắt hiệu ứng.
   */
  const flyToRow = useCallback(
    (rowId: string) => {
      const row = rowsRef.current.find((entry) => entry.id === rowId);
      const currentFrame = frameRef.current;
      const size = canvasSizeRef.current;

      if (row === undefined || currentFrame === null || size.width <= 0 || size.height <= 0) {
        return;
      }

      const min = toPixelPoint(currentFrame, row.boundingBox.min);
      const max = toPixelPoint(currentFrame, row.boundingBox.max);

      flyToBounds(
        { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y },
        size.width,
        size.height,
      );
    },
    [flyToBounds],
  );

  const onSelectDimensionRow = useCallback(
    (rowId: string) => {
      setSelectedRowId(rowId);
      setSuggestionFloorId(null);
      setRatioEntry(null);
      setAreaEntry(null);
      setMethod('dimensionString');
      flyToRow(rowId);
    },
    [flyToRow],
  );

  /** UX-R4 U06: số trên bản vẽ nhỏ — một cú bấm phóng tới số đang chọn (hoặc số đầu), không đổi lựa chọn. */
  const selectedRowIdRef = useRef(selectedRowId);
  selectedRowIdRef.current = selectedRowId;
  const layerDocumentRef = useRef(layerDocument);
  layerDocumentRef.current = layerDocument;
  const onZoomToNumbers = useCallback(() => {
    const rowId = selectedRowIdRef.current ?? rowsRef.current[0]?.id;

    if (rowId !== undefined) {
      flyToRow(rowId);
      return;
    }

    // UX-02: không có số nào — đặt sẵn đoạn đo dọc tường dài nhất và phóng tới đó để đọc số in cạnh nó.
    const wall = longestWallPixels(layerDocumentRef.current);
    const size = canvasSizeRef.current;

    if (wall === null || frameRef.current === null || size.width <= 0 || size.height <= 0) {
      return;
    }

    setMethod('referenceLine');
    setSuggestionFloorId(null);
    setRatioEntry(null);
    setAreaEntry(null);
    setApplyOutcome(null);
    setNudgeTarget('end');
    if (dragRef.current === null) {
      setDrag({
        start: wall.start,
        end: wall.end,
        isDragging: false,
        isAxisLocked: false,
        snappedKind: null,
        snappedEndpoint: null,
        movingEndpoint: 'end',
        grabOffset: NO_GRAB_OFFSET,
      });
    }
    // Lề quanh đoạn: số kích thước thường nằm ngoài tường một khoảng.
    const pad = Math.max(Math.abs(wall.end.x - wall.start.x), Math.abs(wall.end.y - wall.start.y)) * 0.15;
    flyToBounds(
      {
        minX: pixels(Math.min(wall.start.x, wall.end.x) - pad),
        minY: pixels(Math.min(wall.start.y, wall.end.y) - pad),
        maxX: pixels(Math.max(wall.start.x, wall.end.x) + pad),
        maxY: pixels(Math.max(wall.start.y, wall.end.y) + pad),
      },
      size.width,
      size.height,
    );
  }, [flyToBounds, flyToRow]);

  const onStartDrag = useCallback((point: ImageRatioPoint, endpoint?: ReferenceLineEndpoint) => {
    const currentFrame = frameRef.current;

    if (currentFrame === null) {
      return;
    }

    setMethod('referenceLine');
    setSuggestionFloorId(null);
    setRatioEntry(null);
    setAreaEntry(null);

    // Nhấn lên tay cầm: kéo đúng đầu đó, đầu kia đứng yên — không vẽ lại cả đoạn (BUG-587).
    if (endpoint !== undefined) {
      const pressed = toPixelPoint(currentFrame, point);

      setNudgeTarget(endpoint);
      setDrag((session) =>
        session === null
          ? session
          : {
              ...session,
              isDragging: true,
              movingEndpoint: endpoint,
              grabOffset: { x: pixels(session[endpoint].x - pressed.x), y: pixels(session[endpoint].y - pressed.y) },
            },
      );
      return;
    }

    const at = toPixelPoint(currentFrame, point);
    // Đường mới: kết quả áp cũ không còn nói về đường này, để lời nhắc "chưa đủ dữ liệu" lên lại (G58, 14-09).
    setApplyOutcome(null);
    setNudgeTarget('end');
    setDrag({
      start: at,
      end: at,
      isDragging: true,
      isAxisLocked: false,
      snappedKind: null,
      snappedEndpoint: null,
      movingEndpoint: 'end',
      grabOffset: NO_GRAB_OFFSET,
    });
  }, []);

  const onMoveDrag = useCallback(
    (point: ImageRatioPoint, modifiers: ScalePointerModifiers) => {
      const currentFrame = frameRef.current;

      if (currentFrame === null) {
        return;
      }

      const moving = toPixelPoint(currentFrame, point);

      setDrag((session) => {
        if (session === null) {
          return session;
        }

        const endpoint = session.movingEndpoint;
        const resolved = resolveEndpoint(
          session[otherEndpoint(endpoint)],
          grabbed(moving, session.grabOffset),
          modifiers.isAxisLocked,
          modifiers.isSnapDisabled === true,
        );

        return {
          ...session,
          [endpoint]: resolved.point,
          isDragging: true,
          isAxisLocked: modifiers.isAxisLocked,
          snappedKind: resolved.kind,
          snappedEndpoint: resolved.kind === null ? null : endpoint,
        };
      });
    },
    [resolveEndpoint],
  );

  const onEndDrag = useCallback(
    (point: ImageRatioPoint) => {
      const currentFrame = frameRef.current;

      if (currentFrame === null) {
        return;
      }

      const moving = toPixelPoint(currentFrame, point);

      setDrag((session) => {
        if (session === null) {
          return session;
        }

        const endpoint = session.movingEndpoint;

        // Nhấp không kéo: hai đầu trùng nhau và con trỏ đứng yên -> không có đoạn, đừng bắt điểm sang chỗ khác (G52, 14-C-016).
        if (
          session.start.x === session.end.x &&
          session.start.y === session.end.y &&
          moving.x === session[endpoint].x &&
          moving.y === session[endpoint].y
        ) {
          return { ...session, isDragging: false };
        }

        const resolved = resolveEndpoint(
          session[otherEndpoint(endpoint)],
          grabbed(moving, session.grabOffset),
          session.isAxisLocked,
        );

        return {
          ...session,
          [endpoint]: resolved.point,
          isDragging: false,
          snappedKind: resolved.kind,
          snappedEndpoint: resolved.kind === null ? null : endpoint,
        };
      });
    },
    [resolveEndpoint],
  );

  const onCancelDrag = useCallback(() => {
    setDrag((session) => (session === null || !session.isDragging ? session : null));
  }, []);

  /*
   * Đang kéo đoạn thì Esc luôn huỷ kéo, kể cả khi tiêu điểm ở "Chiều dài thật" (14-E-004, QD-004). Bộ phím tắt giữ luật
   * "một phím, một hành động" của phase 05 (ô nhập đã xử lý Esc thì không chuyển tiếp), nên màn tự nghe ở pha capture,
   * chỉ trong lúc kéo.
   */
  const isDragging = drag?.isDragging === true;

  /* UX-49: mở lại màn Tỷ lệ — vẽ lại đoạn đo đã xác nhận lần trước; chỉ cần sửa số. */
  const restoredFloorRef = useRef<string | null>(null);
  useEffect(() => {
    if (frame === null || restoredFloorRef.current === floorId) {
      return;
    }
    restoredFloorRef.current = floorId;
    const saved = readSavedSegment(floorId);
    if (saved === null || dragRef.current !== null) {
      return;
    }
    setMethod('referenceLine');
    setDrag({
      start: toPixelPoint(frame, saved.start),
      end: toPixelPoint(frame, saved.end),
      isDragging: false,
      isAxisLocked: false,
      snappedKind: null,
      snappedEndpoint: null,
      movingEndpoint: 'end',
      grabOffset: NO_GRAB_OFFSET,
    });
  }, [floorId, frame]);

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const cancelOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancelDrag();
      }
    };

    window.addEventListener('keydown', cancelOnEscape, { capture: true });

    return () => window.removeEventListener('keydown', cancelOnEscape, { capture: true });
  }, [isDragging, onCancelDrag]);

  const onNudgeEndpoint = useCallback(
    (endpoint: ReferenceLineEndpoint, direction: NudgeDirection, step: NudgeStep) => {
      const distance = NUDGE_PX[step];
      const acrossStep = direction === 'left' ? -distance : direction === 'right' ? distance : 0;
      const upStep = direction === 'up' ? -distance : direction === 'down' ? distance : 0;

      setNudgeTarget(endpoint);
      setDrag((session) => {
        if (session === null) {
          return session;
        }

        let moved: PixelPoint = {
          x: pixels(session[endpoint].x + acrossStep),
          y: pixels(session[endpoint].y + upStep),
        };
        const currentFrame = frameRef.current;

        // Nhích không được đẩy đầu đoạn ra ngoài ảnh (14-C-023): kẹp qua tỷ lệ 0..1 của khung.
        if (currentFrame !== null) {
          const ratio = toRatioPoint(currentFrame, moved);
          moved = toPixelPoint(currentFrame, {
            x: Math.min(1, Math.max(0, ratio.x)),
            y: Math.min(1, Math.max(0, ratio.y)),
          });
        }

        return { ...session, [endpoint]: moved, isDragging: false };
      });
    },
    [],
  );

  /** D1: chip đang chọn, gắn theo tầng. */
  const [pickedChip, setPickedChip] = useState<{ readonly floorId: string; readonly id: string } | null>(null);
  const dimensionChips = record?.dimensionChips ?? EMPTY_CHIPS;
  const chip =
    pickedChip?.floorId === floorId ? (dimensionChips.find((entry) => entry.id === pickedChip.id) ?? null) : null;

  const onPickDimensionChip = useCallback(
    (chipId: string) => {
      const target = dimensionChips.find((entry) => entry.id === chipId);
      const currentFrame = frameRef.current;
      const size = canvasSizeRef.current;

      if (target === undefined) {
        return;
      }

      setPickedChip({ floorId, id: chipId });
      setMethod('referenceLine');
      setRealLengthText(String(target.valueMm));

      if (currentFrame !== null && size.width > 0 && size.height > 0) {
        const min = toPixelPoint(currentFrame, target.box.min);
        const max = toPixelPoint(currentFrame, target.box.max);

        flyToBounds({ minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }, size.width, size.height);
      }
    },
    [dimensionChips, floorId, flyToBounds],
  );

  const onChangeRealLength = useCallback((text: string) => {
    setRealLengthText(text);
  }, []);

  const onConfirmRealLength = useCallback(() => {
    setDrag((session) => (session === null ? session : { ...session, isDragging: false }));
  }, []);

  const onRemeasure = useCallback(() => {
    setDrag(null);
    setRealLengthText('');
    setNudgeTarget('end');
  }, []);

  /**
   * UX41 U04: không có chuột vẫn đo được — đặt một đoạn ngang giữa ảnh (30 %..70 % bề ngang);
   * người dùng Tab tới tay cầm hai đầu, nhích bằng mũi tên cho khớp một kích thước, rồi nhập số.
   */
  const onPlaceSegment = useCallback(() => {
    const currentFrame = frameRef.current;

    if (currentFrame === null) {
      return;
    }

    setMethod('referenceLine');
    setSuggestionFloorId(null);
    setRatioEntry(null);
    setAreaEntry(null);
    setApplyOutcome(null);
    setNudgeTarget('end');
    setDrag({
      start: toPixelPoint(currentFrame, { x: 0.3, y: 0.5 }),
      end: toPixelPoint(currentFrame, { x: 0.7, y: 0.5 }),
      isDragging: false,
      isAxisLocked: false,
      snappedKind: null,
      snappedEndpoint: null,
      movingEndpoint: 'end',
      grabOffset: NO_GRAB_OFFSET,
    });
  }, []);

  const onPan = useCallback(
    (dx: number, dy: number) => {
      pan(dx, dy);
    },
    [pan],
  );

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const onZoom = useCallback(
    (nextZoom: number, focus: ImageRatioPoint | null) => {
      const currentFrame = frameRef.current;

      if (focus === null || currentFrame === null) {
        zoomTo(nextZoom);
        return;
      }

      // Con trỏ nằm ở đâu trên canvas: gốc khung nhìn cộng vị trí trên ảnh đã
      // phóng. Chỉ có phép nhân, và nó là phép biến đổi ngược của chính cách
      // canvas vẽ ảnh.
      const at = toPixelPoint(currentFrame, focus);
      const current = viewportRef.current;
      zoomTo(nextZoom, current.x + at.x * current.zoom, current.y + at.y * current.zoom);
    },
    [zoomTo],
  );

  /** Phóng quanh TÂM khung (pixel CSS của khung, cùng hệ với `viewport.x/y`). */
  const zoomAroundCentre = useCallback(
    (factor: number) => {
      const size = canvasSizeRef.current;
      zoomTo(viewportRef.current.zoom * factor, size.width / 2, size.height / 2);
    },
    [zoomTo],
  );

  const onZoomIn = useCallback(() => zoomAroundCentre(ZOOM_BUTTON_STEP), [zoomAroundCentre]);
  const onZoomOut = useCallback(() => zoomAroundCentre(1 / ZOOM_BUTTON_STEP), [zoomAroundCentre]);

  /** Về toàn cảnh: khung vuông khớp ảnh vuông ở `zoom` 1, gốc (0; 0) — không cần đo gì thêm. */
  const onFitView = useCallback(() => {
    const current = viewportRef.current;
    zoomTo(1);
    pan(-current.x, -current.y);
  }, [pan, zoomTo]);

  /** Bản đồ nhỏ báo vùng (phần trăm khung ảnh): gốc khung nhìn đi theo góc trên trái của vùng. */
  const onMiniMapViewportChange = useCallback(
    (rect: { readonly x: number; readonly y: number }) => {
      const current = viewportRef.current;
      const size = canvasSizeRef.current;
      pan(
        (-rect.x / FULL_PERCENT) * size.width * current.zoom - current.x,
        (-rect.y / FULL_PERCENT) * size.height * current.zoom - current.y,
      );
    },
    [pan],
  );

  const onMoveCursor = useCallback((point: ImageRatioPoint | null) => {
    // `null` giữ nguyên điểm cuối cùng biết được: thanh trạng thái nói toạ độ
    // con trỏ vừa rời khỏi, không nháy về gốc toạ độ.
    setCursorPoint((previous) => point ?? previous);
  }, []);

  /** UX-R2: dùng tỷ lệ máy ước từ độ dày tường làm đề nghị; người dùng vẫn phải bấm Xác nhận tỷ lệ. */
  const onUseSuggestedScale = useCallback(() => {
    setSuggestionFloorId(floorId);
    setRatioEntry(null);
    setAreaEntry(null);
    setDrag(null);
  }, [floorId]);

  /** UX41 U01: gõ tỷ lệ ghi trên bản vẽ ("1:100"); chỉ có ô này khi N16 mang `sourceDpi`. */
  const onChangeDrawingRatio = useCallback(
    (text: string) => {
      setRatioEntry({ floorId, text });
      setAreaEntry(null);
      setSizeEntry(null);
      setApplyOutcome(null);
    },
    [floorId],
  );

  /** UX-R4 U11: gõ diện tích căn (m²); ô 1:N bị xoá để chỉ một nguồn tỷ lệ. */
  const onChangeFlatArea = useCallback(
    (text: string) => {
      setAreaEntry({ floorId, text });
      setRatioEntry(null);
      setSizeEntry(null);
      setSuggestionFloorId(null);
      setApplyOutcome(null);
    },
    [floorId],
  );

  /** D1: sửa một phần ô rộng × dài; các ô tỷ lệ khác bị xoá để chỉ một nguồn. */
  const onChangeFlatSize = useCallback(
    (patch: Partial<FlatSizeEntryState>) => {
      setSizeEntry((current) => ({
        ...(current?.floorId === floorId ? current : EMPTY_SIZE_ENTRY),
        ...patch,
        floorId,
      }));
      setRatioEntry(null);
      setAreaEntry(null);
      setSuggestionFloorId(null);
      setApplyOutcome(null);
    },
    [floorId],
  );

  const onChangeApplyScope = useCallback((scope: ScaleApplyScope) => {
    setApplyScope(scope);
  }, []);

  const onToggleCollapsed = useCallback(() => {
    setIsCollapsedByUser((collapsed) => !collapsed);
  }, []);

  const onGoToPreprocessing = useCallback(() => {
    navigate(ROUTES.project.quality(projectId));
  }, [navigate, projectId]);

  const onRetry = useCallback(() => {
    void query.refetch();
  }, [query]);

  const onGoToUpload = useCallback(() => {
    navigate(ROUTES.project.upload(projectId));
  }, [navigate, projectId]);

  const onGoToViewer3d = useCallback(() => {
    navigate(ROUTES.project.viewer(projectId));
  }, [navigate, projectId]);

  const onCanvasSizeChange = useCallback((widthPx: number, heightPx: number) => {
    setCanvasSize((size) =>
      size.width === widthPx && size.height === heightPx
        ? size
        : { width: widthPx, height: heightPx },
    );
  }, []);

  /**
   * Áp tỷ lệ (F-04x-2 bước 5): `saveScale` của bộ lưu lớp chung TRƯỚC, rồi một
   * `commit` vào `Level` khi máy chủ đã nhận — hoàn tác chạy qua zundo và toast A8
   * như cũ. "Áp cho mọi tầng" hỏi trước bằng hộp thoại A9.
   */
  const proposedRatioRef = useRef(proposedRatio);
  proposedRatioRef.current = proposedRatio;

  /** UX41 U34: cỡ căn vô lý thì lần bấm đầu chỉ hỏi lại; bấm lần nữa với cùng tỷ lệ mới lưu. */
  const hasPlanSizeWarningRef = useRef(false);
  const planSizeAcknowledgedRef = useRef<number | null>(null);

  /** Ctrl+Z bấm khi lượt áp còn đang gửi (BUG-725) — `commitSaved` hoàn tác chính lượt ấy. */
  const undoWhileApplyingRef = useRef(false);

  /**
   * Đã gửi xong: ghi tỷ lệ vào kho bằng MỘT `commit` (một bước hoàn tác, toast A8) cho
   * những tầng máy chủ đã nhận. Mốc của nhánh hoàn tác đặt TRƯỚC `commit`, để lượt
   * `handleSave` mà chính `commit` này hẹn không gửi lại tỷ lệ vừa lưu.
   */
  const queryClient = useQueryClient();
  const commitSaved = useCallback((levelIds: readonly string[], ratio: MillimetresPerPixel) => {
    // N2-03/N2-09: QC screens read `scaleStatus` from the layer query; refresh it so the provisional
    // banner and room areas update right after the save.
    // refetchType 'none': mark stale only, so this screen's own layer query does not refetch mid-undo.
    void queryClient.invalidateQueries({ queryKey: queryKeys.layer.byFloor.root(), refetchType: 'none' });
    /*
     * UX41 U38: 'none' để N16 trong cache vẫn nói `unresolved` với revision cũ, còn kho đã có revision mới
     * không `scaleStatus` → `floorScaleKeysOf` trả "chưa đọc" và vòng Tỷ lệ của thanh bước rỗng tới lần
     * đọc lại. Máy chủ đã nhận tỷ lệ: ghi thẳng điều đó vào cache. Chỉ tầng kho đang giữ — tầng khác
     * chưa có hình trong kho, để lượt đọc lại (đã đánh dấu cũ ở trên) mang hình theo tỷ lệ mới.
     */
    const stored = useStore.getState();

    for (const id of levelIds) {
      const revision = stored.floorMeta[id]?.revision;

      if (revision === undefined || stored.spatial?.byId[id] === undefined) {
        continue;
      }

      queryClient.setQueryData<FloorLayerDocument>(queryKeys.layer.byFloor(projectIdRef.current, id), (document) =>
        document === undefined ? document : confirmedLayerDocument(document, revision),
      );
    }
    const spatial = useStore.getState().spatial;
    const marks = ratioMarksFor(projectIdRef.current);
    const patches: SpatialPatch[] = [];

    for (const id of levelIds) {
      const level = levelIn(spatial, id);

      if (level !== null) {
        marks.saved.set(id, ratio);
        patches.push({ op: 'update', kind: 'level', id: level.id, changes: { scaleMillimetresPerPixel: ratio } });
      }
    }

    const undoRequested = undoWhileApplyingRef.current;
    undoWhileApplyingRef.current = false;

    if (patches.length > 0) {
      const { undo } = commit(patches, COPY.applyCommitLabel);

      // BUG-725: Ctrl+Z pressed while this apply was in flight undoes THIS apply; the undo's autosave sends the
      // compensating PUT, so screen and server agree.
      if (undoRequested) {
        undo();
        return;
      }

      // A8: the toast "Hoàn tác" of the real route tree is `NotificationHost` (main.tsx), which draws the session
      // bus only; `Toast.Provider`'s `useUndoableToast` bridge is not mounted there (14-A-026), so publish it here.
      appNotificationBus.publish({
        type: 'scale-applied',
        title: appliedToastTitle(formatScaleDensity(ratio), patches.length),
        description: '',
        undoTicket: createUndoTicket({ description: COPY.applyCommitLabel, undo }),
      });
    }
  }, [queryClient]);

  /** Ghi nhớ tỷ lệ tạm của tầng trước khi gửi — hoàn tác về nó thì nói câu của bước 5. */
  const rememberProvisional = useCallback((id: string) => {
    const ratio = levelIn(useStore.getState().spatial, id)?.scaleMillimetresPerPixel;

    if (useStore.getState().floorMeta[id]?.scaleStatus === 'unresolved' && ratio !== undefined) {
      ratioMarksFor(projectIdRef.current).provisionalBefore.set(id, ratio);
    }
  }, []);

  const effectiveApplyScope: ScaleApplyScope = separateUnits ? 'thisFloor' : applyScope;
  const applyScopeRef = useRef(effectiveApplyScope);
  applyScopeRef.current = effectiveApplyScope;

  /** "Áp": PUT trước, `commit` sau — kho chỉ đổi tỷ lệ khi máy chủ đã nhận (A5). */
  const onApply = useCallback(() => {
    const ratio = proposedRatioRef.current;

    if (ratio === null) {
      return;
    }

    if (hasPlanSizeWarningRef.current && planSizeAcknowledgedRef.current !== ratio) {
      planSizeAcknowledgedRef.current = ratio;
      setApplyNotice(PLAN_SIZE_CONFIRM_AGAIN);
      return;
    }

    // `levelId` là mã `Level` N16 trả cho mã tầng của route. Không có tầng đó trong
    // kho thì không có gì để vá — nói lý do tại chỗ thay vì im lặng (B-V5-01).
    if (levelIn(useStore.getState().spatial, levelId) === null) {
      setApplyNotice(COPY.applyNoSpatial);
      return;
    }

    setApplyNotice(null);
    undoWhileApplyingRef.current = false;
    setApplying(true);

    if (applyScopeRef.current === 'allFloors') {
      void gateway.readAllFloors({ projectId }).then(
        (targets) => {
          setAllFloors({ ratio, targets, changes: allFloorsChanges(targets, ratio) });
          setApplying(false);
        },
        () => {
          setApplyNotice(COPY.allFloorsReadFailed);
          setApplying(false);
        },
      );
      return;
    }

    rememberProvisional(levelId);
    void saveScale(levelId, ratio).then(
      () => {
        setScaleConflict(false);
        setOfflinePending(false);
        commitSaved([levelId], ratio);
        const session = dragRef.current;
        const savedFrame = frameRef.current;
        if (session !== null && savedFrame !== null) {
          writeSavedSegment(floorId, {
            start: toRatioPoint(savedFrame, session.start),
            end: toRatioPoint(savedFrame, session.end),
          });
        }
        setApplyOutcome('success');
        setApplying(false);
      },
      (error: unknown) => {
        const kind = toAppError(error).kind;
        setScaleConflict(kind === 'conflict');
        setApplyOutcome('failed');
        setOfflinePending(kind === 'network');
        setApplyNotice(kind === 'network' ? COPY.applyOffline : failureText(error));
        setApplying(false);
      },
    );
  }, [commitSaved, floorId, gateway, levelId, projectId, rememberProvisional, saveScale]);

  /* UX41 U56: lượt áp hỏng vì mất mạng — có mạng lại thì gửi lại đúng lượt ấy, một lần. */
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  useEffect(() => {
    if (!isOfflinePending) {
      return undefined;
    }

    const resend = (): void => {
      setOfflinePending(false);
      onApplyRef.current();
    };

    window.addEventListener('online', resend);

    return () => window.removeEventListener('online', resend);
  }, [isOfflinePending]);

  const onCancelAllFloors = useCallback(() => {
    setAllFloors(null);
  }, []);

  /**
   * Gửi NỐI TIẾP một tỷ lệ cho các tầng (đã lọc có bản vẽ), `hint` = `revision` N15 của tầng. Tầng hỏng
   * vì mất mạng được giữ lại để tự gửi lại khi có mạng (UX41 U56).
   */
  const sendAllFloors = useCallback(
    (ratio: MillimetresPerPixel, targets: readonly ScaleFloorTarget[], skipped: readonly string[]) => {
      undoWhileApplyingRef.current = false;
      setApplying(true);

      void (async () => {
        const saved: ScaleFloorTarget[] = [];
        const failed: string[] = [];
        const blocked: string[] = [];
        const offline: ScaleFloorTarget[] = [];

        for (const target of targets) {
          if (isFloorBlocked(target.floorId)) {
            blocked.push(target.name);
            continue;
          }

          rememberProvisional(target.floorId);

          try {
            await saveScale(target.floorId, ratio, target.revision);
            saved.push(target);
          } catch (error: unknown) {
            failed.push(target.name);

            if (toAppError(error).kind === 'network') {
              offline.push(target);
            }
          }
        }

        commitSaved(
          saved.map((target) => target.floorId),
          ratio,
        );
        setOfflineFloors(offline.length > 0 ? { ratio, targets: offline } : null);
        setApplyOutcome(saved.length > 0 && failed.length === 0 && blocked.length === 0 ? 'success' : 'failed');
        setApplyNotice(
          [
            allFloorsReport({ saved: saved.map((target) => target.name), failed, blocked, skipped }),
            offline.length > 0 ? COPY.allFloorsOffline : '',
          ]
            .filter((sentence) => sentence !== '')
            .join(' ') || null,
        );
        setApplying(false);
      })();
    },
    [commitSaved, isFloorBlocked, rememberProvisional, saveScale],
  );

  /** Đồng ý A9: gửi cho từng tầng có bản vẽ. */
  const onConfirmAllFloors = useCallback(() => {
    if (allFloors === null) {
      return;
    }

    const { ratio, targets } = allFloors;

    setAllFloors(null);
    sendAllFloors(
      ratio,
      targets.filter((entry) => entry.hasDrawing),
      targets.filter((entry) => !entry.hasDrawing).map((entry) => entry.name),
    );
  }, [allFloors, sendAllFloors]);

  /* UX41 U56: "áp mọi tầng" hỏng vì mất mạng — có mạng lại thì gửi lại các tầng ấy, một lần. */
  useEffect(() => {
    if (offlineFloors === null) {
      return undefined;
    }

    const resend = (): void => {
      setOfflineFloors(null);
      sendAllFloors(offlineFloors.ratio, offlineFloors.targets, []);
    };

    window.addEventListener('online', resend);

    return () => window.removeEventListener('online', resend);
  }, [offlineFloors, sendAllFloors]);

  /* ---------------------------------------------------------------------- */
  /* Phím tắt (I-01) — không một `addEventListener` nào ở đây (R-72).        */
  /* ---------------------------------------------------------------------- */

  const nudgeTargetRef = useRef(nudgeTarget);
  nudgeTargetRef.current = nudgeTarget;

  const nudge = useCallback(
    (direction: NudgeDirection, step: NudgeStep) => {
      onNudgeEndpoint(nudgeTargetRef.current, direction, step);
    },
    [onNudgeEndpoint],
  );

  useShortcut({
    id: 'scaleCalibration.cancelDrag',
    combo: 'Escape',
    scope: 'canvas',
    description: COPY.shortcutCancelDrag,
    onTrigger: onCancelDrag,
  });
  // BUG-725: while an apply is in flight, Ctrl+Z belongs to that apply (canvas scope outranks `global.undo`, which
  // would otherwise undo an older step and leave screen and server on different ratios).
  useShortcut(
    {
      id: 'scaleCalibration.undoApplying',
      combo: 'Ctrl+Z',
      scope: 'canvas',
      description: COPY.shortcutUndoApplying,
      onTrigger: () => {
        undoWhileApplyingRef.current = true;
      },
    },
    { enabled: isApplying },
  );
  useShortcut({
    id: 'scaleCalibration.remeasure',
    combo: 'R',
    scope: 'canvas',
    description: COPY.shortcutRemeasure,
    onTrigger: onRemeasure,
  });
  useShortcut({
    id: 'scaleCalibration.fitView',
    combo: 'F',
    scope: 'canvas',
    description: COPY.shortcutFitView,
    onTrigger: onFitView,
  });
  useShortcut({
    id: 'scaleCalibration.confirm',
    combo: 'Enter',
    scope: 'canvas',
    description: COPY.shortcutConfirm,
    onTrigger: onConfirmRealLength,
  });
  useShortcut({
    id: 'scaleCalibration.nudgeUp',
    combo: 'ArrowUp',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeFine,
    onTrigger: () => {
      nudge('up', 'fine');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeDown',
    combo: 'ArrowDown',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeFine,
    onTrigger: () => {
      nudge('down', 'fine');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeLeft',
    combo: 'ArrowLeft',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeFine,
    onTrigger: () => {
      nudge('left', 'fine');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeRight',
    combo: 'ArrowRight',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeFine,
    onTrigger: () => {
      nudge('right', 'fine');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeUpCoarse',
    combo: 'Shift+ArrowUp',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeCoarse,
    onTrigger: () => {
      nudge('up', 'coarse');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeDownCoarse',
    combo: 'Shift+ArrowDown',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeCoarse,
    onTrigger: () => {
      nudge('down', 'coarse');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeLeftCoarse',
    combo: 'Shift+ArrowLeft',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeCoarse,
    onTrigger: () => {
      nudge('left', 'coarse');
    },
  });
  useShortcut({
    id: 'scaleCalibration.nudgeRightCoarse',
    combo: 'Shift+ArrowRight',
    scope: 'canvas',
    allowRepeat: true,
    description: COPY.shortcutNudgeCoarse,
    onTrigger: () => {
      nudge('right', 'coarse');
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Hàng chuỗi kích thước.                                                  */
  /* ---------------------------------------------------------------------- */

  const rows = useMemo<readonly DimensionStringRow[]>(
    () =>
      rawRows.map((row) => {
        const isLowConfidence = row.confidence < confidenceThreshold;

        return {
          id: row.id,
          pixelLength: row.pixelLength,
          realLength: row.realLength,
          confidence: row.confidence,
          isLowConfidence,
          boundingBox: row.boundingBox,
          valueLabel: formatNumber(row.realLength),
          pixelLengthLabel: pixelLabel(row.pixelLength),
          // A5: đây là đầu ra của AI, nên không bao giờ mang màu "đã xác minh".
          statusCode: isLowConfidence ? 'attention' : 'neutral',
        };
      }),
    [confidenceThreshold, rawRows],
  );

  const lowConfidenceCount = rows.filter((row) => row.isLowConfidence).length;

  /* ---------------------------------------------------------------------- */
  /* Cảnh báo — cả hai CHỈ cảnh báo, không hạ `canApply`.                    */
  /* ---------------------------------------------------------------------- */

  const warnings = useMemo<readonly ScaleWarningNotice[]>(() => {
    // UX-09: tỷ lệ đã xác nhận mà cỡ căn vô lý vẫn phải nhắc — không chỉ lúc đang đề nghị.
    const checkRatio = proposedRatio ?? storedRatio;

    if (checkRatio === null) {
      return [];
    }

    const notices: ScaleWarningNotice[] = [];
    const referenceWallWidthPx = record?.referenceWallWidthPx ?? null;

    if (proposedRatio !== null && referenceWallWidthPx !== null) {
      const implied = inferWallThicknessFromScale(proposedRatio, referenceWallWidthPx);
      const rangeStatus = classifyScaleRange(proposedRatio);

      if (implied.implausible || rangeStatus !== 'inRange') {
        const warning: ScaleWarning = {
          kind: 'implausible',
          proposed: proposedRatio,
          impliedWallThickness: implied.thicknessMm,
        };
        notices.push({
          warning,
          message: implausibleMessage(formatLength(implied.thicknessMm)),
          statusCode: 'attention',
        });
      }
    }

    if (proposedRatio !== null && aiSuggestion !== null) {
      const deviation = compareScaleToAiEstimate(proposedRatio, aiSuggestion);

      if (deviation.exceedsLimit) {
        const warning: ScaleWarning = {
          kind: 'deviatesFromEstimate',
          proposed: proposedRatio,
          estimated: aiSuggestion,
          // Bất biến của `types.ts`: `0..1`. Dấu của lệch nằm trong CÂU, chỗ nó
          // nói được điều gì, chứ không nằm trong con số đo độ lớn.
          relativeDifference: Math.abs(deviation.relativeDeviation),
        };
        notices.push({
          warning,
          message: deviationMessage(
            signedPercentLabel(deviation.relativeDeviation),
            formatScaleDensity(aiSuggestion),
          ),
          statusCode: 'attention',
        });
      }
    }

    const planSize = planSizeAt(layerDocument, checkRatio);
    const built = layerDocument?.level.scaleMillimetresPerPixel;
    const flatAreaM2 =
      builtAreaM2 === null || built === undefined || built <= 0 ? null : builtAreaM2 * (checkRatio / built) ** 2;

    if (
      planSize !== null &&
      (isPlanSizeImplausible(planSize, TINY_FOOTPRINT_MM, HUGE_FOOTPRINT_MM) || isFlatAreaImplausible(flatAreaM2))
    ) {
      notices.push({
        warning: { kind: 'implausiblePlanSize', proposed: checkRatio, ...planSize },
        message: planSizeMessage(planSizeText(planSize)),
        statusCode: 'attention',
      });
    }

    return notices;
  }, [aiSuggestion, builtAreaM2, layerDocument, proposedRatio, record?.referenceWallWidthPx, storedRatio]);
  hasPlanSizeWarningRef.current = warnings.some((notice) => notice.warning.kind === 'implausiblePlanSize');

  /* ---------------------------------------------------------------------- */
  /* Ba dòng kiểm chứng — luôn đủ ba.                                        */
  /* ---------------------------------------------------------------------- */

  const crossChecks = useMemo<readonly ScaleCrossCheckRow[]>(() => {
    const ratio = workingRatio;
    const scale = ratio === null ? null : scaleFromRatio(ratio);
    const wallWidthPx = record?.referenceWallWidthPx ?? null;
    const doorWidthPx = record?.typicalDoorWidthPx ?? null;
    const roomBoxPx = record?.largestRoomBoxPx ?? null;

    const wallThickness =
      ratio === null || wallWidthPx === null
        ? null
        : inferWallThicknessFromScale(ratio, wallWidthPx).thicknessMm;
    const doorWidth = scale === null || doorWidthPx === null ? null : scale.pixelsToMillimetres(doorWidthPx);
    const roomArea =
      scale === null || roomBoxPx === null
        ? null
        : rectangleArea(
            scale.pixelsToMillimetres(roomBoxPx.widthPx),
            scale.pixelsToMillimetres(roomBoxPx.heightPx),
          );

    return [
      {
        id: 'wallThickness',
        label: COPY.crossCheckWallThickness,
        valueLabel: millimetreLabel(wallThickness),
        expectedRangeLabel: expectedRange(
          formatLength(MIN_WALL_THICKNESS_MM, { unit: 'mm' }),
          formatLength(MAX_WALL_THICKNESS_MM, { unit: 'mm' }),
        ),
        statusCode:
          wallThickness !== null &&
          (wallThickness < MIN_WALL_THICKNESS_MM || wallThickness > MAX_WALL_THICKNESS_MM)
            ? 'attention'
            : 'neutral',
      },
      {
        id: 'doorWidth',
        label: COPY.crossCheckDoorWidth,
        valueLabel: millimetreLabel(doorWidth),
        // Sổ luật chỉ có mức tối thiểu cho cửa đi, nên khoảng chỉ có một đầu và
        // câu chữ nói đúng như vậy — không bịa một biên trên không tồn tại.
        expectedRangeLabel: expectedRangeFrom(formatLength(MIN_DOOR_WIDTH_MM, { unit: 'mm' })),
        statusCode: doorWidth !== null && isDoorWidthOdd(doorWidth) ? 'attention' : 'neutral',
        ...(doorWidth !== null && isDoorWidthOdd(doorWidth)
          ? { warning: COPY.doorWidthOdd(formatLength(millimetres(Math.round(doorWidth)), { unit: 'mm' })) }
          : {}),
      },
      {
        id: 'largestRoomArea',
        label: COPY.crossCheckLargestRoomArea,
        valueLabel: roomArea === null ? MISSING_VALUE : formatArea(roomArea),
        expectedRangeLabel: expectedRangeFrom(formatArea(SMALLEST_ROOM_MINIMUM_M2)),
        statusCode:
          roomArea !== null && roomArea < SMALLEST_ROOM_MINIMUM_M2 ? 'attention' : 'neutral',
      },
    ];
  }, [
    record?.largestRoomBoxPx,
    record?.referenceWallWidthPx,
    record?.typicalDoorWidthPx,
    workingRatio,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Bảy trạng thái.                                                         */
  /* ---------------------------------------------------------------------- */

  const canEdit = can('edit', 'layer', { roles });
  useShortcut(
    {
      id: 'scaleCalibration.placeSegment',
      combo: 'N',
      scope: 'canvas',
      description: COPY.shortcutPlaceSegment,
      onTrigger: onPlaceSegment,
    },
    { enabled: canEdit && drag === null },
  );
  const isCompact = detectedNarrow;
  const isPanelCollapsed = options.forceCollapsed ?? isCollapsedByUser;
  // Tỷ lệ ước từ độ dày tường không có phép chia nào để bày ra.
  const isComputationComplete = numerator !== null && denominator !== null && !isSuggestionActive;
  // Mốc máy chọn sẵn chưa phải việc người dùng làm (UX-R2 K05).
  const hasStartedWork = drag !== null || pickedRowId !== null || isSuggestionActive || typedRatio !== null;

  const state = useMemo<ScaleCalibrationState>(() => {
    if (query.isPending) {
      return 'loading';
    }

    if (query.isError) {
      return 'error';
    }

    // Vai xem không sửa được tỷ lệ dù ảnh méo: câu "không có quyền" đứng trước lời nhắc méo (G44, R-06).
    if (!canEdit) {
      return 'forbidden';
    }

    // Không tìm thấy khung chỉ là cảnh báo của BE (FRAME_NOT_FOUND, mức attention): người dùng vẫn
    // đo và áp được. Áp xong thì lời nhắc "có thể méo" nhường chỗ cho câu thành công (BUG-567).
    if (drawing?.isWarped === true && applyOutcome !== 'success') {
      return 'error';
    }

    if (!canEdit) {
      return 'forbidden';
    }

    if (isPanelCollapsed) {
      return 'collapsed';
    }

    if (applyOutcome === 'success') {
      return 'success';
    }

    if (hasStartedWork || lowConfidenceCount > 0 || applyOutcome === 'failed') {
      return 'partial';
    }

    if (rows.length === 0) {
      return 'empty';
    }

    return 'partial';
  }, [
    canEdit,
    applyOutcome,
    drawing?.isWarped,
    hasStartedWork,
    isPanelCollapsed,
    lowConfidenceCount,
    query.isError,
    query.isPending,
    rows.length,
  ]);

  /* 404 dự án/tầng (người ngoài dự án, tầng đã xoá): cả màn là một lối ra, không "Mã lỗi: NOT_FOUND" (G45). */
  const floorLayerFailure = useFloorLayerReadFailure(floorLayer, projectId, navigate);
  const readFailure = readWireError(floorLayer.error)?.status === 404 ? floorLayerFailure : null;

  const errorDescription = useMemo(() => {
    if (state !== 'error') {
      return null;
    }

    if (query.isError) {
      const wire = readWireError(query.error);

      // Tầng chưa có bản vẽ: BE trả 404 `upload` (cùng khuôn `useInputQualityGate`). Nói đúng
      // nguyên nhân và không kèm mã máy — "Không tìm thấy… NOT_FOUND" đổ lỗi sai chỗ (BUG-337).
      if (wire?.status === 404 && wire.resource === 'upload') {
        return { title: COPY.noDrawingTitle, description: COPY.noDrawingNotice, code: null, isNoDrawing: true };
      }

      const appError = toAppError(query.error);
      return { ...describeError(appError), code: appError.code };
    }

    // Nắn ảnh hỏng không phải lỗi mạng và không có mã máy nào: "Mã lỗi: UNKNOWN" chỉ là
    // nhiễu (BUG-341). Tiêu đề do view đặt (`errorTitle` vắng ở nhánh này).
    return { title: undefined, description: COPY.warpingNotice, code: null };
  }, [query.error, query.isError, state]);
  const isNoDrawing = errorDescription !== null && 'isNoDrawing' in errorDescription;

  const errorCode = errorDescription?.code ?? null;

  /* ---------------------------------------------------------------------- */
  /* Chạy số 260 ms cho nhãn tỷ lệ sau khi áp (C2).                          */
  /* ---------------------------------------------------------------------- */

  // G4b-13: "Tỷ lệ hiện tại" and the status bar show only the SAVED ratio; the proposal stays in step 3 until applied.
  const displayRatio = storedRatio;
  const countedScale = useCountUp(displayRatio ?? 0, { reducedMotion: prefersReducedMotion });
  const currentScaleLabel =
    displayRatio === null
      ? COPY.currentScaleUnknown
      : formatScaleDensity(countedScale.done ? displayRatio : countedScale.value);

  /* ---------------------------------------------------------------------- */
  /* Viewmodel.                                                              */
  /* ---------------------------------------------------------------------- */

  const shortEdgePx =
    frame === null ? null : Math.min(frame.widthPx, frame.heightPx);

  const scaleRatioLabel =
    displayRatio === null || shortEdgePx === null
      ? MISSING_VALUE
      : formatDrawingScaleRatio(displayRatio, shortEdgePx);

  const scaleDensityLabel =
    displayRatio === null ? MISSING_VALUE : formatScaleDensity(displayRatio);

  const draftForView = useMemo<ReferenceLineDraft | null>(() => {
    if (drag === null || frame === null) {
      return null;
    }

    return {
      start: toRatioPoint(frame, drag.start),
      end: toRatioPoint(frame, drag.end),
      pixelLength: segmentPixelLength(drag.start, drag.end),
      snappedKind: drag.snappedKind,
      snappedEndpoint: drag.snappedEndpoint,
      isDragging: drag.isDragging,
      isAxisLocked: drag.isAxisLocked,
    };
  }, [drag, frame]);

  const computation = useMemo<ScaleComputationViewModel>(
    () => ({
      numeratorLabel: millimetreLabel(numerator),
      denominatorLabel: pixelLabel(denominator),
      resultLabel: proposedRatio === null ? MISSING_VALUE : formatScaleDensity(proposedRatio),
      isComplete: isComputationComplete,
    }),
    [denominator, isComputationComplete, numerator, proposedRatio],
  );

  const methodOptions = useMemo<readonly ScaleMethodOption[]>(
    () => [
      {
        value: 'dimensionString',
        label: COPY.methodDimensionString,
        isDisabled: rows.length === 0,
      },
      { value: 'referenceLine', label: COPY.methodReferenceLine, isDisabled: false },
    ],
    [rows.length],
  );

  const applyScopeOptions = useMemo<readonly ScaleApplyScopeOption[]>(
    () => [
      ...(separateUnits ? [] : [{ value: 'allFloors', label: COPY.scopeAllFloors } as const]),
      { value: 'thisFloor', label: COPY.scopeThisFloor },
    ],
    [separateUnits],
  );

  const shortcutHints = useMemo<readonly ScaleShortcutHint[]>(() => {
    const pressed = (
      [
        ['scaleCalibration.placeSegment', 'N', COPY.shortcutPlaceSegment],
        ['scaleCalibration.cancelDrag', 'Escape', COPY.shortcutCancelDrag],
        ['scaleCalibration.remeasure', 'R', COPY.shortcutRemeasure],
        ['scaleCalibration.confirm', 'Enter', COPY.shortcutConfirm],
        ['scaleCalibration.nudgeFine', 'ArrowLeft', COPY.shortcutNudgeFine],
        ['scaleCalibration.nudgeCoarse', 'Shift+ArrowLeft', COPY.shortcutNudgeCoarse],
      ] as const
    ).map(([id, combo, description]) => ({
      id,
      // Mặt phím người ta bấm ("Esc", "←"), không phải cách registry lưu ("ESCAPE") — BUG-085.
      comboLabel: keyCapLabels(formatCombo(parseCombo(combo))).join(' + '),
      description,
    }));

    // Shift khoá theo trục là một phím GIỮ, không phải một tổ hợp: `parseCombo`
    // từ chối nó vì nó không có phím chính, và `shortcutRegistry` không bao giờ
    // gọi một binding như vậy. Nhãn của nó lấy từ bảng `MODIFIER_SHORTCUTS` —
    // nơi repo đã đặt tên cho đúng phím ấy — chứ không gõ lại.
    const axisLock = MODIFIER_SHORTCUTS.find((entry) => entry.modifier === 'lockAxis');

    return axisLock === undefined
      ? pressed
      : [
          ...pressed,
          {
            id: 'scaleCalibration.axisLock',
            comboLabel: axisLock.keyLabel,
            description: COPY.shortcutAxisLock,
          },
        ];
  }, []);

  const activeStep: ScaleReferenceStep =
    draftForView === null ? 'draw' : isComputationComplete ? 'result' : 'enterLength';

  /*
   * UX-R2 K29: chỉ gợi ý một số cụ thể khi đoạn vừa kéo trùng hai đầu một số máy đã đọc.
   * ponytail: so hai đầu với hai góc hộp bao (kích thước luôn ngang/dọc), sai số 2% khung.
   */
  const nearestOcrValue = useMemo(() => {
    if (draftForView === null) {
      return null;
    }

    const near = (a: ImageRatioPoint, b: ImageRatioPoint): boolean =>
      Math.abs(a.x - b.x) <= OCR_END_TOLERANCE && Math.abs(a.y - b.y) <= OCR_END_TOLERANCE;
    const { start, end } = draftForView;
    const match = rawRows.find(
      ({ boundingBox: { min, max } }) =>
        (near(start, min) && near(end, max)) || (near(start, max) && near(end, min)),
    );

    return match?.realLength ?? null;
  }, [draftForView, rawRows]);

  const isEmptyState = state === 'empty';
  // K12: máy không đo được tỷ lệ (`project_default`) thì câu đỏ — đúng màn người dùng phải đặt tỷ lệ.
  const provisionalNotice = provisionalScaleNoticeOf(floorLayer.scaleStatus, floorLayer.scaleSource);
  const effectiveMethod: ScaleCalibrationMethod = rows.length === 0 ? 'referenceLine' : method;

  const cursorPixels = useMemo<PixelPoint>(() => {
    if (frame === null || cursorPoint === null) {
      return { x: pixels(0), y: pixels(0) };
    }

    return toPixelPoint(frame, cursorPoint);
  }, [cursorPoint, frame]);

  const model = useMemo<ScaleCalibrationViewModel>(() => {
    const canApply = proposedRatio !== null;
    const oneDecimal = (ratio: number): string => formatNumber(ratio, { maxFractionDigits: 1 });
    const sizeSuffix = (ratio: number): string => {
      const size = planSizeAt(layerDocument, ratio);
      return size === null ? '' : ` (căn ${planSizeText(size)})`;
    };
    /* UX-02: tỷ lệ máy đặt từ ghi chú "TL 1:N" của PDF (khớp đúng 1:N ở DPI nguồn). */
    const noteRatio = noteRatioOf(pipelineRatio, sourceDpi);
    /* UX-02: máy chọn sẵn mốc từ chuỗi kích thước, người dùng chưa chạm gì. */
    const isRowProposal = !hasStartedWork && applyOutcome === null && selectedRow !== null;
    const isMachineProposal = canApply && (isAutoSuggestion || isRowProposal);

    return {
      state,
      canvas: {
        imageUrl: state === 'loading' ? null : (drawing?.imageUrl ?? null),
        altText:
          drawing === null ? COPY.canvasAltEmpty : `${COPY.canvasAltPrefix}${drawing.floorName}`,
        viewport,
        dimensionRows: rows,
        highlightedRowId,
        selectedRowId,
        focusBox: chip?.box ?? rows.find((row) => row.id === selectedRowId)?.boundingBox ?? null,
        referenceLine: draftForView,
        liveLengthLabel:
          draftForView === null || !draftForView.isDragging
            ? null
            : pixelLabel(draftForView.pixelLength),
        // Theo vai, không theo trạng thái: tầng lỗi/chưa bản vẽ đứng trước `forbidden` (BUG-601).
        isInteractive: canEdit,
        isImageLoading: state === 'loading',
        zoomPercent: Math.round(viewport.zoom * FULL_PERCENT),
        miniMapViewport: miniMapViewportOf(viewport, canvasSize),
      },
      panel: {
        currentScaleLabel,
        derivedLine:
          displayRatio === null
            ? provisionalRatio === null
              ? COPY.derivedLineUnknown
              : COPY.derivedLineProvisional(formatScaleDensity(provisionalRatio))
            : derivedLine(
                formatLength(millimetres(displayRatio), { unit: 'mm' }),
                scaleRatioLabel,
              ),
        method: effectiveMethod,
        methodOptions,
        // Banner trống đã nói "không đọc được kích thước": không nhắc lại ở khối phương pháp.
        methodNotice: null,
        dimension: {
          rows,
          selectedRowId,
          emptyNotice: rows.length === 0 ? COPY.dimensionEmpty : null,
          lowConfidenceNotice:
            lowConfidenceCount === 0 ? null : lowConfidenceNotice(formatNumber(lowConfidenceCount)),
          // UX-R2 K05: đã có mốc đang dùng thì "phải đặt bằng tay" là câu sai.
          // UX-50: vừa xác nhận xong thì câu "phải đặt bằng tay" mâu thuẫn với dòng "Lệch 0 mm".
          manualCalibrationReason:
            selectedRow === null &&
            state !== 'success' &&
            applyOutcome !== 'success' &&
            aiInference !== null &&
            aiInference.status === 'needsManualCalibration'
              ? aiInference.reason
              : null,
        },
        reference: {
          draft: draftForView,
          activeStep,
          livePixelLengthLabel:
            draftForView === null ? null : pixelLabel(draftForView.pixelLength),
          realLengthText,
          realLengthPlaceholder: COPY.realLengthPlaceholder,
          realLengthError:
            realLengthText.trim() !== '' && (typedLength === null || typedLength <= 0)
              ? COPY.realLengthInvalid
              : null,
          realLengthHint:
            nearestOcrValue === null ? null : realLengthHint(formatNumber(nearestOcrValue)),
          resultLabel: proposedRatio === null ? null : formatScaleDensity(proposedRatio),
          // Cùng một cảnh báo với khối dưới, đặt cạnh ô nhập: nó hiện NGAY KHI
          // GÕ vì `realLengthText` là thứ nuôi `proposedRatio`, không đợi rời ô.
          inlineWarning: warnings[0] ?? null,
          chips: dimensionChips.map((entry) => ({ id: entry.id, label: entry.text, isSelected: entry.id === chip?.id })),
          chipNotice:
            dimensionChips.length === 0 ? COPY.chipsNone : chip === null ? null : COPY.chipDragHint(chip.text),
          liveMeasureLine:
            draftForView === null || draftForView.pixelLength <= 0 || proposedRatio === null
              ? null
              : COPY.liveMeasure(pixelLabel(draftForView.pixelLength), formatScaleDensity(proposedRatio)),
          canRemeasure: draftForView !== null,
          canPlaceSegment: draftForView === null && frame !== null,
          tooShortNotice:
            draftForView !== null && !draftForView.isDragging && draftForView.pixelLength <= 0
              ? COPY.referenceTooShort
              : null,
        },
        computation,
        crossChecks,
        warnings,
        applyScope: effectiveApplyScope,
        applyScopeOptions,
        canApply,
        ...(canApply ? {} : { applyMissingHint: COPY.applyMissingHint }),
        ...(isMachineProposal ? { applyLabel: COPY.machineApplyLabel } : {}),
        ...(applyNotice !== null ? { applyBlockedNotice: applyNotice } : {}),
        canOpenViewer3d: applyOutcome === 'success',
        isApplying,
        areActionsHidden: !canEdit,
        recalculationCaption: COPY.recalculationCaption,
        statusCode: state === 'success' ? 'verified' : 'neutral',
        /* Tầng chưa có bản vẽ: không có gì để kéo hay đo — quy trình mờ đi, bảng phím ẩn (BUG-411). */
        isMethodLocked: isNoDrawing,
        isCurrentScaleKnown: displayRatio !== null,
        scaleCheck: buildScaleCheck({
          mmPerPx: proposedRatio ?? storedRatio ?? provisionalRatio,
          // UX41 U38: đề nghị vừa lưu xong chính là tỷ lệ của tầng — nói "Đã xác nhận", không "Chưa xác nhận".
          source:
            proposedRatio !== null && !(applyOutcome === 'success' && proposedRatio === levelRatio)
              ? 'proposed'
              : storedRatio !== null
                ? 'stored'
                : provisionalRatio === null
                  ? null
                  : isScaleMissing(floorLayer.scaleSource)
                    ? 'missing'
                    : 'provisional',
          shortEdgePx,
          // Kích thước đã biết để kiểm chéo: một chuỗi OCR KHÁC chuỗi đang dùng để đo, không tự kiểm chính nó.
          knownDimension: rows.find((row) => row.id !== selectedRowId) ?? null,
          planSizeMm: planSizeAt(layerDocument, proposedRatio ?? storedRatio ?? provisionalRatio),
          dimensionCount: layerDocument?.dimensions.length ?? 0,
          isGuess: storedRatio === null && typedRatio === null && proposedScale === null && drag === null && selectedRow === null,
          isReadFromDrawing: layerDocument?.scaleBasis === 'chain',
        }),
        ...(layerDocument !== undefined &&
        layerDocument.layer.walls.length > 0 &&
        (layerDocument.level.scaleMillimetresPerPixel ?? 0) > 0 &&
        canEdit
          ? {
              sizeEntry: {
                widthText: sizeState.widthText,
                lengthText: sizeState.lengthText,
                isSwapped: sizeState.isSwapped,
                isOuter: sizeState.isOuter,
                error:
                  sizeEntryResult !== null && sizeEntryResult.mismatchPercent > FLAT_SIZE_MISMATCH_PERCENT
                    ? COPY.sizeEntryMismatch(formatNumber(sizeEntryResult.mismatchPercent, { fractionDigits: 1 }))
                    : null,
              },
            }
          : {}),
        shortcutHints: isNoDrawing ? [] : shortcutHints,
        ...(sourceDpi !== null && canEdit
          ? {
              ratioEntry: {
                label: COPY.ratioEntryLabel,
                text: ratioText,
                placeholder: COPY.ratioEntryPlaceholder,
                error: ratioText.trim() !== '' && ratioDenominator === null ? COPY.ratioEntryInvalid : null,
              },
            }
          : {}),
        ...(builtAreaM2 !== null && canEdit
          ? {
              areaEntry: {
                label: COPY.areaEntryLabel,
                text: areaText,
                placeholder: COPY.areaEntryPlaceholder,
                error: areaText.trim() !== '' && areaEntryRatio === null ? COPY.areaEntryInvalid : null,
                ...(areaPlanSize !== null && areaEntryRatio !== null
                  ? { hint: COPY.areaEntryHint(planSizeText(areaPlanSize), formatScaleDensity(areaEntryRatio)) }
                  : {}),
              },
            }
          : {}),
        ...(sourceDpi === null && canEdit && !isNoDrawing ? { ratioPhotoNotice: COPY.ratioPhotoNotice } : {}),
        ...(suggestedRatio !== null && canEdit
          ? {
              suggestion: {
                text: COPY.suggestionOffer(formatNumber(suggestedRatio, { maxFractionDigits: 1 })),
                actionLabel: COPY.suggestionUse,
                isActive: isSuggestionActive,
              },
            }
          : {}),
      },
      statusBar: {
        x: cursorPixels.x,
        y: cursorPixels.y,
        scaleRatio: scaleRatioLabel,
        scaleDensity: scaleDensityLabel,
        saveText: saveLabel ?? '',
      },
      isCompact,
      // Theo nút, không theo trạng thái: `error`/`forbidden` đứng trước `collapsed` trong thứ tự
      // bảy trạng thái, nên suy từ `state` làm nút "Thu gọn bảng" chết ở đó (BUG-322).
      isPanelCollapsed,
      prefersReducedMotion,
      errorMessage: errorDescription?.description ?? null,
      errorCode,
      // Ảnh méo không đặt tiêu đề: view dùng tiêu đề "nắn ảnh thất bại" của chính nó (B-V5-04).
      ...(errorDescription?.title !== undefined ? { errorTitle: errorDescription.title } : {}),
      ...(isNoDrawing ? { isNoDrawing: true } : {}),
      emptyNotice: isEmptyState ? COPY.emptyNotice : null,
      partialNotice:
        state !== 'partial'
          ? null
          : ratioEntryRatio !== null && ratioDenominator !== null
            ? COPY.ratioEntryNotice(formatNumber(ratioDenominator), formatScaleDensity(ratioEntryRatio))
          : areaEntryRatio !== null && areaM2 !== null && areaPlanSize !== null
            ? COPY.areaEntryNotice(formatNumber(areaM2), planSizeText(areaPlanSize))
          : isAutoSuggestion && pipelineRatio !== null
            ? noteRatio !== null
              ? COPY.noteSuggestionNotice(formatNumber(noteRatio), oneDecimal(pipelineRatio), sizeSuffix(pipelineRatio))
              : COPY.autoSuggestionNotice(oneDecimal(pipelineRatio), sizeSuffix(pipelineRatio))
          : isSuggestionActive
            ? COPY.suggestionNotice
            : isRowProposal && proposedRatio !== null
              ? COPY.machineProposalNotice(formatNumber(rows.length), oneDecimal(proposedRatio), sizeSuffix(proposedRatio))
            : !hasStartedWork && applyOutcome === null && selectedRow !== null
              ? COPY.preselectedNotice(formatNumber(selectedRow.realLength))
              : !hasStartedWork && lowConfidenceCount === 0 && applyOutcome === null && rows.length > 0
                ? storedRatio === null ? COPY.pickDimensionNotice(formatNumber(rows.length)) : null
                : COPY.partialNotice,
      forbiddenNotice: state === 'forbidden' ? COPY.forbiddenNotice : null,
      successNotice: state === 'success' ? COPY.successNotice : null,
      ...(provisionalNotice !== null ? { provisionalScaleNotice: provisionalNotice.message } : {}),
      ...(provisionalNotice?.level === 'violation' ? { missingScaleNotice: provisionalNotice.message } : {}),
      saveBlock,
      readFailure,
      ...(allFloors !== null
        ? {
            allFloorsConfirm: {
              title: allFloorsTitle(formatNumber(allFloors.targets.filter((entry) => entry.hasDrawing).length)),
              message: COPY.allFloorsMessage,
              confirmLabel: COPY.allFloorsConfirm,
              cancelLabel: COPY.allFloorsCancel,
              changes: allFloors.changes,
            },
          }
        : {}),
    };
  }, [
    activeStep,
    chip,
    dimensionChips,
    allFloors,
    applyNotice,
    applyOutcome,
    canEdit,
    canvasSize,
    saveBlock,
    readFailure,
    isApplying,
    provisionalNotice,
    provisionalRatio,
    floorLayer.scaleSource,
    isSuggestionActive,
    isAutoSuggestion,
    pipelineRatio,
    ratioDenominator,
    ratioEntryRatio,
    ratioText,
    areaEntryRatio,
    sizeState,
    sizeEntryResult,
    typedRatio,
    proposedScale,
    drag,
    areaM2,
    areaPlanSize,
    areaText,
    builtAreaM2,
    sourceDpi,
    selectedRow,
    suggestedRatio,
    aiInference,
    effectiveApplyScope,
    applyScopeOptions,
    computation,
    crossChecks,
    currentScaleLabel,
    cursorPixels,
    displayRatio,
    draftForView,
    drawing,
    effectiveMethod,
    errorCode,
    frame,
    levelRatio,
    errorDescription,
    highlightedRowId,
    isCompact,
    isNoDrawing,
    isPanelCollapsed,
    isEmptyState,
    hasStartedWork,
    layerDocument,
    lowConfidenceCount,
    methodOptions,
    nearestOcrValue,
    prefersReducedMotion,
    proposedRatio,
    realLengthText,
    rows,
    typedLength,
    saveLabel,
    scaleDensityLabel,
    scaleRatioLabel,
    selectedRowId,
    shortEdgePx,
    storedRatio,
    shortcutHints,
    state,
    viewport,
    warnings,
  ]);

  const actions = useMemo<ScaleCalibrationActions>(
    () => ({
      onChangeMethod,
      onSelectDimensionRow,
      onHoverDimensionRow,
      onStartDrag,
      onMoveDrag,
      onEndDrag,
      onCancelDrag,
      onNudgeEndpoint,
      onChangeRealLength,
      onConfirmRealLength,
      onPickDimensionChip,
      onRemeasure,
      onPlaceSegment,
      onPan,
      onZoom,
      onZoomIn,
      onZoomOut,
      onFitView,
      onMiniMapViewportChange,
      onMoveCursor,
      onCanvasSizeChange,
      onApply,
      onUseSuggestedScale,
      onChangeDrawingRatio,
      onChangeFlatArea,
      onChangeFlatSize,
      onZoomToNumbers,
      onChangeApplyScope,
      onConfirmAllFloors,
      onCancelAllFloors,
      onToggleCollapsed,
      onGoToPreprocessing,
      onRetry,
      onGoToUpload,
      onGoToViewer3d,
    }),
    [
      onPickDimensionChip,
      onApply,
      onCancelAllFloors,
      onChangeDrawingRatio,
      onChangeFlatArea,
      onChangeFlatSize,
      onZoomToNumbers,
      onConfirmAllFloors,
      onCancelDrag,
      onCanvasSizeChange,
      onChangeApplyScope,
      onChangeMethod,
      onChangeRealLength,
      onConfirmRealLength,
      onEndDrag,
      onFitView,
      onGoToPreprocessing,
      onGoToUpload,
      onGoToViewer3d,
      onHoverDimensionRow,
      onMiniMapViewportChange,
      onMoveCursor,
      onMoveDrag,
      onNudgeEndpoint,
      onPan,
      onRemeasure,
      onPlaceSegment,
      onRetry,
      onSelectDimensionRow,
      onStartDrag,
      onToggleCollapsed,
      onUseSuggestedScale,
      onZoom,
      onZoomIn,
      onZoomOut,
    ],
  );

  return { model, actions, appliedScale, aiInference };
}
