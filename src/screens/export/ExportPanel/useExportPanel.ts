/**
 * Toàn bộ phần suy nghĩ của màn Xuất.
 *
 * Mục D chia đôi: file này giữ trạng thái và làm mọi phép tính, view chỉ vẽ.
 * Mọi chuỗi người dùng đọc — dung lượng, số trang, số đếm của tiến trình, ba
 * dòng kiểm tra trước khi xuất — đã dựng xong ở đây, nên view không còn gì để
 * làm tròn hay ghép (A15). Năng lực nào thiếu thì `exportPanelGateway.ts` nói
 * ra bằng một phép đo, và phần giao diện tương ứng rời khỏi DOM.
 *
 * ## Bốn thứ file này NỐI LẠI chứ không dựng lại
 *
 * - **Tệp `.glb`** — `exportGlb()` của `@/lib/export`. Màn không dựng hình học,
 *   không mã hoá, không đặt tên tệp: cả ba việc đã có chủ trong worker.
 * - **Số trang PDF** — `buildPdfDocument().pages.length`. Không công thức chép
 *   lại, xem `countPdfPages` ở cổng.
 * - **Spatial JSON** — `denormalizeSpatial` + `JSON.stringify`. D-11 là dữ liệu
 *   thuần, không có bộ tuần tự hoá riêng nào để gọi và cũng không cần.
 * - **Ba dòng kiểm tra** — `RuleRunResult.violations` của store và
 *   `ReviewMetadata.reviewed` của từng đối tượng.
 *
 * ## Tiến trình THẬT, và nó sống lâu hơn màn
 *
 * `ExportProgressView.ratio` là `completed / total` của chính worker. Không nội
 * suy theo thời gian, không thanh chạy giả: khi worker im lặng, con số đứng yên
 * — đó là sự thật, và một thanh tự bò lên trong lúc worker treo là một lời nói
 * dối rất khó phát hiện.
 *
 * Tiến trình **không nằm trong `useState` của component này**. Nó sống trong sổ
 * chạy ở phạm vi module của `exportPanelGateway.ts`, và tới màn qua bộ nhớ đệm
 * của `@tanstack/react-query` (R-64). Hệ quả là thứ đặc tả đòi: rời màn rồi
 * quay lại vẫn thấy đúng lượt xuất đang chạy, vì lượt xuất chưa bao giờ thuộc
 * về một lần mount.
 *
 * Rời màn **không huỷ** lượt xuất — huỷ là quyết định của người dùng, không
 * phải hệ quả của một cú bấm sang tab khác. Worker vẫn không rò: mọi đường ra
 * của `exportGlb` (xong / lỗi / huỷ) đều gọi `close()` và `terminate()` ngay,
 * sổ chạy giữ tối đa MỘT lượt cho mỗi dự án và huỷ lượt cũ trước khi mở lượt
 * mới, còn `resetExportRuns()` huỷ sạch cho bài kiểm.
 *
 * ## Trạng thái máy chủ: `useQuery`/`useMutation`, không `useState` (R-64)
 *
 * Không có một `useState` nào cho `isLoading` hay `error` ở đây —
 * `useShareLinks.ts` làm thế là ngoại lệ đi trước, không phải khuôn mẫu. Khuôn
 * mẫu là `useRuleSettings.ts`: lượt đọc đi bằng `useQuery`, lượt ghi đi bằng
 * `useMutation`, và cả hai trạng thái đều đọc ra từ đó. `useState` ở file này
 * chỉ giữ lựa chọn của người dùng (định dạng, tầng, tuỳ chọn) — thứ không ai
 * ngoài màn này biết.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { hasElements } from '@/domain/spatial/elementCount';
import { denormalizeSpatial, idsOnLevel } from '@/domain/spatial/normalize';
import type { Level, LevelId } from '@/domain/spatial/types';
import { ENDPOINTS } from '@/api/endpoints';
import { createAppApiClient } from '@/api/appClient';
import { describeError, toAppError } from '@/lib/errors';
import { DEFAULT_EXPORT_OPTIONS, EXPORT_CANCELLED_MESSAGE } from '@/lib/export/exportGlb';
import { printPdf } from '@/lib/export/pdfRaster';
import { SHARE_LINKS_SUPPORTED } from '@/lib/export/shareLink';
import { createUuid } from '@/lib/http/ids';
import { createBeaconTransport, createTelemetrySender } from '@/lib/telemetry/sender';
import { formatFileSize } from '@/lib/format/bytes';
import { formatTimestamp } from '@/lib/format/datetime';
import { formatNumber, MISSING_VALUE } from '@/lib/format/number';
import { queryKeys } from '@/lib/query/queryKeys';
import { useSession } from '@/hooks/useSession';
import { useStore } from '@/store';
import { selectViolations } from '@/store/selectors';
import type { FloorMetaEntry } from '@/store/spatialSlice';
import type { ProjectRole } from '@/types/project';

import { isScaleTrusted } from '@/lib/viewmodel/provisionalScale';

import { floorLayerQuery, floorScaleKeysOf } from '../../qc/shared/floorScaleKeys';

import { mergeExportHistory, readExportHistory, writeExportHistory } from './exportHistoryStorage';
import {
  buildPreflightRows,
  countPdfPages,
  exportPendingNote,
  floorStateOf,
  ExportAccessError,
  createExportPanelGateway,
  EXPORT_FORBIDDEN_CAPTION,
  toExportFloors,
  type ExportedFile,
  type FloorScaleExport,
  type ExportPanelCapabilities,
  type ExportPanelGateway,
  type ExportRunSnapshot,
} from './exportPanelGateway';
import type {
  ExportedFileRow,
  ExportErrorView,
  ExportFloorChoice,
  ExportFormatCard,
  ExportFormatId,
  ExportOptionsView,
  ExportPanelProps,
  ExportProgressView,
  PreflightRow,
} from './types';
import { EXPORT_FORMAT_IDS } from './types';

/* -------------------------------------------------------------------------- */
/* Chữ ký công khai                                                            */
/* -------------------------------------------------------------------------- */

