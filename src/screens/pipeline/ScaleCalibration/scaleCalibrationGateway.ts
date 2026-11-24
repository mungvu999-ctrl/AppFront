/**
 * Cổng dữ liệu của màn Hiệu chỉnh tỷ lệ — mọi lời gọi ra khỏi màn đi qua đây.
 *
 * Cùng khuôn `processingGateway.ts`: một `interface` cho hình dạng, một factory
 * nhận `ApiClient` để test cắm `createMockApiClient()` vào đúng phép ánh xạ bản
 * sản phẩm dùng (R-70), và một factory thứ hai dựng client thật cho container.
 *
 * ## Phần NỐI ĐƯỢC THẬT
 *
 * Đúng một lượt đọc có endpoint hôm nay: `ENDPOINTS.quality.assess`, qua
 * `client.quality.assess`. Nó trả về đủ ba thứ màn cần để mở được:
 *
 * - `sourceUrl` — ảnh bản vẽ đã nắn, thứ canvas vẽ;
 * - `measurement.widthPx` / `.heightPx` — độ phân giải thật của ảnh, thứ duy
 *   nhất cho phép quy một toạ độ tỉ lệ `0..1` của khung ảnh về pixel ảnh;
 * - `frame.isFound` — máy có tìm được khung bản vẽ hay không. `false` chính là
 *   "nắn ảnh thất bại, bản vẽ có thể méo", tức trạng thái `'error'` của A11 trên
 *   màn này. Nó KHÔNG chặn hiệu chỉnh, chỉ nói ra hậu quả.
 *
 * Tên tầng đọc từ cùng lượt đó (`floorName`), nên màn không cần lượt gọi thứ hai.
 *
 * Lượt đọc thứ hai là của ĐƯỜNG GHI, không phải của khung vẽ: `readLayer`
 * (N16 thô) là nguồn của `useFloorLayer`, đưa tầng vào kho theo `revision`, vì
 * "Áp dụng tỷ lệ" vá `Level` trong kho — B-V5-01. `readAllFloors` (#12 + N15) là
 * danh sách đích của "Áp cho mọi tầng".
 *
 * ## Phần KHÔNG CÓ — và vì sao vẫn khai
 *
 * Năm việc màn cần. Bốn việc hình học bật khi client có `quality.detectedGeometry`; `dimensionStrings`
 * có endpoint nhưng không trả độ dài px nên vẫn `false`. Mỗi việc vẫn nằm trong {@link ScaleCalibrationGateway} với một kết quả
 * `supported: false` khi chưa làm được, nói rõ điều còn thiếu, thay vì bị bỏ trắng: một cổng im lặng thì màn không
 * phân biệt được "chưa có dữ liệu" với "không có đường lấy dữ liệu", và người
 * đọc mã sau này không biết chỗ nào cần nối khi endpoint xuất hiện.
 *
 * Hệ quả nói thẳng: trong bản sản phẩm hôm nay, không lượt OCR nào về, nên màn
 * đứng ở trạng thái `'empty'` — đúng nghĩa "OCR không đọc được chuỗi kích thước
 * nào" mà bảng bảy trạng thái của `types.ts` đã khai. Test và story cắm cổng giả
 * để dựng đủ bảy trạng thái. Đây là quyết định của điều phối viên (R-69), không
 * phải chỗ tự thêm endpoint.
 *
 * ## Ghi tỷ lệ — qua bộ lưu lớp chung, không qua cổng
 *
 * #35 nhận `scaleMillimetresPerPixel` (F-04x-2). Lượt ghi đi qua `saveScale` của
 * `useFloorLayerAutosave` — cùng khoá tầng với lượt lưu lớp — nên cổng chỉ đưa
 * `apiClient` cho bộ lưu, không tự gửi PUT nào.
 */

import type { ApiClient, ApiResult } from '@/api/client';
import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';
import { createAppApiClient } from '@/api/appClient';
import { createMockApiClient } from '@/api/__mocks__/client';
import { ENDPOINTS } from '@/api/endpoints';
import type { DetectedGeometry, FloorImageQuality } from '@/api/schemas/quality';
import { pixels, type Pixels } from '@/domain/units/scale';
import { millimetres, type Millimetres, type MillimetresPerPixel } from '@/domain/units/types';
import { readProjectConfidenceThreshold, type ReadConfidenceThreshold } from '@/hooks/useProjectConfidenceThreshold';

