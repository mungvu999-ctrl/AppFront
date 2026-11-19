import { describe, expect, it } from 'vitest';

import { MOCK_HOUSE_PROPOSAL } from '@/api/__mocks__/client';
import {
  HOUSE_QUESTION_CODES,
  HOUSE_STOREY_LABELS,
  type HouseFloorProposal,
  type HouseProposal,
} from '@/api/schemas/houseProposal';

import {
  confidenceLabelOf,
  HOUSE_QUESTION_TEXTS,
  type HouseProjectFloor,
  statusOfConfidence,
  storeyTextOf,
  summarise,
  toHouseProposalRows,
} from './houseProposal';
import { VIEW_STATUS_CODES } from './types';

const floor = (id: string, order: number, elevationMm = 0, heightMm = 3300): HouseProjectFloor => ({
  id,
  name: `Tầng ${order + 1}`,
  order,
  elevationMm,
  heightMm,
});

const entry = (floorId: string, patch: Partial<HouseFloorProposal> = {}): HouseFloorProposal => ({
  floorId,
  kind: 'plan',
  kindConfidence: 0.95,
  storeyLabel: 'floor',
  storeyNo: 2,
  storeyConfidence: 0.95,
  elevationMm: 3600,
  elevationConfidence: 0.95,
  elevationSource: 'plan+section',
  heightMm: 3300,
  heightConfidence: 0.95,
  heightSource: 'plan+section',
  questions: [],
  ...patch,
});

const proposalOf = (...floors: HouseFloorProposal[]): HouseProposal => ({ floors, runIds: ['run-1'] });

describe('statusOfConfidence', () => {
  it('đúng ranh giới 0,9 và 0,7; không bao giờ verified', () => {
    expect(statusOfConfidence(1)).toBe('neutral');
    expect(statusOfConfidence(0.9)).toBe('neutral');
    expect(statusOfConfidence(0.8999)).toBe('attention');
    expect(statusOfConfidence(0.7)).toBe('attention');
    expect(statusOfConfidence(0.6999)).toBe('violation');
    expect(statusOfConfidence(0)).toBe('violation');
    expect(statusOfConfidence(undefined)).toBe('neutral');

    for (let c = 0; c <= 1; c += 0.01) {
      expect(statusOfConfidence(c)).not.toBe('verified');
      expect(VIEW_STATUS_CODES).toContain(statusOfConfidence(c));
    }
  });
});

describe('confidenceLabelOf', () => {
  it('ba nhãn bằng lời, ranh giới 0,9 và 0,7', () => {
    expect(confidenceLabelOf(0.9)).toBe('Hai nguồn khớp');
    expect(confidenceLabelOf(0.89)).toBe('Một nguồn');
    expect(confidenceLabelOf(0.7)).toBe('Một nguồn');
    expect(confidenceLabelOf(0.69)).toBe('Chưa chắc');
  });
});

describe('storeyTextOf', () => {
  it('đủ sáu nhãn và trường hợp chưa rõ', () => {
    expect(storeyTextOf('ground', 1)).toBe('Tầng trệt');
    expect(storeyTextOf('basement', -1)).toBe('Tầng hầm');
    expect(storeyTextOf('mezzanine', undefined)).toBe('Tầng lửng');
    expect(storeyTextOf('attic', undefined)).toBe('Tầng áp mái');
    expect(storeyTextOf('roof_terrace', undefined)).toBe('Sân thượng');
    expect(storeyTextOf('floor', 2)).toBe('Tầng 2');
    expect(storeyTextOf('floor', 12)).toBe('Tầng 12');
    expect(storeyTextOf('floor', undefined)).toBe('Chưa rõ tầng');
    expect(storeyTextOf('floor', 0)).toBe('Chưa rõ tầng');
    expect(storeyTextOf(undefined, 3)).toBe('Chưa rõ tầng');
  });

  it('mọi nhãn của hợp đồng đều có chữ', () => {
    for (const label of HOUSE_STOREY_LABELS) {
      expect(storeyTextOf(label, 2)).toMatch(/^(Tầng|Sân)/);
    }
  });
});

