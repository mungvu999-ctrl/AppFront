/**
 * Thẻ "Đổi mẫu" của trang 3D: chọn đúng MỘT món đồ thì đổi được mô hình của nó sang mẫu khác
 * cùng vai. Inspector của Pascal chỉ có Dời/Nhân bản/Xoá nên thiếu lối này.
 *
 * Ứng viên (M18 LA): mẫu THƯ VIỆN HIỆN HÀNH cùng vai với món (`swapPoolOf` — đúng tập bộ chọn roomSet thấy, trừ QC loại và
 * vân vỡ); vai = vai bộ chọn đã dùng trong lượt dựng (`roomSetRoleOf`), không có thì vai theo hộp (`roleOf`). `SWAP_GROUPS`
 * (id catalog đóng gói) chỉ còn là đường lùi khi thư viện máy chủ lỗi/offline.
 *
 * Đổi = `useScene.updateNode(id, { asset, … })` — cùng lối inspector dùng, nên lịch sử (Ctrl+Z) của Pascal ghi lại và bộ tự
 * lưu → cầu `onSave` → PUT chạy. Mẫu mới khớp bằng ĐÚNG phép dựng cảnh (`itemFitOf`) và node mang cờ `USER_SEEN_FIELD`:
 * lượt về lưu cỡ đang thấy, lượt dựng sau khớp đúng hộp — cỡ lúc đổi = cỡ sau tải lại.
 *
 * Không nhập `@pascal-app/*` (vitest không nạp được gói chưa dựng): `main.tsx` truyền store và
 * `CATALOG_ITEMS` thật vào, như `createProbe`.
 */
/* eslint-disable react-refresh/only-export-components -- hàm thuần đi kèm thẻ để test gọi thẳng. */
import { ChevronDown } from 'lucide-react';
import { useRef } from 'react';

import type { Furniture } from '@/domain/spatial/types';
import {
  CATALOG_MODELS,
  canonicalModelId,
  isServerModel,
  modelSrcOf,
  namedFolderOf,
  serverModelIdOfUrl,
  thumbnailOf,
} from '@/lib/pascal/furnitureCatalog';
import { bodyOfPascalId } from '@/lib/pascal/ids';
import { itemFitOf, REAL_FIT_FIELD } from '@/lib/pascal/itemFit';
import { roleOf, roomSetRoleOf, swapPoolOf } from '@/lib/pascal/sceneVariety';
import { USER_SEEN_FIELD } from '@/lib/pascal/toSpatial';

import { useMenuGroup } from './menuGroup';

type Vec3 = readonly [number, number, number];

/** Phần `asset` của item Pascal mà thẻ đọc/ghi (kiểu lỏng, xem `@pascal-app/core` `ItemNode`). */
export interface SwapAsset {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly thumbnail: string;
  readonly src: string;
  readonly dimensions?: Vec3;
  readonly offset?: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: Vec3;
  readonly surface?: { readonly height: number };
  readonly [key: string]: unknown;
}

/** Một ô catalog (`CATALOG_ITEMS` đã viết lại về `/items/<thư mục>/…` lúc dựng, hoặc ô thư viện máy chủ). */
export type SwapCatalogItem = Pick<SwapAsset, 'id' | 'name' | 'thumbnail' | 'src' | 'dimensions' | 'offset' | 'rotation' | 'scale'>;

/** Node Pascal (kiểu lỏng): thẻ đọc hộp, siêu dữ liệu AppFront, tầng cha (chiều cao trần). */
export interface SwapNode {
  readonly id: string;
  readonly type: string;
  readonly parentId?: string | null;
  readonly asset?: SwapAsset;
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: Vec3;
  /** Tầng: chiều cao tầng (m). */
  readonly height?: number;
  readonly metadata?: {
    readonly appfront?: { readonly fields?: Readonly<Record<string, unknown>>; readonly [key: string]: unknown };
    readonly [key: string]: unknown;
  };
}

export interface SwapModelStores {
  readonly useViewer: <T>(selector: (state: { selection: { selectedIds: readonly string[] } }) => T) => T;
  readonly useScene: {
    <T>(selector: (state: { nodes: object }) => T): T;
    getState(): { nodes: object; updateNode(id: string, data: object): void };
  };
}

/**
 * ĐƯỜNG LÙI (thư viện máy chủ lỗi/offline): nhóm đổi qua lại được theo id catalog đóng gói. Cùng nhóm phải cùng kiểu đặt
 * (sàn / tường), không thì món đồ treo lơ lửng. Mẫu nào không có trong catalog cục bộ tự rơi.
 */