import type { ImageRatioBox } from './types';

/* -------------------------------------------------------------------------- */
/* Việc làm được và việc chưa có đường.                                         */
/* -------------------------------------------------------------------------- */

/** Mã máy đọc của một phát hiện "không tìm thấy khung bản vẽ". */
export const FRAME_NOT_FOUND_CODE = 'FRAME_NOT_FOUND';

/** Năm việc màn cần; bốn việc hình học làm được khi máy chủ có `detected-geometry`. */
export const SCALE_MISSING_CAPABILITIES = [
  'dimensionStrings',
  'referenceWallWidth',
  'typicalDoorWidth',
  'largestRoomBox',
  'snapTargets',
] as const;

export type ScaleMissingCapability = (typeof SCALE_MISSING_CAPABILITIES)[number];

/**
 * Điều còn thiếu của từng việc khi trả `supported: false` (máy chủ cũ 404/501 cho bốn việc
 * hình học; thiếu trường cho `dimensionStrings`). Chuỗi là mô tả, không phải đường dẫn gọi.
 */
export const SCALE_MISSING_ENDPOINTS: Readonly<Record<ScaleMissingCapability, string>> = {
  dimensionStrings: 'GET .../floors/:floorId/dimension-strings đã có (client.quality.dimensionStrings, dùng cho chip) nhưng không trả độ dài px (span_px) của chuỗi',
  referenceWallWidth: 'GET .../floors/:floorId/detected-geometry (bề rộng nét tường); máy chủ cũ 404/501',
  typicalDoorWidth: 'GET .../floors/:floorId/detected-geometry (bề rộng cửa đi); máy chủ cũ 404/501',
  largestRoomBox: 'GET .../floors/:floorId/detected-geometry (hộp bao phòng lớn nhất); máy chủ cũ 404/501',
  snapTargets: 'GET .../floors/:floorId/detected-geometry (đỉnh tường, giao điểm); máy chủ cũ 404/501',
};

/** Một việc chưa có đường làm, kèm endpoint còn thiếu. */
export interface ScaleUnsupported {
  readonly supported: false;
  readonly capability: ScaleMissingCapability;
  readonly missingEndpoint: string;
}

/** Một việc làm được, kèm kết quả. */
export interface ScaleSupported<TValue> {
  readonly supported: true;
  readonly value: TValue;
}

export type ScaleCapabilityResult<TValue> = ScaleSupported<TValue> | ScaleUnsupported;

/** Dựng câu trả lời "chưa có đường làm việc này". */
export function unsupported(capability: ScaleMissingCapability): ScaleUnsupported {
  return { supported: false, capability, missingEndpoint: SCALE_MISSING_ENDPOINTS[capability] };
}

/* -------------------------------------------------------------------------- */
/* Hình dạng dữ liệu thô.                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bản vẽ đã nắn của một tầng, ở dạng thô.
 *
 * `widthPx`/`heightPx` là `null` khi tầng chưa được đo (`isMeasured === false`):
 * chưa biết độ phân giải thì không quy được toạ độ tỉ lệ về pixel, và màn phải
 * nói ra điều đó chứ không đoán một con số.
 */
export interface ScaleDrawingSnapshot {
  readonly floorId: string;
  readonly floorName: string;
  readonly imageUrl: string | null;
  readonly widthPx: Pixels | null;
  readonly heightPx: Pixels | null;
  /** `true` khi máy không tìm được khung bản vẽ — bản vẽ có thể méo. */
  readonly isWarped: boolean;
}

/** Một chuỗi kích thước OCR đọc được, ở dạng thô. */
export interface ScaleRawDimensionString {
  readonly id: string;
  readonly pixelLength: Pixels;
  readonly realLength: Millimetres;
  /** Độ tin cậy của lần đọc, `0..1`. */
  readonly confidence: number;
  readonly boundingBox: ImageRatioBox;
}