describe('câu hỏi', () => {
  it('mỗi mã có đúng một câu tiếng Việt có dấu, ngắn, kết thúc bằng dấu chấm', () => {
    expect(Object.keys(HOUSE_QUESTION_TEXTS).sort()).toEqual([...HOUSE_QUESTION_CODES].sort());

    for (const code of HOUSE_QUESTION_CODES) {
      const text = HOUSE_QUESTION_TEXTS[code];

      expect(text).toMatch(/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i);
      expect(text.endsWith('.')).toBe(true);
      expect(text.length).toBeLessThanOrEqual(100);
    }
  });

  it('dòng mang câu theo mã, bỏ mã trùng, giữ thứ tự', () => {
    const [row] = toHouseProposalRows(
      proposalOf(entry('a', { questions: [{ code: 'NO_TEXT' }, { code: 'NOT_A_PLAN' }, { code: 'NO_TEXT' }] })),
      [floor('a', 0)],
    );

    expect(row?.questions).toEqual([HOUSE_QUESTION_TEXTS.NO_TEXT, HOUSE_QUESTION_TEXTS.NOT_A_PLAN]);
  });
});

describe('toHouseProposalRows — một dòng', () => {
  it('định dạng cao độ và chiều cao như màn Quản lý tầng, kèm nguồn bằng lời', () => {
    const [row] = toHouseProposalRows(proposalOf(entry('a')), [floor('a', 1, 0, 3000)]);

    expect(row?.floorName).toBe('Tầng 2');
    expect(row?.storeyText).toBe('Tầng 2');
    expect(row?.elevation.proposedText).toBe('+3.600');
    expect(row?.elevation.currentText).toBe('±0.000');
    expect(row?.elevation.sourceText).toBe('mặt bằng và mặt cắt');
    expect(row?.height.proposedText).toBe('3.300');
    expect(row?.height.currentText).toBe('3.000');
  });

  it('khác bao nhiêu: cao độ theo mét, chiều cao theo mm, có dấu', () => {
    const [row] = toHouseProposalRows(proposalOf(entry('a', { elevationMm: 600, heightMm: 2700 })), [
      floor('a', 0, 3600, 3000),
    ]);

    expect(row?.elevation.differs).toBe(true);
    expect(row?.elevation.deltaText).toBe('−3.000 m');
    expect(row?.height.deltaText).toBe('−300 mm');
  });

  it('bằng giá trị hiện tại thì không khác, không nhận được, không có delta', () => {
    const [row] = toHouseProposalRows(proposalOf(entry('a', { elevationMm: 0, heightMm: 3300 })), [floor('a', 0)]);

    expect(row?.elevation.differs).toBe(false);
    expect(row?.elevation.deltaText).toBeNull();
    expect(row?.elevation.acceptable).toBe(false);
    expect(row?.height.acceptable).toBe(false);
    expect(row?.anyAcceptable).toBe(false);
    expect(row?.oneClick).toBe(false);
  });

  it('nhận được khi có, khác, và nằm trong khoảng; ngoài khoảng thì không', () => {
    const inside = toHouseProposalRows(proposalOf(entry('a', { elevationMm: 300000, heightMm: 2000 })), [floor('a', 0)]);
    const outside = toHouseProposalRows(proposalOf(entry('a', { elevationMm: 300001, heightMm: 1999 })), [floor('a', 0)]);
    const farBelow = toHouseProposalRows(proposalOf(entry('a', { elevationMm: -30001, heightMm: 10001 })), [
      floor('a', 0),
    ]);

    expect(inside[0]?.elevation.acceptable).toBe(true);
    expect(inside[0]?.height.acceptable).toBe(true);
    expect(outside[0]?.elevation.acceptable).toBe(false);
    expect(outside[0]?.height.acceptable).toBe(false);
    expect(farBelow[0]?.elevation.acceptable).toBe(false);
    expect(farBelow[0]?.height.acceptable).toBe(false);
  });

  it('thiếu cao độ/chiều cao: ô trống, không nhận được; độ chắc dòng chỉ tính ô có mặt', () => {
    const [row] = toHouseProposalRows(
      proposalOf(
        entry('a', {
          storeyConfidence: 0.8,
          elevationMm: undefined,
          elevationConfidence: undefined,
          elevationSource: undefined,
          heightMm: undefined,
          heightConfidence: undefined,
          heightSource: undefined,
        }),
      ),
      [floor('a', 0)],
    );

    expect(row?.elevation.hasProposal).toBe(false);
    expect(row?.elevation.proposedText).toBe('—');
    expect(row?.elevation.acceptable).toBe(false);
    expect(row?.minConfidence).toBe(0.8);
    expect(row?.statusCode).toBe('attention');
  });

  it('có giá trị mà thiếu độ chắc thì coi là không chắc', () => {
    const [row] = toHouseProposalRows(proposalOf(entry('a', { heightConfidence: undefined })), [floor('a', 0)]);

    expect(row?.height.statusCode).toBe('violation');
    expect(row?.height.confidenceLabel).toBe('Chưa chắc');
    expect(row?.needsLook).toBe(true);
  });

  it('trạng thái từng ô theo độ chắc của chính ô đó', () => {
    const [row] = toHouseProposalRows(
      proposalOf(entry('a', { storeyConfidence: 0.9, elevationConfidence: 0.7, heightConfidence: 0.69 })),
      [floor('a', 0)],
    );

    expect(row?.storeyStatusCode).toBe('neutral');
    expect(row?.elevation.statusCode).toBe('attention');
    expect(row?.height.statusCode).toBe('violation');
    expect(row?.statusCode).toBe('violation');
  });
});

