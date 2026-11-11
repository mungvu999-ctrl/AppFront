import type { LibraryApi } from '@/api/client';
import type { DesignAddition, DesignResult } from '@/api/schemas/designConcept';

import { getSessionSnapshot } from '@/lib/auth/state';

import { CATALOG_MODELS, clearServerLibrary, modelSrcOf, registerServerLibrary, serverModelIdOfUrl } from './furnitureCatalog';

import {
  absenceOf,
  BUNDLED_LIBRARY_VERSION,
  LIBRARY_FALLBACK_NOTICE,
  libraryReadFailed,
  loadServerLibrary,
  type LibraryLoad,
} from './serverLibrary';
import type { PascalScene } from './types';

/**
 * Điểm vào CHUNG của thư viện mẫu/vật liệu cho mọi viewer (editor `/3d/pascal`, lịch sử phiên bản, viewer di động).
 * Một lượt đọc mỗi phiên trang (promise dùng chung, không đua đồng hồ): mọi viewer dựng cảnh trên CÙNG danh mục,
 * cùng `version`, cùng fallback. `notice` = câu báo tiếng Việt khi lượt đọc hỏng (5xx/mạng/hết giờ); 403/404/trống
 * là dự phòng im lặng (`serverLibrary.ts`).
 */
export interface SceneLibrary extends LibraryLoad {
  readonly notice: string | null;
}

/** Trả client thư viện khi có phiên, `null` khi chưa có phiên. */
export type LibraryApiSource = () => Promise<Pick<LibraryApi, 'list'> | null>;

const defaultApi: LibraryApiSource = async () => {
  const [{ createAppApiClient }, { startAppSession }] = await Promise.all([
    import('@/api/appClient'),
    import('@/routes/sessionSetup'),
  ]);
  // Token chỉ ở bộ nhớ: gọi trước khi mở phiên là 401 (e2e fullstack bước 11). `startAppSession` nhớ lượt khởi động —
  // kể cả `false` của lượt chưa đăng nhập — nên đăng nhập sau đó trong cùng thẻ chỉ thấy được qua trạng thái phiên thật.
  await startAppSession().catch(() => false);
  return getSessionSnapshot().status === 'authenticated' ? createAppApiClient().library : null;
};

const withNotice = (load: LibraryLoad): SceneLibrary => ({
  ...load,
  notice: libraryReadFailed(load.source) ? LIBRARY_FALLBACK_NOTICE : null,
});

let shared: Promise<SceneLibrary> | null = null;
let settled: SceneLibrary | null = null;
/** Người dùng của lượt đọc đã chốt (`null` = chưa có phiên). */
let settledOwner: string | null = null;
/** Lúc lượt đọc chốt (ms) — URL ký MinIO hết hạn ~2 giờ. */
let settledAt = 0;
/** Tăng mỗi lần quên lượt đọc (đổi người/đổi phiên): lượt gia hạn bắt đầu ở thế hệ cũ bị bỏ. */
let generation = 0;

const currentOwner = (): string | null => getSessionSnapshot().user?.id ?? null;

/** Quên lượt đọc + gỡ mẫu máy chủ đã gộp (mẫu riêng, URL ký của người trước). */
const forget = (): void => {
  shared = null;
  settled = null;
  generation += 1;
  refreshing = null;
  assetAttempts.clear();
  sameUrlRetried.clear();
  inflight.clear();
  // Câu báo mẫu hỏng là của người/phiên trước: đổi người thì không còn treo.
  if (assetLog.failures.length > 0) {
    assetLog.failures.length = 0;
    notify();
  }
  clearServerLibrary();
};

/**
 * Nạp thư viện máy chủ một lần cho mỗi người dùng trong phiên trang; lượt gọi sau (viewer khác, đổi dự án) nhận lại
 * đúng promise ấy. Không bao giờ ném.
 * - Chưa có phiên (`fallback:no-session`) không được nhớ: đăng nhập trong cùng thẻ thì lượt sau đọc lại.
 * - Đổi người dùng (đăng xuất → người khác, phiên đã rõ) → quên kết quả cũ, gỡ mẫu máy chủ của người trước, đọc lại.
 * - Lỗi đọc (5xx/mạng/hết giờ) giữ dự phòng tới khi tải lại trang hoặc đổi người — mọi viewer trong thẻ cùng trạng thái
 *   ấy, khớp câu báo "Tải lại trang để thử lại" (editor là trang riêng nên tự đọc lượt của nó).
 */
