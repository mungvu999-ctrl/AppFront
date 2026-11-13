/**
 * M18 LA (S3) — món NGƯỜI DÙNG ghim mẫu ("Đổi mẫu", `userPin`) vẫn là vật cản + giữ mẫu, nhưng không dẫn nhóm / không góp
 * bảng màu, gỗ tham chiếu: sửa một món không làm anh em đổi mẫu khi tải lại. Ghim khác (twin `pinTo`, khe) giữ hành vi cũ.
 */
import { describe, expect, it } from 'vitest';

import type { ModelQuality, QualityPart } from '../libraryQuality';
import { roomSetOf, type Dims, type SetContext, type SetMember } from '../roomSet';

const part = (kind: QualityPart['kind'], lab: readonly [number, number, number], material: QualityPart['material']): QualityPart =>
  ({ kind, share: 1, lab, material, kindBy: 'm' }) as QualityPart;
const q = (role: string, p: QualityPart): ModelQuality =>
  ({
    role,
    useMm: [1000, 1000, 1000],
    front: { axis: '+z', check: 'ok' },
    parts: [p],
    completeness: { v: 'full', by: 'm' },
    detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
    licence: 'CC0',
    source: 'test',
  }) as unknown as ModelQuality;
const OAK = [72, 6, 26] as const;
const WALNUT = [32, 10, 18] as const;
const Q: Record<string, ModelQuality> = {
  table: q('diningTable', part('top', OAK, 'wood')),
  'chair-a': q('diningChair', part('frame', OAK, 'wood')),
  'chair-b': q('diningChair', part('frame', OAK, 'wood')),
  'sofa-oak': q('sofa', part('frame', OAK, 'wood')),
  'sofa-walnut': q('sofa', part('frame', WALNUT, 'wood')),
  'ct-oak': q('coffeeTable', part('top', OAK, 'wood')),
  'ct-walnut': q('coffeeTable', part('top', WALNUT, 'wood')),
};
const DIMS: Record<string, Dims> = {
  table: [1.2, 0.75, 0.8],
  'chair-a': [0.46, 0.85, 0.5],
  'chair-b': [0.46, 0.85, 0.5],
  'sofa-oak': [2, 0.8, 0.9],
  'sofa-walnut': [2, 0.8, 0.9],
  'ct-oak': [1, 0.45, 0.6],
  'ct-walnut': [1, 0.45, 0.6],
};
const ctx: SetContext = { tierOf: () => 0, tiers: 5, dimsOf: (id) => DIMS[id], palette: {}, qualityOf: (id) => Q[id] };
const chair = (id: string, cx: number, cy: number, extra: Partial<SetMember> = {}): SetMember => ({
  id,
  role: 'diningChair',
  short: 1,
  long: 1,
  current: 'chair-a',
  pool: ['chair-a', 'chair-b'],
  fixed: false,
  sizeFrom: 'ai',
  box: { cx, cy, w: 0.46, d: 0.5, rot: 0 },
  ...extra,
});
const table: SetMember = {
  id: 't',
  role: 'diningTable',
  short: 3,
  long: 3,
  current: 'table',
  pool: ['table'],
  fixed: false,
  sizeFrom: 'ai',
  box: { cx: 0, cy: 0, w: 1.2, d: 0.8, rot: 0 },
};
const chairsAt = [
  ['c1', -0.35, 0.7],
  ['c2', 0.35, 0.7],
  ['c3', -0.35, -0.7],
  ['c4', 0.35, -0.7],
] as const;
const toOf = (out: ReadonlyMap<string, { readonly to: string | null }>, ids: readonly string[]): (string | null | undefined)[] =>
  ids.map((id) => out.get(id)?.to);

describe('S3: ghim một ghế ăn không kéo các ghế cùng bàn', () => {
  const free = chairsAt.map(([id, cx, cy]) => chair(id, cx, cy));
  const base = roomSetOf('r', [table, ...free], new Map(), ctx);
  const shared = base.get('c2')?.to as string;
  const other = shared === 'chair-a' ? 'chair-b' : 'chair-a';
  const pinOf = (extra: Partial<SetMember>): SetMember[] => [
    table,
    chair('c1', -0.35, 0.7, { fixed: true, current: other, pool: [], ...extra }),
    ...free.slice(1),
  ];

  it('mốc: không ghim → cả bàn một mẫu', () => {
    expect(toOf(base, ['c1', 'c2', 'c3', 'c4'])).toEqual([shared, shared, shared, shared]);
  });

  it('người dùng ghim c1 mẫu khác → c2..c4 giữ đúng quyết định như khi không ghim; c1 giữ mẫu ghim', () => {
    const out = roomSetOf('r', pinOf({ userPin: true }), new Map(), ctx);
    expect(out.get('c1')).toMatchObject({ to: other, cause: 'pinned' });
    expect(toOf(out, ['c2', 'c3', 'c4'])).toEqual(toOf(base, ['c2', 'c3', 'c4']));
  });

  it('ghim không phải của người dùng (cặp đã nhận, khe…) vẫn dẫn nhóm như cũ', () => {
    const out = roomSetOf('r', pinOf({}), new Map(), ctx);
    expect(toOf(out, ['c2', 'c3', 'c4'])).toEqual([other, other, other]);
  });
});

describe('S3: đổi mẫu sofa (người dùng ghim) không đổi bàn trà', () => {
  const sofa = (current: string, userPin: boolean): SetMember => ({
    id: 's',
    role: 'sofa',
    short: 0.9,
    long: 2,
    current,
    pool: [],
    fixed: true,
    ...(userPin ? { userPin: true } : {}),
    sizeFrom: 'user',
    box: { cx: 0, cy: 1.2, w: 2, d: 0.9, rot: 0 },
  });
  const coffee: SetMember = {
    id: 'ct',
    role: 'coffeeTable',
    short: 0.6,
    long: 1,
    current: 'ct-oak',
    pool: ['ct-oak', 'ct-walnut'],
    fixed: false,
    sizeFrom: 'ai',
    box: { cx: 0, cy: 0, w: 1, d: 0.6, rot: 0 },
  };
  const ctOf = (s: SetMember): string | null | undefined => roomSetOf('r', [s, coffee], new Map(), ctx).get('ct')?.to;

  it('sofa gỗ sồi ↔ óc chó do người dùng chọn: bàn trà cùng một mẫu', () => {
    expect(ctOf(sofa('sofa-walnut', true))).toBe(ctOf(sofa('sofa-oak', true)));
  });

  it('mốc: ghim không phải người dùng vẫn dẫn gỗ tham chiếu (bàn trà theo gỗ sofa)', () => {
    expect(ctOf(sofa('sofa-walnut', false))).toBe('ct-walnut');
    expect(ctOf(sofa('sofa-oak', false))).toBe('ct-oak');
  });
});
