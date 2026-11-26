import { describe, expect, it } from 'vitest';

import {
  BuildingDecisionsSchema,
  type BuildingDecisions,
  type BuildingProposal,
} from '@/api/schemas/setBuilding';

import {
  EMPTY_DECISIONS,
  houseActionsOf,
  houseBlockers,
  levelValueFromText,
  levelValueProblem,
  markSeen,
  pickSource,
  pruneDecisions,
  decisionsToSend,
  setLevelValue,
  setRoofSkip,
  setRoofValue,
} from './setBuildingDecisions';

const proposal = (patch: Partial<BuildingProposal> = {}): BuildingProposal => ({
  unitSystem: { value: 'metric', confidence: 0.9, source: 'plan', viewIds: [] },
  floors: [],
  levels: [],
  roofs: [],
  conflicts: [],
  violations: [],
  ...patch,
});

const candidate = (value: number, source: 'plan' | 'section') => ({
  value,
  source,
  confidence: 0.8,
  viewIds: [],
});

describe('số người duyệt nhập cho tầng', () => {
  it('nhập cốt rồi chiều cao: một quyết định cho một hình, không có khoá thừa', () => {
    const one = setLevelValue(EMPTY_DECISIONS, 'v1', 'elevationMm', 150);
    const two = setLevelValue(one, 'v1', 'heightMm', 3300);

    expect(one.levels).toEqual([{ levelRef: 'v1', elevationMm: 150 }]);
    expect(two.levels).toEqual([{ levelRef: 'v1', elevationMm: 150, heightMm: 3300 }]);
    expect(EMPTY_DECISIONS.levels).toEqual([]);
  });

  it('bỏ một số: khoá đó biến mất; bỏ nốt số còn lại thì bỏ cả quyết định', () => {
    const both: BuildingDecisions = {
      ...EMPTY_DECISIONS,
      levels: [{ levelRef: 'v1', elevationMm: 150, heightMm: 3300 }],
    };
    const one = setLevelValue(both, 'v1', 'elevationMm', undefined);

    expect(one.levels).toEqual([{ levelRef: 'v1', heightMm: 3300 }]);
    expect(setLevelValue(one, 'v1', 'heightMm', undefined).levels).toEqual([]);
  });

  it('kết quả luôn qua được schema gửi đi (không null, không undefined)', () => {
    const made = setRoofSkip(
      pickSource(
        markSeen(setLevelValue(EMPTY_DECISIONS, 'v1', 'heightMm', 3300), 'k'),
        'elevationMm:v1',
        'section',
      ),
      'v1',
      true,
    );

    expect(BuildingDecisionsSchema.safeParse(JSON.parse(JSON.stringify(made))).success).toBe(true);
    expect(Object.keys(made.levels[0] ?? {})).toEqual(['levelRef', 'heightMm']);
  });

  it.each([
    ['elevationMm', 150, null],
    ['elevationMm', -30001, 'Cốt phải trong khoảng −30.000 đến 300.000 mm.'],
    ['heightMm', 1999, 'Chiều cao phải trong khoảng 2.000 đến 10.000 mm.'],
    ['heightMm', 3300.5, 'Nhập số nguyên theo mm.'],
    ['heightMm', undefined, 'Nhập số nguyên theo mm.'],
  ] as const)('kiểm dải %s = %s', (field, value, expected) => {
    expect(levelValueProblem(field, value)).toBe(expected);
  });
});

describe('levelValueFromText — chữ gõ trong ô sửa', () => {
  it.each([
    ['3600', 3600],
    [' 3.600 ', 3600],
    ['−150', -150],
    ['-150', -150],
    ['3.5', 3.5],
    ['12a', undefined],
    ['1e3', undefined],
    ['0x10', undefined],
    ['3 000', undefined],
    ['', undefined],
  ] as const)('%j → %s', (text, expected) => {
    expect(levelValueFromText(text)).toBe(expected);
  });
});

describe('mái, nguồn, đã xem', () => {
  it('"không dựng mái": thêm quyết định skip; bỏ chọn thì gỡ, nhưng giữ số mái đã lưu từ trước', () => {
    const skipped = setRoofSkip(EMPTY_DECISIONS, 'v2', true);

    expect(skipped.roofs).toEqual([{ levelRef: 'v2', skip: true }]);
    expect(setRoofSkip(skipped, 'v2', false).roofs).toEqual([]);
    const withForm: BuildingDecisions = {
      ...EMPTY_DECISIONS,
      roofs: [{ levelRef: 'v2', skip: true, form: 'gable' }],
    };

    expect(setRoofSkip(withForm, 'v2', false).roofs).toEqual([
      { levelRef: 'v2', skip: false, form: 'gable' },
    ]);
  });

  it('chọn nguồn ghi đè lựa chọn cũ của cùng mâu thuẫn; "Đã xem" không ghi trùng', () => {
    const picked = pickSource(
      pickSource(EMPTY_DECISIONS, 'elevationMm:v1', 'plan'),
      'elevationMm:v1',
      'section',
    );

    expect(picked.picks).toEqual({ 'elevationMm:v1': 'section' });
    expect(markSeen(markSeen(EMPTY_DECISIONS, 'k1'), 'k1').seen).toEqual(['k1']);
  });
});

