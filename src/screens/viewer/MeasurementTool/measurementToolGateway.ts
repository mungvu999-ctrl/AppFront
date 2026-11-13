/**
 * Cổng dữ liệu riêng của màn `MeasurementTool` — cửa DUY NHẤT ra tầng ngoài.
 *
 * Cùng khuôn `explodedViewGateway.ts`: một bản kê khả năng còn thiếu, một
 * `interface` khai ở hợp đồng (`measurementToolTypes.ts`, chỉ đọc), một factory
 * dựng cổng thật và một factory dựng cổng có dữ liệu cho story và bài kiểm
 * (R-73). Khuôn được CHÉP LẠI chứ không nhập chéo từ thư mục màn khác (R-68).
 *
 * Ngoài ba lượt gọi mạng, file này còn giữ hai phép THUẦN mà hook cần và view
 * không được biết: dựng mồi bắt điểm từ đồ thị ({@link snapTargetsOf}) và đổi
 * một bản ghi thô thành một hàng đã định dạng ({@link formatMeasurementRow}).
 * Cả hai là phép biến hình dữ liệu, không phải phép đo — mọi con số vẫn do
 * `src/domain/measure` tính và mọi chuỗi vẫn do `src/lib/format` viết (R-61, A15).
 *
 * ## Ba quyết định của file này, mỗi cái có một bản sai hiển nhiên
 *
 * **1. Hàng diện tích tính LẠI từ `points`, không đọc `rawValueMm`.**
 * `measurePolygonArea` trả milimét VUÔNG và mét vuông; `formatArea` đọc mét
 * vuông. Đọc `rawValueMm` rồi tự chia cho `SQUARE_MILLIMETRES_PER_SQUARE_METRE`
 * là một phép quy đổi đơn vị viết trong thư mục màn — đúng thứ `local/no-raw-number`
 * chặn và R-61 cấm. Gọi lại đúng hàm domain đã tính ra con số ấy thì không có
 * phép quy đổi nào để viết sai, và nó cũng gỡ luôn chỗ `MeasurementRecord`
 * phải gắn nhãn `Millimetres` lên một giá trị milimét vuông khi đi trên dây.
 *
 * **2. Số chữ số thập phân ĐỌC RA từ tầng định dạng, không chép lại.**
 * `MILLIMETRE_FRACTION_DIGITS` (0), `CENTIMETRE_FRACTION_DIGITS` (1),
 * `METRE_FRACTION_DIGITS` (2) và `AREA_FRACTION_DIGITS` (2) là chuyện riêng của
 * `src/lib/format/measure.ts` và không được xuất ra. Một bảng 0/1/2 chép tay ở
 * đây là một bản sao thứ hai của một chính sách đã có — đúng chỗ hai bên lệch
 * nhau lặng lẽ, y như lần `formatLength` chưa biết `'cm'`. Nên
 * {@link fractionDigitsOf} in một giá trị dò rồi ĐẾM chữ số của chính kết quả ấy.
 *
 * **3. Giá trị số cũng đi qua tầng định dạng, không qua một phép chia.**
 * `displayValue` là `parseNumber(valueLabel)` — `parseNumber` là nghịch đảo
 * chính thức của `formatNumber` và là chỗ DUY NHẤT trong repo được tháo dấu
 * nghìn với dấu thập phân ra. Viết `lengthMm / MILLIMETRES_PER_METRE` ở đây thì
 * `local/no-raw-number` báo lỗi, và nó báo đúng: quy đổi thuộc về tầng dưới.
 *
 * ## Vé hoàn tác đi ra bằng callback, không bằng kiểu trả về
 *
 * `MeasurementToolGateway.deleteMeasurement` của hợp đồng trả `Promise<void>` và
 * chỉ nhận một mã, còn `deleteMeasurement` của `src/lib/mutations` cần cả bản
 * ghi và trả một `UndoTicket` (A8, D-05). Hai chữ ký ấy được nối ở đây, không
 * bằng cách sửa hợp đồng: bản ghi đầy đủ đọc từ bộ nhớ đệm truy vấn (chính khoá
 * `measurementKeys.all` mà lượt tải đã ghi vào), còn vé đi ra qua
 * {@link MeasurementToolGatewayDeps.onUndoTicket}. Nhờ vậy kiểu của màn không
 * phải kéo kiểu của tầng mutation vào view, mà A8 vẫn nguyên vẹn. Cửa sổ hoàn
 * tác là `UNDO_WINDOW_MS` mà chính vé mang theo — không con số nào ở đây (R-71).
 *
 * ## Vì sao hai lượt ghi nhận hàm chạy từ ngoài
 *
 * `saveMeasurement`/`deleteMeasurement` của `src/lib/mutations` trả về
 * `UseMutationOptions`, tức là thứ `useMutation` chạy chứ không phải thứ gọi
 * thẳng được: chạy tay `mutationFn` sẽ bỏ mất `onMutate`/`onSuccess`, và cùng
 * lúc đó `isPending`/`error` — hai thứ R-64 bắt phải lấy từ tầng truy vấn — sẽ
 * không có chỗ nào để sinh ra. Nên hook giữ hai `useMutation` và đưa
 * `mutateAsync` của chúng vào đây. Cổng vẫn là cửa duy nhất ra ngoài; nó chỉ
 * không tự dựng lại vòng đời mutation lần thứ hai.
 */

