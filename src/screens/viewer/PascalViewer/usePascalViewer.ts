/// <reference types="vite/client" />

/**
 * Toàn bộ phần khó của màn xem Pascal, để view ở bên cạnh còn thuần.
 *
 * Ba việc nó làm, và mỗi việc có một cái bẫy đã đo được:
 *
 * 1. **Nạp gói vách ngăn lúc chạy.** Pascal không đi qua gói chính: cổng "chi
 *    phí thêm cho một màn" còn dư 0,4 KiB / 280 và màn Pascal nặng ~1,5 MB
 *    gzip, nên nó là một lượt dựng riêng ra `/assets/pascal/`. Vì vậy đây là
 *    một `import()` tới **đường dẫn tĩnh**, không phải một `import` mà bundler
 *    thấy được — nếu bundler thấy, nó kéo Pascal vào gói chính và cổng đỏ.
 *
 * 2. **Bắt lỗi xuyên gốc React.** Khung nhúng dựng gốc thứ hai, mà
 *    `ScreenErrorBoundary` không với tới đó được. Lỗi đi ngược lên bằng
 *    `onFatal`, và nó đẩy màn sang trạng thái `error` — chứ không ném, vì ném
 *    ở gốc kia thì không ai bắt.
 *
 * 3. **Dọn khi rời màn.** `dispose()` gỡ gốc thứ hai và trả store Pascal về
 *    rỗng. Thiếu bước ấy thì lượt vào sau thấy cảnh của lượt trước — một lỗi
 *    im lặng, không ai báo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  PascalCommitVerdict,
  PascalTemplateResult,
  PascalInitialTool,
  PascalHistoryJump,
  PascalMeasurementDelete,
  PascalMountMode,
  PascalSaveStatus,
} from '@/components/pascal/pascalMountTypes';
import { useShortcut } from '@/hooks/useShortcut';
import { formatNumber } from '@/lib/format/number';
import type { PascalScene, SkippedEntity } from '@/lib/pascal/types';
import type { SpatialGraph } from '@/domain/spatial/types';

import {
  saveLabelOf,
  PASCAL_VIEWER_CAPTIONS,
  PASCAL_VIEWER_TITLE,
  type PascalViewerErrorCode,
  type PascalViewerState,
  type PascalViewerViewModel,
  type SkippedSummary,
} from './pascalViewerTypes';

/** Đường dẫn tĩnh của gói vách ngăn. Xem `vite.pascal.config.ts`. */
const MOUNT_URL = '/assets/pascal/pascal-mount.js';

/**
 * URL nạp gói: `v` là 8 hex sha256 của chính tệp, `vite.config.ts` tính lúc dựng
 * (B-V10-41 — tên cố định + `immutable` thì không có nó trình duyệt giữ bản cũ);
 * `attempt` phá bộ nhớ đệm của lượt nạp hỏng trước. Đọc biến lúc gọi, không lúc nhập.
 */
export function mountUrl(attempt: number): string {
  const version: unknown = import.meta.env.VITE_PASCAL_MOUNT_VERSION;
  const query = new URLSearchParams();

  if (typeof version === 'string' && version.length > 0) {
    query.set('v', version);
  }

  if (attempt > 0) {
    query.set('attempt', String(attempt));
  }

  const search = query.toString();

  return search === '' ? MOUNT_URL : `${MOUNT_URL}?${search}`;
}

/** Số node vào store Pascal và số node store dọn đi. */
interface PascalSceneCensus {
  readonly nodeCount: number;
  readonly droppedIds: readonly string[];
}

