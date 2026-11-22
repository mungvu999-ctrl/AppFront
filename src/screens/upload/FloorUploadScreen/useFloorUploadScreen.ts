/**
 * Toàn bộ phần suy nghĩ của màn tải bản vẽ: đọc tầng, nhận tệp, ghép tầng, tải,
 * và quyết định khi nào lượt xử lý bắt đầu được.
 *
 * Mục D chia đôi: file này giữ trạng thái và làm mọi phép quyết định; view chỉ
 * vẽ những gì `types.ts` mô tả. Mọi con số người dùng đọc — cao độ, chiều cao,
 * dung lượng, phần trăm — đã thành chuỗi ở đây (A15), nên view không còn gì để
 * làm tròn hay quy đổi.
 *
 * ## Những thứ file này NỐI LẠI chứ không dựng lại (R-61, R-64)
 *
 * - **Danh sách tầng** — `useQuery` với `queryKeys.floor.list(projectId)`. Không
 *   một ô `useState` nào cho "đang tải" hay "lỗi đọc": cả hai thuộc về tầng query.
 *   `hooks/useShareLinks.ts` tự viết hai thứ đó và được luật gọi tên là ngoại lệ
 *   đi trước, không phải khuôn mẫu.
 * - **Cao độ trần** — `ceilingElevationMm` của `src/domain/axes/alignFloors`.
 *   Không có phép cộng cao độ nào viết trong file này.
 * - **Tầng chồng lấn / trùng cao độ** — `alignFloors(plans).issues` lọc lấy
 *   `kind === 'overlap'`, và câu tiếng Việt lấy NGUYÊN VĂN `issue.message`. Hai
 *   loại `unalignable` và `clearHeight` bị bỏ qua vì màn này không có trục dò
 *   được (`axes: []`) — đúng cách `useCreateProjectModal.ts:23-26` đã lọc.
 * - **Giới hạn** — `PROJECT_LIMITS` của `src/domain/project/limits`. Không một
 *   ngưỡng cao độ hay chiều cao nào viết tay trong màn (R-71).
 * - **Cắt khúc, song song, trần dung lượng, tần suất báo tiến độ** — `src/lib/upload`
 *   qua `floorUploadGateway`. File này KHÔNG bóp tiến độ lần thứ hai và KHÔNG
 *   đếm số lượt tải song song: `createUploadTask` giữ nhịp tiến độ, hàng
 *   `createUploadScheduler` trong cổng giữ trần song song (BUG-532).
 * - **Hoàn tác một lượt xoá** — `createUndoTicket` (`src/lib/mutations/undoTicket.ts`)
 *   qua `gateway.createRemovalTicket`, cộng `onToast` tiêm vào. KHÔNG dùng
 *   `useUndoableToast`: hook đó lái undo/redo toàn cục của zundo qua store, một
 *   cơ chế khác hẳn và không liên quan tới danh sách tệp cục bộ của màn này.
 *
 * ## Chuyển động
 *
 * Đặc tả màn xin thẻ hiện ra trong **240 ms**. Thang chuyển động của repo có
 * đúng năm giá trị (120/180/260/340/700) và `local/no-raw-duration` ở mức lỗi,
 * nên 240 không viết được. Thẻ dùng `durationMs('standard')` = 260 ms. Nhịp so
 * le 24 ms thì hợp lệ nguyên vẹn: `STAGGER_STEP_MS` của `src/lib/motion/stagger.ts`
 * đúng bằng 24, nên `staggerDelayMs(index)` cho đúng con số đặc tả xin.
 *
 * ## Bảng vô hiệu hoá bộ đệm
 *
 * `src/lib/query/invalidation.ts` **chưa có** mục nào cho tải lên / gán lại /
 * gỡ bản vẽ (`WRITE_OPERATIONS` có 8 mục, không mục nào là của màn này), và
 * `src/lib/query/**` nằm ngoài ba nơi R-68 cho phép sửa. Vì vậy lượt vô hiệu
 * hoá gọi thẳng `queryClient.invalidateQueries` với khoá dựng từ `queryKeys` —
 * mượn tên một `WriteOperation` sẵn có thì bảng sẽ nói dối về việc vừa xảy ra.
 * Thêm mục cho ba thao tác này là một lượt riêng ở tầng dữ liệu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { DrawingCrop, Floor } from '@/api/client';
import { PROJECT_NOT_FOUND_DESCRIPTION } from '@/components/feedback/ProjectSpatialGate';
import type { SelectOption } from '@/components/ui/Select';
import { alignFloors, ceilingElevationMm } from '@/domain/axes/alignFloors';
import type { FloorPlan } from '@/domain/axes/alignFloors';
import { PROJECT_LIMITS } from '@/domain/project/limits';
import type { LevelId } from '@/domain/spatial/types';
import { millimetres, millimetresToMetres } from '@/domain/units/types';
import type { Millimetres } from '@/domain/units/types';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { can } from '@/lib/auth/permissions';
import { BYTES_PER_UNIT, formatFileSize } from '@/lib/format/bytes';
import { formatLength } from '@/lib/format/measure';
import { formatNumber, formatPercent, MISSING_VALUE, parseNumber } from '@/lib/format/number';
import { getAppAnnouncer } from '@/lib/input/announcer';
import { staggerDelayMs } from '@/lib/motion/stagger';
import { durationMs } from '@/lib/motion/tokens';
import { cachedProjectName } from '@/lib/query/cachedProjectName';
import { queryKeys } from '@/lib/query/queryKeys';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';
import { hashBlobSha256Hex, MAX_PDF_PAGE_COUNT, MAX_UPLOAD_FILE_SIZE_BYTES } from '@/lib/upload';
import type { UploadBranch, UploadRejection, UploadTask, UploadTaskState } from '@/lib/upload';
import { ROUTES } from '@/routes/paths';
import { PICKER_UPLOAD_EXTENSIONS } from '@/lib/upload/validate';
import type { ProjectRole } from '@/types/project';

import { CAD_NOT_SUPPORTED_SENTENCE, type FloorUploadGateway } from './floorUploadGateway';
import { useApartmentSplit } from './useApartmentSplit';
import { type SheetUpload, useSheetRegions } from './useSheetRegions';
import { usePdfPageThumbnails } from './usePdfPageThumbnails';
import type {
  FloorUploadActions,
  FloorUploadBlockNotice,
  FloorUploadBlockReason,
  FloorUploadFileModel,
  FloorUploadFooterModel,
  FloorUploadInlineError,
  FloorUploadModel,
  FloorUploadRowModel,
  FloorUploadScreenViewProps,
  FloorUploadStatus,
  FloorUploadTrayItemModel,
  FloorUploadTrayModel,
} from './types';

/* -------------------------------------------------------------------------- */
/* Chuỗi hiển thị — khoá `vi.json` đi kèm để `expectVietnamese` có từ điển.     */
/* -------------------------------------------------------------------------- */

const COPY = Object.freeze({
  dropZoneTitle: 'Kéo thả bản vẽ vào đây, hoặc chọn tệp',
  dropZoneTitleKey: 'floorUpload.dropZone.title',
  selectFile: 'Chọn tệp',
  formatsKey: 'floorUpload.dropZone.formats',
  autoMatch: 'Đã tự gán tệp vào tầng này — kiểm tra lại cho đúng tầng',
  trayTitle: 'Tệp chưa gán tầng',
  trayTitleKey: 'floorUpload.unassignedTray',
  empty: 'Chưa có tầng nào có bản vẽ.',
  emptyKey: 'floorUpload.emptyState',
  offline: 'Đang làm việc ngoại tuyến',
  offlineKey: 'floorUpload.offlineBanner',
  readOnly: 'Vai hiện tại chỉ được xem danh sách tệp, không tải lên và không sửa.',
  readOnlyKey: 'floorUpload.readOnlyNotice',
  counterKey: 'floorUpload.footer.counter',
  submit: 'Bắt đầu xử lý',
  reprocess: 'Xử lý lại',
  submitKey: 'floorUpload.footer.submit',
  blockedTitle: 'Không thể bắt đầu xử lý',
  blockedTitleKey: 'floorUpload.blockedSubmit.title',
  replaceTitle: (label: string) => `Xử lý lại sẽ thay bản vẽ đang có. Bấm "${label}" lần nữa để đồng ý.`,
  noFloors: 'Dự án chưa có tầng nào. Thêm tầng ở màn Quản lý tầng trước khi xử lý.',
  uploadErrorTitleKey: 'errors.upload.title',
  validationErrorTitleKey: 'errors.validation.title',
});

const STATUS_LABELS: Readonly<Record<FloorUploadStatus, string>> = {
  waiting: 'Chờ xử lý',
  uploading: 'Đang tải lên',
  attached: 'Đã có bản vẽ',
  error: 'Lỗi',
};

const STATUS_LABEL_KEYS: Readonly<Record<FloorUploadStatus, string>> = {
  waiting: 'floorUpload.status.waiting',
  uploading: 'floorUpload.status.uploading',
  attached: 'floorUpload.status.attached',
  error: 'floorUpload.status.error',
};

/**
 * `'waiting'` của tầng không tệp, không bản vẽ máy chủ: không có gì đang "chờ xử lý", và hộp
 * chặn lẫn Quản lý tầng đều gọi nó là "chưa có bản vẽ" (BUG-263). Tệp đã thả mà chưa tải vẫn "Chờ xử lý".
 */
const NO_DRAWING_LABEL = 'Chưa có bản vẽ';
const NO_DRAWING_LABEL_KEY = 'floorUpload.status.noDrawing';

/**
 * Màu của huy hiệu, theo bốn mã trạng thái của `src/lib/viewmodel`.
 *
 * Xanh `'verified'` chỉ dành cho một tệp **người dùng tự gán** (A5). Một tệp
 * ghép tự động từ tên tệp là đầu ra của máy, nên nó nhận `'attention'` — xem
 * `statusVariantFor` bên dưới.
 */