export const SWAP_GROUPS: readonly (readonly string[])[] = [
  ['sofa', 'livingroom-chair', 'lounge-chair', 'sunbed'],
  ['dining-chair', 'office-chair', 'herman-miller-aeron-mo8x36k9', 'stool'],
  ['double-bed', 'single-bed', 'bunkbed'],
  ['dining-table', 'dining-table-mo9ms5yh', 'coffee-table', 'office-table', 'standing-desk-mo8wgz95'],
  ['closet', 'dresser', 'bookshelf', 'ikea-kallax-1x4-moa2y49n', 'tv-stand', 'bedside-table'],
  ['kitchen', 'kitchen-cabinet', 'kitchen-counter', 'wooden-kitchen-bar-moa2hhh4'],
  ['floor-lamp', 'table-lamp'],
  ['indoor-plant', 'small-indoor-plant', 'cactus'],
  ['bush', 'fir-tree', 'palm', 'tree'],
  ['rectangular-carpet', 'round-carpet'],
  ['picture', 'round-mirror'],
  ['shower-square', 'shower-angle'],
];

/** Số mẫu tối đa trong danh sách (vai sofa có hơn 100 mẫu). */
export const MAX_SWAP_OPTIONS = 24;
/** Trần mặc định khi tầng cha không ghi chiều cao (mm): chỉ dùng để chặn cao món chưa có `heightMm`. */
const DEFAULT_LEVEL_HEIGHT_MM = 2700;

/**
 * Thư mục mẫu theo tên catalog. L3a-02: khi bật mẫu thật, giường/tủ áo/bồn cầu… dựng từ `/items/bed-sf/…`
 * — thư mục không có trong catalog nên trước đây không tìm ra nhóm và nút "Đổi mẫu" không hiện.
 */
const folderOf = (src: string): string | undefined => {
  const file = /^\/items\/([^/]+)\//.exec(src)?.[1];
  return file === undefined ? undefined : namedFolderOf(file);
};
/** Thư mục `CATALOG_MODELS` của ô — đúng thư mục lượt dựng lại tìm ra từ `model.src` đã lưu. */
const fitFolderOf = (item: SwapCatalogItem): string | undefined => (isServerModel(item.id) ? item.id : folderOf(item.src));
const fieldsOf = (node: SwapNode): Readonly<Record<string, unknown>> => node.metadata?.appfront?.fields ?? {};
const numberOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const dimsOf = (id: string): Vec3 => (CATALOG_MODELS[id] as { readonly dimensions: Vec3 }).dimensions;

/** Mẫu đang dùng của món: id máy chủ theo URL ký (chữ ký đổi mỗi lượt), không thì id chuẩn của `asset.id`. */
const currentModelIdOf = (asset: SwapAsset): string => serverModelIdOfUrl(asset.src) ?? canonicalModelId(asset.id);

/** Vai của món: vai bộ chọn đã dùng trong lượt dựng, không có thì vai theo loại/hộp (cùng cặp toPascal dùng cho itemFitOf). */
const roleOfNode = (node: SwapNode): string | undefined => {
  const set = roomSetRoleOf(bodyOfPascalId(node.id));
  if (set !== undefined) return set;
  const f = fieldsOf(node);
  const heightMm = numberOf(f['heightMm']);
  if (typeof f['kind'] !== 'string' || typeof f['boundingBox'] !== 'object' || f['boundingBox'] === null) return undefined;
  return roleOf({
    kind: f['kind'],
    boundingBox: f['boundingBox'],
    rotationDeg: numberOf(f['rotationDeg']) ?? 0,
    ...(typeof f['variant'] === 'string' ? { variant: f['variant'] } : {}),
    ...(heightMm === undefined ? {} : { heightMm }),
  } as Pick<Furniture, 'kind' | 'variant' | 'boundingBox' | 'rotationDeg' | 'heightMm'>);
};

/** Ảnh xem trước của mẫu máy chủ; '' = mẫu không có ảnh (ô giữ chỗ, không `<img src="">`). */
const previewOf = (id: string): string => {
  const url = thumbnailOf(id);
  return url.startsWith('/items/') ? '' : url;
};

