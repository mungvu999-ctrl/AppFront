/**
 * Bộ hồ sơ giả cho `VITE_USE_MOCK_API` — K-32b, trong lúc BE (K-32a) chưa có route thật.
 *
 * Mô phỏng ĐÚNG vòng đời của hợp đồng đã duyệt: `receiving` → N56 → `analyzing` (hai lượt đọc N57) →
 * `review` → N60 → `confirmed`, cùng các lỗi nghiệp vụ (`DRAWING_SET_NOT_RECEIVING`, `…_NOT_READY`,
 * `…_CONFIRMED`, `…_REVISION_STALE`, `…_NO_PLAN`, `FLOOR_HAS_DRAWING`, `VERSION_CONFLICT`, 503 khi công
 * tắc tắt). Trạng thái ở cấp module — như hai thẻ trình duyệt thấy chung một máy chủ — và test gọi
 * {@link __resetMockDrawingSets} ở `beforeEach`.
 *
 * Bộ mẫu máy "đọc" ra (đủ ba dải độ chắc, đủ loại hình): theo thứ tự trang, trang 1–3 là mặt bằng tầng
 * trệt/2/3, trang 4 là mặt cắt, trang 5 là mặt đứng, trang 6 là hình máy không đoán được loại; rồi lặp.
 * Tên tệp chứa `thieu-mat-cat` thì bộ không có mặt cắt; chứa `hong` thì N56 báo `rejected` (`FILE_CORRUPT`).
 *
 * Chỉ chạy dưới `import.meta.env.DEV`; `src/api/__mocks__/` được đánh dấu không tác dụng phụ nên bản dựng
 * sản phẩm bỏ hẳn file này.
 */

import type { DrawingSetClient } from '@/api/drawingSetClient';
import { DRAWING_SET_ERROR_CODES, DRAWING_SET_LIMITS, DRAWING_SET_NAME_MAX } from '@/api/schemas/drawingSet';
import type {
  DrawingSet,
  DrawingSetFile,
  DrawingSetSummary,
  DrawingSetView,
  ViewEdit,
} from '@/api/schemas/drawingSet';
import { countUploadChunks } from '@/lib/upload/chunk';
import type { HttpError, Result } from '@/lib/http';

type Reply<T> = Result<T, HttpError>;

const wireError = (status: number, code: string, raw: Record<string, unknown> = {}): Reply<never> => ({
  ok: false,
  error: { code, kind: 'http', raw: { code, ...raw }, requestId: 'req-mock-drawing-set', retryable: false, status },
});

const clone = <T>(value: T): T => structuredClone(value);

export interface MockDrawingSetOptions {
  /** Công tắc `DRAWING_SET_ENABLED`; tắt thì N54/N55/N56/N59/N60 trả 503 (đọc và xoá vẫn chạy). */
  readonly enabled?: boolean;
  /** Tầng đã có bản vẽ: nhận mà không có `replace` thì N60 trả 409 `FLOOR_HAS_DRAWING`. */
  readonly occupiedFloorIds?: readonly string[];
  /** Số lượt đọc N57 trước khi `analyzing` thành `review` (mặc định 2). */
  readonly analyzeReads?: number;
}

interface MockFile extends DrawingSetFile {
  readonly chunks: Set<number>;
  readonly kind: 'pdf' | 'image';
}

interface MockSet {
  readonly id: string;
  readonly projectId: string;
  name?: string;
  status: DrawingSet['status'];
  revision: number;
  errorCode?: string;
  readonly createdAt: string;
  confirmedAt?: string;
  files: MockFile[];
  views: DrawingSetView[];
  reads: number;
  deleted: boolean;
}

const sets = new Map<string, MockSet>();
let sequence = 0;

export function __resetMockDrawingSets(): void {
  sets.clear();
  sequence = 0;
}

const mockId = (prefix: string, n: number): string => `${prefix}_${String(n).padStart(26, '0')}`;

const isoNow = (): string => new Date().toISOString();