export interface UseExportPanelOptions {
  readonly projectId: string;
  /** Không truyền thì hook dựng cổng thật; bài kiểm tiêm cổng của nó vào. */
  readonly gateway?: ExportPanelGateway;
  /** Trạng thái 6: container ghi đè quyền. Không truyền thì đọc từ vai thật. */
  readonly canExport?: boolean;
  /** Trạng thái 7: vỏ ứng dụng báo đang thu gọn. */
  readonly isCompact?: boolean;
  /** UX-25: người dùng đã đồng ý xuất khi còn tầng chưa duyệt ở màn trước — không hỏi lại. */
  readonly exportAlreadyConfirmed?: boolean;
  /**
   * Nơi nhận yêu cầu đi tới một liên kết sửa của khối kiểm tra.
   *
   * Màn không tự điều hướng: `PreflightRow.fixHref` đã mang sẵn đường dẫn thật
   * từ `ROUTES`, và ai gắn màn này vào router thì người đó biết cách đi.
   */
  readonly onNavigate?: (href: string) => void;
  /** Mở hộp thoại chia sẻ (`ShareDialogContainer`). Container quyết định mở gì (R-73). */
  readonly onShare?: () => void;
}

/**
 * Khoá của lượt đọc sổ chạy.
 *
 * Nối thêm một nhánh vào khoá chi tiết dự án có sẵn thay vì thêm nhánh mới vào
 * `queryKeys` (`src/lib/query` nằm ngoài phạm vi sửa của lượt này) — đúng cách
 * `ruleSettingsQueryKey` đã làm. Nhờ nằm dưới `project.detail(id)`, một lần vô
 * hiệu hoá khoá cha kéo theo cả khoá này.
 */
export const exportRunQueryKey = (projectId: string) =>
  [...queryKeys.project.detail(projectId), 'exportRun'] as const;

/* -------------------------------------------------------------------------- */
/* Nhãn và câu — thứ duy nhất màn này tự viết                                  */
/* -------------------------------------------------------------------------- */

/** Đuôi tệp của từng định dạng, hiện bằng chữ đều. */
const EXTENSION_LABEL: Readonly<Record<ExportFormatId, string>> = Object.freeze({
  glb: 'Mô hình 3D (.glb)',
  pdf: 'Hồ sơ PDF (.pdf)',
  image: 'Ảnh mặt bằng (.png)',
  'spatial-json': 'Dữ liệu dự án (.json)',
});

/**
 * Mỗi định dạng dành cho ai, bằng tiếng thường.
 *
 * Một câu, nói về NGƯỜI nhận tệp chứ không nói về công nghệ: người đọc màn này
 * đang chọn gửi cho ai, không đang chọn một phần mở rộng.
 */
const AUDIENCE_SENTENCE: Readonly<Record<ExportFormatId, string>> = Object.freeze({
  glb: 'Mô hình ba chiều cho người dựng hình và người xem bằng phần mềm 3D.',
  pdf: 'Hồ sơ in cho người duyệt hồ sơ và người mang bản vẽ ra công trường.',
  image: 'Ảnh mặt bằng cho người làm bản trình bày và người gửi kèm thư.',
  'spatial-json': 'Toàn bộ dữ liệu của dự án, cho người viết công cụ và người nối sang hệ khác.',
});

/** Tên bước, dịch từ pha thật của worker. Hai pha, đúng hai. */
const PHASE_STEP_LABEL: Readonly<Record<'build' | 'encode', string>> = Object.freeze({
  build: 'Đang dựng hình',
  encode: 'Đang mã hoá',
});

/**
 * Đơn vị của số đếm, theo từng pha.
 *
 * Đặc tả ví dụ "12/40 phòng", nhưng worker **không** đếm phòng: pha dựng hình
 * đếm tường + phòng + nội thất, pha mã hoá đếm từng phần lưới. Viết "phòng" là
 * nói sai một con số đúng, nên đơn vị ở đây theo đúng thứ worker đếm.
 */
const PHASE_COUNT_UNIT: Readonly<Record<'build' | 'encode', string>> = Object.freeze({
  build: 'đối tượng',
  encode: 'phần',
});

/**
 * Nơi tệp xuất hiện sau khi xuất xong. Không nhắc "danh sách dưới đây": trước lượt xuất đầu
 * tiên chưa có danh sách nào (BUG-446); giới hạn phiên làm việc do chính khối "Tệp đã xuất" nói.
 */
const DESTINATION_CAPTION = 'Tệp tải về thư mục tải xuống của trình duyệt.';

/** UX-05: hồ sơ PDF là tệp .pdf thật, tải về như GLB và JSON. */
export const PDF_DESTINATION_CAPTION = DESTINATION_CAPTION;

