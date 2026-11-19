import { describe, expect, it } from 'vitest';

import {
  HOUSE_LEVEL_SOURCES,
  HOUSE_QUESTION_CODES,
  HOUSE_STOREY_LABELS,
  HOUSE_VIEW_KINDS,
  HouseProposalSchema,
} from '../houseProposal';

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

const proposal = { floors: [floor], runIds: ['run_01'] };
const withFloor = (patch: Record<string, unknown>) => ({ ...proposal, floors: [{ ...floor, ...patch }] });
const ok = (value: unknown) => HouseProposalSchema.safeParse(value).success;

describe('HouseProposal (house-proposal)', () => {
  it('nhận ví dụ đầy đủ và danh sách rỗng', () => {
    expect(HouseProposalSchema.parse(proposal)).toEqual(proposal);
    expect(ok({ floors: [], runIds: [] })).toBe(true);
  });

  it('trường tuỳ chọn vắng được: chỉ còn các trường bắt buộc', () => {
    const bare = { floorId: 'flr_02', kind: 'other', kindConfidence: 0, storeyConfidence: 0, questions: [] };
    const parsed = HouseProposalSchema.parse({ floors: [bare], runIds: [] });
    expect(parsed.floors[0]?.elevationMm).toBeUndefined();
    expect(parsed.floors[0]?.storeyLabel).toBeUndefined();
  });

  it('W2: null bị từ chối ở mọi trường tuỳ chọn; trường lạ bị từ chối', () => {
    for (const key of [
      'storeyLabel',
      'storeyNo',
      'elevationMm',
      'elevationConfidence',
      'elevationSource',
      'heightMm',
      'heightConfidence',
      'heightSource',
    ]) {
      expect(ok(withFloor({ [key]: null })), key).toBe(false);
    }
    expect(ok(withFloor({ extra: 1 }))).toBe(false);
    expect(ok({ ...proposal, extra: 1 })).toBe(false);
    expect(ok(withFloor({ questions: [{ code: 'NOT_A_PLAN', extra: 1 }] }))).toBe(false);
  });

  it('mỗi enum nhận mọi giá trị hợp lệ và từ chối giá trị lạ', () => {
    const cases: Array<[string, readonly string[]]> = [
      ['kind', HOUSE_VIEW_KINDS],
      ['storeyLabel', HOUSE_STOREY_LABELS],
      ['elevationSource', HOUSE_LEVEL_SOURCES],
      ['heightSource', HOUSE_LEVEL_SOURCES],
    ];
    for (const [key, values] of cases) {
      for (const value of values) expect(ok(withFloor({ [key]: value })), `${key}=${value}`).toBe(true);
      expect(ok(withFloor({ [key]: 'bogus' })), key).toBe(false);
    }
    for (const code of HOUSE_QUESTION_CODES) expect(ok(withFloor({ questions: [{ code }] })), code).toBe(true);
    expect(ok(withFloor({ questions: [{ code: 'BOGUS' }] }))).toBe(false);
  });

  it('độ chắc phải nằm trong 0..1', () => {
    for (const key of ['kindConfidence', 'storeyConfidence', 'elevationConfidence', 'heightConfidence']) {
      expect(ok(withFloor({ [key]: 0 })), key).toBe(true);
      expect(ok(withFloor({ [key]: 1 })), key).toBe(true);
      expect(ok(withFloor({ [key]: -0.01 })), key).toBe(false);
      expect(ok(withFloor({ [key]: 1.01 })), key).toBe(false);
    }
  });

  it('storeyNo, elevationMm, heightMm là số nguyên trong khoảng của FloorRow', () => {
    expect(ok(withFloor({ storeyNo: 1.5 }))).toBe(false);
    expect(ok(withFloor({ storeyNo: -1 }))).toBe(true);
    expect(ok(withFloor({ elevationMm: -30000 }))).toBe(true);
    expect(ok(withFloor({ elevationMm: 300000 }))).toBe(true);
    expect(ok(withFloor({ elevationMm: -30001 }))).toBe(false);
    expect(ok(withFloor({ elevationMm: 300001 }))).toBe(false);
    expect(ok(withFloor({ elevationMm: 3000.5 }))).toBe(false);
    expect(ok(withFloor({ heightMm: 2000 }))).toBe(true);
    expect(ok(withFloor({ heightMm: 10000 }))).toBe(true);
    expect(ok(withFloor({ heightMm: 1999 }))).toBe(false);
    expect(ok(withFloor({ heightMm: 10001 }))).toBe(false);
    expect(ok(withFloor({ heightMm: 3300.5 }))).toBe(false);
  });

  it('thiếu trường bắt buộc bị từ chối', () => {
    for (const key of ['floorId', 'kind', 'kindConfidence', 'storeyConfidence', 'questions']) {
      const rest: Record<string, unknown> = { ...floor };
      delete rest[key];
      expect(ok({ ...proposal, floors: [rest] }), key).toBe(false);
    }
    expect(ok({ floors: [floor] })).toBe(false);
  });
});
