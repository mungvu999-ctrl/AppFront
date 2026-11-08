/**
 * Phép chuyển thuần của S-33 — từ dữ liệu phiên bản sang các mảnh của
 * `VersionHistoryModel`.
 *
 * Tách khỏi `useVersionHistory.ts` vì R-22: gộp lại thì một file vượt 400 dòng. Hai
 * file anh em còn lại cùng lý do — `versionHistoryScene.ts` giữ tab "Trực quan",
 * `versionHistoryCompare.ts` giữ cặp phiên bản đang so. File này **không có React**,
 * nên mọi hàm ở đây test được ngoài một cây React.
 *
 * Ba điều file này KHÔNG làm, và đó là chủ ý:
 *
 * - **Không tự so dữ liệu.** Số đếm của từng hàng đi qua `diffVersions`
 *   (`@/lib/versioning/diff`) — hàm thuần đã có; ở đây chỉ đếm `.length` của ba mảng
 *   nó trả về, đúng như ghi chú khảo sát nói: tầng logic không có sẵn hàm nào trả
 *   `{added, removed, changed}`.
 * - **Không tự ghép câu diff.** Mỗi câu tiếng thường là một lượt gọi `formatChange`
 *   (`@/lib/format/semantic`), và không có phép quy đổi đơn vị nào ở đây (R-61).
 * - **Không tự định dạng số.** `formatNumber`/`formatCalendarDate`/`formatClockTime`
 *   làm việc đó, nên dấu thập phân là dấu phẩy ở mọi nơi (A15).
 */

import {
  formatCalendarDate,
  formatClockTime,
  formatTimestamp,
  isSameCalendarDay,
} from '@/lib/format/datetime';
import { initialsOf } from '@/lib/format/initials';
import { formatNumber } from '@/lib/format/number';
import { formatChange } from '@/lib/format/semantic';
import {
  diffVersions,
  type DiffEntry,
  type EntityKind,
  type VersionDiff,
} from '@/lib/versioning/diff';
import type { FloorVersionSummary } from '@/api/schemas/versions';
import type { VersionEntry, VersionHistoryEntry } from '@/lib/versioning/restore';

import type {
  ConflictNoticeModel,
  DiffCountsModel,
  DiffGroupModel,
  DiffRowModel,
  DiffTone,
  JsonDiffLineModel,
  RestoreConfirmModel,
  VersionGroupModel,
  VersionRowModel,
} from './types';
import { RETENTION_NOTICE } from './versionHistoryGateway';

/* -------------------------------------------------------------------------- */
/* 1 — Từ vựng                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tên tiếng Việt của bảy loại đối tượng, cho tiêu đề nhóm diff.
 *
 * Chép đúng từ `ENTITY_LABELS` của `@/lib/format/semantic:135` thay vì nhập về: bảng
 * ấy **không được xuất**. Chữ phải trùng bảng kia vì mỗi hàng trong nhóm là một câu do
 * `formatChange` sinh ra từ chính bảng ấy — hai cách gọi khác nhau cho cùng một thứ
 * trên cùng một màn là lỗi người đọc thấy ngay. Cùng tiền lệ:
 * `ViolationDetail/useViolationDetail.ts:172` và `HistoryPanel/useHistoryPanel.model.ts:129`
 * đều khai bảng của riêng chúng.
 */
const ENTITY_KIND_LABELS: Readonly<Record<EntityKind, string>> = {
  dimension: 'Kích thước',
  door: 'Cửa đi',
  furniture: 'Nội thất',
  room: 'Phòng',
  roof: 'Mái',
  suggestion: 'Đề xuất',
  vertex: 'Điểm',
  wall: 'Tường',
  window: 'Cửa sổ',
};

/** Thứ tự đọc ba mảng diff: thêm trước, xoá sau, thay đổi cuối — đúng `describeChanges`. */
const TONE_ORDER: readonly DiffTone[] = ['added', 'removed', 'changed'];

/** Ngày hôm nay không đọc thành "08/09/2026" — người ta gọi nó là hôm nay. */
const TODAY_HEADING = 'Hôm nay';