/** Một số máy đọc được trên trang, hộp theo tỉ lệ khung vuông `0..1` như `boundingBox`. */
export interface ScaleDimensionChip {
  readonly id: string;
  readonly text: string;
  readonly valueMm: Millimetres;
  readonly box: ImageRatioBox;
}

/** Hộp bao của phòng lớn nhất, đo trên ảnh bằng pixel. */
export interface ScaleRoomBoxPx {
  readonly widthPx: Pixels;
  readonly heightPx: Pixels;
}

export interface ReadFloorDrawingInput {
  readonly projectId: string;
  readonly floorId: string;
  readonly signal?: AbortSignal;
}

export interface ReadFloorGeometryInput {
  readonly projectId: string;
  readonly floorId: string;
}

export interface ReadAllFloorsInput {
  readonly projectId: string;
}

/** Một tầng của dự án, đích của "Áp cho mọi tầng" (#12 + N15). */
export interface ScaleFloorTarget {
  /** Mã `Level` (N15) của tầng — khớp mã #12 trước, không khớp thì theo `order`. */
  readonly floorId: string;
  readonly name: string;
  /** `Floor.drawings.length > 0` — tầng chưa có bản vẽ bị bỏ qua. */
  readonly hasDrawing: boolean;
  /** `revision` N15 của tầng — `hint` của `saveScale`; vắng khi N15 không có tầng này. */
  readonly revision?: number;
  /** Tỷ lệ hiện tại của tầng theo N15 — vắng khi tầng chưa có tỷ lệ (UX-R2 K32). */
  readonly currentScale?: MillimetresPerPixel;
}

/* -------------------------------------------------------------------------- */
/* Cổng.                                                                        */
/* -------------------------------------------------------------------------- */

export interface ScaleCalibrationGateway {
  /** Việc nào có đường làm hôm nay. Màn đọc cờ này chứ không đoán. */
  readonly supports: Readonly<Record<ScaleMissingCapability, boolean>>;
  readonly readFloorDrawing: (
    input: ReadFloorDrawingInput,
  ) => Promise<ApiResult<ScaleDrawingSnapshot>>;
  readonly readDimensionStrings: (
    input: ReadFloorGeometryInput,
  ) => Promise<ScaleCapabilityResult<readonly ScaleRawDimensionString[]>>;
  /** D1: số máy đọc được, chưa có độ dài px — chip "Hoặc chọn một số". Lỗi/máy chủ cũ → `[]`. */
  readonly readDimensionChips?: (input: ReadFloorGeometryInput) => Promise<readonly ScaleDimensionChip[]>;
  /**
   * Bề rộng của một nét tường điển hình trên ảnh, tính bằng pixel.
   *
   * Đây là số đo cần để `inferWallThicknessFromScale` nói được "tỷ lệ này cho
   * ra bức tường dày ba mét". Nó là một PHÉP ĐO, không phải hằng số suy ra từ
   * độ phân giải: màn không được tự dựng nó (R-69).
   */
  readonly readReferenceWallWidth: (
    input: ReadFloorGeometryInput,
  ) => Promise<ScaleCapabilityResult<Pixels>>;
  /** Bề rộng một ô cửa đi điển hình trên ảnh, tính bằng pixel. */
  readonly readTypicalDoorWidth: (
    input: ReadFloorGeometryInput,
  ) => Promise<ScaleCapabilityResult<Pixels>>;
  /** Hộp bao của phòng lớn nhất trên ảnh, tính bằng pixel. */
  readonly readLargestRoomBox: (
    input: ReadFloorGeometryInput,
  ) => Promise<ScaleCapabilityResult<ScaleRoomBoxPx>>;
  /** Điểm bắt được trên bản vẽ: đỉnh tường, giao điểm, trung điểm, cạnh tường. */
  readonly readSnapTargets: (
    input: ReadFloorGeometryInput,
  ) => Promise<ScaleCapabilityResult<readonly ScaleRawSnapTarget[]>>;
  /**
   * N16 thô của một tầng — nhận MÃ TẦNG API của route, trả `Level` kèm mã `Level`
   * thật. Nguồn của `useFloorLayer`, để "Áp dụng tỷ lệ" có tầng mà vá (B-V5-01).
   * Lỗi thì ném.
   */
  readonly readLayer: (input: ReadFloorDrawingInput) => Promise<FloorLayerDocument>;
  /** #12 + N15: mọi tầng của dự án, có bản vẽ hay không, kèm `revision`. Lỗi thì ném. */
  readonly readAllFloors: (input: ReadAllFloorsInput) => Promise<readonly ScaleFloorTarget[]>;
  /** Client của bộ lưu lớp (`useFloorLayerAutosave`). Vắng thì hook dùng client chung. */
  readonly apiClient?: Pick<ApiClient, 'spatial'>;
  /** Ngưỡng tin cậy của dự án (N5). Vắng → ngưỡng mặc định 0,70 (BUG-354). */
  readonly readConfidenceThreshold?: ReadConfidenceThreshold;
  readonly now: () => number;
}

