/**
 * M2 — editor vẽ lớp đề xuất ĐÃ LƯU (hợp đồng §5 cột "Editor vẽ bản đã lưu"). Thuần, chỉ đổi dữ liệu.
 *
 * `suggestionPlanOf` đọc danh sách của tầng một lần và trả "kế hoạch" cho `toPascalScene`:
 *
 * | kind | vẽ thế nào |
 * |---|---|
 * | skirting (R1) | `skirting` của tường Pascal: cao + dày theo bản ghi. Mặt (`side`) và đoạn (`spansMm`) KHÔNG dùng: Pascal một len mỗi tường, tự cắt ở cửa |
 * | railing (R4) | lan can lô gia `loggiaRailing` theo `start/end/spansMm/heightMm` máy chủ, thay đường tự dò của phòng ấy |
 * | sash (C2) | `frameThickness/frameDepth` của cửa sổ |
 * | modelPick (F1) | mẫu của món chủ (chỉ khi món chưa có `model`, mẫu có trong catalog) |
 * | cabinetRun (F2/F3) | khối `kitchen-cabinet` theo hộp món chủ, dài/sâu/cao theo bản ghi |
 * | item | `Furniture` ảo qua đường `generated:'dressing'`, id = id đề xuất (`DRESS-…`) |
 * | rug, curtain | tấm phẳng: `rectangular-carpet` / `curtain` co theo cỡ bản ghi |
 * | ceilingLight (L1) | chỗ đặt `LIGHT-<phòng>` = `centre`; có bản L1 thì phòng không có bản hiệu lực không có đèn |
 * | wallTile, cornice, casing | chỉ liệt kê (bảng "Lớp đề xuất"), không vẽ |
 *
 * `disabled`, `adopted` (đã nằm trong `furniture[]`) và `stale` không vẽ. Không có bản ghi nào → cảnh như cũ.
 */

import { effectiveParams, isEffectiveSuggestion, validSuggestions, type Suggestion, type SuggestionOf } from '@/api/schemas/suggestions';
import type { Furniture, FurnitureId, FurnitureKind, FurnitureOrigin, LevelId, Opening, Point, Room, RoomId, SpatialGraph, Wall } from '@/domain/spatial/types';
import { degrees, millimetres, millimetresToMetres } from '@/domain/units/types';

import { CATALOG_MODELS } from './furnitureCatalog';
import { insideOutline } from './swingDirection';
import type { PascalNode, PascalNodeId, PascalWallTrim } from './types';

const FURNITURE_KINDS: ReadonlySet<string> = new Set<FurnitureKind>([
  'table',
  'chair',
  'bed',
  'wardrobe',
  'kitchenCabinet',
  'sanitaryFixture',
  'washingMachine',
  'shower',
  'other',
]);

/** `furnitureKind` của luật về `FurnitureKind` của AppFront; lạ thì `other` (mẫu vẫn theo `modelId`). */
const furnitureKindOf = (kind: string): FurnitureKind => (FURNITURE_KINDS.has(kind) ? (kind as FurnitureKind) : 'other');

export interface SkirtingPatch {
  readonly heightMm: number;
  readonly thicknessMm: number;
}

export interface SuggestedRailing {
  readonly id: string;
  readonly roomId: string;
  readonly levelId: LevelId;
  readonly start: Point;
  readonly end: Point;
  readonly heightMm: number;
}

export interface SuggestionPlan {
  /** Có bản ghi nào không; `false` = cảnh dựng y như trước M2. */
  readonly active: boolean;
  /** Tường → cỡ len (`'off'` = mọi bản R1 của tường bị tắt/cũ). Tường không có bản R1 giữ mặc định. */
  readonly skirting: ReadonlyMap<string, SkirtingPatch | 'off'>;
  readonly sash: ReadonlyMap<string, { readonly frameWidthMm: number; readonly frameDepthMm: number }>;
  /** Món chủ → thư mục mẫu (F1). */
  readonly modelFolder: ReadonlyMap<string, string>;
  /** Phòng → chỗ đèn trần (mm) hoặc `'off'`; vắng = như cũ (`interiorPointOf`). */
  readonly light: ReadonlyMap<string, Point | 'off'>;
  /** Hộp tủ bếp (chủ F2/F3 + hộp trùng gộp vào) có dãy hiệu lực: ẩn hộp, không tách `kitchenRuns`. */
  readonly cabinetHosts: ReadonlySet<string>;
  /** Phòng có bản R4 (bất kể trạng thái): máy chủ nắm lan can mép hở của phòng ấy. */
  readonly railingRooms: ReadonlySet<string>;
  readonly railings: readonly SuggestedRailing[];
  /** Đồ ảo (`item`, `rug`, `curtain`, `cabinetRun`) cùng thư mục mẫu và dấu luật (`origin` khi được nhận nuôi). */
  readonly furniture: readonly { readonly furniture: Furniture; readonly folder?: string; readonly origin: FurnitureOrigin }[];
}