import type { QueryClient } from '@tanstack/react-query';

import { createAppHttpClient } from '@/api/appClient';
import { ENDPOINTS } from '@/api/endpoints';
import { MeasurementRecordSchema, type MeasurementRecordBody } from '@/api/schemas/measurements';
import { safeParseList } from '@/api/schemas/decode';
import {
  createMeasurementNoteId,
  measurePolygonArea,
  nextMeasurementNoteSequence,
  squareMillimetres,
  type MeasurePoint,
} from '@/domain/measure/measure';
import { arcApex } from '@/domain/spatial/arc';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Axis, Point, Wall } from '@/domain/spatial/types';
import type { PointMm } from '@/domain/units/compare';
import { snapToTargets, type AnchorKind, type SnapResult, type SnapTarget } from '@/domain/units/snap';
import { millimetres } from '@/domain/units/types';
import { formatArea, formatLength } from '@/lib/format/measure';
import { measureTextOfState, type ScaleState } from '@/lib/viewmodel/provisionalScale';
import { formatNumber, parseNumber } from '@/lib/format/number';
import { readWireError } from '@/lib/errors/wireError';
import type { HttpClient } from '@/lib/http';
import type {
  DeleteMeasurementVariables,
  SaveMeasurementVariables,
} from '@/lib/mutations/measurement';
import type { UndoTicket } from '@/lib/mutations/undoTicket';
import { measurementKeys } from '@/lib/query/queryKeys';
import type { MeasurementRecord } from '@/types/measurement';

import {
  SNAP_KIND_LABELS,
  type MeasureMode,
  type MeasurementToolGateway,
  type MeasureUnit,
  type PinnedMeasurement,
  type PinnedMeasurementId,
  type SnapIndicator,
  type SnapKind,
} from './measurementToolTypes';

/* -------------------------------------------------------------------------- */
/* Bản kê khả năng còn thiếu.                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Những việc màn CẦN mà tầng dữ liệu chưa có đường.
 *
 * Ghi ra để người đọc sau không phải dò lại, và để không ai lấp bằng một hàm tự
 * chế (R-69). Mỗi dòng là một tên hàm còn thiếu cộng lý do.
 */
export const MEASUREMENT_MISSING_CAPABILITIES: readonly string[] = Object.freeze([
  'readMeasurementAnchors — MeasurementRecord chỉ lưu điểm (MeasurePoint), không lưu mã thực thể nào, nên không có gì để đối chiếu với đồ thị khi tường hay phòng bị xoá. Vì thế `stale` của một hàng luôn là false và `staleReason` luôn null: trạng thái "Một phần" của màn tới từ chuỗi đo CHƯA ĐÓNG, không từ hình học mất neo. Muốn có nửa còn lại thì phải thêm entityId vào bản ghi ở tầng LG-3 trước.',
  'ReadSurfaceSnapTargets — snapToTargets làm việc trên PointMm 2D (x, y); domain không có mồi bắt điểm nào cho CẠNH hay BỀ MẶT trong không gian ba chiều. Ba loại giao được là đỉnh tường, trung điểm tường và giao trục, đúng như quyết định Q1 của hợp đồng.',
]);

/* -------------------------------------------------------------------------- */
/* Bắt điểm — mồi dựng từ đồ thị.                                              */
/* -------------------------------------------------------------------------- */

/** Đồ thị chưa có gì để bắt vào. */
const NO_TARGETS: readonly SnapTarget[] = Object.freeze([]);

