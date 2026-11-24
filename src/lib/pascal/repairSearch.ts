/**
 * L7-07 phương án B — luật sửa cảnh chạy TĂNG DẦN ở chỗ đắt nhất: lần dò chỗ hợp lệ gần nhất (`nearestShift` trong
 * `sceneRepair.ts`). Đo 24/11 trên 23 căn bộ chấm `sceneFurnish` (#73): dò chỗ chiếm 95–98 % `repairScene`; phần lớn là
 * lần dò THẤT BẠI (quét hết ~2 800 lệch × 3 mức) lặp lại y hệt ở mỗi vòng luật và mỗi lượt thả, dù quanh món không có
 * gì đổi.
 *
 * Phạm vi một lần dò: mọi chỗ thử có tâm cách tâm món ≤ `max`, nên chỉ vật chắn / tường / vùng mở cửa / phòng nằm trong
 * tầm `reach` (= `max` + nửa chéo món + khe lưng tường + 2 khe đồ + 10 mm, cộng nửa chéo của chính vật kia) có thể đổi kết
 * quả. Ngoài tầm thì mọi phép thử `rectsOverlap` / chứa tâm đều trả "không" — bỏ khỏi danh sách là CHÍNH XÁC, không xấp
 * xỉ. Kết quả dò là hàm thuần của (món, phòng đích, tham số, các danh sách trong tầm) nên nhớ theo chữ ký đó: lượt thả
 * chỉ dò lại món có thứ gì trong tầm vừa đổi (phòng/món bị chạm + vòng lân cận theo khoảng cách thật). Số không hữu hạn
 * luôn được giữ trong danh sách (so sánh với NaN là "không xa") để hành vi y như bản toàn cảnh.
 *
 * Lùi: `?disable=incrementalRules` — dò toàn cảnh, không nhớ (bản trước L7-07 B). Test cổng
 * `__tests__/sceneRepairIncremental.test.ts` đối chiếu hai đường trên 23 căn thật × nhiều kiểu sửa.
 */
import type { Furniture, Point, Room } from '@/domain/spatial/types';

import type { Rect } from './placement';

/** Cờ `?disable=` tắt đường tăng dần. */
export const INCREMENTAL_RULES_FLAG = 'incrementalRules';

export interface Placed {
  readonly centre: Point;
  readonly rotationDeg: number;
}

/** Danh sách trong tầm của một lần dò (cùng thứ tự với danh sách đầy đủ). */
export interface SearchScope {
  readonly walls: readonly Rect[];
  readonly swings: readonly Rect[];
  /** Phòng khác cùng tầng có hộp bao chạm vùng tâm thử. */
  readonly rooms: readonly Room[];
  /** Vật chắn: mọi món (mức 1) / chỉ món ưu tiên hơn (mức 2, 3). */
  readonly all: readonly Rect[];
  readonly stronger: readonly Rect[];
}

/** Lệch lưới bước `step` trong bán kính `max`, gần trước (hoà: theo góc, cố định) — dùng chung cho mọi lần dò. */
const offsetsCache = new Map<string, readonly Point[]>();
export const offsetsWithin = (max: number, step: number): readonly Point[] => {
  const cached = offsetsCache.get(`${max}/${step}`);
  if (cached !== undefined) return cached;
  const n = Math.floor(max / step);
  const out: Point[] = [];
  for (let i = -n; i <= n; i += 1) for (let j = -n; j <= n; j += 1) if (Math.hypot(i, j) * step <= max) out.push({ x: i * step, y: j * step });
  out.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y) || Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
  offsetsCache.set(`${max}/${step}`, out);
  return out;
};

/** Lệch trượt dọc tường (trục x riêng của món, gần trước, + trước −) bước `step` tới `max`. */
export const slideOffsets = (f: Pick<Furniture, 'rotationDeg'>, max: number, step: number): Point[] => {
  const t = (f.rotationDeg * Math.PI) / 180;
  const out: Point[] = [];
  for (let k = 1; k * step <= max; k += 1) for (const s of [1, -1]) out.push({ x: Math.cos(t) * s * k * step, y: Math.sin(t) * s * k * step });
  return out;
};

const halfDiag = (r: Rect): number => Math.hypot(r.w, r.d) / 2;

/** Tầm của lần dò quanh `f` bán kính `max` (mm), chưa cộng nửa chéo vật kia. */
export const reachOf = (f: Rect, max: number, backGapMm: number, gapMm: number): number => max + halfDiag(f) + backGapMm + 2 * gapMm + 10;

/** `r` có thể chạm chỗ thử — viết phủ định để toạ độ NaN vẫn được giữ như bản toàn cảnh. */
export const rectInReach = (centre: Point, reach: number) => (r: Rect): boolean =>
  !(Math.hypot(r.cx - centre.x, r.cy - centre.y) > reach + halfDiag(r));

/** Hộp bao đường bao phòng chạm hình vuông tâm `centre` cạnh 2·`max` (+1 mm). */
export const roomInReach = (centre: Point, max: number) => (room: Room): boolean => {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const m = max + 1;
  return !(Math.min(...xs) > centre.x + m || Math.max(...xs) < centre.x - m || Math.min(...ys) > centre.y + m || Math.max(...ys) < centre.y - m);
};

const rectKey = (r: Rect): string => `${r.cx},${r.cy},${r.w},${r.d},${r.rotationDeg}`;
const rectsKey = (list: readonly Rect[]): string => list.map(rectKey).join(';');

/** Chữ ký đầy đủ đầu vào của một lần dò; hai lần dò cùng chữ ký cho cùng kết quả. */
export const searchKeyOf = (
  f: Furniture,
  room: Room,
  params: { readonly max: number; readonly rotationDeg: number; readonly slide: boolean; readonly keepWall: boolean },
  scope: SearchScope,
): string =>
  [
    JSON.stringify([f.centre, f.boundingBox, f.rotationDeg, f.kind, f.variant ?? null, f.levelId]),
    JSON.stringify([room.id, room.levelId, room.outline]),
    `${params.max}|${params.rotationDeg}|${params.slide}|${params.keepWall}`,
    rectsKey(scope.all),
    rectsKey(scope.stronger),
    rectsKey(scope.walls),
    rectsKey(scope.swings),
    JSON.stringify(scope.rooms.map((r) => [r.id, r.outline])),
  ].join('\n');

/** Ô nhớ dùng chung mọi lượt (hàm thuần, nên giữ qua lượt thả); bỏ mục cũ nhất khi đầy. */
const MEMO_MAX = 1024;
const memo = new Map<string, Placed | null>();
/** Đếm trúng/trượt (test + `?perf`): trượt = lần dò thật sự chạy lại. */
export const repairSearchStats = { hits: 0, misses: 0 };

export const memoSearch = (key: string, search: () => Placed | null): Placed | null => {
  if (memo.has(key)) {
    repairSearchStats.hits += 1;
    return memo.get(key) as Placed | null;
  }
  repairSearchStats.misses += 1;
  const found = search();
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, found);
  return found;
};

/** Test: xoá ô nhớ để đo/đối chiếu từ trạng thái nguội. */
export const clearRepairSearchMemo = (): void => {
  memo.clear();
  repairSearchStats.hits = 0;
  repairSearchStats.misses = 0;
};