/* -------------------------------------------------------------------------- */
/* 2 — Ba số đếm                                                              */
/* -------------------------------------------------------------------------- */

/** Chữ đầu viết hoa, phần còn lại giữ nguyên (A6, aesthetic 2.6 #1). */
export function sentenceCaseNote(note: string): string {
  return note.charAt(0).toLocaleUpperCase('vi') + note.slice(1);
}

/** Không có gì để so: ba số không, và một câu nói đúng điều đó. */

export const EMPTY_DIFF_COUNTS: DiffCountsModel = Object.freeze({
  added: 0,
  removed: 0,
  changed: 0,
  addedLabel: `thêm ${formatNumber(0)}`,
  removedLabel: `xoá ${formatNumber(0)}`,
  changedLabel: `sửa ${formatNumber(0)}`,
  ariaLabel: 'Không có thay đổi nào',
});

/**
 * Ba con số của một bản so, kèm nhãn đã định dạng.
 *
 * `ariaLabel` tồn tại vì ba chấm màu không đọc được thành lời: A4 cho đúng ba màu
 * trạng thái, và trình đọc màn hình không thấy màu nào cả.
 */
export function countsOf(diff: VersionDiff): DiffCountsModel {
  const added = diff.added.length;
  const removed = diff.removed.length;
  const changed = diff.changed.length;

  if (added === 0 && removed === 0 && changed === 0) {
    return EMPTY_DIFF_COUNTS;
  }

  return {
    added,
    removed,
    changed,
    addedLabel: `thêm ${formatNumber(added)}`,
    removedLabel: `xoá ${formatNumber(removed)}`,
    changedLabel: `sửa ${formatNumber(changed)}`,
    ariaLabel: `Thêm ${formatNumber(added)}, xoá ${formatNumber(removed)}, thay đổi ${formatNumber(changed)}`,
  };
}

/* -------------------------------------------------------------------------- */
/* 3 — Cột trái: hàng phiên bản và nhóm theo ngày                             */
/* -------------------------------------------------------------------------- */

/** Một hàng kèm mốc thời gian của nó — phép gộp theo ngày cần mốc, view thì không. */
export interface VersionRowBuild {
  readonly row: VersionRowModel;
  readonly createdAt: Date;
}

/**
 * `VersionMetadata.createdAt` là chuỗi ISO, còn `TimeInput` của `@/lib/format/datetime`
 * chỉ nhận `Date` hoặc số epoch — nên mọi mốc đi qua đây đúng một lần.
 */
function instantOf(iso: string): Date {
  return new Date(iso);
}

/**
 * Ảnh chụp đầy đủ của mục đứng NGAY SAU mục thứ `index` — tức bản cũ hơn liền kề.
 *
 * Dùng để đếm "phiên bản này đã đổi gì so với bản trước nó". Bản cũ hơn chỉ còn siêu
 * dữ liệu thì không so được, và hàng ấy mang ba số không thay vì một con số bịa.
 */
function previousFullVersion(
  history: readonly VersionHistoryEntry[],
  index: number,
): VersionEntry | null {
  const previous = history[index + 1];

  return previous !== undefined && previous.kind === 'full' ? previous.version : null;
}

export interface BuildRowsContext {
  readonly history: readonly VersionHistoryEntry[];
  readonly now: Date;
  readonly leftVersionId: string | null;
  readonly rightVersionId: string | null;
  /** Bản tóm tắt N17 theo id — `creatorName`, `label`, `floorRevision`. */
  readonly summaries: ReadonlyMap<string, FloorVersionSummary>;
  /** Bản hết nội dung: `hasSnapshot: false`, hoặc N18 trả "không còn nội dung". */
  readonly purgedIds: ReadonlySet<string>;
  /** `floorMeta[floorId].revision`; `null` khi chưa có — khi ấy không hàng nào là hiện tại. */
  readonly currentRevision: number | null;
  /** Bản có N18 hỏng tạm thời (không tính bản hết nội dung). */
  readonly failedIds?: ReadonlySet<string>;
  /** Bản có N18 đang nạp thật (đã bật truy vấn, chưa có dữ liệu, chưa hỏng). */
  readonly loadingIds?: ReadonlySet<string>;
}