/** Vì sao hồ sơ PDF mới đếm được trang mà chưa tải về được. */
const PDF_NOTICE_CAPTION =
  'Chưa xuất được PDF lúc này. Hãy chọn mô hình 3D hoặc dữ liệu dự án.';

/** Vì sao chưa chụp được ảnh. */
const IMAGE_NOTICE_CAPTION =
  'Chưa xuất được ảnh từ màn này. Mở mô hình 3D để chụp ảnh, hoặc chọn mô hình 3D hoặc dữ liệu dự án.';

/** Gợi ý duy nhất có thật khi một lượt xuất hỏng: hạ mức chi tiết rồi thử lại. */
const ERROR_HINT = 'Thử hạ mức chi tiết xuống mức gọn hơn rồi xuất lại.';

/** Câu thay cho một lỗi không có mô tả riêng. */
const ERROR_FALLBACK = 'Không xuất được tệp lần này.';

const EMPTY_SNAPSHOT: ExportRunSnapshot = Object.freeze({
  runningFormatId: null,
  progress: null,
  files: Object.freeze([]),
});

/** Khoang chan nhap lai sau khi mot luot xuat ket thuc (ms). */
const EXPORT_RELOCK_MS = 250;

/** U36: câu hỏi lại khi có tầng chọn xuất mà chưa duyệt xong. */
export const unreviewedConfirmMessage = (floorNames: readonly string[], scaleOnly = false): string =>
  `${floorNames.join(', ')} ${scaleOnly ? 'chưa xác nhận tỷ lệ' : 'chưa duyệt xong'}. Vẫn xuất?`;

const EMPTY_FLOORS: readonly Level[] = Object.freeze([]);

/* -------------------------------------------------------------------------- */
/* Tuỳ chọn ban đầu                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Bề ngang ảnh, đã định dạng sẵn ở tầng logic (A15).
 *
 * `CAPTURE_WIDTH_PX` nhân độ phân giải mặc định là con số bộ chụp thật sẽ dùng;
 * không có con số nào viết tay ở đây.
 *
 * Hai hằng số ấy sống trong `@/lib/export/screenshot`, và file đó mở đầu bằng
 * `import { WebGLRenderTarget } from 'three'`. Một cái nhãn không được quyền
 * kéo `three` vào bao đóng nhập TĨNH của màn, nên nó đi qua `import()` — đúng
 * khuôn `useExplodedView.ts:711` đã dùng cho `captureViewport`. Nhãn chỉ hiện
 * khi thẻ "ảnh" mở ra, nên một nhịp `MISSING_VALUE` không ai kịp thấy; và viết
 * cứng 1440 vào đây thì R-71 cấm.
 */
const readCaptureWidthLabel = async (): Promise<string> => {
  const { CAPTURE_WIDTH_PX, DEFAULT_CAPTURE_OPTIONS } = await import('@/lib/export/screenshot');

  return `${formatNumber(CAPTURE_WIDTH_PX * DEFAULT_CAPTURE_OPTIONS.resolution)} px`;
};

const initialOptions = (viewId: string): ExportOptionsView => ({
  glb: {
    detail: DEFAULT_EXPORT_OPTIONS.detail,
    includeFurniture: DEFAULT_EXPORT_OPTIONS.includeFurniture,
    // Không có đích đến ở tầng logic (`canIncludeAxisGrid`), nên mặc định là
    // tắt: một tuỳ chọn bật sẵn mà không đổi được tệp là một lời hứa suông.
    includeAxisGrid: false,
  },
  pdf: {
    includeFloorPlans: true,
    includeRoomTable: true,
    includeViolations: true,
    // Không có ảnh nào để đính (`canCaptureImage`), nên mục này tắt sẵn — bật
    // nó cũng không làm hồ sơ dày thêm một trang, và số trang phải nói thật.
    includeRender3d: false,
  },
  image: { viewId, widthLabel: MISSING_VALUE },
  spatialJson: { includeConfidence: true },
  isExpanded: false,
});

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mọi props của màn Xuất, dựng từ store, quyền và cổng năng lực.
 *
 * `const props = useExportPanel({ projectId }); return <ExportPanel {...props} />;`
 */
