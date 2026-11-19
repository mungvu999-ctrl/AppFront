import { describe, expect, it } from 'vitest';

import { MOCK_HOUSE_PROPOSAL } from '@/api/__mocks__/client';
import type { HouseFloorProposal, HouseProposal } from '@/api/schemas/houseProposal';

import {
  HOUSE_ASSUMED_HINT,
  type HouseProjectFloor,
  storeyTextOf,
  summarise,
  toHouseProposalRows,
} from './houseProposal';
import { questionsOf } from './houseProposalParts';

/** Ba tầng xếp khít: T1 ±0/3.600, T2 +3.600/3.600, T3 +7.200/3.600. */
const floor = (index: number, elevationMm: number, heightMm = 3600): HouseProjectFloor => ({
  id: `F${index}`,
  name: `Tầng ${index}`,
  order: index,
  elevationMm,
  heightMm,
});
const STACK = [floor(1, 0), floor(2, 3600), floor(3, 7200)];

const entry = (floorId: string, patch: Partial<HouseFloorProposal> = {}): HouseFloorProposal => ({
  floorId,
  kind: 'plan',
  kindConfidence: 0.95,
  storeyLabel: 'floor',
  storeyNo: 2,
  storeyConfidence: 0.95,
  elevationConfidence: 0.95,
  heightConfidence: 0.95,
  questions: [],
  ...patch,
});
const proposal = (...floors: HouseFloorProposal[]): HouseProposal => ({ enabled: true, floors, runIds: ['r'] });
const rowsOf = (floors: readonly HouseProjectFloor[], ...entries: HouseFloorProposal[]) =>
  toHouseProposalRows(proposal(...entries), floors);
const rowOf = (id: string, floors: readonly HouseProjectFloor[], ...entries: HouseFloorProposal[]) =>
  rowsOf(floors, ...entries).find((row) => row.floorId === id)!;

describe('chiều cao', () => {
  it('nguồn đọc, khác, trong khoảng, không phải tầng hầm → nhận được, kèm danh sách tầng trên sẽ dời', () => {
    const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, heightMm: 3300, heightSource: 'dims', heightConfidence: 0.8 }));

    expect(row.height).toMatchObject({ acceptable: true, proposedText: '3.300 mm', currentText: '3.600 mm', deltaText: '−300 mm' });
    expect(row.cascade.map((c) => [c.floorName, c.shiftMm])).toEqual([['Tầng 2', -300], ['Tầng 3', -300]]);
    expect(row.height.effectText).toBe('Nhận sẽ dời cao độ Tầng 2, Tầng 3 (−300 mm).');
  });

  it('tầng "Ghi đè" phía trên giữ cao độ: không dời nó, cũng không dời tầng đặt trên nó', () => {
    // T3 ghi đè ở +8.000 (đỉnh T2 là +7.200); T4 đặt trên T3.
    const floors = [floor(1, 0), floor(2, 3600), floor(3, 8000), floor(4, 11600)];
    const row = rowOf('F1', floors, entry('F1', { storeyNo: 1, heightMm: 3300, heightSource: 'plan' }));

    expect(row.cascade.map((c) => c.floorName)).toEqual(['Tầng 2']);
    // Tăng chiều cao T2 đẩy T3 lên khi chạm: T3 chỉ dời phần bị đẩy, T4 theo T3.
    const pushed = rowOf('F2', floors, entry('F2', { heightMm: 5000, heightSource: 'plan' }));
    expect(pushed.cascade.map((c) => [c.floorName, c.shiftMm])).toEqual([['Tầng 3', 600], ['Tầng 4', 600]]);
    expect(pushed.height.effectText).toBe('Nhận sẽ dời cao độ Tầng 3, Tầng 4 (+600 mm).');
  });

  it('giá trị thường gặp (convention/default) không bao giờ nhận được, hiện gợi ý', () => {
    for (const heightSource of ['convention', 'default']) {
      const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, heightMm: 3300, heightSource, heightConfidence: 0.99 }));
      expect(row.height).toMatchObject({ acceptable: false, hint: HOUSE_ASSUMED_HINT, sourceKind: 'assumed' });
      expect(row.height.blockedReason).toContain('gõ vào bảng tầng');
      expect(row.cascade).toEqual([]);
    }
  });

  it('nguồn lạ hoặc thiếu → nguồn chưa rõ, không nhận được', () => {
    for (const heightSource of ['laser', undefined]) {
      const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, heightMm: 3300, ...(heightSource ? { heightSource } : {}) }));
      expect(row.height).toMatchObject({ acceptable: false, sourceKind: 'unknown', sourceText: 'nguồn chưa rõ' });
    }
  });

  it('tầng hầm (nhãn, số tầng < 1, hoặc cao độ âm) không nhận chiều cao', () => {
    const floors = [floor(0, -3000, 3000), floor(1, 0)];
    for (const patch of [{ storeyLabel: 'basement' }, { storeyNo: 0 }, {}]) {
      const row = rowOf('F0', floors, entry('F0', { heightMm: 3300, heightSource: 'plan', ...patch }));
      expect(row.height.acceptable).toBe(false);
      expect(row.height.blockedReason).toContain('Tầng hầm');
    }
  });

  it('bằng giá trị hiện tại → không khác, không nút', () => {
    const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, heightMm: 3600, heightSource: 'plan' }));
    expect(row.height).toMatchObject({ differs: false, acceptable: false, deltaText: null, blockedReason: null });
  });
});