const EMPTY_PLAN: SuggestionPlan = {
  active: false,
  skirting: new Map(),
  sash: new Map(),
  modelFolder: new Map(),
  light: new Map(),
  railingRooms: new Set(),
  cabinetHosts: new Set(),
  railings: [],
  furniture: [],
};

const hasModel = (folder: string): boolean => Object.prototype.hasOwnProperty.call(CATALOG_MODELS, folder);

const mm = (value: number) => millimetres(Math.round(value));
const metresOf = (valueMm: number): number => millimetresToMetres(millimetres(valueMm));

const boxOf = (width: number, depth: number): Furniture['boundingBox'] => ({
  min: { x: millimetres(-width / 2), y: millimetres(-depth / 2) },
  max: { x: millimetres(width / 2), y: millimetres(depth / 2) },
});

/** Phần chung của mọi món ảo: id đề xuất, AI chưa duyệt (A5: không bao giờ tự nhận đã duyệt). */
const virtualOf = (
  s: Suggestion,
  levelId: LevelId,
  roomId: string | undefined,
  fields: Pick<Furniture, 'kind' | 'centre' | 'boundingBox' | 'rotationDeg'> & Partial<Pick<Furniture, 'heightMm' | 'liftMm'>>,
): Furniture => ({
  id: s.id as FurnitureId,
  levelId,
  ...(roomId === undefined ? {} : { roomId: roomId as RoomId }),
  confidence: 1,
  source: 'ai',
  reviewed: false,
  ...fields,
});

interface Lookup {
  readonly walls: ReadonlyMap<string, Wall>;
  readonly rooms: ReadonlyMap<string, Room>;
  readonly openings: ReadonlyMap<string, Opening>;
  readonly furniture: ReadonlyMap<string, Furniture>;
}

const levelOfHost = (s: Suggestion, at: Lookup): LevelId | undefined => {
  const { room, wall, opening, furniture } = s.hostRef;
  return (
    (room === undefined ? undefined : at.rooms.get(room)?.levelId) ??
    (wall === undefined ? undefined : at.walls.get(wall)?.levelId) ??
    (opening === undefined ? undefined : at.walls.get(at.openings.get(opening)?.wallId ?? '')?.levelId) ??
    (furniture === undefined ? undefined : at.furniture.get(furniture)?.levelId)
  );
};

/** Tấm rèm D2: nằm trong phòng chủ, cách mặt tường `offsetMm`, `L` về phía đầu tường. */
const curtainOf = (s: SuggestionOf<'curtain'>, at: Lookup): Furniture | null => {
  const opening = s.hostRef.opening === undefined ? undefined : at.openings.get(s.hostRef.opening);
  const wall = opening === undefined ? undefined : at.walls.get(opening.wallId);
  const room = s.hostRef.room === undefined ? undefined : at.rooms.get(s.hostRef.room);
  if (opening === undefined || wall === undefined || room === undefined) return null;
  const { start, end } = wall.centreline;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(length > 0)) return null;
  const [dx, dy] = [(end.x - start.x) / length, (end.y - start.y) / length];
  const p = effectiveParams(s);
  const at2 = (along: number, across: number): Point =>
    ({ x: start.x + dx * along - dy * across, y: start.y + dy * along + dx * across }) as Point;
  const mid = opening.offsetMm + opening.widthMm / 2;
  const probe = wall.thicknessMm / 2 + 150;
  const sign = insideOutline(at2(mid, probe), room.outline) ? 1 : -1;
  const along =
    p.side === 'L' ? opening.offsetMm - p.extMm + p.widthMm / 2 : opening.offsetMm + opening.widthMm + p.extMm - p.widthMm / 2;
  const centre = at2(along, sign * (wall.thicknessMm / 2 + p.offsetMm + p.pleatMm / 2));
  return virtualOf(s, wall.levelId, room.id, {
    kind: 'other',
    centre: { x: mm(centre.x), y: mm(centre.y) },
    boundingBox: boxOf(p.widthMm, p.pleatMm),
    rotationDeg: degrees((Math.atan2(dy, dx) * 180) / Math.PI),
    heightMm: millimetres(p.topMm),
  });
};

