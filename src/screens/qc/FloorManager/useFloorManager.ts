/**
 * Nửa "suy nghĩ" của màn S-16 "Quản lý tầng" — mọi thứ view của màn cần, đã xong.
 *
 * `floorManagerTypes.ts` là hợp đồng view-model DUY NHẤT của màn và nó ĐÃ ĐÓNG
 * BĂNG; hook này trả về đúng {@link UseFloorManagerResult}, tức toàn bộ
 * `FloorManagerViewProps` cộng ba trường container cần. Mục D: view thuần test
 * được CHỈ từ props, nên không một phép tính nào của màn sống ngoài file này.
 *
 * ## Không công thức tự chế (R-61) — màn không cộng cao độ, không đếm tay
 *
 * - Cao độ khi xếp lại chồng tầng: `createReorderLevelsCommand`. Hàm `restack`
 *   bên trong nó dựng lại chồng tầng từ tầng thấp nhất hiện có (BUG-516) và
 *   giữ cao độ ghi đè tay (BUG-517, `roomFloorCommands.ts`), và nó được gọi sẵn trong
 *   `validateReorderLevels` lẫn `createReorderLevelsCommand`. Phát lệnh reorder
 *   = cao độ được tính lại đúng, bởi mã đã có test. **Không một vòng lặp cộng
 *   dồn nào trong màn.**
 * - Đỉnh ngăn xếp: `ceilingElevationMm` (M-11) qua `stackTopMm` của cổng.
 * - Căn tầng: `alignFloors` (M-11). Câu cảnh báo đọc ở `FloorIssue.message` —
 *   không câu nào soạn lại ở đây.
 * - Đếm tường / phòng / diện tích một tầng: `idsOnLevel` + `isEntityOfKind`
 *   (D-12) qua cổng. Không nơi nào duyệt toàn đồ thị.
 * - Tiến độ QC: `groupViolationsByLevel` + `explainHealthScore`
 *   (`src/domain/rules/healthScore.ts`). Không có "đã duyệt / tổng" theo tầng ở
 *   tầng domain (T1 xác nhận NOT FOUND), nên điểm sức khoẻ 0–100 là con số
 *   thật, và tỷ lệ 0..1 chia cho `HEALTH_SCORE_MAX` chứ không cho một hằng thô.
 * - Chặn trùng cao độ: `findElevationConflict` của cổng — nó gọi
 *   `validateChangeLevelElevation` trước và dùng NGUYÊN VĂN câu của hàm đó.
 * - Định dạng số: `formatLength` / `formatArea` / `formatNumber` /
 *   `formatPercent` của `src/lib/format` (P-01, A15). Không `toFixed`, không
 *   `toLocaleString`, không một phép quy đổi đơn vị viết tay nào — mm ↔ m đi
 *   qua `millimetresToMetres` / `metresToMillimetres` của `src/domain/units`.
 *
 * ## Trạng thái máy chủ (R-64)
 *
 * Không `useState` nào giữ cờ đang-tải hay cờ hỏng. Danh sách tầng đi qua
 * `useQuery` dưới khoá riêng `queryKeys.floor.manager(projectId)` (con của `floor.list`) —
 * `invalidationMap.editFloor` dọn nó theo tiền tố — và mọi lượt ghi gọi
 * `applyInvalidation(queryClient, 'editFloor', …)`, không `invalidateQueries`
 * trần. `useShareLinks.ts` tự khai `isLoading`/`error` bằng tay; đó là ngoại lệ
 * đi trước, KHÔNG phải khuôn mẫu, và không một dòng nào ở đây chép nó.
 *
 * `invalidationMap` chưa có toán tử riêng cho thêm / xoá / sắp xếp tầng (T2 báo
 * NOT FOUND) và R-68 cấm thêm toán tử mới vào `src/lib`. Toán tử tổng quát gần
 * nhất đang có là **`editFloor`**, và nó làm mất hiệu lực đúng hai khoá màn này
 * đọc: `queryKeys.floor.detail(floorId)` và `queryKeys.floor.list(projectId)`
 * (`src/lib/query/invalidation.ts:51-54`). Mọi lượt ghi của màn dùng nó.
 *
 * ## Đường ghi (A10)
 *
 * Không một dòng nào gọi `set()` hay `_applyPatches()`. Mọi thay đổi đi: lệnh
 * dựng bằng nguyên thuỷ công khai → `dispatch` (năm bước) →
 * `SpatialPort.applyPatches` = `commit(patches, label)` → kho → rồi mới ghi lên
 * máy chủ qua `ENDPOINTS.floors.*` / `ENDPOINTS.spatial.floor`. Hoàn tác đi qua
 * `HistoryStack` 100 bước của S-06, KHÔNG phải ngăn xếp zundo của store.
 *
 * ## Đổi chiều cao = MỘT bước lịch sử
 *
 * `createChangeFloorHeightCommands` trả HAI lệnh (đổi chiều cao, rồi xếp chồng
 * lại trên context đã áp bước một) và `runFloorTransaction` chạy chúng như một
 * khối: một `UndoEntry`, một lần `Ctrl+Z`. Xem đầu `floorManagerGateway.ts`.
 *
 * ## Xoá tầng: KHÔNG hộp thoại
 *
 * CẤM TUYỆT ĐỐI. Xoá chạy ngay và phát vé hoàn tác `createUndoTicket`
 * (`UNDO_WINDOW_MS` = 8000 ms — hằng, không phải số gõ tay). A9 không mâu
 * thuẫn: A9 chỉ đòi hộp thoại cho việc A8 KHÔNG hoàn tác được.
 *
 * ## Bàn phím (A12, R-72)
 *
 * Không một `addEventListener('keydown')` nào. `Ctrl/Cmd+Z` đăng ký qua
 * `useShortcut` ở tầng `canvas`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  alignFloors,
  MIN_MATCHED_AXES,
  type FloorAlignmentReport,
  type FloorIssue,
} from '@/domain/axes/alignFloors';
import { explainHealthScore, groupViolationsByLevel, HEALTH_SCORE_MAX } from '@/domain/rules/healthScore';
import type { Violation } from '@/domain/rules/registry';
import { totalArea } from '@/domain/rooms/area';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Level, LevelId } from '@/domain/spatial/types';
import { HUMAN_TEXT_MAX_LENGTH, normalizeHumanText } from '@/domain/text/humanText';
import type { PointMm } from '@/domain/units/compare';
import { PROJECT_LIMITS } from '@/domain/project/limits';
import {
  metres,
  metresToMillimetres,
  millimetres,
  millimetresToMetres,
  roundMeasurement,
  squareMetres,
} from '@/domain/units/types';

import type { Floor } from '@/api/contracts';

import { can } from '@/lib/auth/permissions';
import type { UndoEntryId } from '@/lib/commands/dispatch';
import type { HistoryStep } from '@/lib/commands/history';
import type { Command } from '@/lib/commands/types';
import type { CommandContext } from '@/lib/commands/business/shared';
import { PROJECT_NOT_FOUND_DESCRIPTION } from '@/components/feedback/ProjectSpatialGate';
import { describeError, toAppError } from '@/lib/errors';
import { readWireError } from '@/lib/errors/wireError';
import { formatArea, formatLength } from '@/lib/format/measure';
import { formatNumber, formatPercent, MISSING_VALUE, parseNumber } from '@/lib/format/number';
import { getAppAnnouncer, type Announcer } from '@/lib/input/announcer';
import type { ShortcutRegistry } from '@/lib/input/shortcutRegistry';
import { runExclusive } from '@/lib/mutations/entityQueue';
import type { NotificationBus } from '@/lib/mutations/notificationBus';
import { applyInvalidation } from '@/lib/query/invalidation';
import { cachedProjectName } from '@/lib/query/cachedProjectName';
import { queryKeys } from '@/lib/query/queryKeys';
import type { FloorMeasureRef, ScaleState } from '@/lib/viewmodel/provisionalScale';
import { measureTextOfState, totalMeasureTextOf } from '@/lib/viewmodel/provisionalScale';
import type { ApiResult } from '@/api/client';

import { appNotificationBus } from '@/hooks/useNotifications';
import { useCountUp } from '@/hooks/useCountUp';
import { useShortcut } from '@/hooks/useShortcut';
import { selectViolations } from '@/store/selectors';
import { useStore } from '@/store';
import type { FloorMetaEntry } from '@/store/spatialSlice';
import type { ProjectRole } from '@/types/project';

import { floorScaleStateOf, scaleImplausibleOf } from '../shared/floorReviewGateModel';

import {
  areaOfLevel,
  roomOutlinesOfLevel,
  createAddFloorCommand,
  createChangeFloorHeightCommands,
  createChangeLevelElevationCommand,
  createDuplicateFloorCommand,
  createFloorManagerDispatchDeps,
  createFloorManagerGateway,
  createFloorUndoTicket,
  createRemoveFloorCommand,
  createRenameFloorCommand,
  createReorderLevelsCommand,
  duplicateFloorToastDescription,
  FLOOR_DUPLICATE_NOTIFICATION_TYPE,
  FLOOR_MANAGER_MISSING_CAPABILITIES,
  FLOOR_MANAGER_UNSUPPORTED_NOTICES,
  FLOOR_PERSIST_FAILED_NOTIFICATION_TYPE,
  FLOOR_REMOVE_NOTIFICATION_TYPE,
  FLOOR_REORDER_NOTIFICATION_TYPE,
  FLOOR_ADD_NOTIFICATION_TYPE,
  FLOOR_ELEVATION_NOTIFICATION_TYPE,
  FLOOR_HEIGHT_NOTIFICATION_TYPE,
  FLOOR_RENAME_NOTIFICATION_TYPE,
  ADD_FLOOR_TOAST_DESCRIPTION,
  CHANGE_ELEVATION_TOAST_DESCRIPTION,
  CHANGE_HEIGHT_TOAST_DESCRIPTION,
  RENAME_FLOOR_TOAST_DESCRIPTION,
  findElevationConflict,
  floorWriteBodyOf,
  floorPlansOf,
  isElevationOverridden,
  levelsOf,
  REORDER_FLOORS_TOAST_DESCRIPTION,
  roomsOfLevel,
  removeFloorToastDescription,
  runFloorCommand,
  runFloorTransaction,
  stackBottomMm,
  stackTopMm,
  wallCountOfLevel,
  type FloorManagerGateway,
  type FloorManagerSnapshot,
} from './floorManagerGateway';
import type {
  DuplicateElevationViolation,
  ElevationTickVm,
  FloorEditableField,
  FloorManagerScreenState,
  FloorRowDraft,
  FloorRowVm,
  FloorTableFooterVm,
  SectionBandVm,
  UseFloorManagerResult,
} from './floorManagerTypes';
import { QC_NOT_GRADED } from './floorManagerTypes';
import { elevationSignedText, heightMmText } from './floorFormat';

/* -------------------------------------------------------------------------- */
/* Chuỗi cố định của màn — một chỗ duy nhất (A6: thường, kiểu câu).            */
/* -------------------------------------------------------------------------- */