/**
 * Một điểm bắt thô, toạ độ theo pixel ảnh.
 *
 * Cổng không trả `SnapTarget` của `src/domain/units/snap` sẵn: `SnapTarget` mang
 * toạ độ `PointMm`, mà mm chỉ có nghĩa sau khi đã biết tỷ lệ — thứ màn này đang
 * đi tìm. Hook quy đổi khi nó có một tỷ lệ để quy đổi bằng.
 */
export interface ScaleRawSnapTarget {
  readonly id: string;
  readonly kind: 'wallVertex' | 'intersection' | 'midpoint';
  readonly xPx: Pixels;
  readonly yPx: Pixels;
}

/* -------------------------------------------------------------------------- */
/* Chuyển đổi.                                                                  */
/* -------------------------------------------------------------------------- */

/** Một tầng trong lượt đọc chất lượng, chuyển sang hình dạng màn dùng. */
function toDrawingSnapshot(floor: FloorImageQuality): ScaleDrawingSnapshot {
  const measurement = floor.measurement;
  const frameMissing = floor.frame !== undefined && !floor.frame.isFound;
  const findingSaysFrameMissing = floor.findings.some(
    (finding) => finding.code === FRAME_NOT_FOUND_CODE,
  );

  return {
    floorId: floor.floorId,
    floorName: floor.floorName,
    imageUrl: floor.sourceUrl,
    widthPx: measurement === undefined ? null : pixels(measurement.widthPx),
    heightPx: measurement === undefined ? null : pixels(measurement.heightPx),
    isWarped: frameMissing || findingSaysFrameMissing,
  };
}

/** Toạ độ `detected-geometry` là px trang `pages/0-<id>.png` — cùng ảnh màn vẽ. */
const GEOMETRY_REUSE_MS = 2000;

/* -------------------------------------------------------------------------- */
/* Factory.                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateScaleCalibrationGatewayOptions {
  /** Đồng hồ tiêm được. */
  readonly now?: () => number;
}