/** Đã đủ dữ kiện để so revision: biết revision của tầng và ít nhất một bản có `floorRevision`. */
function hasKnownRevisions(
  history: readonly VersionHistoryEntry[],
  summaries: ReadonlyMap<string, FloorVersionSummary>,
  currentRevision: number | null,
): boolean {
  return (
    currentRevision !== null && history.some((entry) => summaries.get(entry.version.id)?.floorRevision !== undefined)
  );
}

/**
 * Câu đầu danh sách khi tầng đã sửa sau bản mới nhất (không hàng nào là "Hiện tại"); `null` khi có
 * hàng hiện tại hay chưa có hàng nào. Sửa tay không sinh phiên bản (HOP-DONG-MOI §5), nên đây là
 * chỗ duy nhất người dùng biết phục hồi bản mới nhất sẽ bỏ phần sửa ấy.
 */
export function unsavedEditsNotice(rows: readonly Pick<VersionRowModel, 'label' | 'isCurrent'>[]): string | null {
  const latest = rows[0];

  if (latest === undefined || rows.some((row) => row.isCurrent)) return null;

  return `Tầng đã sửa sau ${latest.label}, phần sửa này chưa lưu thành phiên bản. Phục hồi về ${latest.label} sẽ bỏ phần sửa ấy.`;
}

/**
 * Lịch sử thành hàng.
 *
 * `history` là mới-nhất-trước, đúng thứ tự `appendVersionToHistory` dựng ra, nên mục
 * thứ 0 là bản hiện tại và `index + 1` là bản cũ hơn liền kề.
 */
export function buildVersionRows(context: BuildRowsContext): readonly VersionRowBuild[] {
  const {
    currentRevision,
    failedIds,
    history,
    loadingIds,
    now,
    leftVersionId,
    purgedIds,
    rightVersionId,
    summaries,
  } = context;
  const pickedCount = (leftVersionId === null ? 0 : 1) + (rightVersionId === null ? 0 : 1);
  // HOP-DONG-MOI §5: hiện tại ⇔ `floorRevision` bằng revision của tầng. Chỉ khi chưa biết revision
  // (tầng chưa nạp, N17 chưa có `floorRevision`) mới tạm coi bản mới nhất là hiện tại. Biết rồi mà không
  // bản nào khớp = tầng đã sửa sau bản mới nhất: không hàng nào "Hiện tại", bản mới nhất phục hồi được
  // (bỏ phần sửa tay), và `unsavedEditsNotice` nói điều đó ở đầu danh sách.
  const revisionsKnown = hasKnownRevisions(history, summaries, currentRevision);

  return history.map((entry, index): VersionRowBuild => {
    const metadata = entry.version;
    const summary = summaries.get(metadata.id);
    const isMetadataOnly = purgedIds.has(metadata.id);
    const authorName = summary?.creatorName ?? metadata.creatorName ?? metadata.creatorId;
    const isSelectedForCompare = metadata.id === leftVersionId || metadata.id === rightVersionId;
    const previous = entry.kind === 'full' ? previousFullVersion(history, index) : null;
    const counts =
      entry.kind === 'full' && previous !== null
        ? countsOf(diffVersions(previous.snapshot, entry.version.snapshot))
        : EMPTY_DIFF_COUNTS;

    // Ảnh chụp của bản này hoặc bản liền trước chưa nạp: số liệu chưa biết, không phải "không đổi".
    // Chỉ xoay khi truy vấn N18 của hàng (hoặc bản liền trước) thật sự đang chạy; hàng ngoài
    // tầm nạp hay bản trước đã hết nội dung thì "chưa so được", không xoay mãi (RV2#1).
    const isFailed = failedIds?.has(metadata.id) === true;
    const previousEntry = history[index + 1];
    const awaitedId =
      entry.kind !== 'full'
        ? metadata.id
        : previousEntry !== undefined && previous === null
          ? previousEntry.version.id
          : null;
    const isCountsPending = !isMetadataOnly && !isFailed && awaitedId !== null;
    const isCountsLoading = isCountsPending && loadingIds?.has(awaitedId) === true;
    const isCountsUnknown = isCountsPending && !isCountsLoading;

    const createdAt = instantOf(metadata.createdAt);

    return {
      createdAt,
      row: {
        id: metadata.id,
        label: `v${formatNumber(metadata.sequence, { grouping: false })}`,
        // Server notes start lower-case ("phục hồi nội dung của phiên bản v3"); a row reads as a sentence (A6).
        description: typeof metadata.note === 'string' ? sentenceCaseNote(metadata.note) : 'Không có ghi chú cho phiên bản này',
        // `creatorName` do máy chủ ghép (N17); `system:pipeline` đã thành "hệ thống AI".
        authorName,
        authorInitials: initialsOf(authorName),
        // Không có nguồn ảnh đại diện nào ở tầng logic, nên ô đại diện dựng bằng chữ
        // cái đầu — một đường dẫn bịa ra còn tệ hơn một ô chữ thành thật (R-69).
        avatarUrl: null,
        relativeTimeLabel: formatTimestamp(createdAt, now),
        absoluteTimeLabel: `${formatCalendarDate(createdAt)} ${formatClockTime(createdAt)}`,
        counts,
        isCountsLoading,
        ...(isCountsUnknown ? { countsUnavailableLabel: COUNTS_UNAVAILABLE_LABEL } : {}),
        // HOP-DONG-MOI §5: hiện tại ⇔ `floorRevision` bằng `revision` của tầng, không phải "hàng đầu".
        isCurrent: revisionsKnown ? summary?.floorRevision === currentRevision : index === 0,
        tagLabel: summary?.label ?? null,
        isMetadataOnly,
        retentionNotice: isMetadataOnly ? RETENTION_NOTICE : null,
        ...(failedIds?.has(metadata.id) === true ? { snapshotError: SNAPSHOT_FAILED_NOTICE } : {}),
        isSelectedForCompare,
        // Bản còn nội dung nào cũng tích được: tích là nạp nó (B-025). Bản hết nội dung/nạp hỏng thì không.
        isPickable:
          isSelectedForCompare ||
          (!isMetadataOnly && failedIds?.has(metadata.id) !== true && pickedCount < 2),
      },
    };
  });
}