/** Hình dạng tối thiểu của gói vách ngăn mà màn này dựa vào. */
export interface MountModule {
  readonly mount: (
    element: HTMLElement,
    options: {
      readonly scene: PascalScene;
      readonly mode?: PascalMountMode;
      readonly readOnly?: boolean;
      readonly onSceneCommit?: (scene: PascalScene) => Promise<void>;
      readonly onSaveStatus?: (status: PascalSaveStatus) => void;
      readonly validateCommit?: (scene: PascalScene) => PascalCommitVerdict;
      readonly onCommitRejected?: (message: string) => void;
      readonly onSaveAsTemplate?: (nodeId: string) => Promise<PascalTemplateResult>;
      readonly onHistoryJump?: (kind: PascalHistoryJump) => void;
      readonly onMeasurementDelete?: (event: PascalMeasurementDelete) => void;
      readonly onReadyChange?: (ready: boolean) => void;
      readonly onFatal?: (error: Error) => void;
      readonly onSceneLoaded?: (census: PascalSceneCensus) => void;
      readonly onRendererUnavailable?: () => void;
      readonly explodeLevels?: boolean;
      readonly initialTool?: PascalInitialTool;
    },
  ) => {
    readonly dispose: () => void;
    readonly setScene?: (scene: PascalScene) => void;
    readonly setHighlight?: (nodeIds: readonly string[]) => void;
    readonly frameEntity?: (entityId: string) => boolean;
    readonly deleteNodes?: (nodeIds: readonly string[]) => void;
  };
}

export interface UsePascalViewerOptions {
  /** Bản vẽ cần dựng. `null` nghĩa là chưa có dữ liệu — màn ở trạng thái nạp. */
  readonly graph: SpatialGraph | null;
  /** `edit` dựng trình soạn thảo Pascal; `view` chỉ dựng khung xem. */
  readonly mode?: PascalMountMode;
  /** Vai chỉ-xem. Ở `edit`, editor khoá store và ẩn mọi nút sửa. */
  readonly readOnly?: boolean;
  /**
   * Đường lưu — xem `usePascalEdits`. Vắng thì editor không lưu được đi đâu.
   * Trả `true` khi lượt sửa đã vào kho: bản vẽ mới sinh ra từ đó là tiếng vọng
   * của chính editor và KHÔNG được nạp ngược vào nó.
   */
  readonly onSceneCommit?: (scene: PascalScene) => Promise<boolean | void>;
  /** Phán quyết 6A, chạy trước khi lượt sửa vào lịch sử của editor. */
  readonly validateCommit?: (scene: PascalScene) => PascalCommitVerdict;
  /** Lý do một lượt sửa bị chặn — màn hình dựng toast tiếng Việt từ đây. */
  readonly onCommitRejected?: (message: string) => void;
  /** "Lưu làm khuôn mẫu" (#25) — vắng thì Pascal không hiện nút. */
  readonly onSaveAsTemplate?: (nodeId: string) => Promise<PascalTemplateResult>;
  /** Công cụ bật sẵn — `measure` khi URL có `?tool=measure`. */
  readonly initialTool?: PascalInitialTool | undefined;
  /** Người dùng vừa hoàn tác/làm lại trong editor Pascal — màn dựng toast (A8). */
  readonly onHistoryJump?: (kind: PascalHistoryJump) => void;
  /** Người dùng vừa xoá một phép đo — màn dựng toast hoàn tác (#63, A8). */
  readonly onMeasurementDelete?: (event: PascalMeasurementDelete) => void;
  /** Khung xem có đang thu gọn không. Thu gọn thì KHÔNG dựng 3D, để đỡ tốn máy. */
  readonly collapsed?: boolean;
  /** Mở ở chế độ tách tầng — `/3d?view=exploded`. */
  readonly explodeLevels?: boolean;
  /** Danh tính của cảnh (mã dự án). Đổi khoá thì khung gỡ ra và gắn lại từ đầu. */
  readonly mountKey?: string;
  /**
   * Cửa nạp gói, tách ra để bài kiểm thay được. Mặc định là `import()` thật.
   * Không đặt kiểu trả về là `Promise<MountModule>` cứng ở đây vì `import()`
   * một đường dẫn tĩnh trả về `unknown` với `vite-ignore`.
   */
  readonly loadMount?: () => Promise<MountModule>;
  /** Tải lại trang — "Thử lại" sau khi chunk bộ đổi dữ liệu hỏng. Bài kiểm thay được. */
  readonly reloadPage?: () => void;
}