describe('pruneDecisions — hình không còn là mặt bằng đang dùng', () => {
  it('gỡ quyết định tầng và mái của hình đó (BE từ chối cả lượt lưu nếu còn), giữ nguồn đã chọn và đã xem', () => {
    const decisions: BuildingDecisions = {
      levels: [
        { levelRef: 'v1', heightMm: 3300 },
        { levelRef: 'gone', heightMm: 3000 },
      ],
      roofs: [{ levelRef: 'gone', skip: true }],
      picks: { 'elevationMm:gone': 'plan' },
      seen: ['k1'],
    };

    expect(pruneDecisions(decisions, new Set(['v1']))).toEqual({
      levels: [{ levelRef: 'v1', heightMm: 3300 }],
      roofs: [],
      picks: { 'elevationMm:gone': 'plan' },
      seen: ['k1'],
    });
  });
});

describe('decisionsToSend — thân `building` của lượt lưu', () => {
  const stored: BuildingDecisions = {
    levels: [
      { levelRef: 'v1', heightMm: 3000 },
      { levelRef: 'v2', elevationMm: 3300 },
    ],
    roofs: [{ levelRef: 'v2', skip: true }],
    picks: { 'elevationMm:v2': 'section' },
    seen: ['k1'],
  };
  const live = (...ids: string[]) => new Set(ids);

  it('chưa chạm khối và mọi quyết định đã lưu còn hợp lệ: không gửi gì (bộ cũ lưu như trước)', () => {
    expect(decisionsToSend(undefined, stored, live('v1', 'v2'))).toBeUndefined();
    expect(decisionsToSend(undefined, undefined, live('v1'))).toBeUndefined();
    expect(decisionsToSend(undefined, EMPTY_DECISIONS, live())).toBeUndefined();
  });

  it('chưa chạm khối nhưng một hình có quyết định đã lưu vừa bị bỏ: gửi bản đã tỉa, không thì N60 chặn xác nhận mãi', () => {
    expect(decisionsToSend(undefined, stored, live('v1'))).toEqual({
      levels: [{ levelRef: 'v1', heightMm: 3000 }],
      roofs: [],
      picks: { 'elevationMm:v2': 'section' },
      seen: ['k1'],
    });
  });

  it('chỉ một quyết định MÁI trỏ tới hình đã bỏ cũng đủ để phải gửi', () => {
    const roofOnly: BuildingDecisions = { ...EMPTY_DECISIONS, roofs: [{ levelRef: 'v2', skip: false, form: 'hip' }] };

    expect(decisionsToSend(undefined, roofOnly, live('v1'))).toEqual(EMPTY_DECISIONS);
    expect(decisionsToSend(undefined, roofOnly, live('v2'))).toBeUndefined();
  });

  it('đã chạm khối: gửi bản nháp đã tỉa, bản đã lưu không còn vai trò', () => {
    const touched: BuildingDecisions = { ...EMPTY_DECISIONS, levels: [{ levelRef: 'v9', heightMm: 2800 }], seen: ['k2'] };

    expect(decisionsToSend(touched, stored, live('v1', 'v2'))).toEqual({ ...EMPTY_DECISIONS, seen: ['k2'] });
  });
});