/**
 * Gộp theo NGÀY (P-03).
 *
 * Chỉ gộp các hàng liền kề: lịch sử đã sắp mới-nhất-trước nên hai hàng cùng ngày luôn
 * đứng cạnh nhau, và gộp kiểu này giữ nguyên thứ tự thay vì sắp lại sau lưng người đọc.
 *
 * Gộp theo NGƯỜI không có ở đây vì nó không có ở đâu cả — xem `canGroupByAuthor`.
 */
export function groupRowsByDay(
  builds: readonly VersionRowBuild[],
  now: Date,
): readonly VersionGroupModel[] {
  const groups: VersionGroupModel[] = [];
  let current: { createdAt: Date; rows: VersionRowModel[] } | null = null;

  for (const build of builds) {
    if (current !== null && isSameCalendarDay(current.createdAt, build.createdAt)) {
      current.rows.push(build.row);
      continue;
    }

    const heading = isSameCalendarDay(build.createdAt, now)
      ? TODAY_HEADING
      : formatCalendarDate(build.createdAt);

    current = { createdAt: build.createdAt, rows: [build.row] };
    groups.push({ id: `${heading}-${build.row.id}`, heading, rows: current.rows });
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/* 4 — Cột phải: hàng diff, nhóm diff, JSON thô                               */
/* -------------------------------------------------------------------------- */

/** Ba mảng của một `VersionDiff`, đọc theo đúng thứ tự `describeChanges` dùng. */
function entriesOf(diff: VersionDiff, tone: DiffTone): readonly DiffEntry[] {
  if (tone === 'added') {
    return diff.added;
  }

  return tone === 'removed' ? diff.removed : diff.changed;
}

/** Tiêu đề ngữ cảnh của một khối JSON — dòng không tô nền. */
function toneHeading(tone: DiffTone): string {
  if (tone === 'added') {
    return 'Đã thêm';
  }

  return tone === 'removed' ? 'Đã xoá' : 'Đã thay đổi';
}

/**
 * Mã có một khúc chữ-số hoa dài (kiểu ULID của máy chủ: "W-03H178Y099CC541AUHEQYUW8W") — người
 * đọc không nhận ra được nó. Mã ngắn kiểu "W-014" hay "A-AXIS0000000" vẫn đọc được nên giữ.
 */
const OPAQUE_ID = /[0-9A-Z]{16,}/u;

/**
 * Nhóm diff theo LOẠI đối tượng, mỗi hàng là một câu tiếng thường.
 *
 * Câu do `formatChange` sinh, không do màn ghép: nó là nơi duy nhất biết "dày" đi với
 * `thickness_mm` và đơn vị nào đi với con số nào (R-61). Mã đục (ULID) được thay bằng số thứ tự
 * trong nhóm ("Thêm tường #2") trước khi vào câu — mã thô chỉ còn ở tab JSON (BUG-456).
 */
export function buildDiffGroups(diff: VersionDiff): readonly DiffGroupModel[] {
  const rowsByKind = new Map<EntityKind, DiffRowModel[]>();
  const shortIds = new Map<string, string>();
  const shortCounts = new Map<EntityKind, number>();
  const shortIdOf = (entityType: EntityKind, entityId: string): string => {
    if (!OPAQUE_ID.test(entityId)) {
      return entityId;
    }

    const key = `${entityType}:${entityId}`;
    const known = shortIds.get(key);

    if (known !== undefined) {
      return known;
    }

    const ordinal = (shortCounts.get(entityType) ?? 0) + 1;
    const short = `#${formatNumber(ordinal)}`;

    shortCounts.set(entityType, ordinal);
    shortIds.set(key, short);

    return short;
  };

  for (const tone of TONE_ORDER) {
    entriesOf(diff, tone).forEach((entry, index) => {
      const rows = rowsByKind.get(entry.entityType) ?? [];
      const ordinal = formatNumber(index, { grouping: false });

      rows.push({
        id: `${tone}-${entry.entityType}-${entry.entityId}-${entry.field ?? ''}-${ordinal}`,
        entityId: entry.entityId,
        entityType: entry.entityType,
        tone,
        sentence: formatChange(
          { ...entry, entityId: shortIdOf(entry.entityType, entry.entityId) },
          { lengthsInMm: true },
        ),
      });
      rowsByKind.set(entry.entityType, rows);
    });
  }

  const groups: DiffGroupModel[] = [];

  for (const [entityType, rows] of rowsByKind) {
    groups.push({
      entityType,
      heading: ENTITY_KIND_LABELS[entityType],
      count: rows.length,
      countLabel: `${formatNumber(rows.length)} thay đổi`,
      rows,
    });
  }

  return groups;
}

/**
 * JSON thô, MỘT dòng cho mỗi mục diff.
 *
 * Cố ý không in đẹp nhiều dòng: đặc tả đòi câu tiếng thường đứng TRƯỚC JSON thô, nên
 * tab này là chỗ tra cứu chứ không phải chỗ đọc chính, và một mục một dòng thì đối
 * chiếu được với đúng một hàng ở tab "Thay đổi".
 */
export function buildJsonLines(diff: VersionDiff): readonly JsonDiffLineModel[] {
  const lines: JsonDiffLineModel[] = [];

  for (const tone of TONE_ORDER) {
    const entries = entriesOf(diff, tone);

    if (entries.length === 0) {
      continue;
    }

    // Dấu gạch ngang chứ không phải `//`: JSON không có chú thích, và R-65 cấm mọi
    // chuỗi mở đầu bằng `/` trong `src/screens`.
    lines.push({ id: `heading-${tone}`, text: `— ${toneHeading(tone)}`, tone: null });

    entries.forEach((entry, index) => {
      lines.push({
        id: `${tone}-${formatNumber(index, { grouping: false })}`,
        text: JSON.stringify(entry),
        tone,
      });
    });
  }

  return lines;
}

/** Mã của mọi đối tượng có mặt trong bản so, không trùng, theo thứ tự gặp. */
export function changedEntityIdsOf(diff: VersionDiff): readonly string[] {
  const ids = new Set<string>();

  for (const tone of TONE_ORDER) {
    for (const entry of entriesOf(diff, tone)) {
      ids.add(entry.entityId);
    }
  }

  return [...ids];
}

/* -------------------------------------------------------------------------- */
/* 5 — Lỗi                                                                    */
/* -------------------------------------------------------------------------- */

/** Thao tác ghi của màn, cho bảng câu lỗi. */
export type VersionWriteOperation = 'restore' | 'undo' | 'label';

const WRITE_ERROR_TITLES: Readonly<Record<VersionWriteOperation, string>> = {
  restore: 'Chưa phục hồi được',
  undo: 'Chưa hoàn tác được',
  label: 'Chưa gắn được nhãn',
};

const WRITE_ERROR_FALLBACK: Readonly<Record<VersionWriteOperation, string>> = {
  restore: 'Máy chủ chưa nhận lượt phục hồi. Thử lại sau ít phút.',
  undo: 'Máy chủ chưa nhận lượt hoàn tác. Thử lại sau ít phút.',
  label: 'Máy chủ chưa nhận nhãn này. Thử lại sau ít phút.',
};

/** N18 hỏng tạm thời của một hàng (NO-368) — khác "hết nội dung": bấm thử lại được. */
export const SNAPSHOT_FAILED_NOTICE = 'Chưa tải được nội dung bản này';
/** Hàng không nạp ảnh chụp (ngoài tầm nạp trước, hoặc bản trước hết nội dung) — RV2#1. */
export const COUNTS_UNAVAILABLE_LABEL = 'Chưa so được';
/** Nhãn nút thử lại N18 của một hàng. */
export const SNAPSHOT_RETRY_LABEL = 'Thử lại';

/** Toast mời bấm lại sau khi N19 ngược hỏng tạm thời (NO-365) — phiếu hoàn tác vẫn còn hạn. */
export const UNDO_RETRY_TOAST = 'Chưa hoàn tác được lượt phục hồi; bấm "Hoàn tác" để thử lại';

/** Mất phản hồi: lượt ghi có thể đã tới máy chủ — bấm lại cùng `baseVersion` nhận 200 là xong. */
const UNKNOWN_OUTCOME = 'Chưa rõ đã phục hồi chưa, bấm lại.';

/** (thao tác, `code`) → câu. Mã lạ thì câu dự phòng; mã không bao giờ in ra (R1). */
const WRITE_ERROR_SENTENCES: Readonly<
  Record<VersionWriteOperation, Readonly<Record<string, string>>>
> = {
  restore: {
    FORBIDDEN: 'Vai của bạn trên dự án này không được sửa lớp của tầng.',
    LAYER_INTEGRITY_BROKEN:
      'Nội dung bản này không còn khớp toàn vẹn của tầng, nên không phục hồi được.',
    NETWORK: UNKNOWN_OUTCOME,
    REVIEW_BY_AI_FORBIDDEN:
      'Bản này sẽ ghi dấu "đã duyệt" cho kết quả của AI, nên không phục hồi được.',
    TIMEOUT: UNKNOWN_OUTCOME,
    VALIDATION: 'Không phục hồi được bản này.',
    VERSION_FLOOR_MISMATCH: 'Bản này không thuộc tầng đang chọn.',
    VERSION_SNAPSHOT_PURGED: 'Bản này không còn nội dung để phục hồi.',
  },
  undo: {
    FORBIDDEN: 'Vai của bạn trên dự án này không được sửa lớp của tầng.',
    NETWORK: 'Chưa rõ đã hoàn tác chưa; tải lại trang để xem hiện trạng.',
    TIMEOUT: 'Chưa rõ đã hoàn tác chưa; tải lại trang để xem hiện trạng.',
    VERSION_SNAPSHOT_PURGED: 'Bản trước lượt phục hồi không còn nội dung, nên không hoàn tác được.',
  },
  label: {
    FORBIDDEN: 'Vai của bạn trên dự án này không được gắn nhãn phiên bản.',
    VALIDATION: 'Nhãn dài tối đa 60 ký tự.',
  },
};

/** Nhãn đã vừa trần mà máy chủ vẫn 422 `VALIDATION`: lý do còn lại là ký tự cấm (điều khiển, đảo chiều). */
const LABEL_BAD_CHARS = 'Nhãn chứa ký tự không cho phép (ký tự điều khiển hoặc đảo chiều).';
const LABEL_MAX_UNITS = 60;

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

/** Lỗi ghi (đã qua `toAppError`, R1: đọc `code` thẳng) thành dải "Đã hiểu". */
export function writeErrorNotice(
  operation: VersionWriteOperation,
  error: unknown,
  submittedLabel?: string,
): ConflictNoticeModel {
  const code = codeOf(error);
  const isBadChars =
    operation === 'label' &&
    code === 'VALIDATION' &&
    submittedLabel !== undefined &&
    submittedLabel.length <= LABEL_MAX_UNITS;

  return {
    actorName: WRITE_ERROR_TITLES[operation],
    message:
      (isBadChars
        ? LABEL_BAD_CHARS
        : code === undefined
          ? undefined
          : WRITE_ERROR_SENTENCES[operation][code]) ?? WRITE_ERROR_FALLBACK[operation],
    detail: null,
    dismissLabel: 'Đã hiểu',
  };
}

/** N16 hỏng sau một lượt ghi: kho giữ `revision` cũ, nên lượt tự lưu sau sẽ 409 thay vì ghi đè. */
export const RELOAD_FAILED_NOTICE: ConflictNoticeModel = {
  actorName: 'Chưa tải lại được tầng',
  message:
    'Máy chủ đã nhận thay đổi nhưng chưa trả lại lớp mới của tầng. Tải lại để xem bản mới nhất.',
  detail: null,
  dismissLabel: 'Tải lại',
};

/** N17 403, hoặc 404 `resource:"project"` — chỉ hai lỗi này là `forbidden`, không vai viewer. */
export function isForbiddenRead(error: unknown): boolean {
  const code = codeOf(error);
  const params =
    typeof error === 'object' &&
    error !== null &&
    'params' in error &&
    typeof error.params === 'object'
      ? (error.params as Readonly<Record<string, unknown>> | null)
      : null;

  return code === 'FORBIDDEN' || (code === 'NOT_FOUND' && params?.resource === 'project');
}

/* -------------------------------------------------------------------------- */
/* 6 — Phục hồi                                                               */
/* -------------------------------------------------------------------------- */

/** Trạng thái 6: so sánh được, nhưng nút phục hồi rời khỏi DOM (R-69). */
export const RESTORE_FORBIDDEN_REASON =
  'Vai trò của bạn trên dự án này chỉ đọc được lịch sử, nên nút phục hồi không hiện';

/**
 * Câu giải thích phục hồi là KHÔNG PHÁ HUỶ.
 *
 * Luôn hiện cạnh nút VÀ trong hộp thoại xác nhận, tức người đọc gặp nó trước khi bấm —
 * đúng cấm tuyệt đối của đặc tả, và đúng A9 (việc A8 không hoàn tác được thì phải hỏi).
 */
export const RESTORE_CAPTION =
  'Phục hồi không xoá phiên bản nào: trạng thái hiện tại được giữ lại thành một phiên bản riêng, và bản phục hồi được thêm lên đầu danh sách';

/**
 * Câu trấn an thêm của hộp thoại: phục hồi thay lớp từ ngoài, nên Ctrl+Z mất lịch sử. Câu trước
 * nói về PHIÊN BẢN; "Riêng" đánh dấu ngoại lệ để hai câu không đọc thành mâu thuẫn (BUG-459).
 */
export const UNDO_HISTORY_CLEARED = 'Riêng lịch sử hoàn tác (Ctrl+Z) của mọi tầng sẽ được xoá.';

/** Hộp thoại đang mở: hỏi phục hồi, hay hỏi bỏ thay đổi chưa lưu (A9). */
export type RestoreDialog =
  | { readonly kind: 'restore'; readonly versionId: string }
  | { readonly kind: 'discard' };

/** Hộp thoại xác nhận (khung `restoreConfirm`); `dialog` `null` là đang đóng. */
export function buildRestoreConfirm(
  builds: readonly VersionRowBuild[],
  dialog: RestoreDialog | null,
  floorName: string,
): RestoreConfirmModel {
  if (dialog?.kind === 'discard') {
    return {
      isOpen: true,
      title: `${floorName.charAt(0).toLocaleUpperCase('vi-VN')}${floorName.slice(1)} còn thay đổi chưa lưu được; tiếp tục sẽ bỏ chúng`,
      reassurance:
        'Thay đổi chưa lưu của tầng này sẽ mất. Chọn "Huỷ" để giữ chúng và không phục hồi.',
      confirmLabel: 'Bỏ thay đổi và tiếp tục',
      cancelLabel: 'Huỷ',
      targetVersionLabel: null,
    };
  }

  const label =
    dialog === null
      ? null
      : (builds.find((build) => build.row.id === dialog.versionId)?.row.label ?? null);

  return {
    isOpen: dialog !== null,
    title:
      label === null
        ? `Phục hồi phiên bản này của ${floorName}?`
        : `Phục hồi phiên bản ${label} của ${floorName}?`,
    reassurance: `${RESTORE_CAPTION}. ${UNDO_HISTORY_CLEARED}`,
    confirmLabel: 'Phục hồi',
    cancelLabel: 'Để nguyên',
    targetVersionLabel: label,
  };
}

/* -------------------------------------------------------------------------- */
/* 7 — Giới hạn lượt N18 đồng thời                                            */
/* -------------------------------------------------------------------------- */

/**
 * Bọc một hàm async để tối đa `max` lượt chạy cùng lúc; lượt dư xếp hàng theo thứ tự gọi.
 *
 * `signal` bị huỷ (NO-376): lượt đang xếp hàng rời hàng và ném; lượt đang chạy nhả chỗ ngay —
 * `run` nhận cùng `signal` để tự bỏ lượt mạng của nó.
 */
export function createConcurrencyLimit(
  max: number,
): <T>(run: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  // Lượt xong trao thẳng chỗ của nó cho lượt đang chờ — không nhả rồi giành lại.
  const release = (): void => {
    const next = queue.shift();

    if (next === undefined) {
      active -= 1;
    } else {
      next();
    }
  };

  const waitTurn = (signal: AbortSignal | undefined): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        queue.splice(queue.indexOf(turn), 1);
        reject(signal?.reason);
      };
      const turn = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };

      queue.push(turn);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  return async <T>(run: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();

    if (active >= max) {
      await waitTurn(signal);
    } else {
      active += 1;
    }

    let held = true;
    const free = (): void => {
      if (held) {
        held = false;
        release();
      }
    };

    signal?.addEventListener('abort', free, { once: true });

    try {
      return await run(signal);
    } finally {
      signal?.removeEventListener('abort', free);
      free();
    }
  };
}

/* -------------------------------------------------------------------------- */
/* 8 — Câu hỏi A9 đang chờ                                                    */
/* -------------------------------------------------------------------------- */

/** Câu hỏi "bỏ thay đổi chưa lưu?" đang chờ một lời đáp. */
export interface PendingAnswer {
  /** Hỏi; câu cũ còn chờ (nếu có) nhận `false` trước để không treo. */
  readonly ask: () => Promise<boolean>;
  /** Trả lời câu đang chờ; không có câu nào thì bỏ qua. */
  readonly answer: (proceed: boolean) => void;
}

/** Một chỗ giữ câu hỏi A9: lượt ghi chờ trên `ask()`, hộp thoại hoặc lượt đổi tầng gọi `answer`. */
export function createPendingAnswer(): PendingAnswer {
  let resolve: ((proceed: boolean) => void) | null = null;
  const answer = (proceed: boolean): void => {
    const current = resolve;

    resolve = null;
    current?.(proceed);
  };

  return {
    ask: () => {
      answer(false);

      return new Promise<boolean>((next) => {
        resolve = next;
      });
    },
    answer,
  };
}