export interface UsePascalViewerResult {
  readonly viewModel: PascalViewerViewModel;
  readonly canvasRef: React.RefObject<HTMLDivElement | null>;
  /** Đích khuôn camera cho lớp phủ cộng tác — `false` khi khung chưa dựng. */
  readonly sceneTarget: { readonly frameEntity: (entityId: string) => boolean };
  /** Cho editor xoá node theo mã Pascal — lượt xoá hàng loạt người dùng vừa xác nhận. */
  readonly deleteNodes: (nodeIds: readonly string[]) => void;
  /** Cảnh đã đẩy sang Pascal — mốc "trước" cho `usePascalEdits`; `null` khi chưa dựng xong. */
  readonly loadedScene: PascalScene | null;
  readonly onRetry: () => void;
  readonly onExpand: () => void;
}

/** Lượt nạp đang chạy hoặc đã xong; gói chỉ được kéo về một lần cho cả phiên. */
let mountModulePromise: Promise<MountModule> | null = null;

/**
 * Số lượt nạp đã hỏng — để lượt sau xin một URL KHÁC.
 *
 * Trình duyệt giữ kết quả của một module script theo URL suốt đời trang, kể cả
 * khi kết quả ấy là lỗi: thêm lại thẻ `<script>` cùng `src` thì nó trả lỗi cũ
 * mà không gửi request nào. Đo 2026-10-03 (`e2e/pascal-viewer.spec.ts`, B-V10-01):
 * gói hỏng rồi trở lại, bấm "thử lại" hay phím R bao nhiêu lần cũng chỉ có đúng
 * một request — nút thử lại là một lối thoát giả.
 *
 * ponytail: chỉ đổi URL của tệp vào; chunk con hỏng thì vẫn bị giữ lỗi theo URL
 * của chunk, và chỉ tải lại trang mới gỡ được.
 */
let failedLoads = 0;

/** Cờ toàn cục mà zod 4 đọc lúc nạp — cùng khuôn `pascalMount.tsx` khai `__pascalMount`. */
declare global {
  interface Window {
    __zod_globalConfig?: { jitless?: boolean };
  }
}

/**
 * Nạp gói vách ngăn bằng thẻ `<script src>`, KHÔNG bằng `import()`.
 *
 * Đã đo: `import()` tới đường dẫn tĩnh bị bộ phân tích của `vite dev` viết lại
 * thành `…/pascal-mount.js?import`, và Vite trả **500** khi cố dịch một gói
 * 14 MB đã dựng sẵn — màn rơi vào `PASCAL-01` dù tệp nằm đúng chỗ. Thẻ script
 * đi thẳng qua tầng phục vụ tệp tĩnh, giống nhau ở dev và bản sản phẩm.
 *
 * `type="module"` vì gói là ES module có chia chunk; nó tự treo `mount` lên
 * `window.__pascalMount` (xem `components/pascal/pascalMount.tsx`).
 *
 * Trước khi thêm thẻ script, bật `window.__zod_globalConfig.jitless` (B-V10-05).
 */
export const defaultLoadMount = (): Promise<MountModule> => {
  if (mountModulePromise !== null) {
    return mountModulePromise;
  }

  mountModulePromise = new Promise<MountModule>((resolve, reject) => {
    const existing = window.__pascalMount;

    if (existing !== undefined) {
      resolve(existing as MountModule);

      return;
    }

    // B-V10-05: zod 4 trong gói Pascal dò `new Function` để chọn đường JIT — một
    // vi phạm CSP `script-src eval` mỗi lần nạp. `jitless` bỏ hẳn phép dò. Sửa
    // TẠI CHỖ, không thay đối tượng: zod giữ tham chiếu tới nó lúc nạp
    // (`zod/v4/core/core.js:135-136`), nên một đối tượng mới sẽ không tới được nó.
    (window.__zod_globalConfig ??= {}).jitless = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = mountUrl(failedLoads);
    script.addEventListener('load', () => {
      const loaded = window.__pascalMount;

      if (loaded === undefined) {
        reject(new Error('Gói vách ngăn nạp xong nhưng không treo `mount` lên window.'));

        return;
      }

      resolve(loaded as MountModule);
    });
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`Không tải được ${MOUNT_URL}.`));
    });

    document.head.append(script);
  }).catch((cause: unknown) => {
    // Hỏng một lần không được khoá vĩnh viễn: nút "thử lại" phải nạp lại được.
    mountModulePromise = null;
    failedLoads += 1;

    throw cause instanceof Error ? cause : new Error(String(cause));
  });

  return mountModulePromise;
};

