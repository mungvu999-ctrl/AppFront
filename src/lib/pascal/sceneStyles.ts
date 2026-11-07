/**
 * Năm phong cách cảnh Pascal (J6): mỗi phong cách là một bộ DỮ LIỆU — vật liệu sàn theo
 * `finish`, sơn tường, họ vật liệu đồ đạc, thư mục mô hình ưu tiên theo vai trò, ánh đèn.
 *
 * Chỉ là dữ liệu thuần, chưa nối vào `toPascal.ts`. Tham chiếu `library:<id>` chỉ dùng
 * những vật liệu đã có tệp (14 vân gỗ/gạch của J2 + concrete/fabric/leather/metal);
 * `scene:<id>` trỏ vào `SCENE_STYLE_MATERIALS` dưới đây hoặc `SCENE_MATERIALS` sẵn có.
 */

import type { RoomFinish } from '@/domain/spatial/types';

import { STYLE_PALETTE } from './scenePalette';
import type { FurnitureRole } from './sceneVariety';
import type { PascalSceneMaterial } from './types';

export type SceneStyleId = 'am-ap' | 'hien-dai-sang' | 'go-am' | 'toi-gian' | 'sang-trong-toi';

export const SCENE_STYLE_IDS: readonly SceneStyleId[] = ['am-ap', 'hien-dai-sang', 'go-am', 'toi-gian', 'sang-trong-toi'];

export const DEFAULT_SCENE_STYLE: SceneStyleId = 'am-ap';

export type SlotFamily = 'fabric' | 'wood' | 'metal' | 'cabinetry' | 'countertop' | 'ceramic' | 'rug' | 'pot';

export interface SceneStyle {
  readonly id: SceneStyleId;
  /** Tên hiển thị tiếng Việt. */
  readonly label: string;
  /**
   * Tham chiếu vật liệu sàn theo `finish`. `tile` là gạch/đá khổ lớn của khu sinh hoạt chung
   * (khách, bếp, hành lang — `sceneDressing.USAGE_FINISH`), `mosaic` là gạch chống trơn WC/lô gia,
   * `wood` là sàn phòng ngủ: ba khoá phải là ba vật liệu khác nhau.
   */
  readonly floor: Readonly<Record<RoomFinish, string>>;
  readonly wall: { readonly interior: string; readonly exterior: string };
  readonly families: Readonly<Record<SlotFamily, string>>;
  /** Thư mục catalog ưu tiên theo vai trò đồ đạc (`sceneVariety.ts`). */
  readonly prefer: Readonly<Partial<Record<FurnitureRole, readonly string[]>>>;
  /** Mã phong cách thư viện (12 mã của hồ sơ mẫu), sớm = ưu tiên: cả căn chọn đồ thư viện theo đây (`sceneVariety`). */
  readonly libraryStyles?: readonly string[];
  readonly lampColour: string;
  readonly lampIntensity: number;
}

const flat = (name: string, label: string, color: string, roughness: number): PascalSceneMaterial => ({
  id: `mat_style_${name}`,
  name: label,
  material: {
    preset: 'custom',
    properties: { color, roughness, metalness: 0, opacity: 1, transparent: false, side: 'front' },
  },
});

/** Vật liệu phẳng mà các phong cách trỏ tới (`scene:mat_style_<name>`). */
export const SCENE_STYLE_MATERIALS: readonly PascalSceneMaterial[] = [
  flat('am_ap_wall', 'Sơn be sáng', STYLE_PALETTE.amApWall, 0.9),
  flat('am_ap_exterior', 'Tường ngoài xám', STYLE_PALETTE.amApExterior, 0.9),
  flat('am_ap_cabinet', 'Tủ trắng ấm', STYLE_PALETTE.amApCabinet, 0.6),
  flat('hien_dai_wall', 'Sơn trắng lạnh', STYLE_PALETTE.hienDaiWall, 0.85),
  flat('hien_dai_exterior', 'Tường ngoài xám sáng', STYLE_PALETTE.hienDaiExterior, 0.9),
  flat('hien_dai_cabinet', 'Tủ trắng bóng', STYLE_PALETTE.hienDaiCabinet, 0.3),
  flat('go_am_wall', 'Sơn be gỗ', STYLE_PALETTE.goAmWall, 0.9),
  flat('go_am_exterior', 'Tường ngoài nâu', STYLE_PALETTE.goAmExterior, 0.9),
  flat('go_am_cabinet', 'Tủ gỗ óc chó', STYLE_PALETTE.goAmCabinet, 0.55),
  flat('toi_gian_wall', 'Sơn xám nhạt', STYLE_PALETTE.toiGianWall, 0.9),
  flat('toi_gian_exterior', 'Tường ngoài xám', STYLE_PALETTE.toiGianExterior, 0.9),
  flat('toi_gian_cabinet', 'Tủ xám mờ', STYLE_PALETTE.toiGianCabinet, 0.7),
  flat('sang_trong_wall', 'Sơn nâu xám', STYLE_PALETTE.sangTrongWall, 0.8),
  flat('sang_trong_exterior', 'Tường ngoài than', STYLE_PALETTE.sangTrongExterior, 0.9),
  flat('sang_trong_cabinet', 'Tủ đen mờ', STYLE_PALETTE.sangTrongCabinet, 0.5),
  flat('ceramic_white', 'Sứ trắng', STYLE_PALETTE.ceramicWhite, 0.15),
  flat('ceramic_ivory', 'Sứ ngà', STYLE_PALETTE.ceramicIvory, 0.2),
  flat('pot_terracotta', 'Chậu đất nung', STYLE_PALETTE.potTerracotta, 0.85),
  flat('pot_concrete', 'Chậu xi măng', STYLE_PALETTE.potConcrete, 0.9),
  flat('pot_black', 'Chậu đen', STYLE_PALETTE.potBlack, 0.6),
];