describe('toHouseProposalRows — danh sách', () => {
  it('thứ tự dòng là thứ tự tầng của dự án (order), không xếp theo độ chắc', () => {
    const floors = [floor('c', 2), floor('a', 0), floor('b', 1), floor('d', 3)];
    const rows = toHouseProposalRows(
      proposalOf(
        entry('c', { storeyConfidence: 0.95 }),
        entry('a', { storeyConfidence: 0.95 }),
        entry('b', { storeyConfidence: 0.5 }),
        entry('d', { storeyConfidence: 0.5 }),
      ),
      floors,
    );

    expect(rows.map((row) => row.floorId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tầng có trong dự án mà máy không đề xuất: giữ đúng chỗ, dòng "chưa có đề xuất"', () => {
    const rows = toHouseProposalRows(proposalOf(entry('b', { storeyConfidence: 0.1 })), [floor('a', 0), floor('b', 1)]);

    expect(rows.map((row) => row.floorId)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({
      floorId: 'a',
      hasProposal: false,
      noProposalText: 'Máy chưa có đề xuất cho tầng này',
      storeyText: '—',
      minConfidence: null,
      statusCode: 'neutral',
      questions: [],
      oneClick: false,
      needsLook: false,
    });
    expect(rows[0]?.elevation.hasProposal).toBe(false);
    expect(rows[0]?.elevation.currentText).toBe('±0.000');
    expect(rows[0]?.height.currentText).toBe('3.300');
    expect(rows[1]?.statusCode).toBe('violation');
  });

  it('id đề xuất dự án không có thì bỏ', () => {
    const rows = toHouseProposalRows(proposalOf(entry('ghost'), entry('a')), [floor('a', 0)]);

    expect(rows.map((row) => row.floorId)).toEqual(['a']);
  });

  it('không dòng nào mang verified', () => {
    const rows = toHouseProposalRows(MOCK_HOUSE_PROPOSAL, [floor('L-00000000L1', 0)]);

    for (const row of rows) {
      expect([row.statusCode, row.storeyStatusCode, row.elevation.statusCode, row.height.statusCode]).not.toContain(
        'verified',
      );
    }
  });
});

describe('một cú bấm theo từng ô', () => {
  const only = (patch: Partial<HouseFloorProposal>, current = floor('a', 0, 0, 3000)) =>
    toHouseProposalRows(proposalOf(entry('a', patch)), [current])[0];

  it('đúng ranh giới 0,7: ô >= 0,7, khác hiện tại, không câu hỏi thì nhận được ngay', () => {
    const row = only({ elevationConfidence: 0.7, heightConfidence: 0.69 });

    expect(row?.elevation.oneClick).toBe(true);
    expect(row?.height.oneClick).toBe(false);
    expect(row?.oneClick).toBe(true);
  });

  it('có câu hỏi thì không ô nào nhận ngay', () => {
    const row = only({ questions: [{ code: 'HEIGHT_ASSUMED' }] });

    expect(row?.elevation.acceptable).toBe(true);
    expect(row?.elevation.oneClick).toBe(false);
    expect(row?.height.oneClick).toBe(false);
    expect(row?.oneClick).toBe(false);
  });

  it('bằng giá trị hiện tại hoặc ngoài khoảng thì không nhận ngay', () => {
    expect(only({ elevationMm: 0 })?.elevation.oneClick).toBe(false);
    expect(only({ heightMm: 1999 })?.height.oneClick).toBe(false);
  });

  it('không cần độ chắc 0,9: chỉ có mặt bằng cũng nhận ngay được', () => {
    expect(only({ elevationConfidence: 0.8, heightConfidence: 0.8 })?.oneClick).toBe(true);
  });
});

describe('summarise', () => {
  it('đếm tầng khác giá trị, tầng cần xem, và Ô nhận một cú bấm', () => {
    const rows = toHouseProposalRows(
      proposalOf(
        entry('a'), // chắc, khác: hai ô nhận ngay
        entry('b', { elevationMm: 0, heightMm: 3000 }), // không khác
        entry('c', { heightConfidence: 0.8 }), // khác, hai ô nhận ngay
        entry('d', { elevationConfidence: 0.5 }), // khác, cần xem; chỉ ô chiều cao nhận ngay
        entry('e', { questions: [{ code: 'HEIGHT_ASSUMED' }] }), // khác nhưng có câu hỏi
      ),
      [0, 1, 2, 3, 4, 5].map((n) => floor('abcdef'.charAt(n), n, 0, 3000)),
    );
    const summary = summarise(rows);

    expect(summary.proposedCount).toBe(5);
    expect(summary.differingCount).toBe(4);
    expect(summary.needsLookCount).toBe(1);
    expect(summary.oneClickCount).toBe(5);
    expect(summary.isEmpty).toBe(false);
    expect(summary.headline).toBe('4 tầng có đề xuất khác giá trị hiện tại, 1 cần xem.');
  });

  it('không có gì khác và không câu hỏi: isEmpty; còn câu hỏi thì không', () => {
    const same = entry('a', { elevationMm: 0, heightMm: 3300 });

    expect(summarise(toHouseProposalRows(proposalOf(same), [floor('a', 0)])).isEmpty).toBe(true);
    expect(
      summarise(toHouseProposalRows(proposalOf({ ...same, questions: [{ code: 'NO_TEXT' }] }), [floor('a', 0)])).isEmpty,
    ).toBe(false);
  });

  it('không có gì khác thì nói không đề xuất thay đổi', () => {
    const summary = summarise(toHouseProposalRows(proposalOf(), [floor('a', 0)]));

    expect(summary).toMatchObject({ proposedCount: 0, differingCount: 0, needsLookCount: 0, oneClickCount: 0, isEmpty: true });
    expect(summary.headline).toBe('Máy không đề xuất thay đổi nào.');
  });
});

describe('ví dụ giả của F1 từ đầu đến cuối (project-1)', () => {
  const projectFloors = [
    { ...floor('L-0000000LX1', 0, -3000, 3000), name: 'Tầng hầm' },
    floor('L-00000000L1', 1, 0, 3900),
    floor('L-00000000L2', 2, 3900, 3600),
    floor('L-00000000L3', 3, 7500, 3600),
  ];
  const rows = toHouseProposalRows(MOCK_HOUSE_PROPOSAL, projectFloors);

  it('thứ tự tầng của dự án, mỗi tầng có đề xuất; dấu trạng thái giữ theo độ chắc', () => {
    expect(rows.map((row) => row.floorId)).toEqual(['L-0000000LX1', 'L-00000000L1', 'L-00000000L2', 'L-00000000L3']);
    expect(rows.map((row) => row.statusCode)).toEqual(['violation', 'attention', 'attention', 'violation']);
  });

  it('các mức xếp chồng khít: cao độ = cao độ tầng dưới + chiều cao tầng dưới', () => {
    for (let index = 1; index < rows.length; index += 1) {
      const below = MOCK_HOUSE_PROPOSAL.floors[index - 1];
      const here = MOCK_HOUSE_PROPOSAL.floors[index];

      expect(here?.elevationMm).toBe((below?.elevationMm ?? NaN) + (below?.heightMm ?? NaN));
    }
  });

  it('chữ từng dòng', () => {
    const [basement, ground, second, third] = rows;

    expect(basement).toMatchObject({ storeyText: 'Tầng hầm', needsLook: true });
    expect(basement?.questions).toEqual([HOUSE_QUESTION_TEXTS.LEVEL_MISSING, HOUSE_QUESTION_TEXTS.HEIGHT_ASSUMED]);
    expect(ground).toMatchObject({ storeyText: 'Tầng trệt', questions: [] });
    expect(ground?.elevation).toMatchObject({ proposedText: '±0.000', differs: false, confidenceLabel: 'Hai nguồn khớp' });
    expect(ground?.height).toMatchObject({ proposedText: '3.600', deltaText: '−300 mm', sourceText: 'kích thước ghi trên bản vẽ' });
    expect(second?.elevation).toMatchObject({ proposedText: '+3.600', deltaText: '−0.300 m', confidenceLabel: 'Một nguồn' });
    expect(third?.questions).toHaveLength(3);
    expect(third?.height.sourceText).toBe('giả định');
  });

  it('thanh tóm tắt: ba ô nhận ngay (T1 cao, T2 cao độ và cao); tầng hầm và tầng 3 còn câu hỏi', () => {
    expect(summarise(rows)).toMatchObject({
      proposedCount: 4,
      differingCount: 4,
      needsLookCount: 2,
      oneClickCount: 3,
      isEmpty: false,
    });
    expect(rows.flatMap((row) => [row.elevation, row.height]).filter((field) => field.oneClick)).toHaveLength(3);
  });
});