const STATUS_VARIANTS = Object.freeze({
  waiting: 'neutral',
  uploading: 'neutral',
  attached: 'verified',
  error: 'violation',
} as const);

/* -------------------------------------------------------------------------- */
/* Lời phàn nàn — vị ngữ thuần, khuôn `useCreateProjectModal.ts:111-136`.       */
/* -------------------------------------------------------------------------- */

/** `null` khi cao độ dùng được; câu tiếng Việt khi không. */
function elevationProblemFor(elevationMm: Millimetres | null): string | null {
  if (elevationMm === null) {
    return null;
  }

  const elevationM = millimetresToMetres(elevationMm);

  if (elevationM < PROJECT_LIMITS.elevationMinM || elevationM > PROJECT_LIMITS.elevationMaxM) {
    return (
      `Cao độ vượt giới hạn cho phép (${formatNumber(PROJECT_LIMITS.elevationMinM)} ` +
      `đến ${formatNumber(PROJECT_LIMITS.elevationMaxM)} mét).`
    );
  }

  return null;
}

/** Một chữ số lẻ — đúng độ chính xác `formatFileSize` hiện từ KB trở lên. */
const SHOWN_DECIMAL_STEPS = 10;

/**
 * Dung lượng của một tệp vượt trần. Tệp chỉ hơn trần vài byte thì hai số làm tròn trùng nhau và câu
 * "vượt trần" tự mâu thuẫn, nên làm tròn LÊN tới chữ số lẻ đang hiện — hơn trần đúng một bậc (BUG-302).
 */
function sizeOverCap(sizeBytes: number, maxSizeBytes: number): string {
  const label = formatFileSize(sizeBytes);

  if (label !== formatFileSize(maxSizeBytes)) {
    return label;
  }

  let unitBytes = 1;

  while (unitBytes * BYTES_PER_UNIT <= sizeBytes) {
    unitBytes *= BYTES_PER_UNIT;
  }

  const stepBytes = unitBytes / SHOWN_DECIMAL_STEPS;

  return formatFileSize(Math.ceil(sizeBytes / stepBytes) * stepBytes);
}

/** Câu cho một tệp bị từ chối. Số lấy từ chính lời từ chối, không viết tay (R-71). */
function rejectionSentence(reason: UploadRejection): string {
  switch (reason.kind) {
    case 'tooLarge':
      return (
        `Tệp nặng ${sizeOverCap(reason.sizeBytes, reason.maxSizeBytes)}, vượt trần ` +
        `${formatFileSize(reason.maxSizeBytes)} của một tệp. Hãy giảm độ phân giải ảnh hoặc xuất lại ` +
        `thành PDF rồi chọn lại.`
      );
    case 'unsupportedFormat':
      // `.dwg` bị từ chối ngay ở bước kiểm tệp (FIX-P0-13): cùng câu BE trả cho `CAD_NOT_SUPPORTED`.
      if (reason.extension === '.dwg') return CAD_NOT_SUPPORTED_SENTENCE;
      return (
        `Định dạng ${reason.extension === '' ? 'chưa rõ' : reason.extension} chưa nhận được. ` +
        `Định dạng hỗ trợ: ${reason.acceptedExtensions.join(', ')}.`
      );
    case 'tooManyPages':
      return (
        `Tệp có ${formatNumber(reason.pageCount, { grouping: false })} trang, vượt trần ` +
        `${formatNumber(reason.maxPageCount, { grouping: false })} trang.`
      );
    case 'unreadable':
      return `Không đọc được nội dung tệp ${reason.extension === '' ? 'này' : reason.extension}.`;
  }
}

