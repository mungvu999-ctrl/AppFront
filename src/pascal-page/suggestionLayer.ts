/**
 * M2 — lớp đề xuất trên trang 3D: (1) danh sách đề xuất mà cảnh dựng (`visibleSuggestionsOf`, cầu
 * `bridge/index.ts` đọc); (2) view model của mục "Lớp đề xuất" (`SuggestionsPanel`). Không React.
 *
 * Công tắc lớp của tầng là cờ máy chủ `suggestionsEnabled` (#35, §8 quyết định 1): tắt = máy chủ không sinh,
 * cảnh không vẽ; bật lại = máy chủ chạy luật ngay lượt lưu ấy.
 */

import type { SuggestionRuleset } from '@/api/schemas/suggestionRules';
import { isEffectiveSuggestion, validSuggestions, type Suggestion } from '@/api/schemas/suggestions';
import type { NormalizedSpatial } from '@/domain/spatial/normalize';
import type { SpatialGraph } from '@/domain/spatial/types';
import { RENDERED_KINDS } from '@/lib/pascal/suggestions';
import { previewSuggestions } from '@/lib/suggestions/mirror';
import { DEFAULT_RULESET, ruleNameVi } from '@/lib/suggestions/ruleset';
import type { FloorSuggestions } from '@/lib/suggestions/state';

/**
 * Đề xuất mà cảnh 3D dựng: mọi tầng đang bật lớp (`enabled`). Tầng có sửa chưa lưu (`preview.unsaved`)
 * dùng bản xem trước của gương luật (R1, R4, C2, F1, L1) trên lớp hiện tại, tới khi máy chủ reconcile.
 */
export function visibleSuggestionsOf(
  floors: Readonly<Record<string, FloorSuggestions>>,
  preview?: { readonly graph: SpatialGraph; readonly unsaved: readonly string[] },
): Suggestion[] {
  return Object.entries(floors).flatMap(([floorId, entry]) => {
    if (entry.enabled !== true) return [];
    if (preview === undefined || !preview.unsaved.includes(floorId)) return [...entry.suggestions];
    const { graph } = preview;
    const walls = graph.walls.filter((w) => w.levelId === floorId);
    const wallIds = new Set<string>(walls.map((w) => w.id));
    const layer = {
      walls,
      rooms: graph.rooms.filter((r) => r.levelId === floorId),
      openings: graph.openings.filter((o) => wallIds.has(o.wallId)),
      furniture: graph.furniture.filter((f) => f.levelId === floorId),
    };
    return previewSuggestions(entry.suggestions, layer, DEFAULT_RULESET);
  });
}

/* ------------------------------- view model ------------------------------- */

const KIND_VI: Readonly<Record<Suggestion['kind'], string>> = {
  skirting: 'Len chân tường',
  wallTile: 'Ốp gạch',
  cornice: 'Phào trần',
  casing: 'Nẹp cửa sổ',
  sash: 'Khung cánh',
  railing: 'Lan can',
  cabinetRun: 'Dãy tủ bếp',
  curtain: 'Rèm',
  rug: 'Thảm',
  ceilingLight: 'Đèn trần',
  item: 'Đồ',
  modelPick: 'Chọn mẫu',
};

export interface SuggestionItemView {
  readonly id: string;
  readonly label: string;
  /** `active`/`overridden`: đang bật. */
  readonly on: boolean;
  /** Đã nhận làm đồ thật: không bật/tắt ở đây nữa. */
  readonly adopted: boolean;
}

export interface SuggestionGroupView {
  readonly rule: string;
  readonly title: string;
  readonly countLabel: string;
  /** Editor chưa vẽ được loại này (phào, nẹp, ốp gạch): chỉ liệt kê. */
  readonly listOnly: boolean;
  readonly items: readonly SuggestionItemView[];
}

export interface StaleSuggestionView {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

export interface FloorSuggestionsView {
  readonly floorId: string;
  readonly floorName: string;
  readonly visible: boolean;
  /** Có thay đổi chưa gửi (bật/tắt món hay cả lớp). */
  readonly pending: boolean;
  readonly groups: readonly SuggestionGroupView[];
  readonly stale: readonly StaleSuggestionView[];
}

const nameOf = (spatial: NormalizedSpatial | null, id: string | undefined): string | undefined => {
  const entity = id === undefined ? undefined : spatial?.byId[id];
  return entity !== undefined && 'name' in entity && typeof entity.name === 'string' && entity.name.trim() !== '' ? entity.name : undefined;
};

const labelOf = (s: Suggestion, spatial: NormalizedSpatial | null): string => {
  const where = nameOf(spatial, s.hostRef.room) ?? (s.hostRef.opening !== undefined ? 'cửa sổ' : s.hostRef.furniture !== undefined ? 'món đồ' : 'tầng');
  if (s.kind === 'modelPick') return `${KIND_VI.modelPick}: ${s.params.reasonVi}`;
  if (s.kind === 'curtain' || s.kind === 'sash') return `${KIND_VI[s.kind]} — ${where} (${s.kind === 'curtain' ? `bên ${s.params.side === 'L' ? 'trái' : 'phải'}` : 'cửa sổ'})`;
  return `${KIND_VI[s.kind]} — ${where}`;
};

/** View model của một tầng: nhóm theo tên luật (thứ tự bảng luật), số đang bật / tổng; bản `stale` vào "Gợi ý cũ". */
export function floorSuggestionsView(input: {
  readonly floorId: string;
  readonly floorName: string;
  readonly entry: FloorSuggestions;
  readonly ruleset: SuggestionRuleset;
  readonly spatial: NormalizedSpatial | null;
}): FloorSuggestionsView {
  const { entry, ruleset, spatial } = input;
  const order = Object.keys(ruleset.rules);
  const rank = (rule: string): number => (order.includes(rule) ? order.indexOf(rule) : order.length);
  const all = validSuggestions(entry.suggestions);
  const live = all.filter((s) => s.stale === undefined);
  const rules = [...new Set(live.map((s) => s.rule))].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));

  return {
    floorId: input.floorId,
    floorName: input.floorName,
    visible: entry.enabled === true,
    pending: entry.dirty === true || entry.enabledChanged === true,
    groups: rules.map((rule) => {
      const items = live.filter((s) => s.rule === rule);
      const on = items.filter((s) => isEffectiveSuggestion(s)).length;
      return {
        rule,
        title: ruleNameVi(ruleset, rule),
        countLabel: `${on}/${items.length} đang bật`,
        listOnly: items.every((s) => !RENDERED_KINDS.has(s.kind)),
        items: items.map((s) => ({ id: s.id, label: labelOf(s, spatial), on: isEffectiveSuggestion(s), adopted: s.state === 'adopted' })),
      };
    }),
    stale: all
      .filter((s) => s.stale !== undefined)
      .map((s) => ({ id: s.id, label: labelOf(s, spatial), reason: s.stale?.reasonVi ?? '' })),
  };
}