/** Câu của chip khi con trỏ ở trên bề mặt trống — chip KHÔNG bao giờ được rỗng. */
export const NO_SNAP_LABEL = 'Chưa bắt vào đâu';

/**
 * `AnchorKind` của domain sang `SnapKind` của màn.
 *
 * Ba loại, đúng ba thứ `snapToTargets` dò được. `'perpendicular'` và `'grid'`
 * KHÔNG có mặt: chúng là mồi của công cụ vẽ, không phải một điểm người dùng
 * chấm để đo, và màn tắt cả hai khi gọi `snapToTargets`.
 */
export const SNAP_KIND_BY_ANCHOR: Readonly<Record<AnchorKind, SnapKind>> = {
  wallVertex: 'vertex',
  midpoint: 'midpoint',
  intersection: 'axisIntersection',
};

/** Mã mồi bắt điểm — cái tên hiện ra trong `SnapResult.targetId`. */
const vertexTargetId = (wallId: string, end: 'start' | 'end'): string => `${wallId}-${end}`;
const midpointTargetId = (wallId: string): string => `${wallId}-mid`;
const intersectionTargetId = (first: string, second: string): string => `${first}-${second}`;

/**
 * Toạ độ bản vẽ thành `PointMm` có nhãn.
 *
 * `Point` của `spatial/types.ts` đo bằng một `Millimetres` là bí danh của
 * `number`, còn `PointMm` của `units/compare.ts` đo bằng nhãn thật. Hai kiểu
 * sống song song trong repo; `explodedViewGateway.ts` bắc cầu bằng đúng hàm
 * này. Chép lại cầu ấy thay vì nhập chéo (R-68), và KHÔNG ép kiểu bằng `as`:
 * `millimetres()` là hàm gắn nhãn chính thức của `src/domain/units`.
 */
function toPointMm(corner: Point): PointMm {
  return { x: millimetres(corner.x), y: millimetres(corner.y) };
}

/**
 * Trung điểm của một đoạn tim tường.
 *
 * Domain không có hàm nào trả về trung điểm của một đoạn — `src/domain/units/snap.ts`
 * nhận mồi đã dựng sẵn và không tự dựng cái nào, `perpendicularFoot` trả chân
 * vuông góc chứ không trả trung điểm. Nên phép này viết ở đây, ở tầng cổng, đúng
 * chỗ `explodedViewGateway.ts` đặt `axisFractionOf` và `fractionWithin`: một phép
 * đổi toạ độ để dựng dữ liệu cho màn, không phải một phép ĐO (R-61 nói về số đo,
 * và không số đo nào của màn này đi qua đây).
 */
function midpointOf(start: PointMm, end: PointMm): PointMm {
  return {
    x: millimetres((start.x + end.x) / 2),
    y: millimetres((start.y + end.y) / 2),
  };
}

/** Thực thể có hình dạng một bức tường của đồ thị, hoặc `null`. */
function wallOf(spatial: NormalizedSpatial, id: string): Wall | null {
  const entity = spatial.byId[id];

  // Đọc theo HÌNH DẠNG, không qua `isEntityOfKind`: mã của bộ mẫu có thân ngắn
  // hơn mười ký tự nên `isValidId` từ chối nó, và một danh sách mồi rỗng là thứ
  // người dùng nhìn thấy. `explodedViewGateway.axisProbesOf` đọc theo cùng cách
  // vì cùng lý do.
  if (entity === undefined || !('centreline' in entity) || !('thicknessMm' in entity)) {
    return null;
  }

  return entity as Wall;
}

/** Thực thể có hình dạng một trục của đồ thị, hoặc `null`. */
function axisOf(spatial: NormalizedSpatial, id: string): Axis | null {
  const entity = spatial.byId[id];

  if (entity === undefined || !('line' in entity) || !('direction' in entity)) {
    return null;
  }

  return entity as Axis;
}

/**
 * Mọi mồi bắt điểm của một tầng: đỉnh tường, trung điểm tường, giao trục.
 *
 * `levelId` là `null` khi màn chưa chọn tầng nào — lúc ấy lấy mồi của cả mô
 * hình, vì một điểm đo trong khung nhìn 3D không buộc phải thuộc tầng đang hoạt
 * động. Lọc theo tầng khi có tầng, để hai bức tường chồng nhau ở hai tầng không
 * cùng tranh một cú chấm.
 *
 * Giao trục dựng bằng cách bắt cặp một trục DỌC với một trục NGANG: một trục dọc
 * đứng ở một toạ độ `x`, một trục ngang đứng ở một toạ độ `y`, nên giao của
 * chúng là `(x, y)` — không có phép giải hai đường thẳng nào ở đây, và cũng
 * không cần: `Axis.direction` đã nói phương của từng trục.
 */