/** Lỗi kiểm tra tệp không bao giờ thử lại được: cùng một tệp sẽ bị từ chối y hệt. */
function rejectionError(reason: UploadRejection): FloorUploadInlineError {
  return {
    kind: reason.kind,
    sentence: rejectionSentence(reason),
    isRetryable: false,
    titleKey: COPY.validationErrorTitleKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Tệp đang giữ trong màn.                                                     */
/* -------------------------------------------------------------------------- */

/** Một tệp người dùng vừa đưa vào, cùng mọi thứ màn biết về nó. */
interface Attachment {
  readonly id: string;
  readonly file: File;
  /** `null` nghĩa là đang nằm trong khay chưa gán tầng. */
  readonly floorId: string | null;
  readonly branch: UploadBranch | null;
  readonly pageCount: number | null;
  readonly selectedPage: string | null;
  /** Tầng do `guessFloorFromFileName` chọn, chưa ai xác nhận. */
  readonly isAutoMatched: boolean;
  readonly status: FloorUploadStatus;
  readonly percent: number;
  readonly problem: FloorUploadInlineError | null;
  /**
   * Đã gán tầng nhưng chọn lúc ngoại tuyến: chờ mạng về để tự tải (NO-389).
   * `File` chỉ sống trong bộ nhớ của màn — tải lại trang là mất, nên câu báo
   * nói rõ điều đó.
   */
  readonly awaitingNetwork: boolean;
  /** Người dùng vừa bấm "Huỷ" lượt tải này: thẻ mở "Thử lại" thay vì bắt xoá rồi chọn lại (BUG-534). */
  readonly wasCancelled?: boolean;
  /**
   * Lỗi người dùng đã bấm "Đóng": câu ẩn đi, nhưng lỗi vẫn là lỗi — "Thử lại" còn nguyên (BUG-535).
   * So bằng tham chiếu: lượt tải sau dựng `problem` mới, nên lỗi mới lại hiện ra.
   */
  readonly dismissedProblem?: FloorUploadInlineError | null;
  /** Vùng của tầng này trên tờ nhiều tầng; vắng = cả trang. */
  readonly crop?: DrawingCrop;
}

/** Lỗi còn hiện trên thẻ/khay: mọi lỗi trừ đúng lỗi người dùng đã đóng. */
function visibleProblem(attachment: Attachment | null): FloorUploadInlineError | null {
  return attachment === null || attachment.problem === attachment.dismissedProblem
    ? null
    : attachment.problem;
}

const PICK_PAGE_SENTENCE = 'Hãy chọn trang bản vẽ để bắt đầu tải';
const AWAIT_NETWORK_KEY = 'floorUpload.notices.awaitNetwork';
const AWAIT_NETWORK_SENTENCE =
  'Đang ngoại tuyến: tệp sẽ tự tải lên khi có mạng trở lại; nếu tải lại trang thì cần chọn lại tệp';

/** Trang PDF người dùng chọn (đếm từ 1) thành `pageIndex` (đếm từ 0); vắng thì `undefined`. */
function pageIndexOf(attachment: Attachment): number | undefined {
  if (attachment.branch !== 'pdf' || attachment.selectedPage === null) {
    return undefined;
  }

  const page = parseNumber(attachment.selectedPage);

  return page === undefined ? undefined : page - 1;
}

/** PDF nhiều trang chưa chọn trang: ghép tầng được, nhưng chưa tải. */
function isAwaitingPage(attachment: Attachment): boolean {
  return (
    attachment.branch === 'pdf' &&
    (attachment.pageCount ?? 0) > 1 &&
    pageIndexOf(attachment) === undefined
  );
}

/** Trạng thái hàng suy ra từ trạng thái một lượt tải. */
function statusOfTask(taskState: UploadTaskState): FloorUploadStatus {
  switch (taskState.status) {
    case 'done':
      return 'attached';
    case 'failed':
      return 'error';
    case 'uploading':
      return 'uploading';
    case 'queued':
    case 'cancelled':
      return 'waiting';
  }
}

/* -------------------------------------------------------------------------- */
/* Cách xếp thu gọn — cùng mốc `ProjectSettings` và `ProjectDashboard` dùng.    */
/* -------------------------------------------------------------------------- */

const NARROW_VIEWPORT_QUERY = '(width < 1024px)';

function useNarrowViewport(): boolean {
  const [isNarrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    setNarrow(media.matches);
    const listener = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  return isNarrow;
}

/* -------------------------------------------------------------------------- */
/* Tuỳ chọn của hook.                                                          */
/* -------------------------------------------------------------------------- */

export interface FloorUploadToast {
  readonly message: string;
  readonly onUndo?: () => void;
}

export interface UseFloorUploadScreenOptions {
  readonly gateway: FloorUploadGateway;
  readonly projectId: string;
  readonly roles?: readonly ProjectRole[];
  /** Đồng hồ tiêm được (R-29) — vé hoàn tác đọc nó. */
  readonly now?: () => number;
  /** Ép cách xếp thu gọn, cho story hoặc test muốn một câu trả lời cố định. */
  readonly forceCollapsed?: boolean;
  /** Toast hoàn tác của A8. `Toast.Provider` do nơi gọi dựng, không phải hook. */
  readonly onToast?: (toast: FloorUploadToast) => void;
  /**
   * Điều hướng sau khi lượt xử lý bắt đầu.
   *
   * Hook KHÔNG gọi `useNavigate()` — nó phải test được không cần Router
   * (`renderWithProviders` không bọc Router). Container truyền `navigate` của
   * `react-router-dom` vào đây; đường dẫn đã dựng sẵn bằng hằng `ROUTES`, không
   * bao giờ là chuỗi viết thẳng (R-65).
   */
  readonly onNavigate?: (path: string) => void;
  /**
   * Hỏi "tầng hay căn riêng" khi thả từ hai tệp trở lên (K19). Mặc định `true`; test của
   * đường gán tầng tắt nó để khỏi trả lời câu hỏi trước mỗi lượt thả.
   */
  readonly askHowToSplit?: boolean;
}

/** Vai mặc định khi nơi gọi không nói gì. Mảng rỗng vẫn là "không có quyền". */
const DEFAULT_ROLES: readonly ProjectRole[] = ['engineer'];

const LOAD_FAILURE_FALLBACK = 'Không tải được danh sách tầng của dự án.';

/* -------------------------------------------------------------------------- */
/* Hook.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * UX-07: dự án đã có tầng xử lý xong (`areaM2` chỉ có sau khi AI dựng) thì màn nói rõ, không như dự án mới.
 * Đang thả tệp mới (xử lý lại) thì im, để khối điều kiện bên phải dẫn lượt đó.
 * ponytail: #24 không có số mục đã duyệt từng tầng, nên chỉ nói số tầng đã xử lý.
 */
export function processedNoticeOf(floors: readonly Floor[], pendingFiles: number): string | null {
  if (pendingFiles > 0) return null;
  const processed = floors.filter((floor) => floor.drawings.length > 0 && (floor.areaM2 ?? 0) > 0).length;
  if (processed === 0) return null;
  return `Đã xử lý ${processed}/${floors.length} tầng, đang chờ duyệt. Muốn xử lý lại thì thả bản vẽ mới vào tầng; máy sẽ hỏi trước khi thay.`;
}

export function useFloorUploadScreen(
  options: UseFloorUploadScreenOptions,
): FloorUploadScreenViewProps {
  const { gateway, projectId } = options;
  const roles = options.roles ?? DEFAULT_ROLES;
  const queryClient = useQueryClient();

  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);
  const [dragDepth, setDragDepth] = useState(0);
  const [isOnline, setOnline] = useState(true);
  const [blockNotice, setBlockNotice] = useState<FloorUploadBlockNotice | null>(null);
  // UX-51: lời hỏi lại khi lượt xử lý sẽ thay bản vẽ của tầng đã có kết quả. Bấm lần hai là đồng ý.
  const [replaceNotice, setReplaceNotice] = useState<FloorUploadBlockNotice | null>(null);
  const [scrollToken, setScrollToken] = useState(0);
  const [isSubmitting, setSubmitting] = useState(false);

  const tasksRef = useRef(new Map<string, UploadTask>());
  // Lệnh hàng đợi ngoại tuyến của từng tệp đang chờ mạng — nhiều nhất một lệnh
  // mỗi tệp. Giữ lời hứa để gỡ được cả khi lượt ghi chưa xong.
  const queuedRef = useRef(new Map<string, Promise<number | null>>());
  // Lượt gỡ lệnh mồ côi lúc mở màn; lượt ghi mới đợi nó để không bị gỡ nhầm.
  const orphansClearedRef = useRef<Promise<void>>(Promise.resolve());
  const unmountedRef = useRef(false);
  const onlineRef = useRef(true);
  // Câu "chờ mạng" đọc một lần cho cả lượt mất mạng, không một lần mỗi tệp.
  const awaitAnnouncedRef = useRef(false);
  // Danh sách tệp của lượt vẽ mới nhất, cho những lời gọi đến muộn (vé hoàn tác).
  const attachmentsRef = useRef<readonly Attachment[]>([]);
  attachmentsRef.current = attachments;

  const detectedNarrow = useNarrowViewport();
  const reducedMotion = useReducedMotion();
  const isCollapsed = options.forceCollapsed ?? detectedNarrow;
  const canEdit = can('upload', 'floor', { roles });

  // Mở thẳng đường dẫn: bộ đệm chưa có #24 hay thẻ N1 nào nêu tên, nên đọc #24 một lần
  // dưới chính khoá của nó — breadcrumb nêu tên dự án ở mọi lối vào (BUG-165).
  // ponytail: lượt đọc tầng (`floor.list`) cũng là #24; hai lượt chỉ xảy ra khi mở thẳng.
  const projectName = cachedProjectName(queryClient, projectId);
  useQuery({
    queryKey: queryKeys.project.detail(projectId),
    queryFn: async ({ signal }) => {
      const result = await gateway.readProject({ projectId, signal });
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: projectName === null,
  });

  /* ---------------------------------------------------------------------- */
  /* Danh sách tầng (R-64).                                                  */
  /* ---------------------------------------------------------------------- */

  const floorsQuery = useQuery({
    queryKey: queryKeys.floor.list(projectId),
    queryFn: async (): Promise<readonly Floor[]> => {
      const result = await gateway.readFloors({ projectId });

      // Ném nguyên lỗi dây: 404 còn mang `kind` để màn nói "không tìm thấy dự án", và luật
      // thử lại của bộ đệm không thử lại một 404 (BUG-311).
      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },
  });

  const floors = useMemo<readonly Floor[]>(
    () => [...(floorsQuery.data ?? [])].sort((first, second) => first.order - second.order),
    [floorsQuery.data],
  );
  // Tầng đã có bản vẽ lúc mở màn — chụp một lần, để tệp vừa tải lên tầng trống không bị coi là "thay" (UX-51).
  const [drawnAtOpen, setDrawnAtOpen] = useState<ReadonlySet<string> | null>(null);
  if (drawnAtOpen === null && floorsQuery.data !== undefined) {
    setDrawnAtOpen(new Set(floorsQuery.data.filter((floor) => floor.drawings.length > 0).map((floor) => floor.id)));
  }
  // Danh sách tầng mới nhất cho lời gọi về muộn của một lượt tải (closure giữ bản cũ).
  const floorsRef = useRef<readonly Floor[]>(floors);
  floorsRef.current = floors;

  // Chưa có tầng thì không có chỗ gán tệp, và tệp chỉ sống trong màn — đi thêm tầng là mất nó:
  // vùng thả không mời thả, nút chính nói lý do, trạng thái rỗng dẫn tới Quản lý tầng (BUG-298).
  const hasNoFloors = floorsQuery.isSuccess && floors.length === 0;
  const canDrop = canEdit && !hasNoFloors && !floorsQuery.isError;

  /* ---------------------------------------------------------------------- */
  /* Mạng — không hook nào bọc `createNetworkMonitor`, nên nối tay ở đây.     */
  /* ---------------------------------------------------------------------- */

  // Mở màn: gỡ lệnh `uploadDrawing` mồ côi — của phiên (tab) đã đóng hay không
  // mang mã phiên; tệp đã mất cùng lượt tải lại trang (đúng câu "tải lại trang
  // thì cần chọn lại tệp"), nên không ai tải nó nữa. Lệnh của tab khác còn sống
  // được giữ (NO-392, NO-400 — xem `clearOrphanUploads`).
  useEffect(() => {
    orphansClearedRef.current = gateway.clearOrphanUploads(projectId).catch(() => undefined);
  }, [gateway, projectId]);

  // Rời màn: `File` của các tệp chờ mạng mất theo, nên lệnh của chúng cũng gỡ;
  // lượt kiểm tệp về muộn sau khi rời màn không được ghi lệnh mới.
  useEffect(() => {
    const queued = queuedRef.current;

    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;

      for (const pending of queued.values()) {
        void pending.then((commandId) => {
          if (commandId !== null) {
            void gateway.dropOffline(commandId);
          }
        });
      }

      queued.clear();
    };
  }, [gateway]);

  useEffect(() => {
    return gateway.watchNetwork((online) => {
      onlineRef.current = online;
      setOnline(online);
    });
  }, [gateway]);

  /* ---------------------------------------------------------------------- */
  /* Cao độ — chồng tầng qua `ceilingElevationMm`, không cộng tay (M-11).     */
  /* ---------------------------------------------------------------------- */

  const stack = useMemo(() => {
    const plans: FloorPlan[] = [];
    const floorIdByLevel = new Map<LevelId, string>();
    const elevationByFloor = new Map<string, Millimetres | null>();
    const ceilingByFloor = new Map<string, Millimetres | null>();

    for (const floor of floors) {
      const hasElevation = Number.isFinite(floor.elevationMm);
      const hasHeight = Number.isFinite(floor.heightMm) && floor.heightMm > 0;
      const elevationMm = hasElevation ? millimetres(floor.elevationMm) : null;

      elevationByFloor.set(floor.id, elevationMm);

      if (elevationMm === null || !hasHeight) {
        ceilingByFloor.set(floor.id, null);
        continue;
      }

      const levelId: LevelId = `L-${floor.id}`;
      const plan: FloorPlan = {
        levelId,
        name: floor.name,
        floorElevationMm: elevationMm,
        clearHeightMm: millimetres(floor.heightMm),
        axes: [],
      };

      plans.push(plan);
      floorIdByLevel.set(levelId, floor.id);
      // Trần của một tầng là chỗ tầng trên đứng lên. Đây là HÀM DUY NHẤT được
      // phép suy ra nó; cộng `elevationMm + heightMm` tại chỗ là điều R-61 cấm.
      ceilingByFloor.set(floor.id, ceilingElevationMm(plan));
    }

    // `alignFloors` chỉ được gọi khi có ít nhất hai tầng: một tầng đơn không
    // chồng lấn được với ai. Ba loại issue còn lại (`alignment`, `unalignable`,
    // `clearHeight`) bị bỏ qua vì màn này không có trục dò được — đúng cách
    // `useCreateProjectModal.ts` lọc.
    const overlaps =
      plans.length < 2
        ? []
        : alignFloors(plans).issues.filter((issue) => issue.kind === 'overlap');

    return { ceilingByFloor, elevationByFloor, floorIdByLevel, overlaps };
  }, [floors]);

  /* ---------------------------------------------------------------------- */
  /* Ghép tệp với tầng.                                                      */
  /* ---------------------------------------------------------------------- */

  // Mức tầng đọc từ CHÍNH tên tầng bằng đúng hàm đọc tên tệp, nên hai phía nói
  // cùng một ngôn ngữ: `"mat-bang-tang-2.pdf"` và `"Tầng 2"` cùng cho mức 2.
  const levelByFloorId = useMemo(() => {
    const levels = new Map<string, number>();

    for (const floor of floors) {
      const guess = gateway.guessFloor(floor.name);

      if (guess.ok) {
        levels.set(floor.id, guess.level);
      }
    }

    return levels;
  }, [floors, gateway]);

  const attachmentByFloor = useMemo(() => {
    const byFloor = new Map<string, Attachment>();

    for (const attachment of attachments) {
      if (attachment.floorId !== null && !byFloor.has(attachment.floorId)) {
        byFloor.set(attachment.floorId, attachment);
      }
    }

    return byFloor;
  }, [attachments]);

  /* ---------------------------------------------------------------------- */
  /* Vô hiệu hoá bộ đệm — xem đầu file về `invalidationMap` còn thiếu.        */
  /* ---------------------------------------------------------------------- */

  const invalidateFloor = (floorId: string): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.drawing.byFloor(floorId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.floor.detail(floorId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.floor.list(projectId) });
    // RV5 #3: header suy ra "chưa có bản vẽ" từ chi tiết dự án.
    void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail(projectId) });
  };

  /* ---------------------------------------------------------------------- */
  /* Một lượt tải.                                                           */
  /* ---------------------------------------------------------------------- */

  /** Gỡ lệnh hàng đợi của một tệp, nếu có. */
  const dropQueued = (fileId: string): void => {
    const queued = queuedRef.current.get(fileId);

    if (queued === undefined) {
      return;
    }

    queuedRef.current.delete(fileId);
    void queued.then((commandId) => {
      if (commandId !== null) {
        void gateway.dropOffline(commandId);
      }
    });
  };

  const patchAttachment = (id: string, patch: Partial<Attachment>): void => {
    setAttachments((previous) =>
      previous.map((attachment) => (attachment.id === id ? { ...attachment, ...patch } : attachment)),
    );
  };

  const applyTaskState = (id: string, floorId: string, taskState: UploadTaskState): void => {
    const status = statusOfTask(taskState);
    const failure = taskState.failure;
    const described = failure === null ? null : gateway.describeUploadFailure(failure);
    const problem: FloorUploadInlineError | null =
      described === null
        ? null
        : {
            // Lỗi truyền tải là một loại riêng của màn; `described.kind` là
            // loại của L-03 (`upload`, `network`…) và không phải cùng bảng.
            kind: 'transfer',
            sentence: described.sentence,
            isRetryable: described.isRetryable,
            titleKey: COPY.uploadErrorTitleKey,
          };
    const hasServerDrawing = (floorsRef.current.find((floor) => floor.id === floorId)?.drawings.length ?? 0) > 0;

    // Tệp mới hỏng hẳn (422…) trên tầng đã có bản vẽ: máy chủ vẫn giữ bản cũ, nên thẻ tầng hiện
    // lại bản cũ và lỗi đi theo tệp mới về khay (U30) — không để tệp hỏng che bản vẽ tốt.
    if (taskState.status === 'failed' && problem !== null && !problem.isRetryable && hasServerDrawing) {
      tasksRef.current.delete(id);
      patchAttachment(id, { ...toTray(), status: 'error', problem });
      getAppAnnouncer().announce(problem.sentence);
      return;
    }

    patchAttachment(id, {
      status,
      percent: taskState.percent,
      problem,
    });

    // 404 giữa phiên: dự án (hay tầng) đã bị xoá ở nơi khác. Đọc lại dự án — nếu nó mất thì màn
    // về "Không tìm thấy dự án này" như lúc mở trang, không để lỗi nằm lại trên thẻ (BUG-311).
    if (taskState.status === 'done' || described?.kind === 'notFound') {
      invalidateFloor(floorId);
    }
  };

  const startUpload = (attachment: Attachment, floorId: string): void => {
    if (isAwaitingPage(attachment)) {
      getAppAnnouncer().announce(PICK_PAGE_SENTENCE);
      return;
    }

    const pageIndex = pageIndexOf(attachment);

    if (!onlineRef.current) {
      // Mất mạng: tệp ở "chờ xử lý" và chờ mạng về NGAY TRONG MÀN, nơi duy nhất
      // giữ được `File` (NO-389). Hàng đợi ngoại tuyến nhận đúng MỘT lệnh cho
      // tệp này — để ConnectionStates đếm nó là "chờ đồng bộ" — và lệnh ấy được
      // gỡ ở mọi lối ra (xem `dropQueued`, NO-392).
      dropQueued(attachment.id);

      if (!unmountedRef.current) {
        queuedRef.current.set(
          attachment.id,
          orphansClearedRef.current
            .then(() =>
              gateway.enqueueOffline({
                projectId,
                floorId,
                fileName: attachment.file.name,
                sizeBytes: attachment.file.size,
                ...(pageIndex !== undefined ? { pageIndex } : {}),
              }),
            )
            // Hàng đợi đầy hay IndexedDB hỏng: tệp vẫn chờ mạng trong màn, chỉ
            // thiếu dấu đếm "chờ đồng bộ" — không ném ra ngoài.
            .catch(() => null),
        );
      }
      patchAttachment(attachment.id, {
        status: 'waiting',
        percent: 0,
        problem: null,
        awaitingNetwork: true,
        wasCancelled: false,
      });
      if (!awaitAnnouncedRef.current) {
        awaitAnnouncedRef.current = true;
        getAppAnnouncer().announce(AWAIT_NETWORK_SENTENCE);
      }
      return;
    }

    const task = gateway.createUpload({
      file: attachment.file,
      floorId,
      projectId,
      id: attachment.id,
      ...(pageIndex !== undefined ? { pageIndex } : {}),
      ...(attachment.crop !== undefined ? { crop: attachment.crop } : {}),
      onProgress: (taskState) => {
        applyTaskState(attachment.id, floorId, taskState);
      },
    });

    // Tệp rời trạng thái chờ mạng: lệnh "chờ đồng bộ" của nó hết vai, dù lượt tải
    // này rồi xong hay hỏng.
    dropQueued(attachment.id);
    tasksRef.current.set(attachment.id, task);
    patchAttachment(attachment.id, {
      status: 'uploading',
      percent: 0,
      problem: null,
      awaitingNetwork: false,
      wasCancelled: false,
    });

    void task.start().then((finalState) => {
      applyTaskState(attachment.id, floorId, finalState);
    });
  };

  // Mạng về: tải các tệp đã chọn (hoặc bấm "Thử lại") lúc ngoại tuyến — màn
  // còn giữ `File`, hàng đợi ngoại tuyến thì không (NO-389). Ref giữ bản
  // `startUpload` của lượt vẽ mới nhất; effect chỉ chạy khi `isOnline` đổi.
  const resumeAwaitingRef = useRef<() => void>(() => undefined);
  resumeAwaitingRef.current = () => {
    for (const attachment of attachments) {
      if (attachment.awaitingNetwork && attachment.floorId !== null) {
        startUpload(attachment, attachment.floorId);
      }
    }
  };

  useEffect(() => {
    if (isOnline) {
      awaitAnnouncedRef.current = false;
      resumeAwaitingRef.current();
    }
  }, [isOnline]);

  /* ---------------------------------------------------------------------- */
  /* Nhận tệp.                                                               */
  /* ---------------------------------------------------------------------- */

  const takenFloorIds = (): ReadonlySet<string> => {
    const taken = new Set<string>();

    // Tệp hỏng không giữ chỗ: tệp chọn sau thay nó trên chính tầng đó (U21).
    for (const attachment of attachments) {
      if (attachment.floorId !== null && attachment.status !== 'error') {
        taken.add(attachment.floorId);
      }
    }

    for (const floor of floors) {
      if (floor.drawings.length > 0) {
        taken.add(floor.id);
      }
    }

    return taken;
  };

  const acceptFile = (
    file: File,
    claimed: Set<string>,
    forcedFloorId: string | null = null,
    fallbackToFirstFree = false,
  ): void => {
    // Cùng tệp đưa vào lần nữa (cùng tên và dung lượng): không thêm bản thứ hai (P01).
    const duplicate = attachmentsRef.current.find(
      (other) => other.file.name === file.name && other.file.size === file.size && other.branch !== null,
    );

    if (duplicate !== undefined) {
      const sentence = duplicateSentence(file.name);

      getAppAnnouncer().announce(sentence);
      options.onToast?.({ message: sentence });
      return;
    }

    // Trùng tên với bản vẽ máy chủ đang giữ: vẫn nhận (có thể người dùng muốn thay), nhưng nói rõ.
    const sameNameFloor = floors.find((floor) => floor.drawings.some((drawing) => drawing.name === file.name));

    if (sameNameFloor !== undefined) {
      const sentence = sameNameSentence(file.name, sameNameFloor.name);

      getAppAnnouncer().announce(sentence);
      options.onToast?.({ message: sentence });
    }

    const id = gateway.createFileId();

    setAttachments((previous) => [
      ...previous,
      {
        id,
        file,
        floorId: null,
        branch: null,
        pageCount: null,
        selectedPage: null,
        isAutoMatched: false,
        status: 'waiting',
        percent: 0,
        problem: null,
        awaitingNetwork: false,
      },
    ]);

    void Promise.all([gateway.validateFile(file), sameContentFloor(file, floors)]).then(([check, twin]) => {
      if (!check.ok) {
        patchAttachment(id, { status: 'error', problem: rejectionError(check.reason) });
        return;
      }

      // Giống hệt bản vẽ đang dùng của một tầng (P01): nói rõ, và không tự thay chính tầng đó.
      if (twin !== null) {
        const sentence = sameContentSentence(twin.name);

        getAppAnnouncer().announce(sentence);
        options.onToast?.({ message: sentence });
      }

      const keepsTwin = twin !== null && (forcedFloorId === null || forcedFloorId === twin.id);

      const guess = gateway.guessFloor(file.name);
      const guessed = guess.ok
        ? (floors.find(
            (floor) => levelByFloorId.get(floor.id) === guess.level && !claimed.has(floor.id),
          ) ?? null)
        : null;
      // Từ thẻ tầng: gán thẳng. Chỉ còn đúng một tầng trống: tệp vào tầng đó, không rơi vào khay (N1-04).
      // Chọn đúng MỘT tệp không đoán được tầng: vào tầng trống đầu tiên, kèm lời nhắc kiểm tra (U28) —
      // nằm chờ trong khay thì bộ đếm vẫn "0 / 4" mà người dùng không biết vì sao.
      const free = floors.filter((floor) => !claimed.has(floor.id));
      const match = keepsTwin
        ? null
        : forcedFloorId !== null
          ? (floors.find((floor) => floor.id === forcedFloorId) ?? null)
          : (guessed ?? (free.length === 1 || fallbackToFirstFree ? (free[0] ?? null) : null));

      if (match !== null) {
        claimed.add(match.id);
        // Tệp hỏng cũ của tầng nhường chỗ cho tệp mới, không che nó trên thẻ (U21).
        setAttachments((previous) =>
          previous.filter((other) => other.id === id || other.floorId !== match.id || other.status !== 'error'),
        );
      }

      const next: Partial<Attachment> = {
        branch: check.branch,
        pageCount: check.pageCount ?? null,
        floorId: match?.id ?? null,
        // Dự án một tầng: không có tầng nào khác để nhầm, nên không bắt xác nhận (U53).
        isAutoMatched: match !== null && forcedFloorId === null && floors.length > 1,
        status: 'waiting',
      };

      patchAttachment(id, next);

      if (match !== null) {
        startUpload({ ...emptyAttachment(id, file), ...next }, match.id);
      }
    });
  };

  const acceptFilesForFloor = (floorId: string, files: readonly File[]): void => {
    const file = files[0];

    if (!canDrop || file === undefined) {
      return;
    }

    acceptFile(file, new Set(takenFloorIds()), floorId);
  };

  const acceptFiles = (files: readonly File[]): void => {
    if (!canDrop) {
      return;
    }

    const claimed = new Set(takenFloorIds());

    for (const file of files) {
      acceptFile(file, claimed, null, files.length === 1);
    }
  };

  const split = useApartmentSplit({
    gateway,
    enabled: (options.askHowToSplit ?? true) && canDrop,
    acceptAsFloors: acceptFiles,
    describeRejection: rejectionSentence,
    onNavigate: options.onNavigate,
  });

  /* ---------------------------------------------------------------------- */
  /* Hành động trên một tệp.                                                 */
  /* ---------------------------------------------------------------------- */

  const findAttachment = (fileId: string): Attachment | null =>
    attachments.find((attachment) => attachment.id === fileId) ?? null;

  // Mọi lối ra của một tệp khỏi tầng/lượt hiện tại (huỷ, xoá, gán lại, đổi
  // trang, bị đẩy về khay) đi qua đây, nên lệnh hàng đợi của nó cũng gỡ ở đây.
  const cancelTask = (fileId: string): void => {
    tasksRef.current.get(fileId)?.cancel();
    tasksRef.current.delete(fileId);
    dropQueued(fileId);
  };

  // Tầng của một tệp biến khỏi danh sách (xoá ở nơi khác, thường lộ ra qua 404 của lượt tải và
  // lượt đọc lại của BUG-311): thẻ tầng đi, nhưng tệp không được đi theo im lặng — nó về khay
  // kèm câu báo để gán lại (BUG-572). Lượt đọc hỏng giữ `data` cũ, nên cổng dự án mất không chạm đây.
  const floorNamesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const releaseGoneFloorsRef = useRef<(present: readonly Floor[]) => void>(() => undefined);
  releaseGoneFloorsRef.current = (present) => {
    const ids = new Set(present.map((floor) => floor.id));

    for (const attachment of attachmentsRef.current) {
      if (attachment.floorId === null || ids.has(attachment.floorId)) {
        continue;
      }

      const sentence = floorGoneSentence(floorNamesRef.current.get(attachment.floorId), attachment.file.name);

      cancelTask(attachment.id);
      patchAttachment(attachment.id, {
        ...toTray(),
        problem: { kind: 'transfer', sentence, isRetryable: false, titleKey: COPY.uploadErrorTitleKey },
      });
      getAppAnnouncer().announce(sentence);
    }

    floorNamesRef.current = new Map(present.map((floor) => [floor.id, floor.name]));
  };

  useEffect(() => {
    if (floorsQuery.data !== undefined) {
      releaseGoneFloorsRef.current(floorsQuery.data);
    }
  }, [floorsQuery.data]);

  const reassign = (fileId: string, floorId: string | null): void => {
    const attachment = findAttachment(fileId);

    // `branch === null`: tệp chưa qua (hoặc đã trượt) lượt kiểm phía máy — tệp bị từ chối không
    // bao giờ được gán cho tầng và tải lên, máy chủ chỉ trả 422/413 y hệt (BUG-523).
    if (!canEdit || attachment === null || attachment.branch === null) {
      return;
    }

    cancelTask(fileId);

    // Một tầng, một tệp (NO-393) — cùng luật ghép tự động (`claimed`): tệp gán
    // sau thay tệp đang ở tầng ấy, tệp cũ về khay, thôi tải và thôi chờ mạng.
    // Không vậy thì thẻ hiện tệp đầu mà máy chủ giữ tệp tải xong sau cùng.
    const displaced =
      floorId === null
        ? undefined
        : attachments.find((other) => other.id !== fileId && other.floorId === floorId);

    if (displaced !== undefined) {
      cancelTask(displaced.id);
      patchAttachment(displaced.id, toTray());
      getAppAnnouncer().announce(displacedSentence(displaced.file.name));
    }

    patchAttachment(fileId, {
      floorId,
      // Người dùng vừa tự chọn, nên lời nhắc "ghép tự động, kiểm tra lại" hết vai.
      isAutoMatched: false,
      status: 'waiting',
      percent: 0,
      problem: null,
      awaitingNetwork: false,
      wasCancelled: false,
    });

    if (floorId !== null) {
      startUpload({ ...attachment, floorId, isAutoMatched: false }, floorId);
    }
  };

  // Một tờ nhiều tầng: cùng tệp gắn vào từng tầng có khung, mỗi bản một `crop`. Tệp gốc
  // nhường chỗ; tệp khác đang ở tầng đích về khay như `reassign` (NO-393).
  // ponytail: bản gốc đã tải xong cả trang vẫn nằm trên máy chủ nếu tầng của nó không được khoanh.
  const uploadSheetRegions = (fileId: string, uploads: readonly SheetUpload[]): void => {
    const source = findAttachment(fileId);

    if (!canEdit || source === null || source.branch === null || uploads.length === 0) {
      return;
    }

    cancelTask(fileId);
    const targets = new Set(uploads.map((upload) => upload.floorId));

    for (const other of attachments) {
      if (other.id !== fileId && other.floorId !== null && targets.has(other.floorId)) {
        cancelTask(other.id);
        patchAttachment(other.id, toTray());
        getAppAnnouncer().announce(displacedSentence(other.file.name));
      }
    }

    const created = uploads.map<Attachment>((upload) => ({
      ...source,
      id: gateway.createFileId(),
      floorId: upload.floorId,
      crop: upload.crop,
      isAutoMatched: false,
      status: 'waiting',
      percent: 0,
      problem: null,
      awaitingNetwork: false,
      wasCancelled: false,
      dismissedProblem: null,
    }));

    setAttachments((previous) => [...previous.filter((attachment) => attachment.id !== fileId), ...created]);

    for (const attachment of created) {
      startUpload(attachment, attachment.floorId ?? '');
    }
  };

  const pickPdfPage = (fileId: string, page: string): void => {
    const attachment = findAttachment(fileId);

    patchAttachment(fileId, { selectedPage: page });

    if (!canEdit || attachment === null || attachment.floorId === null) {
      return;
    }

    // Closure cũ còn giữ trang cũ, nên dựng lại đối tượng với trang mới.
    cancelTask(fileId);
    patchAttachment(fileId, { status: 'waiting', percent: 0, problem: null });
    startUpload({ ...attachment, selectedPage: page }, attachment.floorId);
  };

  const removeFile = (fileId: string): void => {
    const removed = findAttachment(fileId);

    if (!canEdit || removed === null) {
      return;
    }

    cancelTask(fileId);
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== fileId));

    // A8 + D-05: xoá xảy ra NGAY, không hộp thoại xác nhận; đường về là một vé
    // 8 giây do chính vé giữ, nên ở đây không có bộ đếm thời gian nào.
    const ticket = gateway.createRemovalTicket({
      description: `Hoàn tác xoá bản vẽ ${removed.file.name}`,
      undo: () => {
        // Trả lại ĐÚNG thứ đã xoá: tệp đã gắn kèm vẫn là đã gắn kèm (máy chủ đã
        // nhận nó, xoá không gọi máy chủ). Hạ nó về "chờ xử lý" là để thẻ treo ở
        // đó mãi, vì không ai tải lại (B-V4-03). Chỉ lượt tải bị chính lần xoá
        // cắt ngang mới phải chạy lại.
        //
        // Một tầng, một tệp (NO-393): tầng cũ đã nhận tệp khác trong lúc chờ
        // hoàn tác thì tệp trả về khay, không chen thêm vào tầng ấy.
        const occupied =
          removed.floorId !== null &&
          attachmentsRef.current.some(
            (attachment) => attachment.id !== removed.id && attachment.floorId === removed.floorId,
          );
        const restored: Attachment = occupied ? { ...removed, ...toTray() } : removed;

        setAttachments((previous) =>
          previous.some((attachment) => attachment.id === removed.id)
            ? previous
            : [...previous, restored],
        );

        if (occupied) {
          getAppAnnouncer().announce(displacedSentence(removed.file.name));
          return;
        }

        // Tệp đang chờ mạng cũng phải chạy lại: mạng có thể đã về trong lúc
        // nó bị xoá, và effect tải lại chỉ chạy khi mạng ĐỔI (NO-389).
        if ((removed.status === 'uploading' || removed.awaitingNetwork) && removed.floorId !== null) {
          startUpload(removed, removed.floorId);
        }
      },
      ...(options.now !== undefined ? { now: options.now } : {}),
    });

    options.onToast?.({
      message: `Đã xoá bản vẽ ${removed.file.name}`,
      onUndo: () => {
        ticket.undo();
      },
    });
  };

  /* ---------------------------------------------------------------------- */
  /* Lý do chặn và nút chính.                                                */
  /* ---------------------------------------------------------------------- */

  // Đã có ít nhất một tầng có bản vẽ: tầng HOÀN TOÀN trống (không tệp nào) không chặn — bước Xử lý
  // chỉ chạy tầng có bản vẽ (U03). Tệp đang chờ/hỏng của một tầng thì vẫn chặn như cũ.
  const skippedFloors = useMemo<readonly Floor[]>(() => {
    const empty = floors.filter((floor) => floor.drawings.length === 0 && !attachmentByFloor.has(floor.id));

    return empty.length < floors.length ? empty : [];
  }, [attachmentByFloor, floors]);

  const blockReasons = useMemo<readonly FloorUploadBlockReason[]>(() => {
    const reasons: FloorUploadBlockReason[] =
      hasNoFloors ? [{ floorId: '', floorName: '', kind: 'noFloors', sentence: COPY.noFloors }] : [];

    // `floor.name` đã là nhãn đầy đủ — API trả về `Tầng 2`, `Tầng hầm`, chứ
    // không trả về `2`. Mẫu câu trong `.notes/copy.md` viết `Tầng {{floorName}}`
    // với `{{floorName}}` là phần số, nên ghép thêm chữ `Tầng` vào đây là đọc
    // thành `Tầng Tầng 2 chưa có bản vẽ.`. Nhãn xuất hiện đúng một lần.
    for (const floor of floors) {
      if (skippedFloors.includes(floor)) {
        continue;
      }

      const attachment = attachmentByFloor.get(floor.id) ?? null;
      // Cùng luật với bộ đếm "N / M tầng đã có bản vẽ": một tệp ĐANG CHỜ (PDF chưa
      // chọn trang, hàng đợi ngoại tuyến) hay ĐÃ HỎNG chưa phải bản vẽ của tầng.
      // Đếm nó là để bộ đếm nói "3 / 4" mà nút vẫn đi tiếp (B-V4-04). Tệp đang
      // tải có lý do riêng (`uploading`) ngay dưới.
      const isUnfinished =
        attachment !== null && (attachment.status === 'waiting' || attachment.status === 'error');

      if (attachment === null ? floor.drawings.length === 0 : isUnfinished) {
        reasons.push({
          floorId: floor.id,
          floorName: floor.name,
          kind: 'missingFile',
          // PDF nhiều trang chưa chọn trang không "đang tải": nó chờ người chọn trang (BUG-303).
          sentence:
            attachment !== null && isAwaitingPage(attachment)
              ? `${floor.name} chưa chọn trang của bản vẽ.`
              : attachment?.status === 'error'
                ? `Bản vẽ ${floor.name} bị lỗi. Hãy chọn tệp khác.`
                : isUnfinished
                  ? `${floor.name} chưa tải xong bản vẽ.`
                  : `${floor.name} chưa có bản vẽ.`,
        });
      }

      const elevationMm = stack.elevationByFloor.get(floor.id) ?? null;
      const elevationProblem = elevationProblemFor(elevationMm);

      if (elevationMm === null || elevationProblem !== null) {
        reasons.push({
          floorId: floor.id,
          floorName: floor.name,
          kind: 'missingElevation',
          sentence: elevationProblem ?? `${floor.name} chưa nhập cao độ.`,
        });
      }

      if (attachment !== null && attachment.status === 'uploading') {
        reasons.push({
          floorId: floor.id,
          floorName: floor.name,
          kind: 'uploading',
          sentence: `${floor.name} đang tải lên bản vẽ.`,
        });
      }
    }

    for (const issue of stack.overlaps) {
      const floorId = stack.floorIdByLevel.get(issue.levelId);
      const floor = floors.find((candidate) => candidate.id === floorId) ?? null;

      if (floor === null) {
        continue;
      }

      reasons.push({
        floorId: floor.id,
        floorName: floor.name,
        kind: 'duplicateElevation',
        // Câu đã Việt hoá sẵn trong `src/domain`, nêu đúng hai tầng và số
        // milimét chồng lấn. Viết lại ở đây là tạo bản thứ hai sẽ lệch.
        sentence: issue.message,
      });
    }

    return reasons;
  }, [attachmentByFloor, floors, hasNoFloors, skippedFloors, stack]);

  const canSubmit = canEdit && floors.length > 0 && blockReasons.length === 0;

  // Lý do cuối cùng được gỡ thì lời chặn biến mất theo, không đợi bấm lại.
  if (blockNotice !== null && blockReasons.length === 0) {
    setBlockNotice(null);
  }

  // UX-07: đã xử lý mà chưa thả tệp mới thì nút chính là "Xử lý lại" — mọi tầng có bản vẽ đều bị thay, nên hỏi như UX-51.
  const isReprocess = processedNoticeOf(floors, attachments.length) !== null;
  const submitLabel = isReprocess ? COPY.reprocess : COPY.submit;
  const replaced = isReprocess
    ? floors.filter((floor) => floor.drawings.length > 0)
    : floors.filter((floor) => drawnAtOpen?.has(floor.id) === true && attachmentByFloor.has(floor.id));

  // Tệp thay đã gỡ thì lời hỏi lại cũng gỡ theo.
  if (replaceNotice !== null && replaced.length === 0) {
    setReplaceNotice(null);
  }

  const submit = (): void => {
    if (!canEdit) {
      return;
    }

    if (!canSubmit) {
      // Nút chính KHÔNG bị vô hiệu hoá âm thầm: nó bấm được, và bấm lúc còn
      // thiếu thì nêu tên tầng cùng mã tầng để view cuộn tới đó.
      const first = blockReasons[0];

      if (first === undefined) {
        return;
      }

      const requestId = scrollToken + 1;

      setScrollToken(requestId);
      setBlockNotice({
        title: COPY.blockedTitle,
        titleKey: COPY.blockedTitleKey,
        reasons: blockReasons,
        scrollTo: { floorId: first.floorId, requestId },
      });
      return;
    }

    // Tầng đã có bản vẽ máy chủ mà vừa nhận tệp mới: xử lý lại thay kết quả cũ, việc duyệt trên
    // tầng đó mất. Hỏi một lần; bấm lại là đồng ý (UX-51).
    const firstReplaced = replaced[0];

    if (firstReplaced !== undefined && replaceNotice === null) {
      const requestId = scrollToken + 1;

      setScrollToken(requestId);
      setReplaceNotice({
        title: COPY.replaceTitle(submitLabel),
        titleKey: COPY.blockedTitleKey,
        reasons: replaced.map((floor) => ({
          floorId: floor.id,
          floorName: floor.name,
          kind: 'replacesDrawing' as const,
          sentence: `${floor.name}: bản vẽ cũ được thay bằng bản mới. Tường, cửa, phòng đã duyệt, tự vẽ hoặc đã sửa vẫn được giữ; phần AI chưa duyệt sẽ được dựng lại từ bản vẽ mới.`,
        })),
        scrollTo: { floorId: firstReplaced.id, requestId },
      });
      return;
    }

    setSubmitting(true);
    setBlockNotice(null);
    setReplaceNotice(null);
    options.onNavigate?.(ROUTES.project.pipeline(projectId));
  };

  /* ---------------------------------------------------------------------- */
  /* Mô hình.                                                                */
  /* ---------------------------------------------------------------------- */

  const reassignOptions = useMemo<readonly SelectOption[]>(
    () => floors.map((floor) => ({ value: floor.id, label: floor.name })),
    [floors],
  );
  // Gán từ khay vào tầng đã có bản vẽ là THAY bản vẽ ấy: nói trước ngay trong lựa chọn (P01).
  const trayAssignOptions = useMemo<readonly SelectOption[]>(
    () =>
      floors.map((floor) => ({
        value: floor.id,
        label:
          floor.drawings.length > 0 || attachmentByFloor.has(floor.id)
            ? `${floor.name} (thay bản vẽ đang có)`
            : floor.name,
      })),
    [attachmentByFloor, floors],
  );

  // Ảnh xem trước: blob URL của tệp ảnh, giữ theo id tệp và thu hồi khi rời màn (G3-24).
  const previewsRef = useRef(new Map<string, string | null>());
  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      for (const url of previews.values()) {
        if (url !== null) URL.revokeObjectURL(url);
      }
      previews.clear();
    };
  }, []);
  // Gỡ hay thay tệp (thay = gỡ + thêm id mới): thu hồi ngay blob của tệp không còn trong danh sách,
  // không đợi rời màn (RV5#20).
  useEffect(() => {
    const cache = previewsRef.current;
    const live = new Set(attachments.map((attachment) => attachment.id));
    for (const [id, url] of cache) {
      if (live.has(id)) continue;
      if (url !== null) URL.revokeObjectURL(url);
      cache.delete(id);
    }
  }, [attachments]);
  const previewUrlFor = useCallback((attachment: Attachment): string | null => {
    const cache = previewsRef.current;
    if (!cache.has(attachment.id)) {
      cache.set(
        attachment.id,
        attachment.file.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(attachment.file)
          : null,
      );
    }
    return cache.get(attachment.id) ?? null;
  }, []);

  const pageThumbnails = usePdfPageThumbnails(gateway, projectId, attachments, floors.length >= 2 ? 1 : 2);

  /** Ảnh để khoanh vùng: blob của ảnh, ảnh nhỏ của trang PDF đang chọn; `null` khi chưa có. */
  const sheetPreviewOf = useCallback(
    (attachment: Attachment): string | null => {
      if (attachment.branch === 'raster') return previewUrlFor(attachment);
      if (attachment.branch !== 'pdf') return null;

      return pageThumbnails.get(attachment.id)?.[pageIndexOf(attachment) ?? 0] ?? null;
    },
    [pageThumbnails, previewUrlFor],
  );

  const sheet = useSheetRegions({
    floors,
    previewUrlFor: (fileId) => {
      const attachment = findAttachment(fileId);

      return attachment === null ? null : sheetPreviewOf(attachment);
    },
    onConfirm: uploadSheetRegions,
  });

  const fileModelFor = useCallback((attachment: Attachment): FloorUploadFileModel => {
    const pageCountLabel =
      attachment.pageCount === null || attachment.pageCount <= 0
        ? null
        : `${formatNumber(attachment.pageCount, { grouping: false })} trang`;
    // Tệp vượt trần: cùng phép làm tròn với câu "vượt trần" — dòng tệp và câu lỗi ghi một số (BUG-302).
    const sizeLabel =
      attachment.file.size > MAX_UPLOAD_FILE_SIZE_BYTES
        ? sizeOverCap(attachment.file.size, MAX_UPLOAD_FILE_SIZE_BYTES)
        : formatFileSize(attachment.file.size);
    // Một trang thì không có gì để chọn: không ô "Chọn trang", tệp tải ngay (BUG-530).
    const thumbnails = pageThumbnails.get(attachment.id);
    const pageOptions =
      attachment.pageCount === null || attachment.pageCount <= 1
        ? []
        : Array.from({ length: Math.min(attachment.pageCount, MAX_PDF_PAGE_COUNT) }, (_unused, index) => {
            const page = formatNumber(index + 1, { grouping: false });
            return { value: page, label: `Trang ${page}` };
          });

    return {
      id: attachment.id,
      name: attachment.file.name,
      previewUrl: previewUrlFor(attachment),
      sizeLabel,
      pageCountLabel,
      // Tệp CAD hỏng (vd. 422 chưa hỗ trợ) không chạy nhánh nào: không quảng cáo độ chính xác (BUG-304).
      isCadBranch: attachment.branch === 'cad' && attachment.status !== 'error',
      summaryLine: [attachment.file.name, sizeLabel, pageCountLabel]
        .filter((part): part is string => part !== null)
        .join(' · '),
      pageOptions,
      selectedPage: attachment.selectedPage,
      ...(thumbnails === undefined ? {} : { pageThumbnails: thumbnails }),
      ...(attachment.crop === undefined ? {} : { crop: attachment.crop }),
    };
  }, [pageThumbnails, previewUrlFor]);

  const statusVariantFor = (attachment: Attachment | null, status: FloorUploadStatus) =>
    status === 'attached' && attachment !== null && attachment.isAutoMatched
      ? ('attention' as const)
      : STATUS_VARIANTS[status];

  const rows = useMemo<readonly FloorUploadRowModel[]>(
    () =>
      floors.map((floor, index) => {
        const attachment = attachmentByFloor.get(floor.id) ?? null;
        const serverDrawing = floor.drawings[0] ?? null;
        const status: FloorUploadStatus =
          attachment !== null ? attachment.status : serverDrawing !== null ? 'attached' : 'waiting';
        const percent = attachment?.percent ?? (status === 'attached' ? 100 : 0);
        const elevationMm = stack.elevationByFloor.get(floor.id) ?? null;
        const ceilingMm = stack.ceilingByFloor.get(floor.id) ?? null;
        const isAutoMatched = attachment?.isAutoMatched ?? false;
        const file: FloorUploadFileModel | null =
          attachment !== null
            ? fileModelFor(attachment)
            : serverDrawing === null
              ? null
              : {
                  id: serverDrawing.id,
                  name: drawingDisplayName(serverDrawing.name, floor.name),
                  // `Drawing` của máy chủ không mang dung lượng; `formatFileSize`
                  // trả `MISSING_VALUE` cho `undefined`, nên cột vẫn thẳng hàng.
                  sizeLabel: formatFileSize(undefined),
                  pageCountLabel: null,
                  isCadBranch: false,
                  summaryLine: drawingDisplayName(serverDrawing.name, floor.name),
                  pageOptions: [],
                  selectedPage: null,
                };

        return {
          floorId: floor.id,
          name: floor.name,
          elevationLabel: elevationMm === null ? MISSING_VALUE : formatLength(elevationMm, { unit: 'm' }),
          ceilingElevationLabel: ceilingMm === null ? MISSING_VALUE : formatLength(ceilingMm, { unit: 'm' }),
          storeyHeightLabel: formatLength(floor.heightMm, { unit: 'm' }),
          file,
          status,
          statusVariant: statusVariantFor(attachment, status),
          statusLabel: file === null ? NO_DRAWING_LABEL : STATUS_LABELS[status],
          statusLabelKey: file === null ? NO_DRAWING_LABEL_KEY : STATUS_LABEL_KEYS[status],
          isAutoMatched,
          autoMatchHint: isAutoMatched ? COPY.autoMatch : null,
          percent,
          percentLabel: formatPercent(percent, { fractionDigits: 0, source: 'percent' }),
          progressAriaLabel:
            status === 'attached'
              ? `Tải xong ${file?.name ?? floor.name}`
              : `Đã tải ${formatPercent(percent, { fractionDigits: 0, source: 'percent' })} của ${file?.name ?? floor.name}`,
          error: visibleProblem(attachment),
          // Chỉ tệp của phiên này gán lại được; bản vẽ đã nằm trên máy chủ thì không có lượt
          // chuyển nào để gửi, nên không có ô chọn (BUG-531).
          reassignOptions: canEdit && attachment !== null ? reassignOptions : [],
          canSplitSheet:
            canEdit &&
            floors.length >= 2 &&
            attachment !== null &&
            attachment.crop === undefined &&
            attachment.status !== 'error' &&
            sheetPreviewOf(attachment) !== null,
          canCancelUpload: canEdit && status === 'uploading',
          canRetryUpload:
            canEdit &&
            attachment !== null &&
            ((attachment.problem?.isRetryable ?? false) || attachment.wasCancelled === true),
          canRemoveFile: canEdit && attachment !== null,
          removeLabel:
            canEdit && attachment !== null ? `Xoá bản vẽ ${attachment.file.name}` : null,
          // Giảm chuyển động: thẻ hiện ngay, không so le (WCAG 2.3.3, BUG-527).
          revealDelayMs: staggerDelayMs(index, { reducedMotion }),
          revealDurationMs: durationMs('standard', { reducedMotion }),
        };
      }),
    [attachmentByFloor, canEdit, fileModelFor, floors, reassignOptions, reducedMotion, sheetPreviewOf, stack],
  );

  const trayItems = useMemo<readonly FloorUploadTrayItemModel[]>(
    () =>
      attachments
        .filter((attachment) => attachment.floorId === null)
        .map((attachment) => {
          const model = fileModelFor(attachment);

          return {
            id: attachment.id,
            name: model.name,
            sizeLabel: model.sizeLabel,
            isCadBranch: model.isCadBranch,
            summaryLine: model.summaryLine,
            error: visibleProblem(attachment),
            assignOptions: canEdit && attachment.branch !== null ? trayAssignOptions : [],
            canRemoveFile: canEdit,
            removeLabel: canEdit ? `Xoá bản vẽ ${attachment.file.name}` : null,
          };
        }),
    [attachments, canEdit, fileModelFor, trayAssignOptions],
  );

  const tray: FloorUploadTrayModel = {
    title: COPY.trayTitle,
    titleKey: COPY.trayTitleKey,
    items: trayItems,
    countLabel: `${formatNumber(trayItems.length, { grouping: false })} tệp`,
  };

  const doneCount = rows.filter((row) => row.status === 'attached').length;
  const isAwaitingNetwork = attachments.some((attachment) => attachment.awaitingNetwork);

  const footer: FloorUploadFooterModel = {
    doneCount,
    totalCount: rows.length,
    counterLabel:
      `${formatNumber(doneCount, { grouping: false })} / ` +
      `${formatNumber(rows.length, { grouping: false })} tầng đã có bản vẽ`,
    counterLabelKey: COPY.counterKey,
    submitLabel,
    submitLabelKey: COPY.submitKey,
    isReprocess,
    canSubmit,
    blockReasons,
    isSubmitting,
    isSubmitHidden: !canEdit,
    skippedFloorNames: skippedFloors.map((floor) => floor.name),
  };

  /* ---------------------------------------------------------------------- */
  /* Bảy trạng thái (A11, R-63).                                             */
  /* ---------------------------------------------------------------------- */

  // Danh sách tầng trả 404 = dự án không có: cùng chữ và lối ra với Quản lý tầng (BUG-311).
  const loadFailureInfo = floorsQuery.isError ? gateway.describeApiFailure(floorsQuery.error) : null;
  const isProjectMissing = loadFailureInfo?.kind === 'notFound';
  const loadFailure =
    loadFailureInfo === null
      ? null
      : isProjectMissing
        ? PROJECT_NOT_FOUND_DESCRIPTION
        : loadFailureInfo.sentence || LOAD_FAILURE_FALLBACK;

  const hasAnyFile = doneCount > 0 || attachments.length > 0;
  const hasUploading = rows.some((row) => row.status === 'uploading');

  const state = useMemo<SevenState>(() => {
    // Tải và lỗi tải thắng hai lớp phủ: thu gọn chỉ đổi cách xếp danh sách, mà
    // chưa có danh sách thì màn hẹp phải nói lỗi chứ không vẽ vùng thả trống (BUG-072).
    if (floorsQuery.isPending) return 'loading';
    if (loadFailure !== null) return 'error';
    // Câu mời "Kéo thả tệp đầu tiên" hiện ở mọi khổ: rỗng thắng thu gọn (BUG-528). Người xem
    // không thả được tệp, nên với họ câu mời không có nghĩa — họ vẫn về `forbidden`.
    if (canEdit && !hasAnyFile) return 'empty';
    if (isCollapsed) return 'collapsed';
    if (!canEdit) return 'forbidden';
    // Lỗi của MỘT tệp không bao giờ leo lên đây: nó ở lại trong `row.error`.
    // `'error'` của cả màn chỉ dành cho lượt đọc danh sách tầng hỏng.
    if (hasUploading || doneCount < rows.length) return 'partial';
    return 'success';
  }, [
    canEdit,
    doneCount,
    floorsQuery.isPending,
    hasAnyFile,
    hasUploading,
    isCollapsed,
    loadFailure,
    rows.length,
  ]);

  const model: FloorUploadModel = {
    state,
    projectId,
    ...(projectName !== null ? { projectName } : {}),
    canEdit,
    isReadOnly: !canEdit,
    isCollapsed,
    isOffline: !isOnline,
    isDragActive: canDrop && dragDepth > 0,
    errorMessage: state === 'error' ? loadFailure : null,
    isProjectMissing,
    canRetryLoad: !isProjectMissing && (loadFailureInfo?.isRetryable ?? false),
    // Có tệp đang chờ mạng thì nói rõ nó sẽ tự tải, và giới hạn của lời hứa ấy (NO-389).
    offlineNotice: isOnline ? null : isAwaitingNetwork ? AWAIT_NETWORK_SENTENCE : COPY.offline,
    offlineNoticeKey: isAwaitingNetwork ? AWAIT_NETWORK_KEY : COPY.offlineKey,
    readOnlyNotice: canEdit ? null : COPY.readOnly,
    readOnlyNoticeKey: COPY.readOnlyKey,
    emptyMessage: COPY.empty,
    emptyMessageKey: COPY.emptyKey,
    dropZone: {
      title: COPY.dropZoneTitle,
      titleKey: COPY.dropZoneTitleKey,
      selectFileLabel: COPY.selectFile,
      // Cả hai con số lấy từ hằng của `src/lib/upload`; thư mục màn không chứa
      // một trần dung lượng nào viết tay.
      formatsLine:
        `Định dạng hỗ trợ: ${PICKER_UPLOAD_EXTENSIONS.join(', ')}. ` +
        `Kích thước tối đa: ${formatFileSize(MAX_UPLOAD_FILE_SIZE_BYTES)}.`,
      acceptAttribute: PICKER_UPLOAD_EXTENSIONS.join(','),
      isEnabled: canDrop,
    },
    floors: rows,
    tray,
    footer,
    // Lý do hiện theo bản mới nhất, không theo bản chụp lúc bấm (G3-22).
    blockNotice: blockNotice === null ? replaceNotice : { ...blockNotice, reasons: blockReasons },
    processedNotice: isReprocess ? processedNoticeOf(floors, attachments.length) : null,
    splitPrompt: split.splitPrompt,
    apartments: split.apartments,
    sheetRegions: sheet.model,
  };

  const actions: FloorUploadActions = {
    onFilesDropped: (files) => {
      setDragDepth(0);
      split.offer(files);
    },
    onFilesChosen: split.offer,
    onFilesForFloor: acceptFilesForFloor,
    onDragEnter: () => {
      if (canDrop) setDragDepth((depth) => depth + 1);
    },
    onDragLeave: () => {
      setDragDepth((depth) => (depth > 0 ? depth - 1 : 0));
    },
    onReassign: reassign,
    onPickPdfPage: pickPdfPage,
    onCancelUpload: (fileId) => {
      if (!canEdit) return;
      cancelTask(fileId);
      patchAttachment(fileId, { wasCancelled: true });
    },
    onRetryUpload: (fileId) => {
      const attachment = findAttachment(fileId);

      if (!canEdit || attachment === null || attachment.floorId === null) {
        return;
      }

      startUpload(attachment, attachment.floorId);
    },
    onRemoveFile: removeFile,
    onSubmit: submit,
    onRetryLoad: () => {
      void floorsQuery.refetch();
    },
    onAddFloors:
      canEdit && options.onNavigate !== undefined
        ? () => options.onNavigate?.(ROUTES.project.floors(projectId))
        : undefined,
    onOpenReview:
      options.onNavigate === undefined ? undefined : () => options.onNavigate?.(ROUTES.project.floors(projectId)),
    onBackToProjects:
      options.onNavigate === undefined ? undefined : () => options.onNavigate?.(ROUTES.dashboard),
    // Xác nhận "đúng tầng" chỉ gỡ cờ ghép tự động; tệp đã tải không tải lại.
    onConfirmMatch: (fileId) => {
      if (canEdit) patchAttachment(fileId, { isAutoMatched: false });
    },
    // Lỗi của một tệp đóng lại một mình; không hàng nào khác đổi.
    ...split.actions,
    onOpenSheetRegions: (fileId) => {
      if (canEdit) sheet.open(fileId);
    },
    onSelectSheetFloor: sheet.selectFloor,
    onSetSheetRegion: sheet.setRegion,
    onConfirmSheetRegions: sheet.confirm,
    onCloseSheetRegions: sheet.close,
    onDismissError: (fileId) =>
      // Đọc lỗi ngay trong lượt cập nhật, không từ bản vẽ cũ của closure: lượt kiểm tệp có thể vừa
      // đặt lỗi mà màn chưa vẽ lại. Tệp bị từ chối ngay lúc kiểm (`branch === null`) không bao giờ
      // gán được, nên đóng lỗi là bỏ luôn tệp khỏi khay — không bắt xoá tay lần nữa (U55).
      setAttachments((previous) =>
        previous.flatMap((attachment) =>
          attachment.id !== fileId
            ? [attachment]
            : attachment.branch === null && attachment.problem !== null
              ? []
              : [{ ...attachment, dismissedProblem: attachment.problem }],
        ),
      ),
  };

  return { ...model, ...actions };
}