const lib = (id: string): string => `library:${id}`;
const scene = (name: string): string => `scene:mat_style_${name}`;

export const SCENE_STYLES: Readonly<Record<SceneStyleId, SceneStyle>> = {
  // Mặc định, theo ngôi nhà ở trang đăng nhập: tường gần trắng, sàn gỗ sồi nhạt, gạch
  // trắng, sàn gỗ ngoài trời nâu vừa, tường ngoài xám đậm; vải lanh, đồng thau.
  'am-ap': {
    id: 'am-ap',
    label: 'Ấm áp',
    floor: {
      wood: lib('flooring-woodparquet76'),
      tile: lib('flooring-tile79'),
      mosaic: lib('flooring-lightceramic24'),
      decking: lib('wood-woodplank48'),
      concrete: lib('concrete-polished'),
    },
    wall: { interior: scene('am_ap_wall'), exterior: scene('am_ap_exterior') },
    families: {
      fabric: lib('fabric-linen'),
      wood: lib('wood-finewood27'),
      metal: lib('metal-brass'),
      cabinetry: scene('am_ap_cabinet'),
      countertop: lib('flooring-statuarettowhite'),
      ceramic: scene('ceramic_ivory'),
      rug: lib('fabric-wool'),
      pot: scene('pot_terracotta'),
    },
    libraryStyles: ['scandinavian', 'japandi', 'midcentury'],
    prefer: { plant: ['indoor-plant'], roundRug: ['round-carpet'], desk: ['office-table'] },
    lampColour: STYLE_PALETTE.lampWarm,
    lampIntensity: 6,
  },
  // Sàn gỗ xương cá sáng (bớt cam hơn ván floorplank1), gạch men, tường trắng lạnh, crôm.
  'hien-dai-sang': {
    id: 'hien-dai-sang',
    label: 'Hiện đại sáng',
    floor: {
      wood: lib('wood-hungarianparquet10'),
      tile: lib('flooring-lightceramic24'),
      mosaic: lib('flooring-tile20'),
      decking: lib('wood-woodplank19'),
      concrete: lib('concrete-polished'),
    },
    wall: { interior: scene('hien_dai_wall'), exterior: scene('hien_dai_exterior') },
    families: {
      fabric: lib('fabric-cotton'),
      wood: lib('wood-floorplank1'),
      metal: lib('metal-chrome'),
      cabinetry: scene('hien_dai_cabinet'),
      countertop: lib('flooring-statuarettowhite'),
      ceramic: scene('ceramic_white'),
      rug: lib('fabric-boucle'),
      pot: scene('pot_concrete'),
    },
    libraryStyles: ['modern-min', 'scandinavian', 'korean-min'],
    prefer: { plant: ['small-indoor-plant', 'indoor-plant'], rug: ['rectangular-carpet'] },
    lampColour: STYLE_PALETTE.lampNeutral,
    lampIntensity: 7,
  },
  // Gỗ đậm: sàn ván nâu vừa, tủ óc chó, da bò sáp (bớt đỏ hơn nhung), đồng đỏ.
  'go-am': {
    id: 'go-am',
    label: 'Gỗ ấm',
    floor: {
      wood: lib('wood-woodplank48'),
      tile: lib('flooring-tile20'),
      mosaic: lib('flooring-tiles4'),
      decking: lib('wood-woodenparquet11'),
      concrete: lib('concrete-raw'),
    },
    wall: { interior: scene('go_am_wall'), exterior: scene('go_am_exterior') },
    families: {
      fabric: lib('leather-calf'),
      wood: lib('wood-hungarianparquet2'),
      metal: lib('metal-copper'),
      cabinetry: scene('go_am_cabinet'),
      countertop: lib('concrete-polished'),
      ceramic: scene('ceramic_ivory'),
      rug: lib('fabric-wool'),
      pot: scene('pot_terracotta'),
    },
    libraryStyles: ['japandi', 'rustic', 'midcentury'],
    prefer: { plant: ['indoor-plant'], rug: ['rectangular-carpet'], desk: ['office-table'] },
    lampColour: STYLE_PALETTE.lampAmber,
    lampIntensity: 5,
  },
  // Ít chi tiết: tường xám nhạt, sàn ván sồi xám, gạch xám, bê tông thô, thép.
  'toi-gian': {
    id: 'toi-gian',
    label: 'Tối giản',
    floor: {
      wood: lib('wood-woodplank19'),
      tile: lib('flooring-tile79'),
      mosaic: lib('flooring-tiles4'),
      decking: lib('wood-woodenparquet11'),
      concrete: lib('concrete-raw'),
    },
    wall: { interior: scene('toi_gian_wall'), exterior: scene('toi_gian_exterior') },
    families: {
      fabric: lib('fabric-boucle'),
      wood: lib('wood-woodenparquet11'),
      metal: lib('metal-steel'),
      cabinetry: scene('toi_gian_cabinet'),
      countertop: lib('concrete-polished'),
      ceramic: scene('ceramic_white'),
      rug: lib('fabric-linen'),
      pot: scene('pot_concrete'),
    },
    libraryStyles: ['modern-min', 'korean-min', 'japandi'],
    prefer: { plant: ['small-indoor-plant'], roundRug: ['round-carpet'] },
    lampColour: STYLE_PALETTE.lampNeutral,
    lampIntensity: 6,
  },
  // Tường nâu xám (đủ sáng để đọc được đồ đạc), sàn gỗ đậm, đá trắng, da đen, đồng thau bóng.
  'sang-trong-toi': {
    id: 'sang-trong-toi',
    label: 'Sang trọng tối',
    floor: {
      wood: lib('wood-hungarianparquet2'),
      tile: lib('flooring-statuarettowhite'),
      mosaic: lib('flooring-tile20'),
      decking: lib('wood-woodenparquet11'),
      concrete: lib('concrete-polished'),
    },
    wall: { interior: scene('sang_trong_wall'), exterior: scene('sang_trong_exterior') },
    families: {
      fabric: lib('leather-black'),
      wood: lib('wood-woodenparquet11'),
      metal: lib('metal-polished'),
      cabinetry: scene('sang_trong_cabinet'),
      countertop: lib('flooring-statuarettowhite'),
      ceramic: scene('ceramic_white'),
      rug: lib('fabric-velvet'),
      pot: scene('pot_black'),
    },
    libraryStyles: ['modern-lux', 'neoclassic', 'industrial'],
    prefer: { plant: ['indoor-plant'], roundRug: ['round-carpet'], desk: ['office-table'] },
    lampColour: STYLE_PALETTE.lampAmber,
    lampIntensity: 9,
  },
};