export function snapTargetsOf(
  spatial: NormalizedSpatial | null,
  levelId: string | null = null,
): readonly SnapTarget[] {
  if (spatial === null) {
    return NO_TARGETS;
  }

  const targets: SnapTarget[] = [];

  for (const id of spatial.byKind.wall) {
    const wall = wallOf(spatial, id);

    if (wall === null || (levelId !== null && wall.levelId !== levelId)) {
      continue;
    }

    targets.push({
      kind: 'wallVertex',
      id: vertexTargetId(String(wall.id), 'start'),
      position: toPointMm(wall.centreline.start),
    });
    targets.push({
      kind: 'wallVertex',
      id: vertexTargetId(String(wall.id), 'end'),
      position: toPointMm(wall.centreline.end),
    });
    targets.push({
      kind: 'midpoint',
      id: midpointTargetId(String(wall.id)),
      // Tường cong: "trung điểm" là đỉnh cung, điểm giữa thân tường thật.
      position: wall.curveOffsetMm
        ? toPointMm(arcApex(wall.centreline.start, wall.centreline.end, wall.curveOffsetMm))
        : midpointOf(toPointMm(wall.centreline.start), toPointMm(wall.centreline.end)),
    });
  }

  const vertical: Axis[] = [];
  const horizontal: Axis[] = [];

  for (const id of spatial.byKind.axis) {
    const axis = axisOf(spatial, id);

    if (axis === null || (levelId !== null && axis.levelId !== levelId)) {
      continue;
    }

    (axis.direction === 'vertical' ? vertical : horizontal).push(axis);
  }

  for (const down of vertical) {
    for (const across of horizontal) {
      targets.push({
        kind: 'intersection',
        id: intersectionTargetId(String(down.id), String(across.id)),
        position: { x: millimetres(down.line.start.x), y: millimetres(across.line.start.y) },
      });
    }
  }

  return targets;
}

/**
 * Chấm một điểm mặt bằng vào mồi gần nhất.
 *
 * Lưới 50 mm và chân vuông góc bị TẮT: cả hai là mồi của công cụ vẽ. Bật lưới
 * lên sẽ lặng lẽ kéo một điểm đo về bội số gần nhất, tức là sửa số đo của kỹ sư
 * mà không nói — đúng lý do `useAxisGridManager` cũng tắt nó.
 */
export function snapMeasurePoint(
  point: PointMm,
  targets: readonly SnapTarget[],
): SnapResult {
  return snapToTargets(point, targets, {
    gridEnabled: false,
    disabledKinds: ['perpendicular', 'grid'],
  });
}

/**
 * Chip bắt điểm: loại đang bắt, và câu gọi tên nó.
 *
 * Không bắt được gì thì `kind` là `null` nhưng `label` VẪN là một câu tiếng
 * Việt — đặc tả cấm để người dùng đoán, nên chip không có nhánh nào rỗng.
 */
export function snapIndicatorOf(result: SnapResult): SnapIndicator {
  const kind =
    result.kind === null || result.kind === 'perpendicular' || result.kind === 'grid'
      ? null
      : SNAP_KIND_BY_ANCHOR[result.kind];

  return { kind, label: kind === null ? NO_SNAP_LABEL : SNAP_KIND_LABELS[kind] };
}

/* -------------------------------------------------------------------------- */
/* Hàng danh sách: lõi thô → hàng đã định dạng.                                */
/* -------------------------------------------------------------------------- */

/**
 * Đơn vị màn mở ra lần đầu.
 *
 * Mét, vì đó là đơn vị `formatLength` tự chọn cho mọi khoảng cách từ một mét
 * trở lên, và một khoảng cách trong mô hình 3D gần như luôn ở tầm ấy.
 */
export const INITIAL_MEASURE_UNIT: MeasureUnit = 'm';

/** Hậu tố của một hàng diện tích. `formatArea` chỉ in mét vuông, và chỉ mét vuông. */
const AREA_UNIT_SUFFIX = 'm²';

