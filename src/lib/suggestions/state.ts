/**
 * M2 — trạng thái người dùng của lớp đề xuất: chỉ `state` + `override` (hợp đồng §2.2). Thuần, không React.
 *
 * - `sparseStateOf`: đúng thân `suggestionState` của #35 (bản ghi `state ≠ active` hoặc có `override`), sắp theo id.
 * - `applySuggestionState`: mirror AppBack `reconcile.apply_state` — bản không có trong `rows` về `active`.
 * - `adoptedFurnitureOf`: dời/xoay một món `item` = nhận nuôi (quyết định tạm §8.2): đồ thật `source:'human'` kèm `origin`.
 */

import type { Suggestion, SuggestionOf, SuggestionState, SuggestionStateRow } from '@/api/schemas/suggestions';
import { SUGGESTION_ID_PATTERN } from '@/api/schemas/suggestions';
import type { Furniture, FurnitureId, FurnitureKind, LevelId, RoomId } from '@/domain/spatial/types';
import { degrees, millimetres } from '@/domain/units/types';

/** Thân `suggestionState`: toàn bộ trạng thái THƯA của tầng, sắp theo id (gửi lại cùng thân → cùng chuỗi, C09b). */
export function sparseStateOf(suggestions: readonly Suggestion[]): SuggestionStateRow[] {
  return suggestions
    .filter((s) => s.state !== 'active' || s.override !== undefined)
    .map((s): SuggestionStateRow => ({ id: s.id, state: s.state, ...(s.override === undefined ? {} : { override: { ...s.override } }) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Áp thân `suggestionState` lên danh sách hiện có; id lạ thì ném (máy chủ trả 422). */
export function applySuggestionState(current: readonly Suggestion[], rows: readonly SuggestionStateRow[]): Suggestion[] {
  const known = new Set(current.map((s) => s.id));
  const sent = new Map(rows.map((row) => [row.id, row]));
  const unknown = rows.find((row) => !known.has(row.id));
  if (unknown !== undefined) throw new Error(`không có đề xuất ${unknown.id}`);

  return current.map((s) => {
    const row = sent.get(s.id);
    const { override: _override, adoptedAs, ...rest } = s;
    void _override;
    const state = row?.state ?? 'active';
    return {
      ...rest,
      state,
      ...(row?.override === undefined ? {} : { override: row.override }),
      ...(state === 'adopted' && adoptedAs !== undefined ? { adoptedAs } : {}),
    } as Suggestion;
  });
}

/** Đổi `state` của một bản ghi (bật/tắt từ bảng "Lớp đề xuất"); `adoptedAs` chỉ giữ khi vẫn `adopted`. */
export function withSuggestionState(
  suggestions: readonly Suggestion[],
  id: string,
  state: SuggestionState,
  adoptedAs?: string,
): Suggestion[] {
  return suggestions.map((s) => {
    if (s.id !== id) return s;
    const { adoptedAs: _previous, ...rest } = s;
    void _previous;
    return { ...rest, state, ...(state === 'adopted' && adoptedAs !== undefined ? { adoptedAs } : {}) } as Suggestion;
  });
}

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
export const furnitureKindOf = (kind: string): FurnitureKind => (FURNITURE_KINDS.has(kind) ? (kind as FurnitureKind) : 'other');

/** Id của đồ nhận nuôi: `F-` + thân id đề xuất đã lọc ký tự (W4 chỉ cần duy nhất, máy chủ cấp lại nếu cần). */
export const adoptedIdOf = (suggestionId: string): FurnitureId =>
  `F-${suggestionId.replace(/^DRESS-/, '').replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 64) as FurnitureId;

/**
 * Đồ thật cho món `item` được nhận nuôi ở vị trí/góc mới. `source:'human'` (không `rule`, quyết định §8.3) và
 * `origin` để `reconcile` biết đề xuất đã thành đồ (bước 6). Cỡ lấy từ `params`, không từ cảnh.
 */
export function adoptedFurnitureOf(
  suggestion: SuggestionOf<'item'>,
  at: { readonly levelId: LevelId; readonly roomId?: RoomId; readonly centre?: { x: number; y: number }; readonly rotationDeg?: number },
): Furniture {
  const { centre, sizeMm, rotationDeg, furnitureKind, liftMm } = suggestion.params;
  const [width, depth, height] = sizeMm;
  const where = at.centre ?? centre;

  return {
    id: adoptedIdOf(suggestion.id),
    levelId: at.levelId,
    ...(at.roomId === undefined ? {} : { roomId: at.roomId }),
    kind: furnitureKindOf(furnitureKind),
    centre: { x: millimetres(Math.round(where.x)), y: millimetres(Math.round(where.y)) },
    boundingBox: {
      min: { x: millimetres(-width / 2), y: millimetres(-depth / 2) },
      max: { x: millimetres(width / 2), y: millimetres(depth / 2) },
    },
    rotationDeg: degrees(at.rotationDeg ?? rotationDeg),
    heightMm: millimetres(height),
    ...(liftMm === undefined || liftMm === 0 ? {} : { liftMm: millimetres(liftMm) }),
    confidence: 1,
    source: 'human',
    reviewed: true,
    origin: { suggestionId: suggestion.id, rule: suggestion.rule, ruleVersion: suggestion.ruleVersion },
  };
}

/** Id này là một id đề xuất hợp lệ (`DRESS-…`). */
export const isSuggestionId = (id: string): boolean => SUGGESTION_ID_PATTERN.test(id);