export const FLOOR_MANAGER_TEXT = {
  emptyTitle: 'Chưa có tầng nào',
  emptyNotice: 'Thêm tầng đầu tiên, hoặc nhập số tầng từ màn hình tạo dự án.',
  /* Người xem không thêm được tầng, nên không mời họ thêm (BUG-522). */
  viewerEmptyNotice: 'Khi người có quyền sửa thêm tầng, ngăn xếp tầng sẽ hiện ở đây.',
  forbiddenNotice: 'Vai của bạn chỉ xem được ngăn xếp tầng; mọi thao tác sửa đã được ẩn.',
  drawingsMissing: 'Chưa có bản vẽ',
  heightRefusedTitle: 'Chưa đổi được chiều cao tầng',
  heightTooLow: 'Chiều cao tầng không nhỏ hơn 2 m. Nhập lại một giá trị từ 2 m trở lên.',
  persistFailedTitle: 'Chưa lưu được thay đổi tầng',
  shortcutUndo: 'Hoàn tác thay đổi tầng gần nhất',
  uploadDrawingHint:
    'Tải bản vẽ lên ở màn hình bản vẽ của tầng này; danh sách tầng chỉ cho biết tầng nào còn thiếu.',
  duplicateSuffix: 'bản sao',
  newFloorPrefix: 'Tầng',
  addRefusedTitle: 'Chưa thêm được tầng',
  renameRefusedTitle: 'Chưa đổi được tên tầng',
  undoRefusedTitle: 'Chưa hoàn tác được thay đổi tầng',
  idTaken: 'Mã tầng đã có trong dự án, thao tác vừa rồi đã được huỷ.',
  limitReached: 'Dự án đã đủ 50 tầng, thao tác vừa rồi đã được huỷ.',
  listChangedElsewhere: 'Danh sách tầng vừa đổi ở nơi khác, thứ tự chưa được lưu.',
  idAmbiguous:
    'Mã tầng này trùng với một tầng ở dự án khác của bạn nên máy chủ chưa xử lý được; thao tác vừa rồi đã được huỷ.',
  floorGone: 'Tầng này không còn trên máy chủ.',
  undoExpired: 'Đã quá thời gian khôi phục tầng, tầng đã xoá không lấy lại được.',
  undoNotLatest:
    'Thay đổi này không còn là thay đổi gần nhất nên không hoàn tác được từ thông báo.',
} as const;

/**
 * Máy chủ giữ tầng đã xoá 600 s rồi mới dọn; chừa 30 s cho đường truyền, nên
 * quá 570 s là không dám gửi POST khôi phục nữa.
 */
export const FLOOR_RESTORE_WINDOW_MS = 570_000;

/** Bảng mã dây → câu, cùng khuôn `useUserManagement.ts` — mã không bao giờ tới người dùng. */
const FLOOR_ERROR_SENTENCE_BY_CODE: ReadonlyMap<string, string> = new Map([
  ['FLOOR_ID_TAKEN', FLOOR_MANAGER_TEXT.idTaken],
  ['FLOOR_LIMIT_REACHED', FLOOR_MANAGER_TEXT.limitReached],
  ['FLOOR_REORDER_MISMATCH', FLOOR_MANAGER_TEXT.listChangedElsewhere],
  ['FLOOR_ID_AMBIGUOUS', FLOOR_MANAGER_TEXT.idAmbiguous],
]);

/** Lỗi ghi tầng → câu người đọc. Mã lạ rơi về `describeError` như `reportPersist` từng làm. */
export function floorErrorSentence(error: unknown): string {
  const wire = readWireError(error);
  const byCode = wire?.code === undefined ? undefined : FLOOR_ERROR_SENTENCE_BY_CODE.get(wire.code);

  if (byCode !== undefined) {
    return byCode;
  }

  if (wire?.status === 404 && wire.resource === 'floor') {
    return FLOOR_MANAGER_TEXT.floorGone;
  }

  return describeError(toAppError(error)).description;
}

/** Chiều cao tầng tối thiểu, cùng ngưỡng với hộp thoại tạo dự án. */
const MIN_FLOOR_HEIGHT_MM = 2000;

/** Đơn vị của cột "Cao độ (m)" và "Chiều cao (m)": một chữ số sau dấu phẩy. */
const METRE_FRACTION_DIGITS = 1;

/** Danh sách rỗng dùng chung, để `useMemo` không sinh mảng mới mỗi lượt vẽ. */
const NO_ROWS: readonly FloorRowVm[] = Object.freeze([]);
const NO_BANDS: readonly SectionBandVm[] = Object.freeze([]);
const NO_TICKS: readonly ElevationTickVm[] = Object.freeze([]);
const NO_VIOLATIONS: readonly Violation[] = Object.freeze([]);
const NO_FLOOR_IDS: readonly string[] = Object.freeze([]);

/* -------------------------------------------------------------------------- */
/* Phép ghép thuần — kiểm được mà không cần dựng hook.                          */
/* -------------------------------------------------------------------------- */

/** Số mét của một số đo milimét, đã định dạng, KHÔNG kèm hậu tố đơn vị. */
export const metreDraftText = (valueMm: number): string =>
  formatNumber(millimetresToMetres(millimetres(valueMm)), {
    fractionDigits: METRE_FRACTION_DIGITS,
  });

/** Số đo milimét viết thành mét cho người đọc, ví dụ `"3,9 m"` (A15). */
export const metreText = (valueMm: number): string =>
  formatLength(valueMm, { unit: 'm', fractionDigits: METRE_FRACTION_DIGITS });

/** Người dùng gõ mét, mô hình giữ milimét. Quy đổi đi qua `src/domain/units`. */
export const draftToMillimetres = (draftValue: string): number | null => {
  const parsed = parseNumber(draftValue);

  return parsed === undefined ? null : roundMeasurement(metresToMillimetres(metres(parsed)));
};

/** Một phép đếm viết thành chữ; `"—"` khi chưa đếm được (`MISSING_VALUE`). */
export const countText = (value: number | null): string =>
  value === null ? MISSING_VALUE : formatNumber(value, { fractionDigits: 0 });

/** Ví dụ `"2 bản vẽ"`, hoặc `"chưa có bản vẽ"` khi tầng chưa có bản vẽ nào. */
export const drawingCountText = (count: number): string =>
  count === 0
    ? FLOOR_MANAGER_TEXT.drawingsMissing
    : `${formatNumber(count, { fractionDigits: 0 })} bản vẽ`;

/** Ví dụ `"4 tầng"`. */
export const floorCountText = (count: number): string =>
  `${formatNumber(count, { fractionDigits: 0 })} tầng`;

/** Nhãn của một dải lát cắt, ví dụ `"Tầng trệt · 3,9 m"` — hook nối, view không nối. */
export const bandLabel = (name: string, heightMm: number): string =>
  `${name} · ${heightMmText(heightMm)} mm`;

/**
 * `offsetRatio` ở dạng chuỗi CSS.
 *
 * Dấu thập phân của CSS là dấu CHẤM — đây là chuỗi máy đọc, không phải số người
 * đọc, nên A15 không áp vào nó. Phép nhân 100 xảy ra ở đây, tại viewmodel, chứ
 * không ở view.
 */
export const cssPercentOf = (ratio: number): string => `${String(ratio * 100)}%`;

export interface FloorManagerStateInput {
  readonly isViewerRole: boolean;
  readonly isCollapsed: boolean;
  readonly hasError: boolean;
  readonly isLoading: boolean;
  readonly rowCount: number;
  readonly needsDrawingCount: number;
}

/**
 * Bảy trạng thái của A11 / R-63, suy ra từ dữ liệu — tên lấy nguyên văn từ
 * `SEVEN_STATES` của `src/lib/testing/sevenStateScenarios.ts`.
 *
 * Thứ tự nhánh là thứ tự "cái gì che cái gì" mà `floorManagerTypes.ts` khai:
 * `error` → `loading` → `empty` → `forbidden` → `collapsed` → `partial` →
 * `success`. `loading` tách khỏi `empty` bằng chính cờ đang tải chứ không bằng
 * "không có dòng nào", vì cả hai đều không có dòng nào. Lỗi đọc và dự án rỗng
 * đứng TRƯỚC vai người xem: vai chỉ là dải chỉ đọc, không được che "Không tìm
 * thấy dự án này" hay "Chưa có tầng nào" (BUG-522).
 */
export function deriveFloorManagerScreenState(
  input: FloorManagerStateInput,
): FloorManagerScreenState {
  if (input.hasError) {
    return 'error';
  }

  if (input.isLoading) {
    return 'loading';
  }

  if (input.rowCount === 0) {
    return 'empty';
  }

  if (input.isViewerRole) {
    return 'forbidden';
  }

  if (input.isCollapsed) {
    return 'collapsed';
  }

  return input.needsDrawingCount > 0 ? 'partial' : 'success';
}