/** Ứng viên từ thư viện hiện hành: mẫu đang dùng (nếu thuộc vai) đứng đầu, còn lại theo chi phí cỡ so với hộp, ≤ 24. */
const serverCandidates = (node: SwapNode, asset: SwapAsset, catalog: readonly SwapCatalogItem[]): SwapCatalogItem[] => {
  const role = roleOfNode(node);
  if (role === undefined) return [];
  const variant = fieldsOf(node)['variant'];
  const pool = swapPoolOf(role, typeof variant === 'string' ? variant : undefined).filter((id) => CATALOG_MODELS[id] !== undefined);
  const current = currentModelIdOf(asset);
  const [w = 1, , d = 1] = asset.dimensions ?? [];
  const costOf = (id: string): number => Math.abs(Math.log(w / dimsOf(id)[0])) + Math.abs(Math.log(d / dimsOf(id)[2]));
  const others = pool.filter((id) => id !== current).sort((a, b) => costOf(a) - costOf(b) || a.localeCompare(b));
  if (others.length === 0) return [];
  const names = new Map(catalog.map((item) => [item.id, item.name] as const));
  return [...(pool.includes(current) ? [current] : []), ...others].slice(0, MAX_SWAP_OPTIONS).map((id) => ({
    id,
    name: names.get(id) ?? id,
    thumbnail: previewOf(id),
    src: modelSrcOf(id),
    dimensions: dimsOf(id),
  }));
};

/** Đường lùi `SWAP_GROUPS`: mẫu cùng nhóm với món (kể cả mẫu đang dùng), theo thứ tự nhóm. */
const groupCandidates = (asset: SwapAsset, catalog: readonly SwapCatalogItem[]): SwapCatalogItem[] => {
  const folder = folderOf(asset.src);
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const group = SWAP_GROUPS.find((ids) => ids.some((id) => id === asset.id || (folder !== undefined && folderOf(byId.get(id)?.src ?? '') === folder)));
  return (group ?? []).flatMap((id) => byId.get(id) ?? []);
};

/** Mẫu đổi được của món; [] nếu không có mẫu nào khác (thẻ ẩn). Mẫu không khớp được (ngoài catalog) bị bỏ. */
export const swapCandidates = (node: SwapNode, catalog: readonly SwapCatalogItem[]): SwapCatalogItem[] => {
  const asset = node.asset;
  if (asset === undefined) return [];
  const server = serverCandidates(node, asset, catalog);
  if (server.length > 0) return server;
  const found = groupCandidates(asset, catalog).filter((item) => {
    const folder = fitFolderOf(item);
    return folder !== undefined && CATALOG_MODELS[folder] !== undefined;
  });
  return found.length < 2 ? [] : found;
};

/** Ô là mẫu đang dùng: mẫu máy chủ so theo id (URL ký khác nhau mỗi lượt), mẫu đóng gói so theo thư mục. */
export const isCurrentModel = (asset: SwapAsset, item: SwapCatalogItem): boolean => {
  if (serverModelIdOfUrl(asset.src) !== undefined || isServerModel(item.id)) return currentModelIdOf(asset) === item.id;
  const folder = folderOf(asset.src);
  return folder !== undefined && folder === folderOf(item.src);
};

/**
 * Bản cập nhật node khi đổi sang `item` (null = mẫu không khớp được): khớp mẫu mới vào hộp của món (`asset.dimensions`,
 * khung tâm `position`) bằng đúng `itemFitOf` lượt dựng dùng — cùng `heightMm`, trần tầng, và CỠ THẬT nếu món đang dựng
 * cỡ thật (`REAL_FIT_FIELD`). `asset.dimensions` = cỡ hiển thị; độ áp lưng (`backShiftM`) chuyển vào `position` để tâm
 * node = tâm nhìn thấy (lượt về lưu tâm ấy, lượt dựng sau khớp đúng hộp không áp lưng lần nữa). `node.scale` giữ nguyên.
 */
export const swapUpdateOf = (node: SwapNode, item: SwapCatalogItem, levelHeightMm = DEFAULT_LEVEL_HEIGHT_MM): object | null => {
  const asset = node.asset;
  const folder = fitFolderOf(item);
  if (asset === undefined || folder === undefined) return null;
  const fields = fieldsOf(node);
  const real = typeof fields[REAL_FIT_FIELD] === 'object' && fields[REAL_FIT_FIELD] !== null;
  const [w = 1, , d = 1] = asset.dimensions ?? [];
  const fit = itemFitOf(folder, w, d, numberOf(fields['heightMm']), levelHeightMm, false, real ? 'real' : false, real ? roleOfNode(node) : undefined);
  if (fit === null) return null;
  const [ox, oy, oz] = fit.offset;
  const back = fit.backShiftM * (node.scale?.[2] ?? 1);
  const [px, py, pz] = node.position ?? [0, 0, 0];
  const yaw = node.rotation?.[1] ?? 0;
  // `surface` cũ thuộc mẫu cũ (độ cao mặt đặt đồ) — bỏ đi chứ không mang sang mẫu khác.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tách `surface` ra để bỏ.
  const { surface: _surface, ...rest } = asset;
  const appfront = node.metadata?.appfront;
  return {
    asset: {
      ...rest,
      id: item.id,
      name: item.name,
      thumbnail: item.thumbnail,
      src: item.src,
      dimensions: fit.shownM,
      offset: [ox, oy, oz - fit.backShiftM],
      rotation: fit.rotation,
      scale: fit.scale,
    },
    ...(back === 0 ? {} : { position: [px + back * Math.sin(yaw), py, pz + back * Math.cos(yaw)] }),
    // Node AppFront: đánh dấu "mẫu người dùng, cỡ đang thấy" để lượt về lưu cỡ ấy. Node không có siêu dữ liệu AppFront giữ nguyên.
    ...(appfront === undefined ? {} : { metadata: { ...node.metadata, appfront: { ...appfront, fields: { ...fields, [USER_SEEN_FIELD]: true } } } }),
  };
};

