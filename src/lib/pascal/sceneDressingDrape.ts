/**
 * Vòng 10 làn THỊ GIÁC-2 — rèm/vải do FE tự sinh, bật bằng `?drape=light,tall,uv` (hoặc `all`). Không cờ = y như cũ.
 * Chỉ áp cho rèm `DRESS-curtain-*` (đồ trang trí sinh, không bao giờ lưu) — không đụng đồ người dùng đã xác nhận.
 * - light: rèm luôn vải dệt (lanh; phong cách có họ vải là cotton thì giữ cotton), màu = màu chăn ga sáng của phong cách
 *          (không nhuộm theo bọc sofa, không da). Áp ở `sceneDressingRules.ts` decor() + `upholstery.ts` tagUpholstery.
 * - tall : rèm cao = chiều cao tầng − 100 mm (sát dưới phào trần cove 90 mm, khỏi cắt phào), chân giữ sát sàn.
 *          toPascal: `heightMm` → `sy = heightMm / cao catalog`, chỉ trục Y (nếp theo X, sâu Z không đổi).
 * - uv   : GLB rèm/gối/chăn có UV ở thư mục `<folder>-uv` (gen-decor-models.mjs). Chưa nối: cần
 *          `furnitureCatalog.ts` fileFolderOf dùng `drapeFileFolderOf` (đề nghị trong báo cáo) — làn này không sửa tệp đó.
 * Hàm thuần + bảng ghi nhận cho probe (`window.__pascalProbe.drape()`).
 */
import { UPHOLSTERY_PALETTE } from './scenePalette';
import type { SceneStyle, SceneStyleId } from './sceneStyles';

export const DRAPE_FLAGS = ['light', 'tall', 'uv'] as const;
export type DrapeFlag = (typeof DRAPE_FLAGS)[number];

export const parseDrape = (search: string): ReadonlySet<DrapeFlag> => {
  const raw = new URLSearchParams(search).get('drape') ?? '';
  const list = raw === 'all' ? [...DRAPE_FLAGS] : raw.split(',').map((s) => s.trim());
  return new Set(list.filter((s): s is DrapeFlag => (DRAPE_FLAGS as readonly string[]).includes(s)));
};

let flags: ReadonlySet<DrapeFlag> = typeof location === 'undefined' ? new Set() : parseDrape(location.search);

export const drapeOn = (flag: DrapeFlag): boolean => flags.has(flag);
export const drapeFlags = (): readonly DrapeFlag[] => [...flags];

/** Chỉ cho bài kiểm. */
export const setDrapeFlags = (next: readonly DrapeFlag[]): void => {
  flags = new Set(next);
};

export const CURTAIN_FOLDER = 'curtain';
const LINEN = 'library:fabric-linen';
/** Họ vải phong cách dùng được làm rèm (vải dệt mỏng); da/boucle không. */
const WOVEN: ReadonlySet<string> = new Set([LINEN, 'library:fabric-cotton']);

/** Vải rèm cho phong cách: giữ họ vải của phong cách nếu là vải dệt, không thì lanh. */
export const drapeFabricOf = (style: Pick<SceneStyle, 'families'>): string =>
  WOVEN.has(style.families.fabric) ? style.families.fabric : LINEN;

/** Màu rèm = màu chăn ga của phong cách (sáng, trung tính, cùng tông tường/giường). */
const DRAPE_COLOUR: Readonly<Record<SceneStyleId, string>> = {
  'am-ap': UPHOLSTERY_PALETTE.amApBedding,
  'hien-dai-sang': UPHOLSTERY_PALETTE.hienDaiBedding,
  'go-am': UPHOLSTERY_PALETTE.goAmBedding,
  'toi-gian': UPHOLSTERY_PALETTE.toiGianBedding,
  'sang-trong-toi': UPHOLSTERY_PALETTE.sangTrongBedding,
};
export const drapeColourOf = (styleId: SceneStyleId): string => DRAPE_COLOUR[styleId];

/** Khoảng hở đỉnh rèm tới trần: phào trần cove cao 90 mm (wallDressingOf) + 10 mm. */
export const CURTAIN_CEILING_GAP_MM = 100;
/** Không cho rèm thấp hơn cỡ catalog (tầng thấp/thiếu dữ liệu) — khi đó giữ cỡ catalog. */
export const drapeHeightMm = (levelHeightMm: number, catalogMm: number): number =>
  Math.max(catalogMm, Math.round(levelHeightMm - CURTAIN_CEILING_GAP_MM));

/** Thư mục có bản GLB kèm UV (`<folder>-uv`). */
export const DRAPE_UV_FOLDERS: ReadonlySet<string> = new Set([CURTAIN_FOLDER, 'pillow', 'throw-blanket']);
/** Cho `furnitureCatalog.ts` fileFolderOf: thư mục tệp GLB khi `?drape=uv`; undefined = giữ nguyên. */
export const drapeFileFolderOf = (folder: string): string | undefined =>
  drapeOn('uv') && DRAPE_UV_FOLDERS.has(folder) ? `${folder}-uv` : undefined;

export interface DrapeCurtain {
  id: string;
  heightMm: number;
  fabric: string | undefined;
  color: string | null;
}
const curtains = new Map<string, DrapeCurtain>();
/** Ghi nhận rèm sinh ra (gọi từ dressingOf) cho probe. */
export const recordCurtain = (c: DrapeCurtain): void => {
  curtains.set(c.id, c);
};
export const drapeReport = (): { flags: readonly DrapeFlag[]; curtains: DrapeCurtain[] } => ({
  flags: drapeFlags(),
  curtains: [...curtains.values()],
});