export function createScaleCalibrationGateway(
  client: ApiClient,
  options: CreateScaleCalibrationGatewayOptions = {},
): ScaleCalibrationGateway {
  const now = options.now ?? ((): number => Date.now());
  /*
   * Bốn lượt đọc hình học cùng một tầng chạy song song (`Promise.all` của hook) → một lượt
   * `detected-geometry`. ponytail: một ô nhớ theo tầng, sống 2 s; cần hơn thì đưa vào react-query.
   */
  let geometrySlot: { readonly key: string; readonly at: number; readonly promise: Promise<DetectedGeometry | null> } | null = null;
  const geometryOf = ({ floorId, projectId }: ReadFloorGeometryInput): Promise<DetectedGeometry | null> => {
    const key = `${projectId}/${floorId}`;
    const read = client.quality.detectedGeometry;

    if (read === undefined) {
      return Promise.resolve(null);
    }

    if (geometrySlot === null || geometrySlot.key !== key || now() - geometrySlot.at > GEOMETRY_REUSE_MS) {
      // Lỗi nào cũng lùi về hành vi cũ (404/501 của máy chủ cũ, lỗi mạng): màn không vỡ vì phần phụ.
      const promise = read
        .call(client.quality, { floorId, projectId })
        .then((result) => (result.ok ? result.data : null))
        .catch(() => null);
      geometrySlot = { key, at: now(), promise };
    }

    return geometrySlot.promise;
  };

  return {
    // Bốn việc hình học đi qua `detected-geometry` (lô 2b); máy chủ cũ 404/501 → `unsupported`.
    // `dimensionStrings` vẫn `false`: endpoint lô 2b không trả độ dài px của chuỗi (span_px).
    supports: {
      dimensionStrings: false,
      referenceWallWidth: client.quality.detectedGeometry !== undefined,
      typicalDoorWidth: client.quality.detectedGeometry !== undefined,
      largestRoomBox: client.quality.detectedGeometry !== undefined,
      snapTargets: client.quality.detectedGeometry !== undefined,
    },

    readFloorDrawing: async ({ floorId, projectId, signal }) => {
      const result = await client.quality.assess({
        floorId,
        projectId,
        ...(signal !== undefined ? { signal } : {}),
      });

      if (!result.ok) {
        return result;
      }

      const floor = result.data.floors.find((entry) => entry.floorId === floorId);

      if (floor === undefined) {
        // Lượt đánh giá chỉ liệt kê tầng ĐÃ có bản vẽ (tầng lạ thì máy chủ đã 404 `floor`
        // ở chính đường dẫn), nên vắng tầng đang mở nghĩa là tầng này chưa có bản vẽ.
        // Nói đúng câu đó bằng cùng hình 404 `upload` mà dự án chưa tải gì nhận (G02,
        // BUG-337) — không một "Có trục trặc / UNKNOWN" chung chung.
        return {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            kind: 'http',
            raw: { code: 'NOT_FOUND', resource: 'upload' },
            requestId: `${ENDPOINTS.quality.assess(projectId, floorId)}#${floorId}`,
            retryable: false,
            status: 404,
          },
        };
      }

      return { ok: true, data: toDrawingSnapshot(floor) };
    },

    readDimensionStrings: async () => unsupported('dimensionStrings'),
    readDimensionChips: async ({ floorId, projectId }) => {
      const read = client.quality.dimensionStrings;
      const result = read === undefined ? null : await read.call(client.quality, { floorId, projectId }).catch(() => null);

      if (result === null || !result.ok || result.data.pagePx === null) {
        return [];
      }

      // Khung vuông cạnh = cạnh dài trang, trang nằm giữa — cùng phép `imageFrameOf` của hook.
      const [width, height] = result.data.pagePx;
      const edge = Math.max(width, height);
      const toRatio = (x: number, y: number): { x: number; y: number } => ({
        x: (x + (edge - width) / 2) / edge,
        y: (y + (edge - height) / 2) / edge,
      });

      return result.data.items.map((item) => ({
        id: item.id,
        text: item.text,
        valueMm: millimetres(item.valueMm),
        box: { min: toRatio(item.box.xMin, item.box.yMin), max: toRatio(item.box.xMax, item.box.yMax) },
      }));
    },
    readReferenceWallWidth: async (input) => {
      const geometry = await geometryOf(input);
      const median = geometry?.wallThicknessPx?.median;

      return median === undefined || !(median > 0) ? unsupported('referenceWallWidth') : { supported: true, value: pixels(median) };
    },
    readTypicalDoorWidth: async (input) => {
      const geometry = await geometryOf(input);
      const widest = Math.max(0, ...(geometry?.doors ?? []).map((door) => door.widthPx));

      return widest > 0 ? { supported: true, value: pixels(widest) } : unsupported('typicalDoorWidth');
    },
    readLargestRoomBox: async (input) => {
      const box = (await geometryOf(input))?.largestRoom?.boxPx;

      return box === undefined
        ? unsupported('largestRoomBox')
        : { supported: true, value: { widthPx: pixels(box.xMax - box.xMin), heightPx: pixels(box.yMax - box.yMin) } };
    },
    readSnapTargets: async (input) => {
      const geometry = await geometryOf(input);

      return geometry === null
        ? unsupported('snapTargets')
        : {
            supported: true,
            value: geometry.snapPoints.map((point, index) => ({
              id: `snap-${index}`,
              kind: point.kind === 'wallEnd' ? 'wallVertex' : 'intersection',
              xPx: pixels(point.x),
              yPx: pixels(point.y),
            })),
          };
    },

    readLayer: async ({ floorId, projectId, signal }) => {
      const result = await client.spatial.readLayer({ floorId, projectId, ...(signal !== undefined ? { signal } : {}) });

      if (!result.ok) {
        throw result.error;
      }

      return result.data;
    },

    readAllFloors: async ({ projectId }) => {
      const [floors, graph] = await Promise.all([client.floors.list({ projectId }), client.spatial.readGraph({ projectId })]);

      if (!floors.ok) {
        throw floors.error;
      }

      if (!graph.ok) {
        throw graph.error;
      }

      const revisions = new Map<string, number>(graph.data.floorRevisions.map((entry) => [entry.floorId, entry.revision]));
      const levels = graph.data.graph.levels;
      const levelIds = new Set<string>(levels.map((level) => level.id));
      /*
       * Ghép #12 với N15: khớp mã trước; không khớp thì theo `order`. Máy chủ thật dùng
       * `Floor.id = level_id`, bộ mẫu thì không (`L1` ≠ `L-00000000L1`). Đích mang mã
       * `Level`, vì `commitSaved` và `isFloorBlocked` tra kho theo mã ấy.
       */
      const byOrder = new Map<number, string>(
        levels.filter((level) => !floors.data.some((floor) => floor.id === level.id)).map((level) => [level.order, level.id]),
      );

      return floors.data.map((floor) => {
        const levelId = levelIds.has(floor.id) ? floor.id : (byOrder.get(floor.order) ?? floor.id);
        const revision = revisions.get(levelId);
        const currentScale = levels.find((level) => level.id === levelId)?.scaleMillimetresPerPixel;

        return {
          floorId: levelId,
          name: floor.name,
          hasDrawing: floor.drawings.length > 0,
          ...(revision !== undefined ? { revision } : {}),
          ...(currentScale !== undefined ? { currentScale } : {}),
        };
      });
    },

    apiClient: client,

    readConfidenceThreshold: (input) => readProjectConfidenceThreshold(client.projectSettings, input),

    now,
  };
}