/** Một tệp rời tầng về khay: thôi tải, thôi chờ mạng, chờ người gán lại. */
function toTray(): Partial<Attachment> {
  return {
    floorId: null,
    isAutoMatched: false,
    status: 'waiting',
    percent: 0,
    problem: null,
    awaitingNetwork: false,
    wasCancelled: false,
  };
}

/** Câu báo khi một tệp bị đẩy về khay vì tầng của nó nhận tệp khác (NO-393). */
/** Tên tệp máy chủ lưu dạng mã băm (`4ea5b72d….jpg`): không nói gì với người dùng, thay bằng "Bản vẽ tầng N". */
const HASHED_FILE_NAME = /^[0-9a-f-]{16,}(\.[a-z0-9]+)?$/iu;

function drawingDisplayName(fileName: string, floorName: string): string {
  return HASHED_FILE_NAME.test(fileName) ? `Bản vẽ ${floorName.toLocaleLowerCase('vi')}` : fileName;
}

/** Cùng tệp vừa được đưa vào lần nữa (P01). */
function sameContentSentence(floorName: string): string {
  return `Tệp này giống hệt bản vẽ đang dùng của ${floorName}. Gán tầng nếu vẫn muốn tải lại.`;
}

/**
 * Tầng có bản vẽ đang dùng giống hệt `file` theo SHA-256 (P01), hoặc `null`.
 *
 * Chỉ băm khi máy chủ có dấu băm để so (`contentSha256`, lượt tải cũ không có); lỗi đọc
 * tệp thì coi như không trùng — báo trùng là gợi ý, không được chặn việc tải.
 */
