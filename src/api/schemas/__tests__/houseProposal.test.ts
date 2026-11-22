import { describe, expect, it } from 'vitest';

import { HOUSE_PROPOSAL_OFF, HouseProposalSchema, houseProposalOrNull } from '../houseProposal';

const floor = {
  floorId: 'flr_01',
  kind: 'plan',
  kindConfidence: 0.97,
  storeyLabel: 'ground',
  storeyNo: 1,
  storeyConfidence: 0.92,
  elevationMm: 0,
  elevationConfidence: 0.9,
  elevationSource: 'plan',
  heightMm: 3300,
  heightConfidence: 0.8,
  heightSource: 'plan+section',
  questions: [{ code: 'HEIGHT_ASSUMED' }],
};

const proposal = { enabled: true, floors: [floor], runIds: ['run_01'] };
const withFloor = (patch: Record<string, unknown>) => ({ ...proposal, floors: [{ ...floor, ...patch }] });
const ok = (value: unknown) => HouseProposalSchema.safeParse(value).success;
const firstFloor = (patch: Record<string, unknown>) => HouseProposalSchema.parse(withFloor(patch)).floors[0];

describe('HouseProposal (house-proposal)', () => {
  it('nhận ví dụ đầy đủ và danh sách rỗng', () => {
    expect(HouseProposalSchema.parse(proposal)).toEqual(proposal);
    expect(ok({ enabled: true, floors: [], runIds: [] })).toBe(true);
  });

  it('tính năng tắt: hình rỗng hợp lệ và thành null', () => {
    expect(ok(HOUSE_PROPOSAL_OFF)).toBe(true);
    expect(houseProposalOrNull(HOUSE_PROPOSAL_OFF)).toBeNull();
    expect(houseProposalOrNull(HouseProposalSchema.parse(proposal))).toEqual(proposal);
  });

  it('trường tuỳ chọn vắng được: chỉ còn các trường bắt buộc', () => {
    const bare = { floorId: 'flr_02', kind: 'other', kindConfidence: 0, storeyConfidence: 0, questions: [] };
    const parsed = HouseProposalSchema.parse({ enabled: true, floors: [bare], runIds: [] });
    expect(parsed.floors[0]?.elevationMm).toBeUndefined();
    expect(parsed.floors[0]?.storeyLabel).toBeUndefined();
  });

  it('trường lạ phía BE bị bỏ, không làm hỏng câu trả lời', () => {
    const parsed = HouseProposalSchema.parse({
      ...proposal,
      extra: 1,
      floors: [{ ...floor, extra: 1, questions: [{ code: 'NOT_A_PLAN', extra: 1 }] }],
    });
    expect(parsed).toEqual({ ...proposal, floors: [{ ...floor, questions: [{ code: 'NOT_A_PLAN' }] }] });
  });

  it('mã, loại bản vẽ, nhãn tầng, nguồn lạ vẫn qua (viewmodel chuẩn hoá)', () => {
    for (const key of ['kind', 'storeyLabel', 'elevationSource', 'heightSource']) {
      expect(ok(withFloor({ [key]: 'bogus' })), key).toBe(true);
    }
    expect(ok(withFloor({ questions: [{ code: 'BOGUS' }] }))).toBe(true);
  });

  it('câu hỏi nhận reason và textStoreyNo; giá trị hỏng thì bỏ trường, câu hỏi vẫn còn', () => {
    const question = (q: Record<string, unknown>) => firstFloor({ questions: [q] })?.questions[0];
    const code = 'ORDER_TEXT_CONFLICT';
    expect(question({ code, reason: 'title', textStoreyNo: 3 })).toEqual({ code, reason: 'title', textStoreyNo: 3 });
    expect(question({ code, reason: 'level' })).toEqual({ code, reason: 'level' });
    expect(question({ code, reason: 'moi' })?.reason).toBe('moi');
    expect(question({ code, reason: 5 })).toMatchObject({ code, reason: undefined });
    expect(question({ code, reason: 'title', textStoreyNo: 2.5 })?.textStoreyNo).toBeUndefined();
    expect(question({ code, reason: 'title', textStoreyNo: 'ba' })).toMatchObject({ code, reason: 'title', textStoreyNo: undefined });
    expect(ok(withFloor({ storeyLabel: 'tum' }))).toBe(true);
  });

  it('số hỏng chỉ mất số đó, dòng vẫn còn', () => {
    for (const key of ['storeyLabel', 'storeyNo', 'elevationMm', 'elevationConfidence', 'heightMm', 'heightSource']) {
      expect(firstFloor({ [key]: null })?.[key as keyof typeof floor], key).toBeUndefined();
    }
    expect(firstFloor({ storeyNo: 1.5 })?.storeyNo).toBeUndefined();
    expect(firstFloor({ storeyNo: -1 })?.storeyNo).toBe(-1);
    expect(firstFloor({ elevationMm: -30000 })?.elevationMm).toBe(-30000);
    expect(firstFloor({ elevationMm: 300000 })?.elevationMm).toBe(300000);
    expect(firstFloor({ elevationMm: -30001 })?.elevationMm).toBeUndefined();
    expect(firstFloor({ elevationMm: 300001 })?.elevationMm).toBeUndefined();
    expect(firstFloor({ elevationMm: 3000.5 })?.elevationMm).toBeUndefined();
    expect(firstFloor({ heightMm: 2000 })?.heightMm).toBe(2000);
    expect(firstFloor({ heightMm: 10000 })?.heightMm).toBe(10000);
    expect(firstFloor({ heightMm: 1999 })?.heightMm).toBeUndefined();
    expect(firstFloor({ heightMm: 10001 })?.heightMm).toBeUndefined();
  });

  it('độ chắc ngoài 0..1: bắt buộc thì về 0, tuỳ chọn thì bỏ', () => {
    for (const key of ['kindConfidence', 'storeyConfidence'] as const) {
      expect(firstFloor({ [key]: 1 })?.[key], key).toBe(1);
      expect(firstFloor({ [key]: -0.01 })?.[key], key).toBe(0);
      expect(firstFloor({ [key]: 1.01 })?.[key], key).toBe(0);
    }
    for (const key of ['elevationConfidence', 'heightConfidence'] as const) {
      expect(firstFloor({ [key]: 1 })?.[key], key).toBe(1);
      expect(firstFloor({ [key]: 1.01 })?.[key], key).toBeUndefined();
    }
  });

  it('thiếu trường định danh hoặc khung bị từ chối', () => {
    for (const key of ['floorId', 'kind', 'questions']) {
      const rest: Record<string, unknown> = { ...floor };
      delete rest[key];
      expect(ok({ ...proposal, floors: [rest] }), key).toBe(false);
    }
    expect(ok({ enabled: true, floors: [floor] })).toBe(false);
    expect(ok({ floors: [floor], runIds: [] })).toBe(false);
  });
});

describe('isSection (dấu mặt cắt của người dùng)', () => {
  it('nhận true, vắng thì vắng, giá trị hỏng thì bỏ trường', () => {
    expect(firstFloor({ kind: 'section', isSection: true })?.isSection).toBe(true);
    expect(firstFloor({}) ?? {}).not.toHaveProperty('isSection');
    expect(firstFloor({ isSection: 'yes' })?.isSection).toBeUndefined();
  });
});