describe('houseBlockers — lý do chặn xác nhận (như N60)', () => {
  const blocked = proposal({
    conflicts: [
      {
        key: 'elevationMm:v1',
        field: 'elevationMm',
        candidates: [candidate(0, 'plan'), candidate(150, 'section')],
      },
      {
        key: 'elevationMm:v2',
        field: 'elevationMm',
        candidates: [candidate(3300, 'plan'), candidate(3600, 'section')],
        chosenSource: 'plan',
      },
    ],
    violations: [
      { key: 'e1', code: 'T-01', level: 'error', floorRefs: [], values: [-100] },
      { key: 'w1', code: 'T-07', level: 'warning', floorRefs: [], values: ['heightMm'] },
      { key: 'w2', code: 'T-07', level: 'warning', floorRefs: [], values: ['roofForm'] },
      { key: 'h1', code: 'M-07', level: 'hint', floorRefs: [], values: [] },
    ],
  });

  it('mâu thuẫn chưa chọn, lỗi, cảnh báo chưa xem: mỗi loại một câu có số đếm; gợi ý không chặn', () => {
    expect(houseBlockers(blocked, EMPTY_DECISIONS)).toEqual([
      'Khối “Ngôi nhà” còn 1 mâu thuẫn chưa chọn nguồn.',
      'Khối “Ngôi nhà” còn 1 lỗi. Hãy sửa cốt, chiều cao hoặc mái.',
      'Khối “Ngôi nhà” còn 2 cảnh báo chưa xem.',
    ]);
  });

  it('nguồn vừa chọn và cảnh báo vừa xem tính ngay, không chờ đọc lại', () => {
    const decisions: BuildingDecisions = {
      ...EMPTY_DECISIONS,
      picks: { 'elevationMm:v1': 'section' },
      seen: ['w1', 'w2'],
    };

    expect(houseBlockers(blocked, decisions)).toEqual([
      'Khối “Ngôi nhà” còn 1 lỗi. Hãy sửa cốt, chiều cao hoặc mái.',
    ]);
  });

  it('không có đề xuất hoặc đề xuất sạch: không chặn gì', () => {
    expect(houseBlockers(undefined, EMPTY_DECISIONS)).toEqual([]);
    expect(houseBlockers(proposal(), EMPTY_DECISIONS)).toEqual([]);
  });
});

describe('setRoofValue — thông số mái người duyệt nhập (NHA-08c)', () => {
  it('nhập từng trường: một quyết định cho một mái, không dựng mái vẫn là `false`', () => {
    const typed = setRoofValue(
      setRoofValue(setRoofValue(EMPTY_DECISIONS, 'v2', 'form', 'hip'), 'v2', 'pitchDeg', 26.6),
      'v2',
      'quarterTurns',
      1,
    );

    expect(typed.roofs).toEqual([
      { levelRef: 'v2', skip: false, form: 'hip', pitchDeg: 26.6, quarterTurns: 1 },
    ]);
    expect(BuildingDecisionsSchema.safeParse(typed).success).toBe(true);
  });

  it('bỏ một trường: khoá đó biến mất; bỏ nốt thì bỏ cả quyết định, trừ khi mái đang "không dựng"', () => {
    const typed = setRoofValue(
      setRoofValue(EMPTY_DECISIONS, 'v2', 'overhangMm', 600),
      'v2',
      'material',
      'tile',
    );
    const one = setRoofValue(typed, 'v2', 'overhangMm', undefined);

    expect(one.roofs).toEqual([{ levelRef: 'v2', skip: false, material: 'tile' }]);
    expect(setRoofValue(one, 'v2', 'material', undefined).roofs).toEqual([]);
    const skipped = setRoofValue(setRoofSkip(one, 'v2', true), 'v2', 'material', undefined);

    expect(skipped.roofs).toEqual([{ levelRef: 'v2', skip: true }]);
  });

  it('giá trị dây không nhận (dạng lạ, số ngoài khoảng) thì không ghi gì; mái khác không bị đụng', () => {
    const other: BuildingDecisions = { ...EMPTY_DECISIONS, roofs: [{ levelRef: 'v1', skip: true }] };

    expect(setRoofValue(other, 'v2', 'form', 'butterfly')).toBe(other);
    expect(setRoofValue(other, 'v2', 'pitchDeg', 85)).toBe(other);
    expect(setRoofValue(other, 'v2', 'parapetMm', 900).roofs).toEqual([
      { levelRef: 'v1', skip: true },
      { levelRef: 'v2', skip: false, parapetMm: 900 },
    ]);
  });
});

describe('houseActionsOf — thao tác của khối', () => {
  it('thao tác đầu tiên khởi từ quyết định đã lưu ở máy chủ; các thao tác sau nối tiếp trên bản nháp', () => {
    let local: BuildingDecisions | null = null;
    const stored: BuildingDecisions = { ...EMPTY_DECISIONS, seen: ['k0'] };
    const actions = houseActionsOf((update) => {
      local = update(local);
    }, stored);

    actions.markSeen('k1');
    actions.setLevel('v1', 'heightMm', 3300);
    actions.pick('elevationMm:v1', 'section');
    actions.setRoofSkip('v1', true);
    actions.setLevel('v1', 'heightMm', undefined);
    actions.setRoof('v1', 'form', 'gable');
    expect(local).toEqual({
      levels: [],
      roofs: [{ levelRef: 'v1', skip: true, form: 'gable' }],
      picks: { 'elevationMm:v1': 'section' },
      seen: ['k0', 'k1'],
    });
  });

  it('chưa có gì lưu ở máy chủ thì khởi từ bản rỗng', () => {
    let local: BuildingDecisions | null = null;

    houseActionsOf((update) => {
      local = update(local);
    }, undefined).markSeen('k1');
    expect(local).toEqual({ ...EMPTY_DECISIONS, seen: ['k1'] });
  });
});