export function ensureSceneLibrary(getApi: LibraryApiSource = defaultApi): Promise<SceneLibrary> {
  void installAssetRefresh();
  const session = getSessionSnapshot();
  /** Thư viện máy chủ đã chốt nhưng URL quá tuổi: GIỮ nó (không gỡ `SERVER_FILES`) tới khi lượt đọc lại thành công. */
  let keep: SceneLibrary | null = null;
  if (settled !== null && session.status !== 'unknown' && currentOwner() !== settledOwner) forget();
  // URL ký đã quá tuổi: cảnh dựng mới (đổi dự án/phiên bản) lấy URL mới thay vì URL sắp/đã hết hạn.
  else if (settled?.source === 'server' && Date.now() - settledAt > SIGNED_URL_MAX_AGE_MS) {
    keep = settled;
    shared = null;
  }
  if (shared !== null) return shared;
  const mine = getApi()
    .then((api) =>
      api === null
        ? { count: 0, source: 'fallback:no-session' as const, version: BUNDLED_LIBRARY_VERSION }
        : loadServerLibrary(api),
    )
    .catch((): LibraryLoad => ({ count: 0, source: 'fallback:threw', version: BUNDLED_LIBRARY_VERSION }))
    .then((load) => {
      // Đọc lại vì quá tuổi mà hỏng: giữ thư viện cũ (URL cũ vẫn gia hạn được từng mẫu), lượt dựng sau thử lại.
      // Danh sách rỗng/403/404 là câu trả lời HỢP LỆ (không phải lỗi mạng): nhận nó và gỡ thư viện cũ.
      const result = keep !== null && libraryReadFailed(load.source) ? keep : withNotice(load);
      if (keep !== null && result !== keep && shared === mine) {
        if (load.source !== 'server') clearServerLibrary();
        // Lượt đọc mới thành công: trần lượt gia hạn từng mẫu tính lại từ đầu.
        assetAttempts.clear();
        sameUrlRetried.clear();
      }
      if (shared === mine) {
        settled = result;
        settledOwner = currentOwner();
        if (result !== keep) settledAt = Date.now();
        if (load.source === 'fallback:no-session' || result === keep) shared = null;
      }
      return result;
    });
  shared = mine;
  return mine;
}

/** Thư viện đã chốt của phiên (đầu dò, chẩn đoán); `null` khi lượt đọc chưa xong. */
export const sceneLibraryNow = (): SceneLibrary | null => settled;

/** Chỉ cho test: quên lượt đọc của phiên. */
export const resetSceneLibraryForTests = (): void => {
  forget();
  settledOwner = null;
  assetLog.refreshed = 0;
  assetLog.retriedSame = 0;
  assetLog.dropped = 0;
  assetLog.failures.length = 0;
};

/* -------------------------------------------------------------------------- */
/* Gia hạn URL ký của mẫu thư viện (MinIO, hạn ~2 giờ)                         */
/* -------------------------------------------------------------------------- */

/** Coi URL ký là quá tuổi sau 100 phút (hạn máy chủ ~120 phút): lượt `ensureSceneLibrary` sau đó đọc lại. */
export const SIGNED_URL_MAX_AGE_MS = 100 * 60_000;
/** Mỗi mẫu gia hạn tối đa 2 lần trong một lượt đọc thư viện, chờ lùi dần trước mỗi lần. */
export const ASSET_REFRESH_BACKOFF_MS: readonly number[] = [400, 2_000];
/** Câu báo khi một mẫu không tải lại được sau khi gia hạn: món ấy hiện hình thay thế, các món khác không đổi. */
export const ASSET_EXPIRED_NOTICE =
  'Một số mẫu nội thất hết hạn truy cập và không tải lại được, đang hiện hình thay thế. Tải lại trang để thử lại.';