const isSceneStyleId = (id: unknown): id is SceneStyleId => SCENE_STYLE_IDS.includes(id as SceneStyleId);

/** Phong cách theo id; id lạ/thiếu → mặc định. */
export const sceneStyleOf = (id: unknown): SceneStyle => SCENE_STYLES[isSceneStyleId(id) ? id : DEFAULT_SCENE_STYLE];

/** Khoá localStorage lưu phong cách đang chọn (J9). */
export const SCENE_STYLE_STORAGE_KEY = 'appfront.pascal.sceneStyle.v1';

/** Khoá xem thử riêng một dự án của người không sửa được cài đặt (W4a) — chỉ máy này. */
export const sceneStylePreviewKey = (projectId: string): string => `${SCENE_STYLE_STORAGE_KEY}:${projectId}`;

/**
 * Phong cách của lượt mở trang. Thứ tự (W4a): bản xem thử trên máy này của dự án → phong
 * cách lưu ở dự án (`project.sceneStyle`) → khoá J9 → mặc định; bộ nhớ không truy cập được thì
 * bỏ qua các khoá. Mọi lời gọi `toPascalScene` trong một trang phải dùng cùng kết quả này,
 * không thì sinh "sửa ma".
 */
export const readSceneStyle = (
  storage: () => Storage,
  project?: { readonly id: string; readonly style?: unknown },
): SceneStyle => {
  const read = (key: string): string | null => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };
  const preview = project === undefined ? null : read(sceneStylePreviewKey(project.id));
  const pick = [preview, project?.style, read(SCENE_STYLE_STORAGE_KEY)].find(isSceneStyleId);

  return sceneStyleOf(pick);
};