/** Đuôi của câu đếm ở đầu mục, ví dụ "5 phép đo". */
const COUNT_SUFFIX = ' phép đo';

/** Tên tự sinh của một phép đo mới, ví dụ "Phép đo 3". */
const NAME_PREFIX = 'Phép đo ';

/** Không có chữ số thập phân nào — giá trị lùi khi tầng định dạng trả `—`. */
const NO_FRACTION_DIGITS = 0;

/** Giá trị lùi của `displayValue` khi không có số nào đọc được. */
const NO_DISPLAY_VALUE = 0;

/**
 * Giá trị dò để đọc số chữ số thập phân của một đơn vị.
 *
 * Số không, vì phần nguyên của nó in ra đúng MỘT chữ số trong mọi đơn vị và mọi
 * hàm định dạng — nên đếm tổng số chữ số rồi trừ đi một là ra phần thập phân,
 * không cần biết dấu thập phân là dấu gì.
 */
const FRACTION_PROBE = 0;

/** Số chữ số của phần nguyên trong {@link FRACTION_PROBE}. */
const PROBE_INTEGER_DIGITS = 1;

/**
 * Đếm chữ số thập phân của một chuỗi đã định dạng từ {@link FRACTION_PROBE}.
 *
 * Xem quyết định 2 ở đầu file: đây là cách đọc chính sách của
 * `src/lib/format/measure.ts` ra thay vì chép nó lại. `"0 mm"` → 0, `"0,0 cm"`
 * → 1, `"0,00 m"` → 2, `"0,00 m²"` → 2.
 */
function fractionDigitsOf(formattedProbe: string): number {
  const digits = formattedProbe.replace(/\D/gu, '').length;

  return Math.max(NO_FRACTION_DIGITS, digits - PROBE_INTEGER_DIGITS);
}

/** Số chữ số thập phân `formatLength` giữ cho đơn vị này. */
export function lengthFractionDigits(unit: MeasureUnit): number {
  return fractionDigitsOf(formatLength(FRACTION_PROBE, { unit }));
}

/** Số chữ số thập phân `formatArea` giữ. */
export function areaFractionDigits(): number {
  return fractionDigitsOf(formatArea(FRACTION_PROBE));
}

/**
 * Phần của một hàng KHÔNG phụ thuộc đơn vị đang chọn.
 *
 * `PinnedMeasurement` là bản này cộng bốn trường đã định dạng cộng `screenPoints`,
 * nên một `PinnedMeasurement` cũng là một lõi hợp lệ và
 * {@link formatMeasurementRow} định dạng lại nó được khi người dùng đổi đơn vị.
 */
export interface MeasurementRowCore {
  readonly id: PinnedMeasurementId;
  readonly name: string;
  readonly mode: MeasureMode;
  /** Milimét cho hàng độ dài. Hàng diện tích KHÔNG đọc trường này — xem quyết định 1. */
  readonly rawValueMm: PinnedMeasurement['rawValueMm'];
  readonly points: readonly MeasurePoint[];
  readonly visible: boolean;
  readonly stale: boolean;
  readonly staleReason: string | null;
}

/** Giá trị SỐ nằm trong một chuỗi đã định dạng, hoặc 0 khi không có số nào. */
function displayValueOf(label: string): number {
  return parseNumber(label) ?? NO_DISPLAY_VALUE;
}

/**
 * Một hàng đã định dạng theo đơn vị đang chọn.
 *
 * Hàng diện tích bỏ qua `unit`: `formatArea` chỉ in mét vuông, nên Select đơn vị
 * mm/cm/m không đổi được hàng nào của nó — và đó là câu trả lời đúng, không phải
 * một trường hợp bị quên.
 *
 * `screenPoints` để `null` ở đây: phép chiếu world → pixel cần camera, thứ chỉ
 * hook cầm được, nên hook điền nó vào sau mỗi khung hình.
 */