export type AssetRefreshFailure = 'no-session' | 'no-permission' | 'failed' | 'exhausted' | 'stale' | 'unchanged';

interface AssetFailure {
  readonly modelId: string;
  readonly reason: AssetRefreshFailure;
}

/** Số liệu gia hạn (đề nghị nối `__pascalProbe.assetRefresh()` vào `assetRefreshStatus`). */
const assetLog: { refreshed: number; retriedSame: number; dropped: number; readonly failures: AssetFailure[] } = {
  refreshed: 0,
  retriedSame: 0,
  dropped: 0,
  failures: [],
};
const assetAttempts = new Map<string, number>();
/** Mẫu đã dùng lượt "thử lại đúng URL cũ" (máy chủ ký theo mốc giờ tròn: đọc lại cùng mốc trả URL y hệt). */
const sameUrlRetried = new Set<string>();
/** Gia hạn đang chạy theo mẫu: nhiều lời gọi cùng mẫu (FileLoader gọi onError của TỪNG người gọi) dùng chung một lượt. */
const inflight = new Map<string, Promise<string | null>>();
let refreshing: Promise<AssetRefreshFailure | null> | null = null;
/** Id mẫu có trong lượt đọc lại gần nhất (mẫu vắng = người dùng đã mất quyền với nó). */
let refreshedIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export interface AssetRefreshStatus {
  /** Lượt thử lại bằng URL ký MỚI. */
  readonly refreshed: number;
  /** Lượt thử lại đúng URL cũ (đọc lại thư viện trả URL y hệt). */
  readonly retriedSame: number;
  /** Lượt gia hạn bị bỏ vì phiên/người đã đổi (`stale`) — có chủ ý, KHÔNG tính là lỗi mẫu, không vào `failures`. */
  readonly dropped: number;
  readonly failures: readonly AssetFailure[];
  /** `ASSET_EXPIRED_NOTICE` khi có mẫu hỏng hẳn. */
  readonly notice: string | null;
}

export const assetRefreshStatus = (): AssetRefreshStatus => ({
  refreshed: assetLog.refreshed,
  retriedSame: assetLog.retriedSame,
  dropped: assetLog.dropped,
  failures: [...assetLog.failures],
  notice: assetLog.failures.length > 0 ? ASSET_EXPIRED_NOTICE : null,
});

/** Nghe thay đổi `assetRefreshStatus` (viewer hiện câu báo); trả hàm gỡ. */
export const subscribeAssetRefresh = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => listeners.forEach((l) => l());

const fail = (modelId: string, reason: AssetRefreshFailure): null => {
  // `stale` không phải lỗi mẫu: không vào danh sách, không báo người nghe (câu báo đã đóng không hiện lại).
  if (reason === 'stale') {
    assetLog.dropped += 1;
    return null;
  }
  assetLog.failures.push({ modelId, reason });
  notify();
  return null;
};