async function sameContentFloor(file: File, floors: readonly Floor[]): Promise<Floor | null> {
  const hashed = floors.filter((floor) => floor.drawings.some((drawing) => drawing.contentSha256 !== undefined));

  if (hashed.length === 0) {
    return null;
  }

  try {
    const sha256 = await hashBlobSha256Hex(file);

    return hashed.find((floor) => floor.drawings.some((drawing) => drawing.contentSha256 === sha256)) ?? null;
  } catch {
    return null;
  }
}

function duplicateSentence(fileName: string): string {
  return `${fileName} đã có trong danh sách; bỏ qua bản trùng.`;
}

/** Tệp mới trùng tên với bản vẽ máy chủ đang giữ của một tầng (P01). */
function sameNameSentence(fileName: string, floorName: string): string {
  return `${fileName} trùng tên với bản vẽ đang có của ${floorName}; gán vào tầng ấy sẽ thay bản cũ.`;
}

function displacedSentence(fileName: string): string {
  return `${fileName} đã về khay tệp chưa gán tầng vì tầng ấy đã có tệp khác`;
}

/** Câu báo khi tầng của một tệp đã bị xoá ở nơi khác: tệp về khay chờ gán lại (BUG-572). */
function floorGoneSentence(floorName: string | undefined, fileName: string): string {
  const floor = floorName === undefined ? 'Tầng đã chọn' : floorName;

  return `${floor} đã bị xoá ở nơi khác; ${fileName} đã về khay tệp chưa gán tầng, hãy gán cho tầng khác.`;
}

/** Khung một tệp vừa nhận, trước khi lượt kiểm tra trả lời. */
function emptyAttachment(id: string, file: File): Attachment {
  return {
    id,
    file,
    floorId: null,
    branch: null,
    pageCount: null,
    selectedPage: null,
    isAutoMatched: false,
    status: 'waiting',
    percent: 0,
    problem: null,
    awaitingNetwork: false,
  };
}
