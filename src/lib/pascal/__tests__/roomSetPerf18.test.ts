/**
 * Vòng 18 LP — tăng tốc `roomSetOf` không đổi quyết định: lọc hộp bao ngoài trước phép cắt đa giác (`overlapAreaM2`) và
 * nhớ `hardRejectOf` trong MỘT lượt gọi (không giữ gì sang lượt sau).
 */
import { describe, expect, it } from 'vitest';

import type { ModelQuality } from '../libraryQuality';
import { overlapAreaMm2 } from '../placement';
import { overlapAreaM2, planRectOf, roomSetOf, type Dims, type SetContext, type SetMember } from '../roomSet';

const qual = (role: string): ModelQuality => ({
  role,
  useMm: [1000, 1000, 1000],
  front: { axis: '+z', check: 'ok', by: 'import' },
  parts: [{ kind: 'frame', share: 1, lab: [62, 8, 24], kindBy: 'm', material: 'wood' }],
  detail: { tris: 1, kb: 1, textures: 0, maxTex: 0, tier: 'light' },
  licence: 'CC0',
  source: 'test',
});

describe('LP — overlapAreaM2 lọc nhanh cho cùng kết quả với phép cắt thật', () => {
  it('xa nhau → 0; sát/chồng (mọi góc xoay) → đúng bằng overlapAreaMm2', () => {
    const mm = (r: ReturnType<typeof planRectOf>) => ({ ...r, cx: r.cx * 1000, cy: r.cy * 1000, w: r.w * 1000, d: r.d * 1000 });
    for (const rot of [0, 17, 45, 90, 133]) {
      for (const dx of [0, 0.3, 0.9, 1.0005, 1.0015, 1.2, 3]) {
        const a = planRectOf(0, 0, 1.2, 0.8, rot);
        const b = planRectOf(dx + 0.4, dx / 3, 0.6, 0.6, 30);
        expect(overlapAreaM2(a, b)).toBe(overlapAreaMm2(mm(a), mm(b)) / 1e6);
      }
    }
    expect(overlapAreaM2(planRectOf(0, 0, 1, 1, 0), planRectOf(5, 0, 1, 1, 45))).toBe(0);
  });
});

describe('LP — bộ nhớ ràng buộc cứng chỉ sống trong một lượt roomSetOf', () => {
  const dims: Record<string, Dims> = { a: [0.5, 0.45, 0.4], b: [0.5, 0.45, 0.4] };
  const member: SetMember = {
    id: 'n',
    role: 'nightstand',
    short: 0.4,
    long: 0.5,
    current: null,
    pool: ['a', 'b'],
    fixed: false,
    box: { cx: 0, cy: 0, w: 0.5, d: 0.4, rot: 0 },
    shownOf: (f) => dims[f],
  };
  it('cùng đối tượng món, đổi dữ liệu chất lượng giữa hai lượt → lượt sau thấy dữ liệu mới', () => {
    const table: Record<string, ModelQuality | undefined> = { a: qual('nightstand'), b: qual('nightstand') };
    let calls = 0;
    const ctx: SetContext = {
      tierOf: (f) => (f === 'a' ? 0 : 1),
      tiers: 3,
      dimsOf: (f) => dims[f],
      palette: { light: true, tone: 'l' },
      qualityOf: (f) => {
        calls += 1;
        return table[f];
      },
    };
    expect(roomSetOf('k', [member], new Map(), ctx).get('n')?.to).toBe('a');
    const first = calls;
    // Lượt dựng sau: mẫu 'a' mất dữ liệu (thư viện tải lại) — không được trả kết quả nhớ của lượt trước.
    table.a = undefined;
    const second = roomSetOf('k', [member], new Map(), ctx).get('n');
    expect(second?.to).toBe('b');
    expect(calls).toBeGreaterThan(first);
  });
});