export function formatMeasurementRow(
  core: MeasurementRowCore,
  unit: MeasureUnit,
  scaleState?: ScaleState,
): PinnedMeasurement {
  /* R10 làn S: số đo 3D suy từ tỷ lệ. Một thước có thể bắc qua nhiều tầng nên hook truyền xuống
     trạng thái XẤU NHẤT của mô hình: không nói được tầng nào thì không được im lặng. */
  const marked = (text: string): string =>
    scaleState === undefined ? text : measureTextOfState(text, scaleState);
  if (core.mode === 'floorArea') {
    const area = measurePolygonArea(core.points);
    const valueLabel = marked(formatArea(area?.areaM2 ?? null));

    return {
      ...core,
      valueLabel,
      rawValueMm: squareMillimetres(area?.areaMm2 ?? NO_DISPLAY_VALUE),
      displayValue: displayValueOf(valueLabel),
      displayFractionDigits: areaFractionDigits(),
      unitSuffix: AREA_UNIT_SUFFIX,
      screenPoints: null,
    };
  }

  const valueLabel = marked(formatLength(core.rawValueMm, { unit }));

  return {
    ...core,
    valueLabel,
    displayValue: displayValueOf(valueLabel),
    displayFractionDigits: lengthFractionDigits(unit),
    unitSuffix: unit,
    screenPoints: null,
  };
}

/** Câu đếm ở đầu mục "Phép đo", ví dụ "5 phép đo" (A15). */
export function measurementCountLabel(count: number): string {
  return `${formatNumber(count, { fractionDigits: NO_FRACTION_DIGITS })}${COUNT_SUFFIX}`;
}

/**
 * Mã và tên của phép đo tiếp theo.
 *
 * Số thứ tự là một bước sau số cao nhất đang có (hàm `nextMeasurementNoteSequence`
 * của domain; quá trần 15 chữ số thì lấy số nhỏ nhất chưa dùng). Máy chủ xoá
 * cứng nên CHO tái dùng mã đã xoá; còn trong một phiên FE thì không — cổng nhớ
 * mọi mã đã xoá và đưa danh sách hợp vào đây, để một phép đo từng được nhắc tới
 * là `MS-0003` không trở thành một phép đo khác ngay trước mắt người dùng.
 */