/** Chiều cao tầng (mm) của món: tầng cha gần nhất có `height`. */
const levelHeightMmOf = (nodes: Readonly<Record<string, SwapNode | undefined>>, node: SwapNode): number => {
  let at: SwapNode | undefined = node;
  for (let hops = 0; at !== undefined && hops < 8; hops += 1) {
    if (at.type === 'level') return at.height === undefined ? DEFAULT_LEVEL_HEIGHT_MM : at.height * 1000;
    at = at.parentId == null ? undefined : nodes[at.parentId];
  }
  return DEFAULT_LEVEL_HEIGHT_MM;
};

/** Ảnh thu nhỏ catalog `/items/…` được phục vụ ở `/pascal/items/…` (`NEXT_PUBLIC_ASSETS_CDN_URL`). */
const servedUrl = (url: string): string => (url.startsWith('/items/') ? `/pascal${url}` : url);

export interface SwapModelCardProps {
  readonly stores: SwapModelStores;
  readonly catalog: readonly SwapCatalogItem[];
  readonly readOnly: boolean;
}

export function SwapModelCard({ stores, catalog, readOnly }: SwapModelCardProps) {
  useMenuGroup();
  const ids = stores.useViewer((s) => s.selection.selectedIds);
  const node = stores.useScene((s) =>
    ids.length === 1 ? (s.nodes as Record<string, SwapNode | undefined>)[ids[0] as string] : undefined,
  );
  const details = useRef<HTMLDetailsElement>(null);
  const asset = node?.type === 'item' ? node.asset : undefined;
  const options = node === undefined || asset === undefined ? [] : swapCandidates(node, catalog);
  if (readOnly || node === undefined || asset === undefined || options.length === 0) return null;

  const choose = (item: SwapCatalogItem) => {
    const state = stores.useScene.getState();
    const update = swapUpdateOf(node, item, levelHeightMmOf(state.nodes as Record<string, SwapNode | undefined>, node));
    if (update !== null) state.updateNode(node.id, update);
    if (details.current) details.current.open = false;
  };

  return (
    <details className="relative" data-appfront-menu="" ref={details}>
      <summary
        aria-label="Đổi mẫu — mở danh sách mẫu cùng loại"
        data-testid="swap-model"
        title={`Đổi mẫu cho ${asset.name}`}
        className="flex h-8 shrink-0 cursor-pointer list-none items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] px-2.5 font-medium text-[13px] text-[var(--pa-text)] shadow-[var(--pa-shadow-float)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pa-accent)] [&::-webkit-details-marker]:hidden"
      >
        Đổi mẫu
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pa-text-3)]" />
      </summary>
      <ul
        aria-label="Mẫu cùng loại"
        className="absolute top-full left-0 z-50 mt-1 max-h-[60vh] min-w-52 overflow-y-auto rounded-xl border border-[var(--pa-border)] bg-[var(--pa-surface)] p-1 text-[13px] text-[var(--pa-text)] shadow-[var(--pa-shadow-overlay)]"
      >
        {options.map((item) => {
          const current = isCurrentModel(asset, item);
          return (
            <li key={item.id}>
              <button
                aria-pressed={current}
                className="flex h-11 w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 text-left text-[var(--pa-text-2)] transition-colors duration-120 hover:bg-[var(--pa-sunken)] hover:text-[var(--pa-text)] disabled:cursor-default aria-pressed:bg-[var(--pa-selected)] aria-pressed:font-medium aria-pressed:text-[var(--pa-accent)] motion-reduce:transition-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pa-accent)]"
                data-model-id={item.id}
                data-testid="swap-model-option"
                disabled={current}
                onClick={() => choose(item)}
                type="button"
              >
                {item.thumbnail === '' ? (
                  <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-md bg-[var(--pa-sunken)]" data-testid="swap-model-placeholder" />
                ) : (
                  <img alt="" className="h-9 w-9 shrink-0 rounded-md bg-[var(--pa-sunken)] object-contain" loading="lazy" src={servedUrl(item.thumbnail)} />
                )}
                {item.name}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