/** Cổng thật cho container. */
export function createAppScaleCalibrationGateway(): ScaleCalibrationGateway {
  return createScaleCalibrationGateway(createAppApiClient());
}

/**
 * Cổng chạy trên bộ mẫu — story và test dùng, không chạm mạng.
 *
 * Bốn tầng của `createMockApiClient()` là dữ liệu thật của bộ mẫu, nên story
 * không phải bịa một tầng tại chỗ (R-70).
 */
export function createMockScaleCalibrationGateway(
  options: CreateScaleCalibrationGatewayOptions = {},
): ScaleCalibrationGateway {
  return createScaleCalibrationGateway(createMockApiClient(), options);
}

/**
 * Bọc một cổng, thay đúng những việc người gọi đưa vào.
 *
 * Test dựng nhánh "có chuỗi kích thước" hay "đo được bề rộng nét tường" bằng
 * hàm này thay vì viết lại cả cổng — cùng lý lẽ `makeScriptedClient` của
 * `useProcessingScreen.test.ts`: chỉ thứ đang kiểm mới bị thay.
 */
export function withScaleCapabilities(
  base: ScaleCalibrationGateway,
  overrides: Partial<Omit<ScaleCalibrationGateway, 'supports'>> & {
    readonly supports?: Partial<Record<ScaleMissingCapability, boolean>>;
  },
): ScaleCalibrationGateway {
  const { supports, ...rest } = overrides;

  return {
    ...base,
    ...rest,
    supports: { ...base.supports, ...supports },
  };
}

/** Đại lượng độ dài đã gắn nhãn, cho story và test dựng dữ liệu thô. */
export const scaleMillimetres = millimetres;
