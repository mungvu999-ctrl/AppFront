/**
 * Tiến độ và "Việc tiếp" của màn Quản lý tầng (S-19, bản Z) — phép suy THUẦN từ các dòng
 * `FloorRowVm` mà `useFloorManager` đã dựng. Một nguồn trạng thái: không đọc gì ngoài `rows`.
 *
 * App hiện chỉ biết một tầng CÓ hay CHƯA CÓ bản vẽ. Các bước "AI đang đọc", "Đang duyệt",
 * "Duyệt xong", "Xử lý lỗi" của demo cần BE trả tiến độ theo tầng (GHI-CHU §CẦN BE 1) —
 * ở đây không bịa chúng.
 *
 * File `.ts` (không phải view) nên được định dạng số qua `src/lib/format` (A15).
 */

import { millimetres, millimetresToMetres } from '@/domain/units/types';
import { formatNumber } from '@/lib/format/number';
import { SCALE_MEASURE_SUFFIX, SCALE_STATE_VIEWS } from '@/lib/viewmodel/provisionalScale';

import type { FloorRowVm } from './floorManagerTypes';
import { elevationSignedText, heightMmText } from './floorFormat';
import { draftToMillimetres } from './useFloorManager';

const MAX_CONDITIONS = 3;

export { elevationSignedText, heightMmText };

/** Số mm đang có trong nháp chiều cao (nháp của hook tính bằng mét). */
export const heightDraftMm = (row: FloorRowVm): number | undefined =>
  draftToMillimetres(row.draft.height) ?? undefined;

/** Ô chiều cao nhập mm; hook nhận nháp bằng mét — đổi đơn vị ở đây, không ở view. */
export const heightDraftFromMm = (valueMm: number | undefined): string =>
  valueMm === undefined ? '' : formatNumber(millimetresToMetres(millimetres(valueMm)), { fractionDigits: 3, grouping: false });

export type FloorStepTone = 'attention' | 'neutral' | 'violation';

export interface FloorStepVm {
  readonly label: string;
  readonly tone: FloorStepTone;
  readonly nextText: string;
  /** Dòng phụ dưới tên tầng; rỗng khi chip đã nói đủ (không lặp "Chưa có bản vẽ", BUG-250). */
  readonly summaryText: string;
}

export function floorStepOf(row: FloorRowVm): FloorStepVm {
  if (row.needsDrawing) {
    return { label: 'Chưa có bản vẽ', tone: 'attention', nextText: 'tải bản vẽ mặt bằng', summaryText: '' };
  }

  /* Chip dùng tên + màu chung của trạng thái tỷ lệ (UX-R2 K46). Chưa có tỷ lệ: diện tích theo tỷ lệ
     mặc định là số sai, nên không in (K12); tỷ lệ cần kiểm: số tạm, ghi rõ "≈ … (tạm)". */
  if (row.isScaleMissing) {
    return {
      label: SCALE_STATE_VIEWS.missing.name,
      tone: SCALE_STATE_VIEWS.missing.statusCode,
      nextText: 'đặt tỷ lệ',
      summaryText: `${row.wallCountText} tường, ${row.roomCountText} phòng, diện tích: Chưa có`,
    };
  }

  const suffix = SCALE_MEASURE_SUFFIX[row.scaleState];
  if (suffix !== '') {
    const view = SCALE_STATE_VIEWS[row.scaleState];
    return {
      label: view.name,
      tone: 'attention',
      nextText: `${(view.action ?? '').toLowerCase()}, rồi duyệt tường, phòng`,
      summaryText: `${row.wallCountText} tường, ${row.roomCountText} phòng, ≈ ${row.areaText}${suffix}`,
    };
  }

  return {
    label: 'Đã có bản vẽ',
    tone: 'neutral',
    nextText: 'duyệt tường, phòng',
    summaryText: `${row.wallCountText} tường, ${row.roomCountText} phòng, ${row.areaText}`,
  };
}

export interface NextTaskVm {
  readonly floorId: string;
  readonly kind: 'upload' | 'scale' | 'review';
  readonly title: string;
  readonly reason: string;
  readonly conditions: readonly string[];
  readonly actionLabel: string;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly meterText: string;
}