/** Một lượt đọc lại thư viện dùng chung cho mọi mẫu hết hạn cùng lúc; chỉ gộp khi vẫn đúng người + thế hệ. */
const refreshLibrary = (getApi: LibraryApiSource): Promise<AssetRefreshFailure | null> => {
  if (refreshing !== null) return refreshing;
  const gen = generation;
  const owner = currentOwner();
  const isStale = (): boolean => gen !== generation || currentOwner() !== owner;
  const mine = (async (): Promise<AssetRefreshFailure | null> => {
    const api = await getApi().catch(() => null);
    if (isStale()) return 'stale';
    if (api === null) return 'no-session';
    const result = await api.list().catch(() => null);
    if (isStale()) return 'stale';
    if (result === null) return 'failed';
    if (!result.ok) return absenceOf(result.error) === undefined ? 'failed' : 'no-permission';
    registerServerLibrary(result.data);
    refreshedIds = new Set(result.data.map((i) => i.id));
    settledAt = Date.now();
    return null;
  })().finally(() => {
    if (refreshing === mine) refreshing = null;
  });
  refreshing = mine;
  return mine;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mẫu thư viện tải hỏng vì URL ký hết hạn (401/403): đọc lại thư viện theo QUYỀN của người đang đăng nhập, trả URL ký
 * mới để thử lại; `null` = không thử lại (không phải mẫu thư viện, lỗi khác, hết quyền, hết lượt, request cũ đã đổi
 * phiên/người). Mỗi mẫu tối đa `ASSET_REFRESH_BACKOFF_MS.length` lần mỗi lượt đọc thư viện. Không ném.
 */
export function refreshAssetUrl(
  url: string,
  status: number,
  getApi: LibraryApiSource = defaultApi,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string | null> {
  if (status !== 401 && status !== 403) return Promise.resolve(null);
  const modelId = serverModelIdOfUrl(url);
  if (modelId === undefined) return Promise.resolve(null);
  const running = inflight.get(modelId);
  if (running !== undefined) return running;
  const mine = refreshOnce(modelId, url, getApi, sleep).finally(() => {
    if (inflight.get(modelId) === mine) inflight.delete(modelId);
  });
  inflight.set(modelId, mine);
  return mine;
}

async function refreshOnce(
  modelId: string,
  url: string,
  getApi: LibraryApiSource,
  sleep: (ms: number) => Promise<void>,
): Promise<string | null> {
  // Phiên đã đổi người mà chưa qua `ensureSceneLibrary` (vd. đăng nhập người khác ở thẻ khác): không gộp thư viện
  // của người mới vào danh mục của người cũ.
  if (currentOwner() !== settledOwner) return fail(modelId, 'stale');
  const used = assetAttempts.get(modelId) ?? 0;
  const wait = ASSET_REFRESH_BACKOFF_MS[used];
  if (wait === undefined) return fail(modelId, 'exhausted');
  assetAttempts.set(modelId, used + 1);
  const gen = generation;
  await sleep(wait);
  if (gen !== generation) return fail(modelId, 'stale');
  const failure = await refreshLibrary(getApi);
  if (failure !== null) return fail(modelId, failure);
  // Lượt đọc mới không còn mẫu này = người dùng mất quyền với nó.
  if (!refreshedIds.has(modelId)) return fail(modelId, 'no-permission');
  const fresh = modelSrcOf(modelId);
  if (fresh === url) {
    // URL y hệt: thử lại ĐÚNG MỘT lần URL cũ (403 thoáng qua/proxy), vẫn trong trần lượt của mẫu; lần sau thì dừng.
    if (sameUrlRetried.has(modelId)) return fail(modelId, 'unchanged');
    sameUrlRetried.add(modelId);
    assetLog.retriedSame += 1;
    notify();
    return url;
  }
  assetLog.refreshed += 1;
  notify();
  return fresh;
}

type LoadFn = (
  url: string,
  onLoad?: (data: unknown) => void,
  onProgress?: (event: unknown) => void,
  onError?: (err: unknown) => void,
) => unknown;

/**
 * Một URL tải THÀNH CÔNG: mẫu ấy (nếu đã từng gia hạn) được tính lại trần lượt — phiên dài không báo `exhausted` mãi
 * cho mẫu đã tải lại được. Chỉ xoá khi tải được (không xoá khi chỉ nhận URL mới): mẫu 403 mãi vẫn dừng ở trần.
 */
export const assetLoadedOk = (url: string): void => {
  if (assetAttempts.size === 0) return;
  const modelId = serverModelIdOfUrl(url);
  if (modelId === undefined) return;
  assetAttempts.delete(modelId);
  sameUrlRetried.delete(modelId);
};

let installed: Promise<void> | null = null;
let restore: (() => void) | null = null;

/**
 * Nối gia hạn vào `FileLoader.load` của three: điểm tải GLB chung của mọi viewer (Pascal `useGLTF` → GLTFLoader →
 * FileLoader), không vá mã vendor. HTTP 401/403 của URL mẫu thư viện → `refreshAssetUrl` → tải lại bằng URL mới; lỗi
 * khác hoặc hết lượt → chuyển nguyên lỗi cho Pascal (hình thay thế) + `assetRefreshStatus().notice`.
 * Tắt: `?disable=assetrefresh`. Nạp `three` động để không kéo three vào chunk của màn không có 3D.
 */
export function installAssetRefresh(
  getApi: LibraryApiSource = defaultApi,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  if (installed !== null) return installed;
  const off = new URLSearchParams(globalThis.location?.search ?? '').getAll('disable').some((v) => v.split(',').includes('assetrefresh'));
  if (off) return Promise.resolve();
  installed = import('three')
    .then(({ FileLoader }) => {
      const proto = FileLoader.prototype as unknown as { load: LoadFn };
      const original = proto.load;
      restore = () => {
        proto.load = original;
      };
      proto.load = function patched(this: unknown, url, onLoad, onProgress, onError) {
        const loaded = (data: unknown): void => {
          assetLoadedOk(url);
          onLoad?.(data);
        };
        return original.call(this, url, loaded, onProgress, (err: unknown) => {
          const status = (err as { response?: { status?: number } } | null)?.response?.status;
          if (status === undefined) {
            onError?.(err);
            return;
          }
          void refreshAssetUrl(url, status, getApi, sleep).then((fresh) =>
            fresh === null ? onError?.(err) : patched.call(this, fresh, onLoad, onProgress, onError),
          );
        });
      };
    })
    .catch(() => {
      installed = null;
    });
  return installed;
}

/** Gỡ bản vá `FileLoader` (test; bản dựng không gọi). */
export const uninstallAssetRefreshForTests = (): void => {
  restore?.();
  restore = null;
  installed = null;
};

/** Một `modelId` không có trong danh mục (đóng gói + thư viện máy chủ đã gộp) và thứ dựng thay nó. */
export interface UnresolvedModel {
  readonly modelId: string;
  /** Node món (`item_…`), `concept:<vai trò>` hoặc `addition:<chỉ số>`. */
  readonly where: string;
  /**
   * `role`: mẫu theo vai trò như đồ tự bày (concept/đồ AI bổ sung — `designStyles.ts` lọc trước khi dựng).
   * `saved-src`: món lưu `model` lạ — cảnh giữ nguyên đường lưu, không khớp hộp bao (`toPascal.ts` `itemNodeOf`).
   */
  readonly substitute: 'role' | 'saved-src';
}

const SAVED_MODEL_SRC = /^\/items\/([a-z0-9_-]+)\/model\.glb$/;
const known = (id: string): boolean => Object.prototype.hasOwnProperty.call(CATALOG_MODELS, id);

/**
 * `modelId` thiếu trong thư viện ĐANG nạp (chẩn đoán, đầu dò): đọc cảnh đã dựng + concept, không ném, không đổi dữ liệu.
 * Cùng cảnh + cùng thư viện + cùng concept → cùng danh sách ở mọi viewer (thứ tự theo `where`).
 */
export function unresolvedModelIds(
  scene: PascalScene,
  concept?: { readonly models?: DesignResult['models']; readonly additions?: readonly DesignAddition[] },
): UnresolvedModel[] {
  const out: UnresolvedModel[] = [];
  for (const node of Object.values(scene.nodes)) {
    const src = (node as { type?: string; asset?: { src?: string } }).type === 'item' ? (node as { asset?: { src?: string } }).asset?.src : undefined;
    const folder = src === undefined ? undefined : SAVED_MODEL_SRC.exec(src)?.[1];
    if (folder !== undefined && !known(folder)) out.push({ modelId: folder, where: node.id, substitute: 'saved-src' });
  }
  for (const [role, id] of Object.entries(concept?.models ?? {})) {
    if (!known(id)) out.push({ modelId: id, where: `concept:${role}`, substitute: 'role' });
  }
  (concept?.additions ?? []).forEach((addition, i) => {
    if (addition.modelId != null && !known(addition.modelId)) out.push({ modelId: addition.modelId, where: `addition:${i}`, substitute: 'role' });
  });
  return out.sort((a, b) => (a.where < b.where ? -1 : a.where > b.where ? 1 : 0));
}