/** Đoạn lan can R4 thành các cặp đầu-cuối (mm) dọc cạnh `start → end`. */
const railingsOf = (s: SuggestionOf<'railing'>, levelId: LevelId): SuggestedRailing[] => {
  const p = effectiveParams(s);
  const length = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
  if (!(length > 0)) return [];
  const [ux, uy] = [(p.end.x - p.start.x) / length, (p.end.y - p.start.y) / length];
  const at = (t: number): Point => ({ x: p.start.x + ux * t, y: p.start.y + uy * t }) as Point;
  return p.spansMm.map(([from, to], index) => ({
    id: index === 0 ? s.id : `${s.id}:${index}`,
    roomId: s.hostRef.room ?? '',
    levelId,
    start: at(from),
    end: at(to),
    heightMm: p.heightMm,
  }));
};

/** Kế hoạch vẽ lớp đề xuất của đồ thị; `offIds` (= `dressingOff`) chặn món người dùng đã xoá. */
export function suggestionPlanOf(
  suggestions: readonly Suggestion[] | undefined,
  graph: Pick<SpatialGraph, 'walls' | 'rooms' | 'openings' | 'furniture'>,
  offIds: ReadonlySet<string> = new Set(),
): SuggestionPlan {
  if (suggestions === undefined || suggestions.length === 0) return EMPTY_PLAN;
  const checked = validSuggestions(suggestions);
  const at: Lookup = {
    walls: new Map(graph.walls.map((w) => [w.id, w])),
    rooms: new Map(graph.rooms.map((r) => [r.id, r])),
    openings: new Map(graph.openings.map((o) => [o.id, o])),
    furniture: new Map(graph.furniture.map((f) => [f.id, f])),
  };
  const skirting = new Map<string, SkirtingPatch | 'off'>();
  const sash = new Map<string, { frameWidthMm: number; frameDepthMm: number }>();
  const modelFolder = new Map<string, string>();
  const light = new Map<string, Point | 'off'>();
  const railingRooms = new Set<string>();
  const cabinetHosts = new Set<string>();
  const railings: SuggestedRailing[] = [];
  const furniture: { furniture: Furniture; folder?: string; origin: FurnitureOrigin }[] = [];

  for (const s of checked) {
    const live = isEffectiveSuggestion(s) && !offIds.has(s.id);
    if (s.kind === 'railing' && s.hostRef.room !== undefined) railingRooms.add(s.hostRef.room);
    if (s.kind === 'skirting' && s.hostRef.wall !== undefined && !live && !skirting.has(s.hostRef.wall)) {
      skirting.set(s.hostRef.wall, 'off');
    }
    if (!live) continue;
    const levelId = levelOfHost(s, at);
    if (levelId === undefined) continue;
    const roomId = s.hostRef.room;
    const origin: FurnitureOrigin = { suggestionId: s.id, rule: s.rule, ruleVersion: s.ruleVersion };

    switch (s.kind) {
      case 'skirting': {
        const p = effectiveParams(s);
        const wallId = s.hostRef.wall;
        if (wallId === undefined) break;
        // Pascal một len mỗi tường: hai phòng hai mặt thì lấy cỡ lớn hơn (điều chỉnh của một mặt vẫn thấy).
        const prev = skirting.get(wallId);
        const base = prev === undefined || prev === 'off' ? { heightMm: 0, thicknessMm: 0 } : prev;
        skirting.set(wallId, { heightMm: Math.max(base.heightMm, p.heightMm), thicknessMm: Math.max(base.thicknessMm, p.thicknessMm) });
        break;
      }
      case 'sash':
        if (s.hostRef.opening !== undefined) sash.set(s.hostRef.opening, effectiveParams(s));
        break;
      case 'modelPick': {
        const host = s.hostRef.furniture === undefined ? undefined : at.furniture.get(s.hostRef.furniture);
        const { modelId } = effectiveParams(s);
        // Chỉ chọn mẫu khi người dùng chưa chọn (mẫu hoặc biến thể).
        if (host !== undefined && host.model === undefined && host.variant === undefined && hasModel(modelId)) modelFolder.set(host.id, modelId);
        break;
      }
      case 'ceilingLight':
        if (roomId !== undefined) light.set(roomId, effectiveParams(s).centre as Point);
        break;
      case 'railing':
        railings.push(...railingsOf(s, levelId));
        break;
      case 'item': {
        const p = effectiveParams(s);
        furniture.push({
          furniture: virtualOf(s, levelId, roomId, {
            kind: furnitureKindOf(p.furnitureKind),
            centre: { x: mm(p.centre.x), y: mm(p.centre.y) },
            boundingBox: boxOf(p.sizeMm[0], p.sizeMm[1]),
            rotationDeg: degrees(p.rotationDeg),
            heightMm: millimetres(p.sizeMm[2]),
            ...(p.liftMm === undefined || p.liftMm === 0 ? {} : { liftMm: millimetres(p.liftMm) }),
          }),
          ...(hasModel(p.modelId) ? { folder: p.modelId } : {}),
          origin,
        });
        break;
      }
      case 'rug': {
        const p = effectiveParams(s);
        furniture.push({
          furniture: virtualOf(s, levelId, roomId, {
            kind: 'other',
            centre: { x: mm(p.centre.x), y: mm(p.centre.y) },
            boundingBox: boxOf(p.sizeMm[0], p.sizeMm[1]),
            rotationDeg: degrees(p.rotationDeg),
            heightMm: millimetres(p.thicknessMm),
          }),
          folder: 'rectangular-carpet',
          origin,
        });
        break;
      }
      case 'curtain': {
        const panel = curtainOf(s, at);
        if (panel !== null) furniture.push({ furniture: panel, folder: 'curtain', origin });
        break;
      }
      case 'cabinetRun': {
        const host = s.hostRef.furniture === undefined ? undefined : at.furniture.get(s.hostRef.furniture);
        const p = effectiveParams(s);
        const length = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
        // Hộp do người dùng vẽ/sửa không bao giờ bị ẩn: dãy tủ chỉ thay hộp AI/luật. Hộp chủ của người dùng thì không vẽ dãy chồng lên.
        if (host === undefined || host.source === 'human' || !(length > 0)) break;
        [host.id, ...(p.mergedIds ?? [])].forEach((id) => {
          if (at.furniture.get(id)?.source !== 'human') cabinetHosts.add(id);
        });
        // Dãy nằm phía pháp tuyến trái của đường lưng, tâm lùi nửa chiều sâu.
        const [ux, uy] = [(p.end.x - p.start.x) / length, (p.end.y - p.start.y) / length];
        const centre = { x: (p.start.x + p.end.x) / 2 - uy * (p.depthMm / 2), y: (p.start.y + p.end.y) / 2 + ux * (p.depthMm / 2) };
        furniture.push({
          furniture: virtualOf(s, levelId, host.roomId, {
            kind: 'kitchenCabinet',
            centre: { x: mm(centre.x), y: mm(centre.y) },
            boundingBox: boxOf(p.lengthMm, p.depthMm),
            rotationDeg: degrees((Math.atan2(uy, ux) * 180) / Math.PI),
            heightMm: millimetres(p.topMm - p.bottomMm),
            ...(p.bottomMm === 0 ? {} : { liftMm: millimetres(p.bottomMm) }),
          }),
          folder: 'kitchen-cabinet',
          origin,
        });
        break;
      }
      default:
        // wallTile, cornice, casing: chỉ liệt kê (Pascal chưa có phần tương ứng).
        break;
    }
  }

  return { active: true, skirting, sash, modelFolder, light, railingRooms, cabinetHosts, railings, furniture };
}