describe('cao độ', () => {
  it('tầng thấp nhất: nguồn đọc, khác, không chạm tầng trên → nhận được; hạ xuống thì báo tầng trên thành Ghi đè', () => {
    const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, elevationMm: -300, elevationSource: 'section' }));
    expect(row.elevation).toMatchObject({ acceptable: true, proposedText: '−0.300 m', deltaText: '−0.300 m' });
    expect(row.elevation.effectText).toBe('Nhận sẽ để hở 300 mm dưới Tầng 2; tầng đó thành "Ghi đè".');
    expect(row.elevationCheck).toBeNull();
  });

  it('tầng thấp nhất nâng lên chạm tầng trên → không nhận được (lệnh đổi cao độ sẽ từ chối)', () => {
    const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, elevationMm: 500, elevationSource: 'plan' }));
    expect(row.elevation.acceptable).toBe(false);
    expect(row.elevation.blockedReason).toContain('chạm lên Tầng 2');
  });

  it('tầng khác: không bao giờ nhận được; đối chiếu với cộng dồn sau khi nhận chiều cao bên dưới', () => {
    const t1 = entry('F1', { storeyNo: 1, heightMm: 3300, heightSource: 'plan' });
    const agree = rowOf('F2', STACK, t1, entry('F2', { elevationMm: 3320, elevationSource: 'plan' }));
    expect(agree.elevation).toMatchObject({ acceptable: false, blockedReason: null, differs: true });
    expect(agree.elevationCheck).toMatchObject({ stackedMm: 3300, stackedText: '+3.300 m', agrees: true, differenceMm: 20 });
    expect(agree.elevationCheck?.text).toBe('Khớp với cộng dồn chiều cao các tầng dưới.');

    const differ = rowOf('F2', STACK, t1, entry('F2', { elevationMm: 3600, elevationSource: 'plan' }));
    expect(differ.elevationCheck).toMatchObject({ agrees: false, differenceMm: 300 });
    expect(differ.elevationCheck?.text).toBe('Lệch 300 mm so với cộng dồn chiều cao các tầng dưới. Xem cốt trên bản vẽ.');
    expect(differ.needsLook).toBe(true);
  });
});