export function useExportPanel(options: UseExportPanelOptions): ExportPanelProps {
  const { projectId, isCompact = false } = options;

  const injectedGateway = options.gateway;
  const gateway = useMemo<ExportPanelGateway>(
    () =>
      injectedGateway ??
      createExportPanelGateway({
        telemetry: createTelemetrySender({
          transport: createBeaconTransport({ url: ENDPOINTS.telemetry }),
          sessionId: createUuid(),
        }),
        exportGraph: (id) => createAppApiClient().spatial.exportGraph({ projectId: id }),
      }),
    [injectedGateway],
  );
  const capabilities = useMemo<ExportPanelCapabilities>(
    () => gateway.readCapabilities(),
    [gateway],
  );

  const queryClient = useQueryClient();
  const session = useSession();

  const graph = useStore((state) => state.spatial);
  const storeGraph = graph;
  const spatialLoading = useStore((state) => state.spatialLoading);
  const versionId = useStore((state) => state.versionId);
  const storeFloorMeta = useStore((state) => state.floorMeta);
  const project = useStore((state) => state.project);
  const storeFloors = useStore((state) => state.floors);
  const activeFloorId = useStore((state) => state.activeFloorId);
  const storeRoles = useStore((state) => state.userRoles);
  const violations = useStore(selectViolations);

  const floors = storeFloors.length === 0 ? EMPTY_FLOORS : storeFloors;

  // UX-52: N15 không mang `scaleStatus`, nên mở thẳng URL Xuất thì kho chưa biết tầng nào tỷ lệ tạm;
  // sau khi qua màn Duyệt tầng, kho mới biết và khối kiểm tra mọc thêm một dòng. Đọc N16 ngay ở đây
  // (cùng cache `layer.byFloor`) để số việc không tăng vì người dùng vừa đi duyệt.
  const floorIds = useMemo(() => floors.map((level) => level.id), [floors]);
  const layerDocs = useQuery({
    queryKey: ['exportFloorScale', projectId, ...floorIds] as const,
    queryFn: () =>
      Promise.all(floorIds.map((floorId) => queryClient.fetchQuery(floorLayerQuery(projectId, floorId)).catch(() => undefined))),
    enabled: injectedGateway === undefined && floorIds.length > 0,
  }).data;
  const floorMeta = useMemo<Readonly<Record<string, FloorMetaEntry>>>(() => {
    if (layerDocs === undefined) {
      return storeFloorMeta;
    }
    const merged: Record<string, FloorMetaEntry> = { ...storeFloorMeta };
    floorIds.forEach((floorId, index) => {
      const held = storeFloorMeta[floorId];
      const keys = floorScaleKeysOf(layerDocs[index], held);
      /* R10: giữ CẢ scaleState/scaleReasons, không riêng `scaleStatus` — tầng người dùng đã chấp nhận
         số máy không còn `scaleStatus` nên lối cũ bỏ sót đúng tầng mà hồ sơ cần đánh dấu. */
      if (keys === null) return;
      if (keys.scaleStatus === undefined && keys.scaleState === undefined) return;
      merged[floorId] = {
        ...(held ?? { revision: layerDocs[index]?.revision ?? 0 }),
        ...(keys.scaleStatus === undefined ? {} : { scaleStatus: keys.scaleStatus }),
        ...(keys.scaleSource === undefined ? {} : { scaleSource: keys.scaleSource }),
        ...(keys.scaleState === undefined ? {} : { scaleState: keys.scaleState }),
        ...(keys.scaleReasons === undefined ? {} : { scaleReasons: keys.scaleReasons }),
      };
    });
    return merged;
  }, [floorIds, layerDocs, storeFloorMeta]);

  /**
   * Tầng mà số đo chưa tin được (R10 làn S). Một danh sách thay cho boolean cũ: hồ sơ in và tệp JSON
   * đều phải nói ĐÚNG tầng nào ước, không bôi "(tạm)" lên cả tệp rồi im lặng về tầng nào.
   */
  const provisionalLevelIds = useMemo(
    () =>
      graph === null
        ? []
        : floors
            .filter((level) => {
              if (idsOnLevel(graph, level.id).length === 0) return false;
              if (level.scaleMillimetresPerPixel === undefined) return true;
              const meta = floorMeta?.[level.id];
              return !isScaleTrusted(meta?.scaleStatus, meta?.scaleSource, meta?.scaleState);
            })
            .map((level) => String(level.id)),
    [floorMeta, floors, graph],
  );

  /** Trạng thái tỷ lệ của từng tầng, viết thẳng vào tệp JSON để người nhận tệp đọc được. */
  const floorScalesForExport = useMemo<Readonly<Record<string, FloorScaleExport>>>(() => {
    const out: Record<string, FloorScaleExport> = {};
    for (const level of floors) {
      const meta = floorMeta?.[level.id];
      if (meta?.scaleState === undefined && meta?.scaleStatus === undefined) continue;
      out[String(level.id)] = {
        ...(meta.scaleState === undefined ? {} : { scaleState: meta.scaleState }),
        ...(meta.scaleReasons === undefined ? {} : { scaleReasons: meta.scaleReasons }),
        isTrusted: isScaleTrusted(meta.scaleStatus, meta.scaleSource, meta.scaleState),
      };
    }
    return out;
  }, [floorMeta, floors]);

  /* ---------------------------------------------------------------------- */
  /* Quyền — một khoá `model.export` gác cả bốn định dạng                    */
  /* ---------------------------------------------------------------------- */

  // Vai theo dự án đang mở là nguồn đúng nhất; phiên đăng nhập là nguồn dự
  // phòng cho tới khi một dự án được mở.
  const roles: readonly ProjectRole[] = storeRoles.length > 0 ? storeRoles : session.roles;
  const canExport = options.canExport ?? gateway.readPermission(roles);

  /* ---------------------------------------------------------------------- */
  /* Lựa chọn của người dùng — thứ duy nhất `useState` giữ ở đây             */
  /* ---------------------------------------------------------------------- */

  const [selectedFormatId, setSelectedFormatId] = useState<ExportFormatId>('glb');
  // Người dùng chỉ ghi đè khi bấm; mặc định tick tầng có bản vẽ, bỏ tick tầng trống (U11).
  const [floorOverrides, setFloorOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [optionsView, setOptionsView] = useState<ExportOptionsView>(() =>
    // Không có khung nhìn thì nhãn "Góc nhìn hiện tại:" vẫn phải có giá trị (BUG-467).
    initialOptions(activeFloorId ?? MISSING_VALUE),
  );

  // Bề ngang ảnh đến sau một nhịp vì `@/lib/export/screenshot` được nạp muộn;
  // xem {@link readCaptureWidthLabel}. Ghi đè đúng một trường và bỏ qua nếu
  // nhãn đã đúng, nên lượt này không đụng tới lựa chọn nào của người dùng.
  useEffect(() => {
    let isActive = true;

    void readCaptureWidthLabel().then((widthLabel) => {
      if (!isActive) {
        return;
      }

      setOptionsView((current) =>
        current.image.widthLabel === widthLabel
          ? current
          : { ...current, image: { ...current.image, widthLabel } },
      );
    });

    return () => {
      isActive = false;
    };
  }, []);

  // Mặc định là **mọi tầng**, và một tầng mới thêm vào dự án cũng được chọn:
  // giữ danh sách tầng BỊ BỎ chọn thay vì danh sách được chọn khiến mặc định
  // đúng mà không cần một lượt đồng bộ nào theo `floors`.
  const isFloorSelected = useCallback(
    (id: string): boolean => floorOverrides[id] ?? (graph === null || idsOnLevel(graph, id as LevelId).length > 0),
    [floorOverrides, graph],
  );

  const selectedLevels = useMemo<readonly Level[]>(
    () => floors.filter((level) => isFloorSelected(level.id)),
    [floors, isFloorSelected],
  );

  /* ---------------------------------------------------------------------- */
  /* Sổ chạy: đọc bằng `useQuery`, nghe bằng một lượt đăng ký               */
  /* ---------------------------------------------------------------------- */

  const runQuery = useQuery({
    queryKey: exportRunQueryKey(projectId),
    queryFn: (): ExportRunSnapshot => gateway.readSnapshot(projectId),
    // Sổ chạy sống lâu hơn màn và **đổi trong lúc màn không có mặt**: một lượt
    // xuất chạy tiếp khi người dùng đi màn khác. Nên bộ nhớ đệm không bao giờ
    // được coi là còn tươi — mỗi lần mount phải đọc lại sổ thật.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    const key = exportRunQueryKey(projectId);
    const sync = (): void => {
      queryClient.setQueryData(key, gateway.readSnapshot(projectId));
    };

    // Đồng bộ ngay lúc đăng ký: giữa lượt mount trước và lượt này, sổ chạy có
    // thể đã tiến thêm vài bước mà không ai nghe.
    sync();

    return gateway.subscribe(projectId, sync);
  }, [gateway, projectId, queryClient]);

  const snapshot = runQuery.data ?? EMPTY_SNAPSHOT;

  /* ---------------------------------------------------------------------- */
  /* Số trang PDF — đếm lại mỗi khi bốn mục đổi                              */
  /* ---------------------------------------------------------------------- */

  const preparerName = session.user?.name?.trim() || session.user?.email || '';

  // Mốc giờ chỉ đi vào bìa hồ sơ, không đi vào phép đếm trang; dựng một lần cho
  // mỗi cổng để phép đếm không bị bỏ nhớ lại sau mỗi lượt vẽ.
  const pageCountMoment = useMemo(() => new Date(gateway.now()), [gateway]);

  const pdfChoice = optionsView.pdf;
  const pdfPageCount = useMemo<number>(() => {
    if (graph === null) {
      return 0;
    }

    return countPdfPages({
      graph: denormalizeSpatial(graph),
      violations,
      dataVersion: versionId ?? '',
      exportedAt: pageCountMoment,
      preparerName,
      choice: pdfChoice,
    });
  }, [graph, violations, versionId, pageCountMoment, preparerName, pdfChoice]);

  /* ---------------------------------------------------------------------- */
  /* Một lượt xuất                                                           */
  /* ---------------------------------------------------------------------- */

  const startedAtRef = useRef<number>(0);
  // Khoa dong bo chong nhap doi (30-C-029): dat ngay khi bam, khong cho state React;
  // mo lai sau khi luot xuat ket thuc cong mot khoang ngan, vi .json xong tuc thi
  // nen lan nhap thu hai co the den sau khi luot dau da xong.
  const exportLockRef = useRef(false);

  const exportMutation = useMutation<ExportedFile, Error, ExportFormatId>({
    mutationFn: async (formatId) => {
      startedAtRef.current = gateway.now();

      // Máy chủ quyết định ai được xuất (viewer 403): lấy đồ thị qua tuyến xuất
      // có kiểm quyền; cổng không có tuyến (bài kiểm) thì dùng đồ thị trong store.
      const graph =
        storeGraph === null || gateway.loadExportGraph === undefined
          ? storeGraph
          : await gateway.loadExportGraph(projectId);

      if (formatId === 'glb') {
        if (graph === null) {
          throw new Error('Chưa có mô hình để xuất.');
        }

        const exportFloors = await toExportFloors(graph, selectedLevels);

        return gateway.startGlbExport({
          projectId,
          projectName: project?.name ?? '',
          projectVersion: versionId ?? '',
          floors: exportFloors,
          options: {
            detail: optionsView.glb.detail,
            includeFurniture: optionsView.glb.includeFurniture,
            // Không có điều khiển nào cho phép nén trong hợp đồng, nên giữ
            // đúng mặc định của bộ xuất thay vì bịa ra một lựa chọn.
            compress: DEFAULT_EXPORT_OPTIONS.compress,
          },
        });
      }

      if (formatId === 'spatial-json') {
        if (graph === null) {
          throw new Error('Chưa có mô hình để xuất.');
        }

        return gateway.startSpatialJsonExport({
          projectId,
          projectName: project?.name ?? '',
          graph,
          includeConfidence: optionsView.spatialJson.includeConfidence,
          floorScales: floorScalesForExport,
        });
      }

      if (formatId === 'pdf') {
        if (graph === null) {
          throw new Error('Chưa có mô hình để xuất.');
        }

        return gateway.startPdfExport({
          projectId,
          projectName: project?.name ?? '',
          graph: denormalizeSpatial(graph),
          violations,
          dataVersion: versionId ?? '',
          preparerName,
          choice: pdfChoice,
          provisionalLevelIds,
        });
      }

      // Ảnh chưa sinh được bytes (`canCaptureImage`), nên view không dựng hành động
      // xuất cho nó và {@link onExport} chặn trước. Nhánh này chỉ tồn tại để
      // một lời gọi lọt qua được không im lặng biến mất.
      return Promise.reject(new Error(`Không xuất được định dạng ${formatId}.`));
    },

    onSettled: () => {
      setTimeout(() => {
        exportLockRef.current = false;
      }, EXPORT_RELOCK_MS);
    },

    onSuccess: (file, formatId) => {
      // Lời màn đã hứa (`DESTINATION_CAPTION`): xuất xong là tệp về thư mục tải xuống.
      // Nút ở hàng là "tải lại" — lượt tải đầu là việc của đây (B-V12-05).
      gateway.deliver(file);
      gateway.track({
        formatId,
        outcome: 'success',
        durationMs: gateway.now() - startedAtRef.current,
        sizeBytes: file.byteLength,
        pageCount: formatId === 'pdf' ? pdfPageCount : 0,
      });
    },

    onError: (error, formatId) => {
      gateway.track({
        formatId,
        outcome: error.message === EXPORT_CANCELLED_MESSAGE ? 'cancelled' : 'failure',
        durationMs: gateway.now() - startedAtRef.current,
        sizeBytes: 0,
        pageCount: 0,
      });
    },
  });

  const exportError = exportMutation.error;

  // "Góc nhìn hiện tại:" theo tầng đang mở, tên người đọc được (30-C-026); đọc mỗi lượt
  // vì store nạp sau lần dựng đầu.
  // Chua co tang dang chon (mo /export truc tiep) thi roi ve tang dau theo `order`.
  const activeFloorName =
    (
      floors.find((level) => level.id === activeFloorId) ??
      floors.reduce<(typeof floors)[number] | undefined>(
        (first, level) => (first === undefined || level.order < first.order ? level : first),
        undefined,
      )
    )?.name ?? MISSING_VALUE;
  const optionsViewLive = useMemo<ExportOptionsView>(
    () => ({ ...optionsView, image: { ...optionsView.image, viewId: activeFloorName } }),
    [optionsView, activeFloorName],
  );

  /**
   * Lỗi thật của màn.
   *
   * Một lượt huỷ **không** phải lỗi: `exportGlb` từ chối lời hứa bằng
   * `EXPORT_CANCELLED_MESSAGE` để nơi gọi biết lượt đã dừng, và biến thông báo
   * đó thành trạng thái 4 là bắt người dùng đọc một câu báo hỏng cho đúng việc
   * họ vừa yêu cầu.
   */
  const errorView = useMemo<ExportErrorView | null>(() => {
    if (exportError === null || exportError.message === EXPORT_CANCELLED_MESSAGE) {
      return null;
    }

    if (exportError instanceof ExportAccessError) {
      return { message: exportError.message, code: 'export_access', hint: ERROR_HINT };
    }

    const appError = toAppError(exportError);

    return {
      // Lỗi worker được xếp vào `processing` (câu của pipeline AI, `{{step}}` bị nuốt):
      // với màn Xuất, câu đúng là câu về việc xuất.
      message: (appError.kind === 'processing' ? '' : describeError(appError).description) || ERROR_FALLBACK,
      code: appError.code.toLowerCase(),
      hint: ERROR_HINT,
    };
  }, [exportError]);

  /* ---------------------------------------------------------------------- */
  /* Viewmodel                                                               */
  /* ---------------------------------------------------------------------- */

  const lastSizeByFormat = useMemo<Readonly<Record<string, number>>>(() => {
    const sizes: Record<string, number> = {};

    // Danh sách xếp mới nhất trước, nên lần ghi ĐẦU cho mỗi định dạng là lần
    // xuất gần nhất của định dạng đó.
    for (const file of snapshot.files) {
      sizes[file.formatId] ??= file.byteLength;
    }

    return sizes;
  }, [snapshot.files]);

  const formats = useMemo<readonly ExportFormatCard[]>(
    () =>
      EXPORT_FORMAT_IDS.map((id) => {
        const sizeBytes = lastSizeByFormat[id];
        const isKnown = sizeBytes !== undefined;

        return {
          id,
          extensionLabel: EXTENSION_LABEL[id],
          audienceSentence: AUDIENCE_SENTENCE[id],
          sizeLabel: isKnown ? formatFileSize(sizeBytes) : null,
          sizeState: isKnown ? 'known' : 'unavailable',
          pageCountLabel: id === 'pdf' ? `${formatNumber(pdfPageCount)} trang` : null,
          isSelected: id === selectedFormatId,
        };
      }),
    [lastSizeByFormat, pdfPageCount, selectedFormatId],
  );

  const floorChoices = useMemo<readonly ExportFloorChoice[]>(
    () =>
      floors.map((level) => ({
        id: level.id,
        name: level.name,
        order: level.order,
        isSelected: isFloorSelected(level.id),
        isApproved: level.reviewed,
        state: floorStateOf(graph, level, floorMeta?.[level.id]),
      })),
    [floors, isFloorSelected, graph, floorMeta],
  );

  const preflight = useMemo<readonly PreflightRow[]>(
    () => buildPreflightRows({ projectId, graph, levels: selectedLevels, violations, floorMeta }),
    [projectId, graph, selectedLevels, violations, floorMeta],
  );
  const pendingNote = useMemo(
    () => exportPendingNote({ projectId, graph, levels: selectedLevels, violations, floorMeta }),
    [projectId, graph, selectedLevels, violations, floorMeta],
  );

  // U51: thông tin tệp đã xuất (không có nội dung) giữ qua lượt tải lại trang.
  const storedHistory = useMemo(() => readExportHistory(projectId), [projectId]);
  const history = useMemo(() => mergeExportHistory(snapshot.files, storedHistory), [snapshot.files, storedHistory]);
  useEffect(() => {
    if (snapshot.files.length > 0) {
      writeExportHistory(projectId, history);
    }
  }, [history, projectId, snapshot.files.length]);

  const exportedFiles = useMemo<readonly ExportedFileRow[]>(() => {
    // Một mốc giờ cho cả danh sách, đọc đúng một lần: hai hàng cạnh nhau phải
    // được đo bằng cùng một chiếc đồng hồ.
    const nowMs = gateway.now();
    const sessionIds = new Set(snapshot.files.map((file) => file.id));

    return history.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      sizeLabel: formatFileSize(file.byteLength),
      momentLabel: formatTimestamp(file.exportedAtMs, nowMs),
      formatId: file.formatId,
      // Nội dung tệp chỉ sống trong phiên đã xuất ra nó: hàng khôi phục không tải lại được.
      isRestored: !sessionIds.has(file.id),
    }));
  }, [gateway, history, snapshot.files]);

  const progress = useMemo<ExportProgressView | null>(() => {
    const running = snapshot.runningFormatId;

    if (running === null) {
      return null;
    }

    const raw = snapshot.progress;

    // Chưa có lượt tiến trình nào: bước đầu tiên là dựng hình, và số đếm là 0
    // thật chứ không phải một con số đoán trước.
    const phase = raw?.phase ?? 'build';
    const completed = raw?.completed ?? 0;
    const total = raw?.total ?? 0;

    return {
      formatId: running,
      stepLabel: PHASE_STEP_LABEL[phase],
      countLabel: `${formatNumber(completed)}/${formatNumber(total)} ${PHASE_COUNT_UNIT[phase]}`,
      ratio: total > 0 ? completed / total : 0,
    };
  }, [snapshot.progress, snapshot.runningFormatId]);

  /**
   * Câu của trạng thái `partial`.
   *
   * Chỉ nói về thứ đang **thiếu**, không nói về thứ đang chạy: một lượt xuất
   * đang chạy đã có thanh tiến độ nói hộ, và hai câu cùng nói một việc là một
   * câu thừa.
   */
  const noticeCaption = useMemo<string | null>(() => {
    if (selectedFormatId === 'pdf' && !capabilities.canRenderPdfBytes) {
      return PDF_NOTICE_CAPTION;
    }

    if (selectedFormatId === 'image' && !capabilities.canCaptureImage) {
      return IMAGE_NOTICE_CAPTION;
    }

    return null;
  }, [capabilities.canCaptureImage, capabilities.canRenderPdfBytes, selectedFormatId]);

  /** Định dạng đang chọn có sinh ra được một tệp thật không. */
  const canExportSelected =
    selectedFormatId === 'glb' ||
    (selectedFormatId === 'pdf' && capabilities.canRenderPdfBytes) ||
    (selectedFormatId === 'image' && capabilities.canCaptureImage) ||
    selectedFormatId === 'spatial-json';

  const status = useMemo<ExportPanelProps['status']>(() => {
    if (isCompact) {
      return 'collapsed';
    }

    if (!canExport) {
      return 'forbidden';
    }

    if (spatialLoading || runQuery.isPending) {
      return 'loading';
    }

    if (errorView !== null) {
      return 'error';
    }

    // S-3b: có tầng mà chưa có tường/phòng nào thì kiểm tra trước khi xuất không được báo xanh.
    if (graph === null || floors.length === 0 || !hasElements(graph)) {
      return 'empty';
    }

    if (progress !== null || noticeCaption !== null) {
      return 'partial';
    }

    return 'success';
  }, [
    canExport,
    errorView,
    floors.length,
    graph,
    isCompact,
    noticeCaption,
    progress,
    runQuery.isPending,
    spatialLoading,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Hành động                                                               */
  /* ---------------------------------------------------------------------- */

  const onSelectFormat = useCallback((id: ExportFormatId): void => {
    setSelectedFormatId(id);
  }, []);

  const onToggleFloor = useCallback((id: string): void => {
    setFloorOverrides((current) => ({ ...current, [id]: !(current[id] ?? (graph === null || idsOnLevel(graph, id as LevelId).length > 0)) }));
  }, [graph]);

  const onChangeOptions = useCallback((next: ExportOptionsView): void => {
    setOptionsView(next);
  }, []);

  const onToggleOptionsExpanded = useCallback((): void => {
    setOptionsView((current) => ({ ...current, isExpanded: !current.isExpanded }));
  }, []);

  // U36: tầng chưa duyệt → hỏi lại một câu trước khi xuất, không xuất im lặng.
  const [unreviewedConfirm, setUnreviewedConfirm] = useState<string | null>(null);
  // UX-25: đã bấm "Vẫn xuất" một lần thì không hỏi lại ở định dạng sau.
  const unreviewedAcceptedRef = useRef(options.exportAlreadyConfirmed === true);

  const runExport = useCallback((askUnreviewed: boolean): void => {
    // Ba cửa chặn, mỗi cửa một lý do thật. Cửa thứ ba chỉ áp cho `.glb`: bộ
    // xuất đó dựng hình theo TẦNG và ném `RangeError` khi không có tầng nào,
    // còn Spatial JSON lấy cả đồ thị nên nó không phụ thuộc lựa chọn tầng.
    // View không dựng hành động xuất trong cả ba cảnh; đây là lớp chặn thứ
    // hai, không phải nơi báo lỗi.
    if (exportLockRef.current || !canExport || !canExportSelected || !hasElements(graph) || exportMutation.isPending || spatialLoading) {
      return;
    }

    if (selectedFormatId === 'glb' && selectedLevels.length === 0) {
      return;
    }

    const unreviewed = selectedLevels.filter((level) => !level.reviewed);
    if (askUnreviewed && !unreviewedAcceptedRef.current && unreviewed.length > 0) {
      // UX-17: đã duyệt hết, chỉ thiếu tỷ lệ thì nói đúng việc đó.
      const scaleOnly = unreviewed.every((level) => floorStateOf(graph, level, floorMeta?.[level.id]) === 'scaleOnly');
      setUnreviewedConfirm(unreviewedConfirmMessage(unreviewed.map((level) => level.name), scaleOnly));
      return;
    }

    if (!askUnreviewed) {
      unreviewedAcceptedRef.current = true;
    }
    setUnreviewedConfirm(null);
    exportLockRef.current = true;
    exportMutation.mutate(selectedFormatId);
  }, [canExport, canExportSelected, exportMutation, floorMeta, graph, selectedFormatId, selectedLevels, spatialLoading]);

  const startExport = useCallback((): void => {
    runExport(true);
  }, [runExport]);

  const onConfirmExport = useCallback((): void => {
    runExport(false);
  }, [runExport]);

  const onCancel = useCallback((): void => {
    gateway.cancel(projectId);
  }, [gateway, projectId]);

  const onRetry = useCallback((): void => {
    // "Giữ nguyên mọi thiết lập": định dạng, tầng và tuỳ chọn nằm trong state
    // của hook và không bị chạm tới — lượt thử lại chỉ dọn lỗi cũ rồi chạy lại.
    exportMutation.reset();
    runExport(false);
  }, [exportMutation, runExport]);

  const onDownload = useCallback(
    (fileId: string): void => {
      const file = gateway.readSnapshot(projectId).files.find((entry) => entry.id === fileId);

      if (file !== undefined) {
        gateway.deliver(file);
      }
    },
    [gateway, projectId],
  );

  const onPrint = useCallback(
    (fileId: string): void => {
      const file = gateway.readSnapshot(projectId).files.find((entry) => entry.id === fileId);

      if (file !== undefined) {
        printPdf(file.blob);
      }
    },
    [gateway, projectId],
  );

  const onNavigate = options.onNavigate;
  const onFollowFix = useCallback(
    (rowId: PreflightRow['id']): void => {
      const row = preflight.find((entry) => entry.id === rowId);

      if (row?.fixHref != null) {
        onNavigate?.(row.fixHref);
      }
    },
    [onNavigate, preflight],
  );

  const onReviewFirst = useCallback((): void => {
    setUnreviewedConfirm(null);
    const href = preflight.find((entry) => entry.id === 'approval')?.fixHref;
    if (href != null) {
      onNavigate?.(href);
    }
  }, [onNavigate, preflight]);

  const onShareOption = options.onShare;
  const onShare = useCallback((): void => {
    onShareOption?.();
  }, [onShareOption]);

  // Liên kết chia sẻ là v2 (BE-BIND #47–#49): tắt thì nút "chia sẻ" rời DOM.
  const shareAction = SHARE_LINKS_SUPPORTED && onShareOption !== undefined ? onShare : null;

  return {
    status,
    capabilities,
    formats,
    floors: floorChoices,
    options: optionsViewLive,
    preflight,
    exportedFiles,
    progress,
    error: errorView,
    destinationCaption: selectedFormatId === 'pdf' ? PDF_DESTINATION_CAPTION : DESTINATION_CAPTION,
    pendingNote,
    noticeCaption,
    permissionCaption: canExport ? null : EXPORT_FORBIDDEN_CAPTION,
    isCollapsed: isCompact,
    onSelectFormat,
    onToggleFloor,
    onChangeOptions,
    onToggleOptionsExpanded,
    onExport: startExport,
    unreviewedConfirm,
    onConfirmExport,
    onReviewFirst,
    onCancel,
    onRetry,
    onDownload,
    onPrint,
    onFollowFix,
    onShare: shareAction,
  };
}