/** Kind nào editor vẽ được (đầy đủ hay một phần) — bảng "Lớp đề xuất" ghi "chỉ liệt kê" cho phần còn lại. */
export const RENDERED_KINDS: ReadonlySet<Suggestion['kind']> = new Set([
  'skirting',
  'railing',
  'sash',
  'modelPick',
  'cabinetRun',
  'item',
  'rug',
  'curtain',
  'ceilingLight',
]);


/**
 * Áp phần "vá node" của kế hoạch lên cảnh đã dựng: len của tường (R1) và khung cánh cửa sổ (C2).
 * Len tắt mà tường còn phào ngoài (`skirting.exterior`) thì chỉ giữ mặt ngoài.
 */
export function applySuggestionPatches(
  nodes: Record<PascalNodeId, PascalNode>,
  plan: SuggestionPlan,
  idOf: (kind: 'wall' | 'window', id: string) => PascalNodeId,
): void {
  if (!plan.active) return;
  for (const [wallId, patch] of plan.skirting) {
    const node = nodes[idOf('wall', wallId)];
    if (node?.type !== 'wall' || node.skirting === undefined) continue;
    const skirting: PascalWallTrim =
      patch === 'off'
        ? node.skirting.exterior === undefined
          ? { ...node.skirting, enabled: false }
          : { ...node.skirting, sides: 'exterior' }
        : { ...node.skirting, height: metresOf(patch.heightMm), proud: metresOf(patch.thicknessMm) };
    nodes[node.id] = { ...node, skirting };
  }
  for (const [openingId, { frameWidthMm, frameDepthMm }] of plan.sash) {
    const node = nodes[idOf('window', openingId)];
    if (node?.type !== 'window') continue;
    nodes[node.id] = { ...node, frameThickness: metresOf(frameWidthMm), frameDepth: metresOf(frameDepthMm) };
  }
}
