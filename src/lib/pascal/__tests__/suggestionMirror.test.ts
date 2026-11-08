/** @vitest-environment node */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CH04, GOLDEN_CASES, storedSuggestionsOf } from '@/lib/suggestions/__fixtures__/golden';
import { MIRROR_RULES, PREVIEW_STALE_VI, metresVi, mirrorSuggestions, polylabel, previewSuggestions } from '@/lib/suggestions/mirror';
import { DEFAULT_RULESET } from '@/lib/suggestions/ruleset';
import defaultRulesetJson from '@/lib/suggestions/defaultRuleset.json';

/**
 * M2 — luật "tự chạy nhẹ" (R1, R4, C2, F1, L1) phải ra ĐÚNG ca vàng của AppBack
 * (`packages/domain/suggestions/tests/data/*.golden.json`, chép nguyên vào `lib/suggestions/__fixtures__`).
 * So JSON chuẩn hoá (khoá sắp, không khoảng trắng) của hai bên sau khi đọc: số nguyên Python ghi `1.0` đọc ra `1`.
 * Lệch ở luật nào thì gỡ luật đó khỏi `MIRROR_RULES` (hạ về chỉ vẽ bản đã lưu), không sửa ca vàng.
 */

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

describe('M2 — gương luật khớp ca vàng AppBack', () => {
  it('bảng luật gói kèm có đúng rulesetSha của ca vàng (sha256 JSON chuẩn hoá như AppBack)', () => {
    const sha = createHash('sha256').update(canonical(defaultRulesetJson), 'utf8').digest('hex');
    for (const golden of GOLDEN_CASES) expect(golden.rulesetSha, golden.name).toBe(sha);
  });

  it('ca vàng chỉ chép đúng năm luật FE tự chạy', () => {
    for (const golden of GOLDEN_CASES) expect([...golden.rules].sort()).toEqual([...MIRROR_RULES].sort());
  });

  for (const golden of GOLDEN_CASES) {
    for (const rule of MIRROR_RULES) {
      it(`${golden.name} · ${rule}: từng byte của JSON chuẩn hoá trùng ca vàng`, () => {
        const want = golden.drafts.filter((d) => d['rule'] === rule);
        const got = mirrorSuggestions(golden.layer, DEFAULT_RULESET, [rule]);
        expect(canonical(got)).toBe(canonical(want));
      });
    }
  }

  it('cả năm luật một lượt = danh sách vàng (sắp theo id)', () => {
    for (const golden of GOLDEN_CASES) expect(canonical(mirrorSuggestions(golden.layer, DEFAULT_RULESET))).toBe(canonical(golden.drafts));
  });

  it('định dạng mét như Python: hoà nhị phân đúng về chẵn, còn lại như toFixed', () => {
    expect(metresVi(125, 2)).toBe('0,12');
    expect(metresVi(375, 2)).toBe('0,38');
    expect(metresVi(2665, 2)).toBe((2.665).toFixed(2).replace('.', ','));
    expect(metresVi(480, 2)).toBe('0,48');
  });

  it('polylabel: hình vuông → tâm; vòng suy biến → góc dưới trái', () => {
    const [x, y] = polylabel([[0, 0], [4000, 0], [4000, 4000], [0, 4000]], 50);
    expect([Math.round(x), Math.round(y)]).toEqual([2000, 2000]);
    expect(polylabel([[0, 0], [10, 0], [10, 10]], 50)).toEqual([0, 0]);
  });

  it('xem trước: dời tường → len của tường ấy đổi đoạn, giữ trạng thái người dùng; luật máy chủ giữ nguyên', () => {
    const saved = storedSuggestionsOf(CH04).map((s) => (s.rule === 'R1' ? { ...s, state: 'disabled' as const } : s));
    expect(previewSuggestions(saved, CH04.layer, DEFAULT_RULESET)).toEqual(saved);

    const r1 = saved.find((s) => s.rule === 'R1' && s.kind === 'skirting')!;
    const layer = { ...CH04.layer, rooms: CH04.layer.rooms.filter((room) => room.id !== r1.hostRef.room) };
    const preview = previewSuggestions(saved, layer, DEFAULT_RULESET);
    expect(preview.find((s) => s.id === r1.id)).toMatchObject({ state: 'disabled', stale: { reasonVi: PREVIEW_STALE_VI } });
    const server = saved.filter((s) => !(MIRROR_RULES as readonly string[]).includes(s.rule));
    expect(preview.filter((s) => !(MIRROR_RULES as readonly string[]).includes(s.rule))).toEqual(server);
  });
});
