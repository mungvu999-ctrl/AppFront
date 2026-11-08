/**
 * M2 — trạng thái người dùng của lớp đề xuất: chỉ `state` + `override` (hợp đồng §2.2). Thuần, không React.
 *
 * - `sparseStateOf`: đúng thân `suggestionState` của #35 (bản ghi `state ≠ active` hoặc có `override`), sắp theo id.
 * - `applySuggestionState`: mirror AppBack `reconcile.apply_state` — bản không có trong `rows` về `active`.
 */

import type { Suggestion, SuggestionState, SuggestionStateRow, SuggestionsMeta } from '@/api/schemas/suggestions';
// Không nhập zod/schema lúc chạy: tệp này nạp lười qua ống tự lưu (`useAutosave.loadPipes`), kho tự giữ bản chép nhỏ.
import { idsOnLevel, isEntityOfKind, type NormalizedSpatial } from '@/domain/spatial/normalize';
import type { Furniture, LevelId } from '@/domain/spatial/types';

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

/**
 * Bản ghi cần chuyển `adopted`: đồ thật có `origin.suggestionId` trỏ vào một bản chưa `adopted` của tầng.
 * Trả `[id đề xuất, id đồ]` theo thứ tự đồ; rỗng khi không có gì đổi.
 */
export function adoptionsOf(
  furniture: readonly Pick<Furniture, 'id' | 'origin'>[],
  suggestions: readonly Pick<Suggestion, 'id' | 'state' | 'adoptedAs'>[],
): (readonly [string, string])[] {
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  return furniture.flatMap((f) => {
    const target = f.origin === undefined ? undefined : byId.get(f.origin.suggestionId);
    return target === undefined || (target.state === 'adopted' && target.adoptedAs === f.id) ? [] : [[target.id, f.id] as const];
  });
}

/** Mọi `[tầng, id đề xuất, id đồ]` cần chuyển `adopted` trên cả đồ thị (gọi sau mỗi lượt sửa). */
export function floorAdoptionsOf(
  spatial: NormalizedSpatial,
  floors: Readonly<Record<string, { readonly suggestions: readonly Pick<Suggestion, 'id' | 'state' | 'adoptedAs'>[] }>>,
): (readonly [string, string, string])[] {
  return Object.entries(floors).flatMap(([floorId, entry]) => {
    const furniture = idsOnLevel(spatial, floorId as LevelId).flatMap((id) => {
      const entity = spatial.byId[id];
      return entity !== undefined && isEntityOfKind('furniture', entity) && entity.origin !== undefined ? [entity] : [];
    });
    return adoptionsOf(furniture, entry.suggestions).map(([suggestionId, furnitureId]) => [floorId, suggestionId, furnitureId] as const);
  });
}

/**
 * Lớp đề xuất của một tầng trong kho: bản máy chủ trả gần nhất + phần người dùng chưa gửi.
 * `enabled`: lớp bật (`suggestionsEnabled`); `dirty`: `state` đổi tại máy, lượt #35 sau mang `suggestionState`;
 * `enabledChanged`: người dùng bật/tắt lớp, lượt #35 sau mang `suggestionsEnabled`.
 */
export interface FloorSuggestions {
  readonly suggestions: readonly Suggestion[];
  readonly meta?: SuggestionsMeta;
  readonly enabled?: true;
  readonly dirty?: true;
  readonly enabledChanged?: true;
}

/** Bản máy chủ (kết quả lưu hay lượt đọc); `null` = giữ bản tại máy vì nó còn sửa chưa gửi mà lượt này không mang. */
export function receivedEntry(
  current: FloorSuggestions | undefined,
  incoming: Pick<FloorSuggestions, 'suggestions' | 'meta' | 'enabled'>,
  sent: boolean,
): FloorSuggestions | null {
  if ((current?.dirty === true || current?.enabledChanged === true) && !sent) return null;
  const { suggestions, meta, enabled } = incoming;
  return { suggestions, ...(meta === undefined ? {} : { meta }), ...(enabled === true ? { enabled } : {}) };
}

/** Bật/tắt (hay nhận nuôi) một món; `null` khi tầng không có id ấy. */
export function changedEntry(
  current: FloorSuggestions | undefined,
  id: string,
  state: SuggestionState,
  adoptedAs?: string,
): FloorSuggestions | null {
  if (current === undefined || !current.suggestions.some((s) => s.id === id)) return null;
  return { ...current, suggestions: withSuggestionState(current.suggestions, id, state, adoptedAs), dirty: true };
}

/** Bật/tắt lớp của tầng. */
export function enabledEntry(current: FloorSuggestions | undefined, enabled: boolean): FloorSuggestions {
  const { enabled: _was, ...rest } = current ?? { suggestions: [] };
  void _was;
  return { ...rest, ...(enabled ? { enabled: true as const } : {}), enabledChanged: true };
}

/**
 * Bản ghi này do máy chủ M2 trả: chỉ máy chủ M2 mới có `suggestionsMeta` / `suggestionsEnabled` (máy chủ trước M2
 * không có khoá nào, và gửi `suggestionState`/`suggestionsEnabled` lên nó là 422 khối cả tầng).
 */