/** Số trang máy "đọc" từ một tệp: ảnh 1, PDF theo `-<n>-trang` trong tên (mặc định 6). */
function pagesOf(file: MockFile): number {
  if (file.kind === 'image') return 1;
  const match = /(\d+)-trang/u.exec(file.fileName);

  return match?.[1] === undefined ? 6 : Math.min(DRAWING_SET_LIMITS.maxPagesPerPdf, Math.max(1, Number(match[1])));
}

const PAGE_PATTERN = [
  { kind: 'plan', conf: 0.96, label: 'ground', no: 1, storeyConf: 0.94, questions: [] },
  { kind: 'plan', conf: 0.9, label: 'floor', no: 2, storeyConf: 0.82, questions: [{ code: 'STOREY_UNSURE' }] },
  { kind: 'plan', conf: 0.66, label: 'floor', no: 3, storeyConf: 0.55, questions: [{ code: 'STOREY_UNSURE' }, { code: 'NO_TEXT' }] },
  { kind: 'section', conf: 0.92, questions: [] },
  { kind: 'elevation', conf: 0.88, questions: [] },
  { kind: 'other', conf: 0.4, questions: [{ code: 'NOT_A_PLAN' }] },
] as const;

/** Khung tên chung mà máy "đọc" ra khi bộ đã tới bước duyệt (thiếu `date`, để thấy trường vắng). */
const MOCK_TITLE_BLOCK = { owner: 'Anh Nguyễn Văn An', project: 'Nhà phố Nguyễn Văn An', location: 'Quận 7, TP. Hồ Chí Minh' } as const;

function synthesizeViews(set: MockSet): DrawingSetView[] {
  const noSection = set.files.some((file) => file.fileName.includes('thieu-mat-cat'));
  const views: DrawingSetView[] = [];
  let global = 0;

  for (const file of set.files) {
    if (file.status === 'rejected') continue;
    for (let page = 0; page < pagesOf(file); page += 1) {
      const pattern = PAGE_PATTERN[global % PAGE_PATTERN.length] ?? PAGE_PATTERN[0];
      const kind = noSection && pattern.kind === 'section' ? 'elevation' : pattern.kind;

      global += 1;
      views.push({
        id: mockId('dwv', sequence * 1000 + global),
        fileId: file.id,
        pageIndex: page,
        crop: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 },
        source: 'ai',
        excluded: false,
        kind,
        kindConfidence: pattern.conf,
        ...('label' in pattern ? { storeyLabel: pattern.label, storeyNo: pattern.no, storeyConfidence: pattern.storeyConf } : {}),
        ...(kind === 'section' ? { titleText: 'Mặt cắt A-A' } : {}),
        ...(kind === 'other' ? {} : { sheetNo: `KT-${String(global).padStart(2, '0')}` }),
        questions: pattern.questions.map((question) => ({ ...question })),
      });
    }
  }

  return views;
}

/** Tệp như trên dây: bỏ phần riêng của mô phỏng (các khúc đã nhận, loại tệp). */
const wireFile = (file: MockFile): DrawingSetFile => ({
  id: file.id,
  fileName: file.fileName,
  sizeBytes: file.sizeBytes,
  chunkCount: file.chunkCount,
  status: file.status,
  ...(file.rejectedCode !== undefined ? { rejectedCode: file.rejectedCode } : {}),
  ...(file.pageCount !== undefined ? { pageCount: file.pageCount } : {}),
});

function viewOf(set: MockSet): DrawingSet {
  const progress =
    set.status === 'receiving' ? 0 : set.status === 'analyzing' ? Math.min(90, 30 + set.reads * 30) : 100;

  return {
    id: set.id,
    status: set.status,
    revision: set.revision,
    progressPercent: progress,
    ...(set.name !== undefined ? { name: set.name } : {}),
    ...(set.errorCode !== undefined ? { errorCode: set.errorCode } : {}),
    createdAt: set.createdAt,
    ...(set.confirmedAt !== undefined ? { confirmedAt: set.confirmedAt } : {}),
    ...(set.status === 'review' || set.status === 'confirmed' ? { titleBlock: { ...MOCK_TITLE_BLOCK } } : {}),
    files: set.files.map(wireFile),
    views: clone(set.views),
  };
}