export function nextMeasurementIdentity(rows: readonly { readonly id: string }[]): {
  readonly id: PinnedMeasurementId;
  readonly name: string;
} {
  const sequence = nextMeasurementNoteSequence(rows.map((row) => row.id));

  return {
    id: createMeasurementNoteId(sequence),
    name: `${NAME_PREFIX}${formatNumber(sequence, { fractionDigits: NO_FRACTION_DIGITS })}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Bản ghi trên dây ↔ hàng của màn.                                            */
/* -------------------------------------------------------------------------- */

/**
 * Hàng của màn thành bản ghi để lưu.
 *
 * Bốn trường của tầng hiển thị (`valueLabel`, `visible`, `stale`, `staleReason`)
 * KHÔNG lên dây: A15 cấm lưu chuỗi đã định dạng, và ba trường còn lại là trạng
 * thái của phiên chứ không phải một phần hồ sơ.
 *
 * `rawValueMm` của một hàng diện tích là milimét VUÔNG, còn `MeasurementRecord`
 * gắn nhãn `Millimetres` cho trường ấy. Gắn lại nhãn ở đây là chỗ duy nhất chấp
 * nhận được cho việc đó, và nó vô hại vì đường về không đọc nó:
 * {@link formatMeasurementRow} tính lại diện tích từ `points` (quyết định 1).
 */
export function toMeasurementRecord(row: PinnedMeasurement): MeasurementRecord {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    points: row.points,
    rawValueMm: millimetres(row.rawValueMm),
  };
}

/** Bản ghi vừa tải về thành lõi một hàng — xem {@link MEASUREMENT_MISSING_CAPABILITIES}. */
export function toMeasurementRowCore(record: MeasurementRecord): MeasurementRowCore {
  return {
    id: record.id,
    name: record.name,
    mode: record.mode,
    rawValueMm: record.rawValueMm,
    points: record.points,
    visible: true,
    stale: false,
    staleReason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Cổng thật.                                                                  */
/* -------------------------------------------------------------------------- */

/** Không có phép đo nào đã ghim. */
const NO_ROWS: readonly PinnedMeasurement[] = Object.freeze([]);

export interface MeasurementToolGatewayDeps {
  /** Cổng mạng. Mọi truy cập mạng đi qua `src/lib/http` (`local/no-fetch-outside-http`). */
  readonly http: HttpClient;
  /** Bộ nhớ đệm truy vấn — chỗ đọc lại bản ghi ĐẦY ĐỦ khi xoá. */
  readonly queryClient: QueryClient;
  /** `mutateAsync` của `useMutation(saveMeasurement(…))`, do hook giữ (R-64). */
  readonly save: (variables: SaveMeasurementVariables) => Promise<MeasurementRecord>;
  /** `mutateAsync` của `useMutation(deleteMeasurement(…))`, do hook giữ (R-64). */
  readonly remove: (variables: DeleteMeasurementVariables) => Promise<UndoTicket>;
  /** Chỗ vé hoàn tác đi ra — xem ghi chú đầu file. */
  readonly onUndoTicket?: (ticket: UndoTicket) => void;
}

/** Bản ghi đang nằm trong bộ nhớ đệm cho khoá của dự án này. */
function cachedRecords(
  queryClient: QueryClient,
  projectId: string,
): readonly MeasurementRecord[] {
  return (
    queryClient.getQueryData<readonly MeasurementRecord[]>(measurementKeys.all(projectId)) ?? []
  );
}

/** Mã lỗi máy chủ trả khi cùng id khác thân (#17). */
const ID_TAKEN_CODE = 'MEASUREMENT_ID_TAKEN';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Mã và tài nguyên của một lỗi, dù là `HttpError` hay `AppError`. */
export interface MeasurementErrorCode {
  readonly code: string | null;
  readonly resource: string | null;
}

/**
 * Đọc mã lỗi từ MỌI hình dạng lỗi mà màn gặp.
 *
 * `readWireError` đọc `HttpError` (lỗi của lượt GET) nhưng trả `null` với
 * `AppError` — thứ `mutateAsync` luôn ném. Nên khi vắng, đọc thẳng `code` và
 * `params.resource` của `AppError` (`toAppError` giữ cả hai từ `error.raw`).
 */
export function measurementErrorCodeOf(error: unknown): MeasurementErrorCode {
  const wire = readWireError(error);

  if (wire !== null) {
    // Có hình dạng HttpError: mã không qua mẫu thì là `null`, không đọc lại `code` thô.
    return { code: wire.code ?? null, resource: wire.resource ?? null };
  }

  if (!isRecord(error)) {
    return { code: null, resource: null };
  }

  const params = isRecord(error.params) ? error.params : null;
  const resource = typeof params?.resource === 'string' ? params.resource : null;

  return { code: typeof error.code === 'string' ? error.code : null, resource };
}

/** Thân dây (đã qua schema) thành bản ghi của ứng dụng, không ép kiểu. */
function toRecordFromWire(body: MeasurementRecordBody): MeasurementRecord {
  return {
    id: `MS-${body.id.slice(3)}`,
    name: body.name,
    mode: body.mode,
    points: body.points.map((point) => ({
      x: millimetres(point.x),
      y: millimetres(point.y),
      ...(point.z !== undefined ? { z: millimetres(point.z) } : {}),
    })),
    rawValueMm: millimetres(body.rawValueMm),
  };
}

/** Cổng thật, cộng hàm hoà giải 409 của vé hoàn tác (E5) — kiểu mở rộng khai ở đây. */
export type MeasurementToolHttpGateway = MeasurementToolGateway & {
  /** Đọc lại #16 rồi cấp cho bản ghi một mã và tên chưa ai dùng. */
  readonly resolveUndoConflict: (
    projectId: string,
    measurement: MeasurementRecord,
  ) => Promise<MeasurementRecord>;
};

/**
 * Cổng đọc và ghi thật.
 *
 * `listMeasurements` định dạng theo {@link INITIAL_MEASURE_UNIT}; hook định dạng
 * lại bằng {@link formatMeasurementRow} mỗi khi người dùng đổi đơn vị, nên chỉ
 * có MỘT hàm định dạng cho cả hai đường và chúng không lệch nhau được.
 */
export function createMeasurementToolGateway(
  deps: MeasurementToolGatewayDeps,
): MeasurementToolHttpGateway {
  /** Mọi mã đã xoá trong phiên này — máy chủ cho tái dùng, phiên FE thì không. */
  const deletedIds = new Set<string>();

  const withDeleted = (rows: readonly { readonly id: string }[]): readonly { readonly id: string }[] => [
    ...rows,
    ...[...deletedIds].map((id) => ({ id })),
  ];

  const readRecords = async (projectId: string): Promise<readonly MeasurementRecord[]> => {
    const result = await deps.http.get<unknown>(ENDPOINTS.measurements.list(projectId));

    if (!result.ok) {
      // Ném nguyên `HttpError`: `useQuery` của hook là chỗ lỗi thành trạng
      // thái màn (R-64), và bọc lại ở đây chỉ làm mất `kind` gốc.
      throw result.error;
    }

    const decoded = safeParseList(MeasurementRecordSchema, result.data, 'measurements.list');

    if (!decoded.ok) {
      throw decoded.error;
    }

    return decoded.data.map(toRecordFromWire);
  };

  /** Đọc lại #16, ghi vào bộ nhớ đệm, và cấp mã mới trên danh sách hợp mã đã xoá. */
  const freshIdentity = async (projectId: string): Promise<ReturnType<typeof nextMeasurementIdentity>> => {
    const records = await readRecords(projectId);

    deps.queryClient.setQueryData(measurementKeys.all(projectId), records);

    return nextMeasurementIdentity(withDeleted(records));
  };

  return {
    listMeasurements: async (projectId) =>
      (await readRecords(projectId)).map((record) =>
        formatMeasurementRow(toMeasurementRowCore(record), INITIAL_MEASURE_UNIT),
      ),

    saveMeasurement: async (projectId, measurement) => {
      // Mã bản nháp sinh ở hook chỉ thấy danh sách; mã đã xoá trong phiên thì
      // chỉ cổng biết, nên sinh lại trước khi gửi.
      let row: PinnedMeasurement = deletedIds.has(measurement.id)
        ? {
            ...measurement,
            ...nextMeasurementIdentity(withDeleted(cachedRecords(deps.queryClient, projectId))),
          }
        : measurement;

      try {
        await deps.save({ projectId, measurement: toMeasurementRecord(row) });
      } catch (error) {
        // Chỉ 409 đổi mã mới đáng thử lại; mọi mã khác (kể cả 422 hết hạn mức)
        // ném ngay, không đọc lại.
        if (measurementErrorCodeOf(error).code !== ID_TAKEN_CODE) {
          throw error;
        }

        row = { ...row, ...(await freshIdentity(projectId)) };

        try {
          await deps.save({ projectId, measurement: toMeasurementRecord(row) });
        } catch {
          // Lần hai hỏng thì ném lỗi GỐC (lần một), không phải lỗi lần hai.
          throw error;
        }
      }

      return row;
    },

    deleteMeasurement: async (projectId, id) => {
      const measurement = cachedRecords(deps.queryClient, projectId).find(
        (record) => record.id === id,
      );

      if (measurement === undefined) {
        // Không có bản ghi thì không có gì để phục hồi, và một lượt xoá không
        // hoàn tác được là thứ A8 không cho phép đi tiếp lặng lẽ.
        throw new Error(`Không tìm thấy phép đo ${id} để xoá.`);
      }

      deps.onUndoTicket?.(await deps.remove({ projectId, measurement }));
      deletedIds.add(id);
    },

    resolveUndoConflict: async (projectId, measurement) => ({
      ...measurement,
      ...(await freshIdentity(projectId)),
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Cổng có dữ liệu — story và bài kiểm.                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cổng giả, không mạng.
 *
 * Danh sách sống trong closure nên một lượt ghim rồi một lượt tải lại trong cùng
 * story thấy đúng thứ vừa ghim; vé hoàn tác không có ở đây vì không có máy chủ
 * nào để phục hồi về.
 */
export function createMeasurementToolFixtureGateway(
  seed: readonly PinnedMeasurement[] = NO_ROWS,
): MeasurementToolGateway {
  let rows: readonly PinnedMeasurement[] = seed;

  return {
    listMeasurements: (): Promise<readonly PinnedMeasurement[]> => Promise.resolve(rows),
    saveMeasurement: (_projectId, measurement): Promise<PinnedMeasurement> => {
      rows = [...rows.filter((row) => row.id !== measurement.id), measurement];

      return Promise.resolve(measurement);
    },
    deleteMeasurement: (_projectId, id): Promise<void> => {
      rows = rows.filter((row) => row.id !== id);

      return Promise.resolve();
    },
  };
}

/**
 * Cổng mạng của phiên đang chạy.
 *
 * Base URL **và** phiên đăng nhập đều lấy từ `createAppHttpClient` của
 * `src/api/appClient` — nơi DUY NHẤT quyết định cả hai, không một bản sao thứ
 * hai (R-65, R-07). Bản tự dựng trước đây không gắn token, nên mọi lượt đo trên
 * một server thật trả 401.
 */
export function createMeasurementHttpClient(): HttpClient {
  return createAppHttpClient();
}