describe('câu hỏi theo ô', () => {
  it('mỗi mã vào đúng ô; mã lạ bị bỏ và đếm', () => {
    const { questionsFor, unknownQuestions } = questionsOf(['LEVEL_MISSING', 'HEIGHT_ASSUMED', 'STOREY_UNSURE', 'NEW_CODE', 'NEW_CODE']);
    expect(questionsFor.elevation).toEqual([expect.stringMatching(/^Cao độ: /)]);
    expect(questionsFor.height).toEqual([expect.stringMatching(/^Chiều cao: .*Xem cốt ở mặt cắt\.$/)]);
    expect(questionsFor.row).toEqual([expect.stringMatching(/^Tầng: /)]);
    expect(unknownQuestions).toBe(1);
    for (const code of ['STOREY_CONFLICT', 'ORDER_DIFFERS', 'NOT_A_PLAN', 'NO_TEXT']) {
      expect(questionsOf([code]).questionsFor.row).toHaveLength(1);
    }
  });

  it('câu hỏi của chiều cao chỉ chặn chiều cao; câu hỏi cả dòng chặn mọi ô', () => {
    const base = { storeyNo: 1, elevationMm: -300, elevationSource: 'plan', heightMm: 3300, heightSource: 'plan' };
    const heightOnly = rowOf('F1', STACK, entry('F1', { ...base, questions: [{ code: 'HEIGHT_ASSUMED' }] }));
    expect([heightOnly.elevation.acceptable, heightOnly.height.acceptable]).toEqual([true, false]);

    const elevationOnly = rowOf('F1', STACK, entry('F1', { ...base, questions: [{ code: 'LEVEL_MISSING' }] }));
    expect([elevationOnly.elevation.acceptable, elevationOnly.height.acceptable]).toEqual([false, true]);

    const whole = rowOf('F1', STACK, entry('F1', { ...base, questions: [{ code: 'ORDER_DIFFERS' }] }));
    expect([whole.elevation.acceptable, whole.height.acceptable, whole.anyAcceptable]).toEqual([false, false, false]);
    expect(whole.needsLook).toBe(true);
  });

  it('mã lạ không chặn ô nào, chỉ được đếm', () => {
    const row = rowOf('F1', STACK, entry('F1', { storeyNo: 1, heightMm: 3300, heightSource: 'plan', questions: [{ code: 'X' }] }));
    expect(row).toMatchObject({ unknownQuestions: 1, anyAcceptable: true, needsLook: false });
  });
});

describe('chữ và tóm tắt', () => {
  it('nhãn lạ → "Chưa rõ tầng"', () => {
    expect(storeyTextOf('loft', undefined)).toBe('Chưa rõ tầng');
    expect(storeyTextOf(undefined, 2)).toBe('Chưa rõ tầng');
    expect(storeyTextOf('floor', 2)).toBe('Tầng 2');
    expect(storeyTextOf('basement', undefined)).toBe('Tầng hầm');
  });

  it('tầng dự án không có đề xuất giữ dòng trống; thứ tự theo dự án', () => {
    const rows = rowsOf([STACK[2]!, STACK[0]!, STACK[1]!], entry('F2', {}));
    expect(rows.map((row) => row.floorId)).toEqual(['F1', 'F2', 'F3']);
    expect(rows[0]).toMatchObject({ hasProposal: false, anyAcceptable: false, cascade: [] });
  });

  it('ví dụ mock: hai tầng nhận được chiều cao, đếm tầng cần xem, không có trường "nhận tất cả"', () => {
    const floors = [floor(0, -3000, 3000), floor(1, 0, 3900), floor(2, 3900), floor(3, 7500)].map((f, i) => ({
      ...f,
      id: MOCK_HOUSE_PROPOSAL.floors[i]!.floorId,
    }));
    const rows = toHouseProposalRows(MOCK_HOUSE_PROPOSAL, floors);
    const summary = summarise(rows);

    expect(rows.map((row) => row.height.acceptable)).toEqual([false, true, true, false]);
    expect(rows.every((row) => !row.elevation.acceptable)).toBe(true);
    expect(rows[2]!.elevationCheck?.agrees).toBe(true);
    expect(summary).toMatchObject({ acceptableCount: 2, needsLookCount: 2 });
    expect(summary.headline).toBe('2 tầng có giá trị nhận được, 2 tầng cần xem.');
    expect(summary).not.toHaveProperty('oneClickCount');
  });

  it('không có gì khác và không có gì cần xem → rỗng', () => {
    const rows = rowsOf(STACK, entry('F1', { storeyNo: 1, heightMm: 3600, heightSource: 'plan' }));
    expect(summarise(rows)).toMatchObject({ isEmpty: true, headline: 'Máy không đề xuất thay đổi nào.' });
  });
});