/** Vấn đề xếp chồng nặng nhất mà M-11 tìm ra, hoặc `null` khi ngăn xếp lành. */
export function worstStackIssue(report: FloorAlignmentReport): FloorIssue | null {
  let worst: FloorIssue | null = null;

  for (const issue of report.issues) {
    if (issue.kind !== 'overlap' && issue.kind !== 'clearHeight') {
      continue;
    }

    if (worst === null || issue.amountMm > worst.amountMm) {
      worst = issue;
    }
  }

  return worst;
}

/** Câu cảnh báo khi các tầng không có trục chung — có thể là các căn riêng, không phải một nhà (UX-R1 K19). */
export const NO_SHARED_AXES_NOTICE = {
  title: 'Các tầng không có trục chung',
  message:
    'Phần lớn bản vẽ không khớp trục với nhau, nên có thể là các căn hộ riêng chứ không phải các tầng của một nhà. Nếu đúng vậy, bật "Các tầng là các căn hộ riêng" để bỏ cảnh chồng tầng.',
} as const;

/**
 * Có từ hai tầng có trục mà QUÁ NỬA tầng còn lại khớp dưới {@link MIN_MATCHED_AXES} trục với tầng
 * chuẩn — đúng con số "0 trục chung" màn Trục hiện. Không đòi MỌI tầng: một bản vẽ khớp tình cờ
 * 2 trục từng làm dải này không bao giờ hiện (UX-R2 K09). Tầng chưa có trục không tính.
 */
export function hasNoSharedAxes(report: FloorAlignmentReport): boolean {
  const base = report.floors.find((floor) => floor.isBase);
  const others = report.floors.filter((floor) => !floor.isBase && floor.axisCount > 0);

  return (
    base !== undefined &&
    base.axisCount > 0 &&
    others.length > 0 &&
    others.filter((floor) => floor.matchedAxisCount < MIN_MATCHED_AXES).length * 2 > others.length
  );
}

/**
 * Tầng cần đặt tỷ lệ trước (nhãn "Chưa có tỷ lệ", "Việc tiếp" sang bước Tỷ lệ): cùng luật với thanh bước
 * (`floorScaleStateOf` + `scaleImplausibleOf`) — máy không đo được, hoặc đo ra hình vô lý. Chỉ xét
 * tầng kho biết là tỷ lệ tạm; kho chưa biết thì không đoán (như `useFloorReview`).
 */
export function floorScaleMissingOf(graph: NormalizedSpatial, level: Level, meta: FloorMetaEntry | undefined): boolean {
  return floorRowScaleStateOf(graph, level, meta) === 'missing';
}

/**
 * Trạng thái tỷ lệ của dòng tầng (chip chung `SCALE_STATE_VIEWS`); kho chưa biết gì thì coi như đã
 * xác nhận. Xét cả `scaleState`, không riêng `scaleStatus`: từ K4 tầng mà người dùng chấp nhận số
 * máy không còn `scaleStatus` nhưng số vẫn là số ước — xét mình `scaleStatus` thì gắn nhầm cho nó
 * nhãn xanh "Tỷ lệ đã xác nhận".
 */
export function floorRowScaleStateOf(graph: NormalizedSpatial, level: Level, meta: FloorMetaEntry | undefined): ScaleState {
  if (meta?.scaleStatus === undefined && meta?.scaleState === undefined) return 'confirmed';
  return floorScaleStateOf(
    meta.scaleStatus,
    meta.scaleSource,
    level.scaleMillimetresPerPixel,
    scaleImplausibleOf(graph, level.id),
    meta.scaleState,
  );
}

/** Bỏ bộ đệm văn bản của một dòng, trả lại bản ghi mới — không đụng bản cũ. */
const withoutDraft = (
  drafts: Readonly<Record<string, FloorRowDraft>>,
  floorId: string,
): Readonly<Record<string, FloorRowDraft>> =>
  Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== floorId));

/** Tên của tầng mới, ví dụ `"Tầng 5"`. Nhãn giao diện, không phải mã. */
export const newFloorName = (index: number): string => {
  const raw = `${FLOOR_MANAGER_TEXT.newFloorPrefix} ${formatNumber(index, { fractionDigits: 0, grouping: false })}`;
  const normalized = normalizeHumanText(raw);

  return normalized.ok ? normalized.value : raw;
};

/**
 * Tên tầng thêm mới: số = số tầng từ mặt đất trở lên (trệt là số 0, như `nextFloorName` của
 * wizard tạo dự án), ít nhất 1, bỏ qua tên đã có. Đếm cả tầng hầm nhảy mất một số (BUG-277).
 */
export const nextNewFloorName = (levels: readonly Pick<Level, 'name' | 'elevationMm'>[]): string => {
  const taken = new Set(levels.map((level) => level.name.trim()));
  let number = Math.max(1, levels.filter((level) => level.elevationMm >= 0).length);

  while (taken.has(newFloorName(number))) {
    number += 1;
  }

  return newFloorName(number);
};

/** Tên của bản sao, ví dụ `"Tầng 2 (bản sao)"`. */
export const duplicateFloorName = (sourceName: string): string => {
  const suffix = ` (${FLOOR_MANAGER_TEXT.duplicateSuffix})`;
  const room = HUMAN_TEXT_MAX_LENGTH - [...suffix].length;
  const stem = [...sourceName.trim()].slice(0, room).join('').trimEnd();
  const normalized = normalizeHumanText(`${stem}${suffix}`);

  return normalized.ok ? normalized.value : `${sourceName}${suffix}`;
};

/** Một tầng đổi trong một bước lịch sử, đã gộp: `before` của bản đầu, `after` của bản cuối. */
/** Ảnh chụp của màn, kèm đồ thị trong kho lúc lượt đọc BẮT ĐẦU (R1-04). */
type MountedSnapshot = FloorManagerSnapshot & { readonly baseGraph: FloorManagerSnapshot['graph'] };

interface LevelChangeSummary {
  readonly id: string;
  readonly before: Level | null;
  readonly after: Level | null;
}

/** `HistoryStep` không có `.changes` — chúng nằm trong từng lệnh của bước. */
export function levelChangesOfStep(step: HistoryStep): readonly LevelChangeSummary[] {
  const merged = new Map<string, LevelChangeSummary>();

  for (const change of step.commands.flatMap((command) => command.changes)) {
    if (change.kind !== 'level') {
      continue;
    }

    const id = String(change.id);

    merged.set(id, { id, before: merged.get(id)?.before ?? change.before, after: change.after });
  }

  return [...merged.values()];
}

/** Tầng vừa được thêm bởi lệnh thêm / nhân bản. */
const addedLevelOf = (command: Command): Level | null => {
  const added = command.changes.find((change) => change.kind === 'level' && change.after !== null);

  return added?.kind === 'level' ? added.after : null;
};

type FloorRequest = () => Promise<ApiResult<unknown>>;

/** Gửi tuần tự, dừng ở lỗi đầu tiên; `index` cho biết đã có request nào thành công trước nó chưa. */
async function sendInOrder(
  requests: readonly FloorRequest[],
): Promise<{ readonly index: number; readonly error: unknown } | null> {
  for (const [index, request] of requests.entries()) {
    const result = await request();

    if (!result.ok) {
      return { index, error: result.error };
    }
  }

  return null;
}

/** Kế hoạch của một bước thuận: lệnh, và các request phải gửi SAU khi lệnh đã áp cục bộ. */
interface FloorStepPlan {
  readonly commands: readonly Command[];
  readonly label: string;
  readonly requests: readonly FloorRequest[];
  /** Ngay sau khi lệnh áp cục bộ, TRƯỚC request đầu — chỗ phát vé hoàn tác 8 giây. */
  readonly onApplied?: (stepId: UndoEntryId | undefined) => void;
  /** Sau khi mọi request thành công. */
  readonly onSynced?: () => Promise<void> | void;
}

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseFloorManagerOptions {
  readonly projectId: string;
  readonly roles?: readonly ProjectRole[];
  /** Cổng tiêm được; vắng mặt thì hook dựng cổng thật ĐÚNG MỘT LẦN. */
  readonly gateway?: FloorManagerGateway;
  readonly registry?: ShortcutRegistry;
  readonly notifications?: NotificationBus;
  readonly announcer?: Announcer;
  /** Story ép trạng thái `collapsed` mà không phải bấm nút. */
  readonly forceCollapsed?: boolean;
  /** Lát cắt thu gọn lúc mở màn (dưới 1280 px, bản Z); người dùng vẫn mở lại được. */
  readonly initialCollapsed?: boolean;
  /** Dưới 1.024px lát cắt xuống dưới bảng; lớp 3 đo bề rộng và truyền vào. */
  readonly isCompact?: boolean;
  /**
   * Đưa người dùng tới màn tải bản vẽ của một tầng.
   *
   * Điều hướng là việc của container (`react-router-dom` chỉ được nhập ở vỏ
   * route), nên hook nhận nó từ ngoài. Vắng mặt thì liên kết "tải lên" chọn
   * dòng đó và NÓI RA nơi tải lên, chứ không giả vờ đã làm gì.
   */
  readonly onNavigateToDrawings?: (floorId: string) => void;
}

/** Cổng thật dựng đúng một lần cho suốt đời component. */
function useResolvedGateway(injected: FloorManagerGateway | undefined): FloorManagerGateway {
  const fallbackRef = useRef<FloorManagerGateway | null>(null);

  if (injected !== undefined) {
    return injected;
  }

  fallbackRef.current ??= createFloorManagerGateway();

  return fallbackRef.current;
}

/**
 * G3-20: tên tầng nói vị trí ("Tầng mái", "Tầng trệt") mà nằm sai chỗ sau khi kéo thì nói ra,
 * kèm vé hoàn tác. ponytail: dò theo chữ trong tên; tên khác ("Roof", "Sân thượng") không bắt.
 */