export const fromM2Server = (entry: FloorSuggestions): boolean => entry.meta !== undefined || entry.enabled === true;

/** Phần lớp đề xuất của thân #35 cho một tầng; `null` = không mang gì. */
export function suggestionBodyOf(
  entry: FloorSuggestions | undefined,
): { suggestionState?: SuggestionStateRow[]; suggestionsEnabled?: boolean } | null {
  if (entry === undefined || (entry.dirty !== true && entry.enabledChanged !== true)) return null;
  return {
    ...(entry.dirty === true ? { suggestionState: sparseStateOf(entry.suggestions) } : {}),
    ...(entry.enabledChanged === true ? { suggestionsEnabled: entry.enabled === true } : {}),
  };
}

/** Tầng vừa có sửa lớp đề xuất chưa gửi (so với lượt kho trước): mỗi tầng ấy là một lượt lưu. */
export function suggestionFloorsToSave(
  next: Readonly<Record<string, FloorSuggestions>>,
  previous: Readonly<Record<string, FloorSuggestions>>,
): string[] {
  return Object.entries(next)
    .filter(([floorId, entry]) => entry !== previous[floorId] && (entry.dirty === true || entry.enabledChanged === true))
    .map(([floorId]) => floorId);
}

/** Cổng kho tối thiểu (lib không nhập store): đọc mục tầng và thay một mục. */
export interface FloorSuggestionStore {
  getState(): {
    readonly floorSuggestions: Readonly<Record<string, FloorSuggestions>>;
    readonly putFloorSuggestions: (floorId: string, entry: FloorSuggestions) => void;
  };
}

/** Kết quả #35 vào kho: thay mục tầng trừ khi còn sửa chưa gửi mà lượt này không mang (`sent` sai). */
export function storeReceived(
  store: FloorSuggestionStore,
  floorId: string,
  result: {
    readonly suggestions?: readonly Suggestion[] | undefined;
    readonly suggestionsMeta?: SuggestionsMeta | undefined;
    readonly suggestionsEnabled?: true | undefined;
  },
  sent: boolean,
): void {
  const next = receivedEntry(
    store.getState().floorSuggestions[floorId],
    {
      suggestions: result.suggestions ?? [],
      ...(result.suggestionsMeta === undefined ? {} : { meta: result.suggestionsMeta }),
      ...(result.suggestionsEnabled === true ? { enabled: true as const } : {}),
    },
    sent,
  );
  if (next !== null) store.getState().putFloorSuggestions(floorId, next);
}

/**
 * Dời/xoay món đề xuất = nhận nuôi: `toSpatial` đã ghi đồ thật kèm `origin`; chuyển bản ghi sang `adopted`
 * (bẩn → lượt lưu mang `suggestionState`). Hoàn tác xoá đồ thì máy chủ tự về `disabled` (bước 6).
 */
export function storeAdoptions(store: FloorSuggestionStore, spatial: NormalizedSpatial): void {
  for (const [floorId, suggestionId, furnitureId] of floorAdoptionsOf(spatial, store.getState().floorSuggestions)) {
    const next = changedEntry(store.getState().floorSuggestions[floorId], suggestionId, 'adopted', furnitureId);
    if (next !== null) store.getState().putFloorSuggestions(floorId, next);
  }
}

interface Subscribable<S> { subscribe(listener: (state: S, previous: S) => void): () => void }

/**
 * Theo dõi kho từ phía ống tự lưu (nạp lười, để chunk vào không mang logic này): mỗi lượt sửa đồ thị thì đánh dấu
 * món nhận nuôi; mỗi lần lớp đề xuất có sửa chưa gửi thì báo `onTouched(tầng)` để lưu tầng ấy.
 */
export function watchSuggestions(
  spatialStore: Subscribable<{ readonly spatial: NormalizedSpatial | null }>,
  store: FloorSuggestionStore & Subscribable<{ readonly floorSuggestions: Readonly<Record<string, FloorSuggestions>> }>,
  onTouched: (floorIds: string[]) => void,
): () => void {
  const stopSpatial = spatialStore.subscribe((state, previous) => {
    if (state.spatial !== null && state.spatial !== previous.spatial) storeAdoptions(store, state.spatial);
  });
  const stopLayer = store.subscribe((state, previous) => {
    if (state.floorSuggestions === previous.floorSuggestions) return;
    const touched = suggestionFloorsToSave(state.floorSuggestions, previous.floorSuggestions);
    if (touched.length > 0) onTouched(touched);
  });
  // Bộ lưu dựng lại (rời màn/đổi dự án) mà kho còn sửa chưa gửi: quét một lần. Hoãn một nhịp vì lúc `watchSuggestions`
  // chạy bộ lưu chưa gắn xong nên `onTouched` chưa đánh dấu được.
  let stopped = false;
  queueMicrotask(() => {
    const pending = stopped ? [] : suggestionFloorsToSave(store.getState().floorSuggestions, {});
    if (pending.length > 0) onTouched(pending);
  });
  return () => {
    stopped = true;
    stopSpatial();
    stopLayer();
  };
}