export function createMockDrawingSetClient(options: MockDrawingSetOptions = {}): DrawingSetClient {
  const enabled = options.enabled ?? true;
  const occupied = new Set(options.occupiedFloorIds ?? []);
  const analyzeReads = options.analyzeReads ?? 2;
  const find = (projectId: string, setId: string): MockSet | undefined => {
    const set = sets.get(setId);

    return set !== undefined && set.projectId === projectId && !set.deleted ? set : undefined;
  };
  const off = (): Reply<never> | null => (enabled ? null : wireError(503, DRAWING_SET_ERROR_CODES.disabled));
  const notFound = (): Reply<never> => wireError(404, 'NOT_FOUND', { resource: 'drawing_set' });

  return {
    createSet: async ({ body, projectId }) => {
      const blocked = off();

      if (blocked !== null) return blocked;
      if (body.files.length < 1 || body.files.length > DRAWING_SET_LIMITS.maxFiles) {
        return wireError(422, 'VALIDATION', { field: 'files' });
      }
      if (body.files.some((file) => file.fileName.toLowerCase().endsWith('.dwg'))) {
        return wireError(422, 'CAD_NOT_SUPPORTED');
      }
      if (body.files.reduce((sum, file) => sum + file.sizeBytes, 0) > DRAWING_SET_LIMITS.maxBytes) {
        return wireError(422, 'VALIDATION', { field: 'files' });
      }
      sequence += 1;
      const id = mockId('dws', sequence);
      const set: MockSet = {
        id,
        projectId,
        ...(body.name !== undefined ? { name: body.name } : {}),
        status: 'receiving',
        revision: 0,
        createdAt: isoNow(),
        files: body.files.map((file, index) => ({
          id: mockId('dwf', sequence * 100 + index),
          fileName: file.fileName,
          sizeBytes: file.sizeBytes,
          chunkCount: countUploadChunks(file.sizeBytes),
          status: 'receiving',
          chunks: new Set<number>(),
          kind: file.mimeType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
        })),
        views: [],
        reads: 0,
        deleted: false,
      };

      sets.set(id, set);

      return { ok: true, data: viewOf(set) };
    },

    sendChunk: async ({ chunkIndex, fileId, projectId, setId }) => {
      const blocked = off();

      if (blocked !== null) return blocked;
      const set = find(projectId, setId);

      if (set === undefined) return notFound();
      if (set.status !== 'receiving') return wireError(409, DRAWING_SET_ERROR_CODES.notReceiving);
      const file = set.files.find((item) => item.id === fileId);

      if (file === undefined) return notFound();
      file.chunks.add(chunkIndex);
      return { ok: true, data: wireFile(file) };
    },

    complete: async ({ projectId, setId }) => {
      const blocked = off();

      if (blocked !== null) return blocked;
      const set = find(projectId, setId);

      if (set === undefined) return notFound();
      if (set.status === 'receiving') {
        set.files = set.files.map((file) =>
          file.fileName.includes('hong')
            ? { ...file, status: 'rejected' as const, rejectedCode: 'FILE_CORRUPT' }
            : { ...file, status: 'complete' as const, pageCount: pagesOf(file) },
        );
        if (set.files.every((file) => file.status === 'rejected')) {
          set.status = 'failed';
          set.errorCode = 'DRAWING_SET_ALL_FILES_REJECTED';
        } else {
          set.status = 'analyzing';
        }
      }

      return { ok: true, data: viewOf(set) };
    },

    read: async ({ projectId, setId }) => {
      const set = find(projectId, setId);

      if (set === undefined) return notFound();
      if (set.status === 'analyzing') {
        set.reads += 1;
        if (set.reads >= analyzeReads) {
          set.views = synthesizeViews(set);
          set.status = 'review';
        }
      }

      return { ok: true, data: viewOf(set) };
    },

    list: async ({ projectId }) => {
      const items: DrawingSetSummary[] = [...sets.values()]
        .filter((set) => set.projectId === projectId && !set.deleted)
        .reverse()
        .slice(0, 20)
        .map((set) => ({
          id: set.id,
          status: set.status,
          ...(set.name !== undefined ? { name: set.name } : {}),
          createdAt: set.createdAt,
          ...(set.confirmedAt !== undefined ? { confirmedAt: set.confirmedAt } : {}),
          fileCount: set.files.length,
          viewCount: set.views.length,
        }));

      return { ok: true, data: { items } };
    },

    replaceViews: async ({ baseVersion, name, projectId, setId, views }) => {
      const blocked = off();

      if (blocked !== null) return blocked;
      const set = find(projectId, setId);

      if (set === undefined) return notFound();
      if (set.status === 'confirmed') return wireError(409, DRAWING_SET_ERROR_CODES.confirmed);
      if (set.status !== 'review') return wireError(409, DRAWING_SET_ERROR_CODES.notReady);
      if (baseVersion !== set.revision) return wireError(409, 'VERSION_CONFLICT');
      if (views.length > DRAWING_SET_LIMITS.maxViews) return wireError(422, 'VALIDATION', { field: 'body.views' });
      if (name !== undefined && (name.trim().length === 0 || name.length > DRAWING_SET_NAME_MAX)) {
        return wireError(422, 'VALIDATION', { field: 'body.name' });
      }
      const byId = new Map(set.views.map((view) => [view.id, view]));
      const next: DrawingSetView[] = [];

      for (const edit of views as readonly ViewEdit[]) {
        const { id: editId, ...rest } = edit;
        const original = editId === undefined ? undefined : byId.get(editId);

        if (original === undefined && editId !== undefined) continue;
        next.push({
          ...(original ?? { id: mockId('dwv', ++sequence), source: 'user' as const, kindConfidence: 1, questions: [] }),
          ...rest,
        });
      }
      // Hình máy không bao giờ mất: vắng khỏi danh sách thì thành `excluded`.
      for (const view of set.views) {
        if (view.source === 'ai' && !next.some((item) => item.id === view.id)) next.push({ ...view, excluded: true });
      }
      set.views = next;
      if (name !== undefined) set.name = name.trim();
      set.revision += 1;

      return { ok: true, data: viewOf(set) };
    },

    confirm: async ({ projectId, revision, setId }) => {
      const blocked = off();

      if (blocked !== null) return blocked;
      const set = find(projectId, setId);

      if (set === undefined) return notFound();
      if (set.status === 'confirmed') return { ok: true, data: viewOf(set) };
      if (set.status !== 'review') return wireError(409, DRAWING_SET_ERROR_CODES.notReady);
      if (revision !== set.revision) return wireError(409, DRAWING_SET_ERROR_CODES.revisionStale);
      const plans = set.views.filter((view) => !view.excluded && view.kind === 'plan');

      if (!plans.some((view) => view.target !== undefined)) return wireError(422, DRAWING_SET_ERROR_CODES.noPlan);
      const floorIds = new Set<string>();

      for (const [index, view] of plans.entries()) {
        if (view.target === undefined || view.target.mode === 'section' || floorIds.has(view.target.floorId)) {
          return wireError(422, 'VALIDATION', { field: `views[${String(index)}].target` });
        }
        floorIds.add(view.target.floorId);
        if (view.target.mode === 'floor' && occupied.has(view.target.floorId) && view.target.replace !== true) {
          return wireError(409, DRAWING_SET_ERROR_CODES.floorHasDrawing);
        }
      }
      set.views = set.views.map((view, index) =>
        view.excluded || view.target === undefined || view.target.mode === 'section' ? view : { ...view, uploadId: mockId('upl', 10 + index) },
      );
      set.status = 'confirmed';
      set.confirmedAt = isoNow();
      set.revision += 1;

      return { ok: true, data: viewOf(set) };
    },

    remove: async ({ projectId, setId }) => {
      const set = sets.get(setId);

      if (set === undefined || set.projectId !== projectId) return notFound();
      set.deleted = true;

      return { ok: true, data: viewOf(set) };
    },
  };
}