export function misplacedFloorNameWarning(namesBottomUp: readonly string[]): string | null {
  const roofIndex = namesBottomUp.findIndex((name) => /mái/iu.test(name));

  if (roofIndex !== -1 && roofIndex !== namesBottomUp.length - 1) {
    return `"${namesBottomUp[roofIndex]}" không còn ở trên cùng, hãy xem lại thứ tự.`;
  }

  const groundIndex = namesBottomUp.findIndex((name) => /trệt/iu.test(name));

  if (groundIndex > 0 && !namesBottomUp.slice(0, groundIndex).every((name) => /hầm/iu.test(name))) {
    return `"${namesBottomUp[groundIndex]}" đang nằm trên một tầng không phải tầng hầm, hãy xem lại thứ tự.`;
  }

  return null;
}

export function useFloorManager(options: UseFloorManagerOptions): UseFloorManagerResult {
  const { projectId } = options;
  const gateway = useResolvedGateway(options.gateway);
  const queryClient = useQueryClient();
  // N0-05: breadcrumb nêu tên dự án; bộ đệm có sẵn thì khỏi đọc lại.
  const cachedName = cachedProjectName(queryClient, projectId);
  const projectNameQuery = useQuery({
    queryKey: [...queryKeys.project.detail(projectId), 'name'],
    queryFn: ({ signal }) => gateway.readProjectName?.({ projectId, signal }) ?? Promise.resolve(null),
    enabled: cachedName === null && gateway.readProjectName !== undefined,
  });
  const projectName = cachedName ?? projectNameQuery.data ?? null;
  const notifications = options.notifications ?? appNotificationBus;
  const announcerRef = useRef<Announcer | null>(options.announcer ?? null);

  const announce = useCallback((message: string) => {
    announcerRef.current ??= getAppAnnouncer();
    announcerRef.current.announce(message, 'assertive');
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Vai trò — trạng thái 6 vô hiệu MỌI hàm sửa, ở tầng hook.                */
  /* ---------------------------------------------------------------------- */

  const roles = options.roles ?? [];
  const canEdit = can('edit', 'layer', { roles });
  const isViewerRole = !canEdit;

  /* ---------------------------------------------------------------------- */
  /* Trạng thái của riêng giao diện.                                         */
  /* ---------------------------------------------------------------------- */

  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [hoveredFloorId, setHoveredFloorId] = useState<string | null>(null);
  const [hiddenFloorIds, setHiddenFloorIds] = useState<readonly string[]>(NO_FLOOR_IDS);
  /* Cờ dirty thật (G3-16): câu "tường, phòng, nội thất chưa lưu" chỉ đúng sau khi đã nhân bản hay xoá tầng. */
  const [hasUnsavedContents, setHasUnsavedContents] = useState(false);
  const [ownCollapsed, setOwnCollapsed] = useState(options.initialCollapsed ?? false);
  const [isAutoElevation, setIsAutoElevation] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, FloorRowDraft>>>({});

  /*
   * Gương ĐỒNG BỘ của `drafts` — T7 thêm khi ráp hai nửa (xem báo cáo T7).
   *
   * `NumericField` không có sự kiện "đang gõ" riêng: nó chỉ bắn `onChange` MỘT
   * lần, lúc chốt (`useNumericField.ts:14,86`). Nên `FloorTableRow.tsx` buộc
   * phải gọi `onFloorFieldChange` rồi `onFloorFieldCommit` trong CÙNG một lượt
   * xử lý sự kiện, và ở lượt đó `setDrafts` chưa kịp vẽ lại: bản `drafts` mà
   * `onFloorFieldCommit` đóng gói vẫn là bản CŨ, nên `drafts[floorId]` là
   * `undefined` và lượt chốt lặng lẽ không làm gì. Ô "Tên tầng" không dính vì
   * `Input` bắn `onChange` mỗi phím rồi mới `onBlur`, tức hai lượt vẽ khác nhau.
   *
   * `useRef` sửa đúng chỗ đó và KHÔNG đổi một dòng logic lệnh nào: `updateDrafts`
   * ghi gương trước, đặt state sau; `onFloorFieldCommit` đọc gương. Đường ghi vẫn
   * là lệnh → `dispatch` → `commit` như cũ (A10).
   */
  const draftsRef = useRef<Readonly<Record<string, FloorRowDraft>>>(drafts);

  const updateDrafts = useCallback(
    (
      next: (
        previous: Readonly<Record<string, FloorRowDraft>>,
      ) => Readonly<Record<string, FloorRowDraft>>,
    ) => {
      draftsRef.current = next(draftsRef.current);
      setDrafts(draftsRef.current);
    },
    [],
  );
  const [editing, setEditing] = useState<{
    readonly floorId: string;
    readonly field: FloorEditableField;
  } | null>(null);
  const [duplicateElevation, setDuplicateElevation] = useState<{
    /** Tầng có ô cao độ bị từ chối — chỉ ô đó mang dấu lỗi (BUG-306). */
    readonly floorId: string;
    readonly message: string;
    readonly violation: DuplicateElevationViolation;
  } | null>(null);

  const isCollapsed = options.forceCollapsed ?? ownCollapsed;

  /* ---------------------------------------------------------------------- */
  /* Lượt đọc máy chủ (R-64).                                                 */
  /* ---------------------------------------------------------------------- */

  /* Lượt đọc đầu của lần gắn này đọc mới từ máy chủ; các lượt sau (sau một lượt ghi) giữ kho. */
  const hasReadRef = useRef(false);
  const floorListQuery = useQuery({
    // Khoá riêng `floor.manager`, không phải `floor.list` trần: ảnh chụp ở đây là `{ graph, floors, … }`,
    // còn Tải bản vẽ và cổng chất lượng đọc `floor.list` là `Floor[]` (BUG-348).
    queryKey: queryKeys.floor.manager(projectId),
    queryFn: async ({ signal }): Promise<MountedSnapshot> => {
      // Đồ thị trong kho lúc BẮT ĐẦU đọc: sửa trong lúc lượt đọc còn bay đổi kho, và ảnh chụp
      // đọc trước lượt sửa ấy không được đè nó (R1-04).
      const baseGraph = useStore.getState().spatial;
      const snapshot = await gateway.readFloorList({ isMountRead: !hasReadRef.current, projectId, signal });

      hasReadRef.current = true;

      return { ...snapshot, baseGraph };
    },
    /* Quay lại màn trong SPA luôn đọc lại: tầng thêm ở nơi khác phải hiện (BUG-515). */
    refetchOnMount: 'always',
    /*
     * Ảnh chụp mang THAM CHIẾU đồ thị (`graph`, `baseGraph`) mà chốt R1-04 so bằng `===`.
     * Chia sẻ cấu trúc thay một đồ thị bằng bản cũ bằng-sâu của lượt trước (sau một lượt
     * sắp xếp hỏng rồi lùi), nên lượt đọc lúc gắn bị coi là sửa giữa chừng và bị bỏ (BUG-515).
     */
    structuralSharing: false,
  });

  /* Cờ ẩn khỏi 3D là của máy chủ (`floors.hidden_in_3d`, W4b): mỗi lượt đọc danh sách đặt lại nó. */
  const serverFloors = floorListQuery.data?.floors;

  useEffect(() => {
    if (serverFloors !== undefined) {
      setHiddenFloorIds(serverFloors.filter((floor) => floor.hiddenIn3d === true).map((floor) => floor.id));
    }
  }, [serverFloors]);

  const storeGraph = useStore((state) => state.spatial);
  const storeProjectId = useStore((state) => state.spatialProjectId);
  const setSpatial = useStore((state) => state.setSpatial);
  const violations = useStore(selectViolations);
  /* Nguồn tỷ lệ tạm từng tầng (N16, kho giữ ở `floorMeta`): `project_default` = máy không đo được (K12). */
  const floorMeta = useStore((state) => state.floorMeta);

  const snapshot = floorListQuery.data;
  const loadedGraph = snapshot?.graph ?? null;
  const { isFetchedAfterMount } = floorListQuery;
  const appliedSnapshotRef = useRef<MountedSnapshot | null>(null);

  /*
   * Nạp đồ thị vào kho khi kho trống, hoặc khi lượt đọc của CHÍNH lần gắn này đọc
   * mới từ máy chủ (kho là của dự án khác hay lệch bộ tầng — BUG-515). Mỗi ảnh
   * chụp được xét đúng một lần: sửa sau đó đổi `storeGraph` nhưng không được bị đè.
   */
  useEffect(() => {
    if (
      snapshot === undefined ||
      loadedGraph === null ||
      loadedGraph === storeGraph ||
      appliedSnapshotRef.current === snapshot ||
      (storeGraph !== null && (!isFetchedAfterMount || snapshot.fromStore))
    ) {
      return;
    }

    appliedSnapshotRef.current = snapshot;

    /*
     * Kho của dự án này đã đổi từ lúc bắt đầu đọc, hay còn sửa chưa lưu: người dùng đã sửa
     * trong lúc lượt đọc còn bay. Nạp lúc này đè sửa ấy bằng bản đọc cũ hơn và xoá lịch sử
     * hoàn tác (`setSpatial` → `temporal.clear()`), nên bỏ ảnh chụp này (R1-04).
     */
    if (
      storeGraph !== null &&
      storeProjectId === projectId &&
      (storeGraph !== snapshot.baseGraph || useStore.getState().unsavedFloorIds.length > 0)
    ) {
      return;
    }

    setSpatial(loadedGraph, null, {
      floorRevisions: snapshot.floorRevisions,
      projectId,
      ...(snapshot.floorScaleStatus === undefined ? {} : { floorScaleStatus: snapshot.floorScaleStatus }),
      ...(snapshot.floorScaleSource === undefined ? {} : { floorScaleSource: snapshot.floorScaleSource }),
    });
  }, [isFetchedAfterMount, loadedGraph, projectId, setSpatial, snapshot, storeGraph, storeProjectId]);

  /*
   * Đọc kho trước, lượt tải sau: giữa lúc `useEffect` trên chưa chạy, view vẫn
   * có dữ liệu để vẽ — đúng cái màn trắng mà A11 tồn tại để chặn. Kho của dự án
   * KHÁC thì không vẽ (đang tải) cho tới khi lượt đọc của dự án này về (BUG-515).
   */
  const graph =
    storeGraph === null ? loadedGraph : storeProjectId === projectId ? storeGraph : null;
  const hasError = floorListQuery.isError;
  const isLoading = floorListQuery.isPending || graph === null;

  const levels = useMemo(() => levelsOf(graph), [graph]);

  /** Tầng của máy chủ theo mã. `Floor.drawings` là nơi DUY NHẤT biết số bản vẽ. */
  const floorsById = useMemo(() => {
    const table = new Map<string, Floor>();

    for (const floor of floorListQuery.data?.floors ?? []) {
      table.set(floor.id, floor);
    }

    return table;
  }, [floorListQuery.data]);

  /* ---------------------------------------------------------------------- */
  /* Ngăn xếp — đỉnh và đáy đọc từ M-11, màn không cộng cao độ.               */
  /* ---------------------------------------------------------------------- */

  const topMm = useMemo(() => stackTopMm(graph), [graph]);
  const bottomMm = useMemo(() => stackBottomMm(graph), [graph]);

  /**
   * Bề cao của cả ngăn xếp.
   *
   * Hiệu của hai số ĐÃ có: đỉnh (`ceilingElevationMm` của M-11) trừ đáy (cao độ
   * thấp nhất). Đây là bề cao của KHUNG VẼ, không phải cao độ của một tầng nào
   * — cao độ tầng vẫn chỉ do `restack` trong tầng lệnh quyết định.
   */
  const totalStackHeightMm =
    topMm === null || bottomMm === null ? Number.NaN : topMm - bottomMm;

  /**
   * Số chạy khi ngăn xếp đổi chiều cao.
   *
   * `useCountUp` chạy ở slot `standard` (260 ms) — thang chuyển động chỉ có năm
   * giá trị và 240 ms mà đặc tả ghi không nằm trên thang, nên `COUNT_UP_DURATION`
   * của `src/lib/motion/useCountUp.ts` đã chốt `standard`. `from` bằng chính
   * giá trị hiện tại nên lượt vẽ đầu KHÔNG chạy số; chỉ lần đổi sau mới chạy.
   */
  const totalHeightRun = useCountUp(totalStackHeightMm, {
    from: totalStackHeightMm,
    format: { fractionDigits: METRE_FRACTION_DIGITS },
  });

  /*
   * Đọc `value` chứ không `text`: `text` của `useCountUp` là `formatNumber`
   * trần, còn cột này cần chuỗi CÓ đơn vị mét. `formatLength` là chính hàm
   * `text` gọi bên dưới, nên mọi khung hình vẫn là một con số đúng định dạng.
   */
  const totalHeightText = `${heightMmText(totalHeightRun.value)} mm`;

  /* ---------------------------------------------------------------------- */
  /* Tiến độ QC — điểm sức khoẻ theo tầng (thay cho "P-03" không tồn tại).    */
  /* ---------------------------------------------------------------------- */

  const violationsByLevel = useMemo(() => {
    const table = new Map<string, readonly Violation[]>();

    for (const group of groupViolationsByLevel(violations)) {
      if (group.levelId !== null) {
        table.set(String(group.levelId), group.violations);
      }
    }

    return table;
  }, [violations]);

  /* ---------------------------------------------------------------------- */
  /* Đường ghi.                                                              */
  /* ---------------------------------------------------------------------- */

  const dispatchBundle = useMemo(
    () =>
      createFloorManagerDispatchDeps({
        graph: { read: () => useStore.getState().spatial },
        selectionBefore: () => ({ selectedIds: [] }),
        selectionAfter: () => ({ selectedIds: [] }),
        onSynced: () => {
          /*
           * Bước `sync` chỉ đánh dấu bản vẽ bẩn cho tự lưu (A7). Lượt ghi lên
           * máy chủ chạy ở chính hàm xử lý, sau khi `commit` đã cập nhật đồ thị
           * — xem `persistChangedLevels`.
           */
        },
      }),
    [],
  );

  const invalidate = useCallback(
    (floorId: string) => {
      applyInvalidation(queryClient, 'editFloor', { floorId, projectId });
    },
    [projectId, queryClient],
  );

  /** Nói ra một điều người dùng phải biết: toast (thấy được) VÀ aria-live (nghe được). */
  const say = useCallback(
    (title: string, sentence: string): void => {
      notifications.publish({
        type: FLOOR_PERSIST_FAILED_NOTIFICATION_TYPE,
        title,
        description: sentence,
      });
      announce(sentence);
    },
    [announce, notifications],
  );

  /**
   * Đếm lần đã nói "ghi máy chủ không xong". Vé GỘP chạy mọi vé con liền nhau; con đầu
   * thất bại (409 ...) thì con sau thấy đỉnh sổ đã đổi và nói "không còn là gần nhất",
   * ĐÈ lên câu lý do thật (cùng loại thông báo, cùng ô, BUG 11F-B-202). Con sau chỉ im
   * khi có một lần thất bại xảy ra trong lúc nó xếp hàng.
   */
  const failureCountRef = useRef(0);

  /** Nói ra một lượt ghi máy chủ KHÔNG xong — cấm im lặng, cấm bịa một lượt lưu. */
  const reportFailure = useCallback(
    (error: unknown): void => {
      failureCountRef.current += 1;
      say(FLOOR_MANAGER_TEXT.persistFailedTitle, floorErrorSentence(error));
    },
    [say],
  );

  /** Ngữ cảnh lệnh đọc đồ thị MỚI NHẤT — không phải bản chụp của lượt vẽ này. */
  const readContext = useCallback((): CommandContext | null => {
    const current = gateway.graph.read();

    return current === null ? null : { graph: current, actorId: gateway.actorId };
  }, [gateway]);

  /**
   * Mốc máy khách của lần xoá thành công (#11) — chỉ để tính cửa sổ khôi phục
   * 570 s. KHÔNG phải kho tầng: dữ liệu tầng vẫn chỉ nằm ở đồ thị và máy chủ.
   */
  const removedAtRef = useRef(new Map<string, number>());

  /** Mọi thao tác tầng của một dự án nối đuôi nhau trong MỘT hàng đợi. */
  const queueKey = `floors:${projectId}`;

  const removeRequest = useCallback(
    (floorId: string): FloorRequest =>
      async () => {
        const result = await gateway.persistRemoveFloor({ projectId, floorId });

        if (result.ok) {
          removedAtRef.current.set(floorId, gateway.now());
        }

        return result;
      },
    [gateway, projectId],
  );

  const createRequest = useCallback(
    (level: Level): FloorRequest =>
      async () => {
        const result = await gateway.persistAddFloor({ projectId, level });

        if (result.ok) {
          removedAtRef.current.delete(String(level.id));
        }

        return result;
      },
    [gateway, projectId],
  );

  const patchRequest = useCallback(
    (level: Level): FloorRequest =>
      () =>
        gateway.persistFloorFields({
          projectId,
          floorId: String(level.id),
          body: floorWriteBodyOf(level),
        }),
    [gateway, projectId],
  );

  /**
   * #34 cho những tầng mà lệnh THẬT SỰ đổi.
   *
   * Đọc thẳng ảnh chụp `after` của từng `change` — dữ liệu đã có trong tay, nên
   * không phải đoán tầng nào đã dịch. Trùng mã thì bản sau thắng.
   */
  const patchRequestsOf = useCallback(
    (commands: readonly Command[]): readonly FloorRequest[] => {
      const changed = new Map<string, Level>();

      for (const command of commands) {
        for (const change of command.changes) {
          if (change.kind === 'level' && change.after !== null) {
            changed.set(String(change.after.id), change.after);
          }
        }
      }

      return [...changed.values()].map(patchRequest);
    },
    [patchRequest],
  );

  /** Chạy một lệnh qua đủ năm bước; `false` khi vai trò không cho sửa hoặc lệnh rỗng. */
  const run = useCallback(
    async (command: Command | null): Promise<boolean> => {
      if (!canEdit || command === null) {
        return false;
      }

      const result = await runFloorCommand(command, dispatchBundle);

      if (result.ok) {
        invalidate(String(command.scope.levelIds[0] ?? projectId));
      }

      return result.ok;
    },
    [canEdit, dispatchBundle, invalidate, projectId],
  );

  /** Chạy NHIỀU lệnh như MỘT bước lịch sử (QĐ-2). */
  const runAll = useCallback(
    async (commands: readonly Command[], label: string): Promise<boolean> => {
      if (!canEdit || commands.length === 0) {
        return false;
      }

      const result = await runFloorTransaction(commands, dispatchBundle, label);

      if (result.ok) {
        invalidate(String(commands[0]?.scope.levelIds[0] ?? projectId));
      }

      return result.ok;
    },
    [canEdit, dispatchBundle, invalidate, projectId],
  );

  /**
   * Một bước thuận: dựng lệnh, `dispatch` cục bộ, rồi gửi máy chủ — TẤT CẢ trong
   * một task của hàng đợi, nên bước hỏng luôn còn ở đỉnh khi ta xét lùi.
   *
   * Request ĐẦU hỏng → lùi cả bước, cục bộ, không gửi thêm gì. Request sau hỏng
   * (máy chủ đã nhận request đầu) → giữ bước, chỉ nói ra.
   */
  const executeStep = useCallback(
    (build: (context: CommandContext) => FloorStepPlan | null): Promise<void> =>
      runExclusive(queueKey, async () => {
        const context = readContext();
        const plan = context === null ? null : build(context);

        if (plan === null) {
          return;
        }

        const [only] = plan.commands;
        const applied =
          plan.commands.length === 1 && only !== undefined
            ? await run(only)
            : await runAll(plan.commands, plan.label);

        if (!applied) {
          return;
        }

        const { history, deps } = dispatchBundle;
        const stepId = history.undoSteps().at(-1)?.id;

        plan.onApplied?.(stepId);

        const failure = await sendInOrder(plan.requests);

        if (failure === null) {
          await plan.onSynced?.();

          return;
        }

        if (
          failure.index === 0 &&
          stepId !== undefined &&
          history.undoSteps().at(-1)?.id === stepId
        ) {
          const transition = history.undo();

          if (transition !== null) {
            deps.spatial.revertPatches?.(transition.patches);
            invalidate(String(plan.commands[0]?.scope.levelIds[0] ?? projectId));
          }
        }

        reportFailure(failure.error);
      }).catch((error: unknown) => {
        reportFailure(error);
      }),
    [dispatchBundle, invalidate, projectId, queueKey, readContext, reportFailure, run, runAll],
  );

  /** Kế hoạch nghịch đảo của một bước, dựng SAU khi đồ thị đã lùi cục bộ. */
  const inverseRequestsOf = useCallback(
    (changes: readonly LevelChangeSummary[]): readonly FloorRequest[] => {
      const structural: FloorRequest[] = [];
      const fields: FloorRequest[] = [];

      for (const change of changes) {
        if (change.before === null) {
          structural.push(removeRequest(change.id));
        } else if (change.after === null) {
          structural.push(createRequest(change.before));
        } else {
          fields.push(patchRequest(change.before));
        }
      }

      const orderChanged = changes.some(
        (change) =>
          change.before !== null &&
          change.after !== null &&
          change.before.order !== change.after.order,
      );
      const reorder: FloorRequest[] = orderChanged
        ? [
            () =>
              gateway.persistReorderFloors({
                projectId,
                floorIds: [...levelsOf(gateway.graph.read())]
                  .sort((first, second) => first.order - second.order)
                  .map((level) => String(level.id)),
              }),
          ]
        : [];

      return [...structural, ...reorder, ...fields];
    },
    [createRequest, gateway, patchRequest, projectId, removeRequest],
  );

  /**
   * Hoàn tác MỘT bước — và gọi máy chủ để nó đổi theo (A8). Vé 8 giây và Mod+Z
   * cùng đi qua đây. `expectedStepId` là bước mà vé ghi lúc phát: tới lúc bấm mà
   * bước đó không còn ở đỉnh thì KHÔNG hoàn tác bước khác.
   */
  const applyUndo = useCallback(
    (expectedStepId?: UndoEntryId): Promise<boolean> => {
      const failuresAtCall = failureCountRef.current;

      return runExclusive(queueKey, async (): Promise<boolean> => {
        if (!canEdit) {
          return false;
        }

        const { history, deps } = dispatchBundle;
        const step = history.undoSteps().at(-1);

        if (step === undefined) {
          if (expectedStepId !== undefined) {
            say(FLOOR_MANAGER_TEXT.undoRefusedTitle, FLOOR_MANAGER_TEXT.undoNotLatest);
          }

          return false;
        }

        if (expectedStepId !== undefined && step.id !== expectedStepId) {
          if (failureCountRef.current === failuresAtCall) {
            say(FLOOR_MANAGER_TEXT.undoRefusedTitle, FLOOR_MANAGER_TEXT.undoNotLatest);
          }

          return false;
        }

        const changes = levelChangesOfStep(step);
        const now = gateway.now();
        const isExpired = changes.some((change) => {
          const removedAt = removedAtRef.current.get(change.id);

          return (
            change.after === null &&
            (removedAt === undefined || now - removedAt > FLOOR_RESTORE_WINDOW_MS)
          );
        });

        if (isExpired) {
          say(FLOOR_MANAGER_TEXT.undoRefusedTitle, FLOOR_MANAGER_TEXT.undoExpired);

          return false;
        }

        const transition = history.undo();

        if (transition === null) {
          return false;
        }

        deps.spatial.applyPatches(transition.patches);
        invalidate(changes[0]?.id ?? projectId);

        const failure = await sendInOrder(inverseRequestsOf(changes));

        if (failure === null) {
          return true;
        }

        if (failure.index === 0 && history.redoSteps()[0]?.id === step.id) {
          const redone = history.redo();

          if (redone !== null) {
            deps.spatial.revertPatches?.(redone.patches);
            invalidate(changes[0]?.id ?? projectId);
          }
        }

        reportFailure(failure.error);

        return false;
      }).catch((error: unknown) => {
        reportFailure(error);

        return false;
      });
    },
    [
      canEdit,
      dispatchBundle,
      gateway,
      inverseRequestsOf,
      invalidate,
      projectId,
      queueKey,
      reportFailure,
      say,
    ],
  );

  const onUndo = useCallback(() => {
    void applyUndo();
  }, [applyUndo]);

  /**
   * Vé hoàn tác 8 giây + toast (A8). KHÔNG hộp thoại.
   *
   * `UNDO_WINDOW_MS` là mặc định của `createUndoTicket`, nên con số 8000 không
   * xuất hiện ở màn (R-71). Vé ghi id bước lúc phát.
   */
  const publishUndoTicket = useCallback(
    (type: string, description: string, stepId: UndoEntryId | undefined) => {
      const ticket = createFloorUndoTicket({
        description,
        now: gateway.now,
        undo: () => {
          void applyUndo(stepId);
        },
      });

      notifications.publish({ type, title: description, description: '', undoTicket: ticket });
    },
    [applyUndo, gateway, notifications],
  );

  /**
   * Đọc lại báo cáo căn tầng của M-11 sau một lượt xếp chồng, và NÓI RA vấn đề
   * nặng nhất bằng chính câu `FloorIssue.message` của domain.
   */
  const announceStackIssue = useCallback(() => {
    const current = gateway.graph.read();
    const issue = worstStackIssue(alignFloors(floorPlansOf(current)));

    if (issue !== null) {
      announce(issue.message);
    }
  }, [announce, gateway]);

  /* ---------------------------------------------------------------------- */
  /* Chọn, trỏ, thu gọn, công tắc.                                           */
  /* ---------------------------------------------------------------------- */

  const onSelectFloor = useCallback((floorId: string | null) => {
    setSelectedFloorId(floorId);
  }, []);

  const onHoverFloor = useCallback((floorId: string | null) => {
    setHoveredFloorId(floorId);
  }, []);

  const onToggleCollapsed = useCallback(() => {
    setOwnCollapsed((previous) => !previous);
  }, []);

  /**
   * Công tắc "Tự động tính cao độ".
   *
   * KHUNG ĐỌC của màn, không phải thay đổi mô hình — cùng loại với
   * `ghostEnabled` của `AxisGridManager`, nên A8 không đòi hoàn tác nó. Bật thì
   * ô cao độ chỉ đọc và cao độ hiển thị là cao độ mà `restack` đã dồn từ mốc
   * chuẩn; tắt thì người dùng gõ đè được. Màn KHÔNG tự cộng cao độ ở cả hai
   * nhánh: con số vẫn luôn là con số trong mô hình.
   */
  const onToggleAutoElevation = useCallback(() => {
    // Câu lỗi cao độ cũ không còn đúng sau khi cao độ được tính lại (G3-19).
    setDuplicateElevation(null);
    setIsAutoElevation((previous) => !previous);
  }, []);

  const onToggleHiddenIn3d = useCallback(
    (floorId: string) => {
      setHiddenFloorIds((previous) =>
        previous.includes(floorId)
          ? previous.filter((id) => id !== floorId)
          : [...previous, floorId],
      );

      /*
       * Cổng thật PATCH `hiddenIn3d` (W4b); hỏng thì trả lại lựa chọn cũ. Cổng không có
       * đường lưu (mẫu) giữ cờ trong phiên và nói ra điều đó.
       */
      const isHidden = !hiddenFloorIds.includes(floorId);

      void gateway.persistHiddenIn3d({ projectId, floorId, isHidden }).then((result) => {
        if (result.supported) {
          return;
        }

        announce(result.notice);

        if (gateway.supports.hideFloorFrom3d) {
          setHiddenFloorIds((previous) =>
            isHidden ? previous.filter((id) => id !== floorId) : [...previous, floorId],
          );
        }
      });
    },
    [announce, gateway, hiddenFloorIds, projectId],
  );

  const onUploadDrawing = useCallback(
    (floorId: string) => {
      setSelectedFloorId(floorId);

      if (options.onNavigateToDrawings === undefined) {
        announce(FLOOR_MANAGER_TEXT.uploadDrawingHint);

        return;
      }

      options.onNavigateToDrawings(floorId);
    },
    [announce, options],
  );

  const onRetry = useCallback(() => {
    void floorListQuery.refetch();
  }, [floorListQuery]);

  /* ---------------------------------------------------------------------- */
  /* Sửa ba ô.                                                               */
  /* ---------------------------------------------------------------------- */

  const draftOf = useCallback(
    (level: Level): FloorRowDraft =>
      drafts[String(level.id)] ?? {
        name: level.name,
        elevation: metreDraftText(level.elevationMm),
        height: metreDraftText(level.heightMm),
      },
    [drafts],
  );

  const onFloorFieldChange = useCallback(
    (floorId: string, field: FloorEditableField, draftValue: string) => {
      setEditing({ floorId, field });
      /* Bộ đệm mới gieo từ giá trị đang có của tầng, không từ chuỗi rỗng: khi cao độ bị
         từ chối, bộ đệm được giữ để người dùng sửa tiếp, và hai ô kia (tên, chiều cao)
         từng hiện trống vì đọc đúng bộ đệm rỗng đó (BUG-306). */
      const level = levels.find((candidate) => String(candidate.id) === floorId);
      const seed: FloorRowDraft =
        level === undefined
          ? { name: '', elevation: '', height: '' }
          : { name: level.name, elevation: metreDraftText(level.elevationMm), height: metreDraftText(level.heightMm) };

      updateDrafts((previous) => ({
        ...previous,
        [floorId]: { ...(previous[floorId] ?? seed), [field]: draftValue },
      }));
    },
    [levels, updateDrafts],
  );

  const onFloorFieldCancel = useCallback(
    (floorId: string) => {
      setEditing(null);
      setDuplicateElevation(null);
      updateDrafts((previous) => withoutDraft(previous, floorId));
    },
    [updateDrafts],
  );

  /**
   * Rời tiêu điểm hoặc Enter — giá trị đã CHỐT.
   *
   * `NumericField` chỉ báo giá trị khi chốt (debounce 800 ms hoặc blur/Enter,
   * `useNumericField.ts:14,86`), nên hook KHÔNG thêm một lớp debounce thứ hai và
   * không có con số 800 nào ở màn (R-71).
   */
  const onFloorFieldCommit = useCallback(
    (floorId: string, field: FloorEditableField) => {
      setEditing(null);

      const context = readContext();
      const draft = draftsRef.current[floorId];

      if (context === null || draft === undefined) {
        return;
      }

      const levelId = floorId as LevelId;
      const clearDraft = (): void => {
        updateDrafts((previous) => withoutDraft(previous, floorId));
      };

      if (field === 'name') {
        clearDraft();

        void executeStep((fresh) => {
          const result = createRenameFloorCommand({ levelId, name: draft.name }, fresh);

          if (!result.ok) {
            say(FLOOR_MANAGER_TEXT.renameRefusedTitle, result.error.reasons.join(' '));

            return null;
          }

          return {
            commands: [result.data],
            label: result.data.description,
            requests: patchRequestsOf([result.data]),
            onApplied: (stepId) => {
              publishUndoTicket(FLOOR_RENAME_NOTIFICATION_TYPE, RENAME_FLOOR_TOAST_DESCRIPTION, stepId);
            },
          };
        });

        return;
      }

      const valueMm = draftToMillimetres(field === 'elevation' ? draft.elevation : draft.height);

      if (valueMm === null) {
        clearDraft();

        return;
      }

      if (field === 'elevation') {
        const conflict = findElevationConflict({ levelId, elevationMm: valueMm }, context);

        if (conflict !== null) {
          const message = conflict.reasons.join(' ');

          setDuplicateElevation({ floorId, message, violation: conflict.violation });
          announce(message);

          return;
        }

        setDuplicateElevation(null);
        clearDraft();

        void executeStep((fresh) => {
          const result = createChangeLevelElevationCommand({ levelId, elevationMm: valueMm }, fresh);

          return result.ok
            ? {
                commands: [result.data],
                label: result.data.description,
                requests: patchRequestsOf([result.data]),
                onApplied: (stepId) => {
                  publishUndoTicket(
                    FLOOR_ELEVATION_NOTIFICATION_TYPE,
                    CHANGE_ELEVATION_TOAST_DESCRIPTION,
                    stepId,
                  );
                  announceStackIssue();
                },
              }
            : null;
        });

        return;
      }

      clearDraft();

      // Nói ngưỡng thay vì để máy chủ từ chối rồi quay về giá trị cũ (G3-18).
      if (valueMm < MIN_FLOOR_HEIGHT_MM) {
        say(FLOOR_MANAGER_TEXT.heightRefusedTitle, FLOOR_MANAGER_TEXT.heightTooLow);

        return;
      }

      void executeStep((fresh) => {
        const built = createChangeFloorHeightCommands({ levelId, heightMm: valueMm }, fresh);

        return built.ok
          ? {
              commands: built.commands,
              label: built.commands[0]?.description ?? '',
              requests: patchRequestsOf(built.commands),
              onApplied: (stepId) => {
                publishUndoTicket(
                  FLOOR_HEIGHT_NOTIFICATION_TYPE,
                  CHANGE_HEIGHT_TOAST_DESCRIPTION,
                  stepId,
                );
                announceStackIssue();
              },
            }
          : null;
      });
    },
    [
      announce,
      announceStackIssue,
      executeStep,
      patchRequestsOf,
      publishUndoTicket,
      readContext,
      say,
      updateDrafts,
    ],
  );

  /* ---------------------------------------------------------------------- */
  /* Thêm, nhân bản, xoá, đổi thứ tự.                                        */
  /* ---------------------------------------------------------------------- */

  /** Đủ trần thì báo câu và KHÔNG dựng lệnh — dựng rồi mới bị từ chối là "tầng ma". */
  const isAtFloorLimit = useCallback(
    (context: CommandContext): boolean => {
      if (levelsOf(context.graph).length < PROJECT_LIMITS.floorCountMax) {
        return false;
      }

      say(FLOOR_MANAGER_TEXT.addRefusedTitle, FLOOR_MANAGER_TEXT.limitReached);

      return true;
    },
    [say],
  );

  const onAddFloor = useCallback(() => {
    void executeStep((context) => {
      if (isAtFloorLimit(context)) {
        return null;
      }

      const result = createAddFloorCommand(
        { id: gateway.nextLevelId(), name: nextNewFloorName(levelsOf(context.graph)) },
        context,
      );
      const added = result.ok ? addedLevelOf(result.data) : null;

      return result.ok && added !== null
        ? {
            commands: [result.data],
            label: result.data.description,
            requests: [createRequest(added)],
            onApplied: (stepId) => {
              publishUndoTicket(FLOOR_ADD_NOTIFICATION_TYPE, ADD_FLOOR_TOAST_DESCRIPTION, stepId);
            },
          }
        : null;
    });
  }, [createRequest, executeStep, gateway, isAtFloorLimit, publishUndoTicket]);

  const onDuplicateFloor = useCallback(
    (floorId: string, duplicateOptions: { readonly copyFurniture: boolean }) => {
      void executeStep((context) => {
        const source = levelsOf(context.graph).find((level) => String(level.id) === floorId);

        if (source === undefined || isAtFloorLimit(context)) {
          return null;
        }

        const result = createDuplicateFloorCommand(
          {
            sourceLevelId: source.id,
            targetLevelId: gateway.nextLevelId(),
            name: duplicateFloorName(source.name),
            copyFurniture: duplicateOptions.copyFurniture,
          },
          context,
        );
        const added = result.ok ? addedLevelOf(result.data) : null;

        if (!result.ok || added === null) {
          return null;
        }

        return {
          commands: [result.data],
          label: result.data.description,
          requests: [createRequest(added)],
          onApplied: (stepId) => {
            publishUndoTicket(
              FLOOR_DUPLICATE_NOTIFICATION_TYPE,
              duplicateFloorToastDescription(source.name),
              stepId,
            );
          },
          onSynced: async () => {
            /* Ghi lớp của tầng mới (#35); hỏng hay cổng không ghi được thì nói ra, đừng im. */
            const contents = await gateway.persistFloorContents({ projectId, floorId: String(added.id) });

            if (!contents.supported) {
              setHasUnsavedContents(true);
              announce(contents.notice);
            }
          },
        };
      });
    },
    [announce, createRequest, executeStep, gateway, isAtFloorLimit, projectId, publishUndoTicket],
  );

  const onRemoveFloor = useCallback(
    (floorId: string) => {
      void executeStep((context) => {
        const level = levelsOf(context.graph).find((entry) => String(entry.id) === floorId);
        const result =
          level === undefined ? null : createRemoveFloorCommand({ levelId: level.id }, context);

        if (level === undefined || result === null || !result.ok) {
          return null;
        }

        return {
          commands: [result.data],
          label: result.data.description,
          requests: [removeRequest(floorId)],
          onApplied: (stepId) => {
            setHasUnsavedContents(true);

            if (selectedFloorId === floorId) {
              setSelectedFloorId(null);
            }

            publishUndoTicket(
              FLOOR_REMOVE_NOTIFICATION_TYPE,
              removeFloorToastDescription(level.name),
              stepId,
            );
          },
        };
      });
    },
    [executeStep, publishUndoTicket, removeRequest, selectedFloorId],
  );

  const onReorderFloors = useCallback(
    (floorIdsBottomUp: readonly string[]) => {
      setDuplicateElevation(null);
      void executeStep((context) => {
        const result = createReorderLevelsCommand(
          { levelIds: floorIdsBottomUp.map((id) => id as LevelId) },
          context,
        );

        if (!result.ok) {
          return null;
        }

        return {
          commands: [result.data],
          label: result.data.description,
          requests: [
            () => gateway.persistReorderFloors({ projectId, floorIds: floorIdsBottomUp }),
            ...patchRequestsOf([result.data]),
          ],
          onApplied: (stepId) => {
            const names = floorIdsBottomUp.map(
              (id) => levelsOf(context.graph).find((entry) => String(entry.id) === id)?.name ?? '',
            );
            const warning = misplacedFloorNameWarning(names);

            publishUndoTicket(
              FLOOR_REORDER_NOTIFICATION_TYPE,
              warning === null ? REORDER_FLOORS_TOAST_DESCRIPTION : `${REORDER_FLOORS_TOAST_DESCRIPTION} ${warning}`,
              stepId,
            );
            announceStackIssue();
          },
        };
      });
    },
    [announceStackIssue, executeStep, gateway, patchRequestsOf, projectId, publishUndoTicket],
  );

  /* ---------------------------------------------------------------------- */
  /* Phím tắt (A12) — không một `addEventListener` nào (R-72).                */
  /* ---------------------------------------------------------------------- */

  const shortcutOptions = useMemo(
    () => (options.registry === undefined ? {} : { registry: options.registry }),
    [options.registry],
  );

  useShortcut(
    {
      id: 'floorManager.undo',
      combo: 'Mod+Z',
      scope: 'canvas',
      description: FLOOR_MANAGER_TEXT.shortcutUndo,
      onTrigger: onUndo,
    },
    { ...shortcutOptions, enabled: canEdit },
  );

  /* ---------------------------------------------------------------------- */
  /* View-model — ĐỊNH DẠNG SỐ XẢY RA Ở ĐÂY, không ở view (A15).              */
  /* ---------------------------------------------------------------------- */

  /**
   * Đếm tường / phòng / diện tích của từng tầng, đọc qua `idsOnLevel` (D-12).
   *
   * Một tầng CHƯA có bản vẽ thì chưa đếm được gì — bảng hiện `"—"`
   * (`MISSING_VALUE`), không hiện `0`, vì `0` là một phép đếm đã chạy xong.
   */
  const countsByLevel = useMemo(() => {
    const table = new Map<
      string,
      {
        readonly wallCount: number;
        readonly roomCount: number;
        readonly areaM2: number;
        readonly roomOutlinesMm: readonly (readonly PointMm[])[];
      }
    >();

    for (const level of levels) {
      const id = String(level.id);
      const drawingCount = floorsById.get(id)?.drawings.length ?? 0;

      if (drawingCount === 0) {
        continue;
      }

      table.set(id, {
        wallCount: wallCountOfLevel(graph, level.id),
        roomCount: roomsOfLevel(graph, level.id).length,
        areaM2: areaOfLevel(graph, level.id),
        roomOutlinesMm: roomOutlinesOfLevel(graph, level.id),
      });
    }

    return table;
  }, [floorsById, graph, levels]);

  const rows = useMemo<readonly FloorRowVm[]>(() => {
    if (hasError) {
      return NO_ROWS;
    }

    return levels.map((level, index) => {
      const id = String(level.id);
      const below = levels[index - 1];
      const drawingCount = floorsById.get(id)?.drawings.length ?? 0;
      const hasDrawing = drawingCount > 0;
      const counts = countsByLevel.get(id) ?? null;
      const health = explainHealthScore(violationsByLevel.get(id) ?? NO_VIOLATIONS);
      /* Chưa có bản vẽ thì chưa có gì để kiểm: không có vi phạm KHÔNG có nghĩa là 100% (BUG-263). */
      const qcProgressRatio = hasDrawing ? health.score / HEALTH_SCORE_MAX : 0;
      const scaleState: ScaleState =
        hasDrawing && graph !== null ? floorRowScaleStateOf(graph, level, floorMeta[id]) : 'confirmed';

      return {
        id,
        name: level.name,
        elevationText: metreText(level.elevationMm),
        elevationMm: millimetres(level.elevationMm),
        isElevationOverridden: isElevationOverridden(level, below),
        heightText: metreText(level.heightMm),
        heightMm: millimetres(level.heightMm),
        drawingCountText: drawingCountText(drawingCount),
        drawingCount,
        hasDrawing,
        wallCountText: countText(counts?.wallCount ?? null),
        roomCountText: countText(counts?.roomCount ?? null),
        areaText: counts === null ? MISSING_VALUE : measureTextOfState(formatArea(counts.areaM2), scaleState),
        areaM2: counts === null ? null : squareMetres(counts.areaM2),
        qcProgressText: !hasDrawing ? MISSING_VALUE : qcProgressRatio === 0 ? QC_NOT_GRADED : formatPercent(qcProgressRatio, { fractionDigits: 0 }),
        qcProgressRatio,
        isSelected: selectedFloorId === id,
        isHovered: hoveredFloorId === id,
        needsDrawing: !hasDrawing,
        isScaleMissing: scaleState === 'missing',
        scaleState,
        isHiddenIn3d: hiddenFloorIds.includes(id),
        isElevationRefused: duplicateElevation?.floorId === id,
        draft: draftOf(level),
        editingField: editing?.floorId === id ? editing.field : null,
      };
    });
  }, [
    countsByLevel,
    draftOf,
    duplicateElevation,
    editing,
    floorMeta,
    floorsById,
    graph,
    hasError,
    hiddenFloorIds,
    hoveredFloorId,
    levels,
    selectedFloorId,
    violationsByLevel,
  ]);

  /* K19: các tầng không chung trục nào — dữ liệu trục có sẵn trong đồ thị, cùng phép căn của màn Trục. */
  const axisMismatchNotice = useMemo(
    () => (graph !== null && hasNoSharedAxes(alignFloors(floorPlansOf(graph))) ? NO_SHARED_AXES_NOTICE : null),
    [graph],
  );

  const bands = useMemo<readonly SectionBandVm[]>(() => {
    if (rows.length === 0 || !Number.isFinite(totalStackHeightMm) || totalStackHeightMm <= 0) {
      return NO_BANDS;
    }

    // Mép dưới của dải là cao độ của tầng, không phải đỉnh dải trước: cao độ ghi đè để hở
    // một khoảng giữa hai tầng thì khoảng ấy nằm DƯỚI dải, không dồn lên đỉnh (BUG-357).
    let previousTopMm: number = bottomMm ?? 0;

    return rows.map((row) => {
      const gapBelowMm = Math.max(0, row.elevationMm - previousTopMm);
      previousTopMm = Math.max(previousTopMm, row.elevationMm + row.heightMm);

      return {
        levelId: row.id,
        label: bandLabel(row.name, row.heightMm),
        bandHeightRatio: row.heightMm / totalStackHeightMm,
        gapBelowRatio: gapBelowMm / totalStackHeightMm,
        isSelected: row.isSelected,
        isHovered: row.isHovered,
        isHiddenIn3d: row.isHiddenIn3d,
        needsDrawing: row.needsDrawing,
      };
    });
  }, [bottomMm, rows, totalStackHeightMm]);

  const elevationTicks = useMemo<readonly ElevationTickVm[]>(() => {
    if (bottomMm === null || topMm === null || !Number.isFinite(totalStackHeightMm)) {
      return NO_TICKS;
    }

    const marks: { readonly id: string; readonly valueMm: number }[] = levels.map((level) => ({
      id: String(level.id),
      valueMm: level.elevationMm,
    }));

    marks.push({ id: 'stack-top', valueMm: topMm });

    return marks.map((mark) => {
      const offsetRatio =
        totalStackHeightMm <= 0 ? 0 : (mark.valueMm - bottomMm) / totalStackHeightMm;

      return {
        id: mark.id,
        labelText: elevationSignedText(mark.valueMm),
        offsetRatio,
        offsetCssPercent: cssPercentOf(offsetRatio),
      };
    });
  }, [bottomMm, levels, topMm, totalStackHeightMm]);

  const footer = useMemo<FloorTableFooterVm>(() => {
    // Tổng chân bảng: mọi đường bao của các tầng đã đếm, cộng mm² rồi làm tròn MỘT lần (K5).
    let areaOutlines: (readonly PointMm[])[] | null = null;
    let wallTotal: number | null = null;
    let roomTotal: number | null = null;

    /* Tầng nào góp số vào tổng thì góp cả trạng thái tỷ lệ của nó: tổng trộn tầng đo được với tầng
       ước mà không dấu, không tên tầng, thì người đọc tưởng cả toà nhà đã đo (R10 làn S). */
    const countedFloors: FloorMeasureRef[] = [];

    for (const row of rows) {
      const counts = countsByLevel.get(row.id);

      if (counts === undefined) {
        continue;
      }

      countedFloors.push({ name: row.name, state: row.scaleState });
      areaOutlines = [...(areaOutlines ?? []), ...counts.roomOutlinesMm];
      wallTotal = (wallTotal ?? 0) + counts.wallCount;
      roomTotal = (roomTotal ?? 0) + counts.roomCount;
    }

    return {
      floorCountText: floorCountText(rows.length),
      totalHeightText,
      totalAreaText:
        areaOutlines === null ? MISSING_VALUE : totalMeasureTextOf(formatArea(totalArea(areaOutlines)), countedFloors),
      totalWallCountText: countText(wallTotal),
      totalRoomCountText: countText(roomTotal),
    };
  }, [countsByLevel, rows, totalHeightText]);

  const needsDrawingCount = rows.filter((row) => row.needsDrawing).length;

  const state = deriveFloorManagerScreenState({
    isViewerRole,
    isCollapsed,
    hasError,
    isLoading,
    rowCount: rows.length,
    needsDrawingCount,
  });

  const isProjectMissing = hasError && toAppError(floorListQuery.error).kind === 'notFound';

  const errorMessage = useMemo(() => {
    if (!hasError) {
      return null;
    }

    if (isProjectMissing) {
      // Cùng câu với 404 của `ProjectSpatialGate` — nhập, không chép (BUG-032).
      return PROJECT_NOT_FOUND_DESCRIPTION;
    }

    return describeError(toAppError(floorListQuery.error)).description;
  }, [floorListQuery.error, hasError, isProjectMissing]);

  // Câu "ẩn khỏi 3D không lưu" chỉ đúng khi đang có tầng ẩn; nói trước đó là cảnh báo về
  // một việc chưa xảy ra (BUG-287).
  const hasHiddenFloor = hiddenFloorIds.length > 0;
  const unsupportedNotices = useMemo(
    () =>
      FLOOR_MANAGER_MISSING_CAPABILITIES.filter(
        (capability) =>
          !gateway.supports[capability] &&
          (capability !== 'hideFloorFrom3d' || hasHiddenFloor) &&
          /* Câu nhân bản/xoá tầng chỉ nói với người làm được hai việc đó (BUG-521). */
          /* …và chỉ sau khi đã nhân bản/xoá tầng trong phiên này (G3-16). */
          (capability !== 'persistFloorContents' || (canEdit && hasUnsavedContents)),
      ).map((capability) => FLOOR_MANAGER_UNSUPPORTED_NOTICES[capability]),
    [canEdit, gateway, hasHiddenFloor, hasUnsavedContents],
  );

  return {
    state,

    rows,
    bands,
    elevationTicks,
    totalHeightText,
    footer,

    canEdit,
    isCollapsed,
    isCompact: options.isCompact ?? false,
    isAutoElevation,

    emptyNotice:
      state !== 'empty' ? null : canEdit ? FLOOR_MANAGER_TEXT.emptyNotice : FLOOR_MANAGER_TEXT.viewerEmptyNotice,
    errorMessage,
    isProjectMissing,
    forbiddenNotice: isViewerRole ? FLOOR_MANAGER_TEXT.forbiddenNotice : null,
    duplicateElevationMessage: duplicateElevation?.message ?? null,
    duplicateElevationViolation: duplicateElevation?.violation ?? null,

    onSelectFloor,
    onHoverFloor,

    onFloorFieldChange,
    onFloorFieldCommit,
    onFloorFieldCancel,

    onReorderFloors,

    onAddFloor,
    onDuplicateFloor,
    onToggleHiddenIn3d,
    onRemoveFloor,

    onToggleAutoElevation,
    onUploadDrawing,
    onToggleCollapsed,
    onRetry,
    onUndo,

    historyStepCount: () => dispatchBundle.history.undoSteps().length,
    canUndo: dispatchBundle.history.canUndo(),
    unsupportedNotices,
    axisMismatchNotice,
    projectName,
  };
}