/** Gộp danh sách bỏ qua thành mỗi loại một dòng, đếm sẵn thành chuỗi (A15). */
const summariseSkipped = (skipped: readonly SkippedEntity[]): readonly SkippedSummary[] => {
  const byKind = new Map<string, { count: number; reason: string }>();

  for (const item of skipped) {
    const current = byKind.get(item.kind);
    if (current === undefined) byKind.set(item.kind, { count: 1, reason: item.reason });
    else current.count += 1;
  }

  return [...byKind.entries()].map(([kind, { count, reason }]) => ({
    kind,
    countLabel: formatNumber(count),
    reason,
  }));
};

export function usePascalViewer({
  graph,
  collapsed = false,
  loadMount = defaultLoadMount,
  mode = 'view',
  readOnly = false,
  onSceneCommit,
  validateCommit,
  onCommitRejected,
  onSaveAsTemplate,
  initialTool,
  onHistoryJump,
  onMeasurementDelete,
  explodeLevels = false,
  mountKey = '',
  reloadPage = () => window.location.reload(),
}: UsePascalViewerOptions): UsePascalViewerResult {
  const canvasRef = useRef<HTMLDivElement>(null);
  /* Tay cầm của khung đang chạy; `sceneTarget` đọc nó lúc gọi nên đứng vững qua
     các lần dựng lại. */
  const mountedRef = useRef<ReturnType<MountModule['mount']> | null>(null);
  const sceneTarget = useMemo(
    () => ({ frameEntity: (entityId: string) => mountedRef.current?.frameEntity?.(entityId) ?? false }),
    [],
  );
  const deleteNodes = useCallback((nodeIds: readonly string[]) => mountedRef.current?.deleteNodes?.(nodeIds), []);

  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<PascalViewerErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Chunk bộ đổi dữ liệu nạp hỏng: trình duyệt giữ lỗi ấy theo URL, chỉ tải lại trang mới xin lại được (BUG-646). */
  const converterChunkFailed = useRef(false);
  const [expanded, setExpanded] = useState(false);
  /**
   * Node mà store Pascal dọn đi trong im lặng.
   *
   * Nó dọn node mồ côi và node không với tới được từ `rootNodeIds`, không báo
   * ai. Một tấm sàn bị dọn là một mặt sàn biến mất trong khi màn hình vẫn nói
   * "xong" — nên số này đi vào cùng danh sách "chưa chuyển sang được" mà bản vẽ
   * dùng cho trục định vị và kích thước. Luật ở đây giống luật của
   * `lib/pascal/toPascal.ts`: không đối tượng nào rơi không dấu vết.
   */
  const [droppedCount, setDroppedCount] = useState(0);
  /** Người dùng tự thu khung lại bằng Esc. Khác `collapsed` do nơi gọi truyền vào. */
  const [selfCollapsed, setSelfCollapsed] = useState(false);
  /** Trạng thái lưu mà editor Pascal báo ra; `null` khi chưa có lượt nào. */
  const [saveStatus, setSaveStatus] = useState<PascalSaveStatus | null>(null);
  // #24 — giờ của lượt lưu thành công gần nhất, cho câu "Đã lưu lúc HH:MM".
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * Hàm gọi lại của đường lưu, giữ trong ref chứ KHÔNG trong deps của hiệu ứng gắn.
   *
   * `usePascalEdits` dựng chúng bằng `useCallback` phụ thuộc bản vẽ, mà mỗi lượt
   * lưu lại đổi bản vẽ — để chúng vào deps thì editor Pascal bị tháo và gắn lại
   * sau MỖI lần lưu, tức người dùng mất vùng chọn, mất camera, và cảnh nạp lại
   * từ đầu. Ref giữ bản mới nhất mà không động tới danh sách phụ thuộc.
   */
  const edits = useRef({ onSceneCommit, validateCommit, onCommitRejected, onHistoryJump, onSaveAsTemplate, onMeasurementDelete });

  useEffect(() => {
    edits.current = { onSceneCommit, validateCommit, onCommitRejected, onHistoryJump, onSaveAsTemplate, onMeasurementDelete };
  }, [onSceneCommit, validateCommit, onCommitRejected, onHistoryJump, onSaveAsTemplate, onMeasurementDelete]);

  const isCollapsed = selfCollapsed || (collapsed && !expanded);

  /**
   * Bản vẽ rỗng: không có gì để dựng.
   *
   * Đếm theo ĐỒ THỊ chứ không theo số node của cảnh Pascal: cảnh luôn có khu
   * đất, công trình và các tầng, nên đếm node thì một bản vẽ trống vẫn ra sáu
   * node và không bao giờ rỗng. Tầng không có tường thì không dựng ra hình gì.
   */
  const isEmpty =
    graph !== null &&
    graph.walls.length === 0 &&
    graph.rooms.length === 0 &&
    graph.openings.length === 0 &&
    graph.furniture.length === 0;

  /**
   * Cảnh Pascal, dựng trong hiệu ứng chứ không trong `useMemo`.
   *
   * `toPascalScene` nhập ở tầng module thì nó rơi vào chunk DÙNG CHUNG của các
   * route, và cổng "chi phí thêm cho một màn" đo được đúng điều đó: 280,0 / 280,
   * vượt. Nhập muộn đẩy nó sang chunk riêng của màn này — thứ chỉ tải khi ai đó
   * thật sự mở màn.
   */
  const [result, setResult] = useState<{
    readonly scene: PascalScene;
    readonly skipped: readonly SkippedEntity[];
    /** Bản vẽ này sinh ra từ lượt lưu của chính editor — cảnh đã nằm trong đó. */
    readonly echo: boolean;
  } | null>(null);
  /** Bản mới nhất cho hiệu ứng gắn, để `result` không nằm trong deps của nó. */
  const resultRef = useRef(result);
  resultRef.current = result;
  /** Cảnh đang nằm trong editor: lúc gắn, hoặc lượt đẩy từ nguồn ngoài gần nhất. */
  const [pascalScene, setPascalScene] = useState<PascalScene | null>(null);
  /**
   * Một lượt lưu của editor đang ghi vào kho. Bản vẽ đổi trong lúc cờ dựng là
   * tiếng vọng của lượt ấy. Dựng TRƯỚC khi gọi đường lưu, vì `commit` đổi kho
   * ngay trong lúc gọi và React có thể chạy hiệu ứng trước khi lời gọi trả về.
   */
  const echoPending = useRef(false);

  useEffect(() => {
    if (graph === null || isEmpty) {
      setResult(null);

      return;
    }

    let cancelled = false;
    const echo = echoPending.current;
    echoPending.current = false;

    // `diff` nạp cùng lượt: nhập tĩnh thì nó vào chunk của màn bản xem/di động.
    // Cảnh chuẩn `standardSceneOf` (orient/fit/door/tone + sửa cảnh) như editor, lịch sử phiên bản, di động.
    Promise.all([import('@/lib/pascal/sceneStandard'), import('@/lib/pascal/diff'), import('@/lib/pascal/sceneLibrary')])
      .catch((error: unknown) => {
        converterChunkFailed.current = true;
        throw error;
      })
      // Thư viện máy chủ chốt TRƯỚC khi dựng (cùng điểm vào với editor); `cancelled` bỏ kết quả của bản vẽ cũ.
      .then(async ([pascal, diffs, { ensureSceneLibrary }]) => [pascal, diffs, await ensureSceneLibrary()] as const)
      .then(([{ standardSceneOf }, { diffScenes, isEmptyDiff }]) => {
        if (cancelled) return;
        const converted = standardSceneOf(graph);
        const previous = resultRef.current;
        /* 23-C-001 — sau PUT 200 `replaceFloorLayer` thay kho bằng đúng lớp vừa
           gửi: bản vẽ mới, nội dung y hệt, lúc cờ echo đã tắt. Cảnh không đổi
           so với cảnh editor đang giữ thì không có gì để nạp lại. */
        const unchanged = previous !== null && isEmptyDiff(diffScenes(previous.scene, converted.scene));
        setResult({ ...converted, echo: echo || unchanged });
      })
      .catch(() => {
        if (!cancelled) setFailure('PASCAL-01');
      });

    return () => {
      cancelled = true;
    };
    /* `attempt` có mặt vì "thử lại" phải chạy lại CẢ lượt nạp này: thiếu nó thì
       nạp hỏng → thử lại → `result` vẫn `null` và màn kẹt "đang nạp" mãi (B-V10-04). */
  }, [graph, isEmpty, attempt]);

  const shouldMount = !isCollapsed && result !== null && !isEmpty;

  useEffect(() => {
    if (!shouldMount) return;

    const element = canvasRef.current;
    const initial = resultRef.current;
    if (element === null || initial === null) return;

    let disposed = false;
    let handle: ReturnType<MountModule['mount']> | null = null;

    setReady(false);
    setFailure(null);
    /* Số của lượt trước KHÔNG được sống sang lượt này: thử lại xong mà dòng
       "phần mô hình" vẫn đứng đó thì nó đang nói về một lượt nạp đã chết. */
    setDroppedCount(0);

    loadMount()
      .then((module) => {
        if (disposed) return;
        handle = module.mount(element, {
          scene: initial.scene,
          mode,
          readOnly,
          explodeLevels,
          ...(initialTool === undefined ? {} : { initialTool }),
          onSceneCommit: async (next) => {
            echoPending.current = true;
            try {
              if ((await edits.current.onSceneCommit?.(next)) !== true) echoPending.current = false;
            } catch (cause) {
              echoPending.current = false;
              throw cause;
            }
          },
          validateCommit: (next) => edits.current.validateCommit?.(next) ?? { ok: true },
          onCommitRejected: (message) => edits.current.onCommitRejected?.(message),
          ...(edits.current.onSaveAsTemplate === undefined
            ? {}
            : {
                onSaveAsTemplate: (nodeId: string) =>
                  edits.current.onSaveAsTemplate?.(nodeId) ?? Promise.resolve({ ok: false, message: '' }),
              }),
          onHistoryJump: (kind) => edits.current.onHistoryJump?.(kind),
          onMeasurementDelete: (event) => edits.current.onMeasurementDelete?.(event),
          onSaveStatus: (status) => {
            if (disposed) return;
            setSaveStatus(status);
            if (status === 'saved') setSavedAt(Date.now());
          },
          onReadyChange: (value) => {
            if (!disposed) setReady(value);
          },
          onFatal: () => {
            // Thông điệp thô KHÔNG lên màn hình — xem `PascalViewerErrorCode`.
            if (!disposed) setFailure('PASCAL-02');
          },
          onSceneLoaded: (census) => {
            if (!disposed) setDroppedCount(census.droppedIds.length);
          },
          onRendererUnavailable: () => {
            if (!disposed) setFailure('PASCAL-03');
          },
        });
        mountedRef.current = handle;
        setPascalScene(initial.scene);
      })
      .catch(() => {
        if (!disposed) setFailure('PASCAL-01');
      });

    return () => {
      disposed = true;
      mountedRef.current = null;
      setPascalScene(null);
      handle?.dispose();
    };
    /* KHÔNG có `result`: mỗi lượt lưu đổi bản vẽ, và gỡ-gắn lại theo nó là mất
       vùng chọn, camera và lịch sử hoàn tác của editor sau MỖI lần sửa. Cảnh
       đổi từ nguồn ngoài đi qua `setScene` ở hiệu ứng dưới. */
  }, [shouldMount, mountKey, loadMount, attempt, mode, readOnly, explodeLevels, initialTool]);

  /* Cảnh đổi từ nguồn ngoài (người khác sửa, khôi phục phiên bản…) → nạp vào
     editor đang chạy. Tiếng vọng của lượt lưu của chính editor thì bỏ qua. */
  useEffect(() => {
    const handle = mountedRef.current;
    if (handle === null || result === null || result.echo || result.scene === pascalScene) return;
    if (pascalScene === null) return;
    handle.setScene?.(result.scene);
    setPascalScene(result.scene);
  }, [result, pascalScene]);

  const reloadPageRef = useRef(reloadPage);
  reloadPageRef.current = reloadPage;
  const onRetry = useCallback(() => {
    if (converterChunkFailed.current) {
      reloadPageRef.current();
      return;
    }
    setFailure(null);
    setAttempt((value) => value + 1);
  }, []);

  const onExpand = useCallback(() => {
    setSelfCollapsed(false);
    setExpanded(true);
  }, []);

  /**
   * Bàn phím là đường đi hạng nhất, không phải phương án dự phòng (A12).
   *
   * Ba phím, mỗi phím có nút chuột song song — không phím nào là cách DUY NHẤT
   * làm được việc gì:
   *
   * - **Esc** thu khung xem lại. Đây là lời hứa "Esc đóng lớp trên cùng" mà A12
   *   nói không tính năng nào được lấy mất; khung 3D là lớp trên cùng của màn
   *   này. Nó chỉ nhận khi khung đang mở, nên không giành Esc của hộp thoại.
   * - **R** thử lại, chỉ khi đang lỗi.
   * - **E** mở lại khung xem, chỉ khi đang thu gọn.
   */
  useShortcut(
    {
      id: 'pascalViewer.collapse',
      combo: 'Escape',
      scope: 'canvas',
      description: 'Thu khung xem 3d lại',
      onTrigger: () => setSelfCollapsed(true),
    },
    { enabled: !isCollapsed },
  );

  useShortcut(
    {
      id: 'pascalViewer.retry',
      combo: 'R',
      scope: 'canvas',
      description: 'Thử nạp lại khung dựng hình',
      onTrigger: onRetry,
    },
    { enabled: failure !== null },
  );

  useShortcut(
    {
      id: 'pascalViewer.expand',
      combo: 'E',
      scope: 'canvas',
      description: 'Mở lại khung xem 3d',
      onTrigger: onExpand,
    },
    { enabled: isCollapsed },
  );

  const skipped = useMemo(() => {
    const fromAdapter = result === null ? [] : summariseSkipped(result.skipped);

    if (droppedCount === 0) return fromAdapter;

    return [
      ...fromAdapter,
      {
        kind: 'Phần mô hình',
        countLabel: formatNumber(droppedCount),
        reason: 'Khung dựng hình dọn đi vì không nối được vào cây của cảnh.',
      },
    ];
  }, [result, droppedCount]);

  /* `forbidden` không còn nguồn ở đây: cờ `scene.pascal-viewer` đã bị gỡ (F-15),
     màn Pascal là màn 3D duy nhất. Trạng thái vẫn nằm trong hợp đồng của view —
     A11 đòi đủ bảy — và nơi gọi dựng nó khi vai không được xem bản vẽ. */
  const state: PascalViewerState = isCollapsed
    ? 'collapsed'
    : failure !== null
      ? 'error'
      : isEmpty
        ? 'empty'
        : result === null
          ? 'loading'
          : !ready
            ? 'loading'
            : skipped.length > 0
              ? 'partial'
              : 'success';

  const summary = useMemo(() => {
    if (graph === null || (state !== 'success' && state !== 'partial')) return null;
    return {
      levelLabel: formatNumber(graph.levels.length),
      wallLabel: formatNumber(graph.walls.length),
      openingLabel: formatNumber(graph.openings.length),
      roomLabel: formatNumber(graph.rooms.length),
    };
  }, [graph, state]);

  return {
    viewModel: {
      state,
      title: PASCAL_VIEWER_TITLE,
      caption: PASCAL_VIEWER_CAPTIONS[state],
      summary,
      skipped: state === 'partial' ? skipped : [],
      errorCode: failure,
      saveLabel: saveLabelOf(saveStatus, savedAt),
    },
    canvasRef,
    sceneTarget,
    deleteNodes,
    loadedScene: pascalScene,
    onRetry,
    onExpand,
  };
}