/**
 * Tầng cần làm nhất: tầng đầu tiên chưa có bản vẽ; rồi tầng đầu tiên máy không đo được tỷ lệ
 * (duyệt tường trên tỷ lệ sai là làm lại từ đầu, K06); đủ cả thì tầng đầu tiên để duyệt.
 */
export function nextTaskOf(rows: readonly FloorRowVm[], canEdit = true): NextTaskVm | null {
  const first = rows[0];

  if (first === undefined) {
    return null;
  }

  const missing = rows.filter((row) => row.needsDrawing);
  const doneCount = rows.length - missing.length;
  const meterText = `${formatNumber(doneCount, { fractionDigits: 0 })}/${formatNumber(rows.length, { fractionDigits: 0 })} tầng có bản vẽ`;
  const target = missing[0];

  if (target !== undefined) {
    return {
      floorId: target.id,
      kind: 'upload',
      title: `Tải bản vẽ mặt bằng ${target.name}`,
      reason: `${target.name} ở cao độ ${elevationSignedText(target.elevationMm)}. Tải bản vẽ để AI đọc tường, phòng của tầng này.`,
      conditions: missing.slice(0, MAX_CONDITIONS).map((row) => `${row.name}: tải bản vẽ`),
      actionLabel: `Tải bản vẽ ${target.name}`,
      doneCount,
      totalCount: rows.length,
      meterText,
    };
  }

  const scaleMissing = rows.filter((row) => row.isScaleMissing);
  const scaleTarget = scaleMissing[0];

  // UX-46: người chỉ xem không được mời duyệt hay đặt tỷ lệ; chỉ được mời xem.
  if (!canEdit) {
    return {
      floorId: first.id,
      kind: 'review',
      title: 'Xem tường, phòng từng tầng',
      reason: 'Bạn chỉ có quyền xem dự án này. Mở từng tầng để xem tường, phòng máy đọc được.',
      conditions: [],
      actionLabel: `Xem tường ${first.name}`,
      doneCount,
      totalCount: rows.length,
      meterText,
    };
  }

  if (scaleTarget !== undefined) {
    const scaledCount = rows.length - scaleMissing.length;

    return {
      floorId: scaleTarget.id,
      kind: 'scale',
      title: `Đặt tỷ lệ ${scaleTarget.name}`,
      reason: `Máy không đo được tỷ lệ của ${formatNumber(scaleMissing.length, { fractionDigits: 0 })} tầng, nên kích thước đang sai. Đặt tỷ lệ trước, rồi mới duyệt tường.`,
      conditions: scaleMissing.slice(0, MAX_CONDITIONS).map((row) => `${row.name}: đặt tỷ lệ`),
      actionLabel: `Đặt tỷ lệ ${scaleTarget.name} (còn ${formatNumber(scaleMissing.length, { fractionDigits: 0 })} tầng)`,
      doneCount: scaledCount,
      totalCount: rows.length,
      meterText: `${formatNumber(scaledCount, { fractionDigits: 0 })}/${formatNumber(rows.length, { fractionDigits: 0 })} tầng có tỷ lệ`,
    };
  }

  return {
    floorId: first.id,
    kind: 'review',
    title: 'Duyệt tường, phòng từng tầng',
    reason: 'Mọi tầng đã có bản vẽ. Duyệt tường, phòng AI đọc được trước khi sang Mô hình 3D.',
    conditions: [],
    actionLabel: `Duyệt tường ${first.name}`,
    doneCount,
    totalCount: rows.length,
    meterText,
  };
}

/** Câu trạng thái dưới tiêu đề, ví dụ "4 tầng, từ cao độ −3.000 đến +10.200, cao tổng 13.200 mm." */
export function stackSummaryText(rows: readonly FloorRowVm[]): string | null {
  if (rows.length === 0) {
    return null;
  }

  const bottom = Math.min(...rows.map((row) => row.elevationMm));
  const top = Math.max(...rows.map((row) => row.elevationMm + row.heightMm));

  return `${formatNumber(rows.length, { fractionDigits: 0 })} tầng, từ cao độ ${elevationSignedText(bottom)} đến ${elevationSignedText(top)}, cao tổng ${heightMmText(top - bottom)} mm.`;
}
