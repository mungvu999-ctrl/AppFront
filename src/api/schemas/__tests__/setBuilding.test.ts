import { describe, expect, it } from 'vitest';

import { ReplaceViewsSchema } from '../drawingSet';
import { BuildingDecisionsSchema, SetBuildingSchema } from '../setBuilding';

const measured = (value: number | string, source = 'plan', viewIds: string[] = []) => ({ value, confidence: 0.8, source, viewIds });

const PROPOSAL = {
  unitSystem: measured('metric'),
  floors: [
    {
      floorId: 'dwv_1',
      kind: 'plan',
      kindConfidence: 0.9,
      storeyNo: 1,
      storeyConfidence: 0.9,
      elevationMm: 0,
      elevationConfidence: 0.8,
      elevationSource: 'plan',
      heightMm: 3300,
      heightConfidence: 0.4,
      heightSource: 'default',
      questions: [{ code: 'HEIGHT_ASSUMED' }],
    },
  ],
  levels: [{ levelRef: 'dwv_1', elevationMm: measured(0, 'plan', ['dwv_1']), heightMm: measured(3300, 'default', ['dwv_1']) }],
  roofs: [
    {
      levelRef: 'dwv_1',
      form: measured('gable', 'convention'),
      pitchDeg: measured(16.7, 'roofPlan', ['dwv_9']),
      quarterTurns: measured(0, 'convention'),
      eaveElevationMm: measured(3300, 'default', ['dwv_1']),
      overhangMm: measured(300, 'convention'),
    },
  ],
  conflicts: [
    { key: 'elevationMm:dwv_1', field: 'elevationMm', candidates: [measured(3300, 'section'), measured(3900, 'plan', ['dwv_1'])] },
  ],
  violations: [{ key: 'M-18|dwv_9|convention', code: 'M-18', level: 'warning', floorRefs: ['dwv_9'], values: ['convention'] }],
};
const DECISIONS = {
  levels: [{ levelRef: 'dwv_1', heightMm: 3000 }],
  roofs: [{ levelRef: 'dwv_1', skip: false, form: 'hip', pitchDeg: 35 }],
  picks: { 'elevationMm:dwv_1': 'plan' },
  seen: ['M-18|dwv_9|convention'],
};
const EDIT = { id: 'dwv_1', fileId: 'dwf_1', pageIndex: 0, crop: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }, excluded: false, kind: 'plan' };

describe('SetBuildingSchema — route đọc đề xuất ngôi nhà', () => {
  it('nhận phản hồi đầy đủ, công tắc tắt, và bộ chưa có đề xuất', () => {
    const full = { enabled: true, proposal: PROPOSAL, decisions: DECISIONS };

    expect(SetBuildingSchema.parse(full)).toEqual(full);
    expect(SetBuildingSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(SetBuildingSchema.parse({ enabled: true })).toEqual({ enabled: true });
  });

  it('từ chối khoá lạ, null ở trường tuỳ chọn, nguồn lạ, vi phạm thiếu khoá, mâu thuẫn một ứng viên', () => {
    const bad = [
      { enabled: true, proposal: PROPOSAL, extra: 1 },
      { enabled: true, proposal: null },
      { enabled: true, proposal: { ...PROPOSAL, unitSystem: measured('metric', 'guess') } },
      { enabled: true, proposal: { ...PROPOSAL, violations: [{ code: 'M-18', level: 'warning', floorRefs: [], values: [] }] } },
      { enabled: true, proposal: { ...PROPOSAL, conflicts: [{ key: 'k', field: 'elevationMm', candidates: [measured(1)] }] } },
      { enabled: true, proposal: { ...PROPOSAL, roofs: [{ ...PROPOSAL.roofs[0], material: null }] } },
      { enabled: true, proposal: { ...PROPOSAL, levels: [{ levelRef: 'dwv_1', surprise: true }] } },
      { enabled: true, proposal: { ...PROPOSAL, violations: [{ ...PROPOSAL.violations[0], key: 'k'.repeat(257) }] } },
      { enabled: true, proposal: { ...PROPOSAL, violations: [{ ...PROPOSAL.violations[0], values: [''] }] } },
    ];

    for (const wire of bad) expect(SetBuildingSchema.safeParse(wire).success).toBe(false);
  });

  it('tầng trong đề xuất giải lỏng như bảng N52: mã lạ không làm hỏng cả phản hồi', () => {
    const floors = [{ ...PROPOSAL.floors[0], kind: 'kind-moi', elevationMm: 999_999 }];
    const parsed = SetBuildingSchema.parse({ enabled: true, proposal: { ...PROPOSAL, floors } });

    expect(parsed.proposal?.floors[0]?.kind).toBe('kind-moi');
    expect(parsed.proposal?.floors[0]?.elevationMm).toBeUndefined();
  });
});

describe('BuildingDecisionsSchema — thân `building` của N59', () => {
  it('nhận quyết định hợp lệ và bản rỗng', () => {
    expect(BuildingDecisionsSchema.parse(DECISIONS)).toEqual(DECISIONS);
    expect(BuildingDecisionsSchema.safeParse({ levels: [], roofs: [], picks: {}, seen: [] }).success).toBe(true);
    const edges = {
      levels: [{ levelRef: 'a', elevationMm: -30_000, heightMm: 2_000 }, { levelRef: 'b', elevationMm: 300_000, heightMm: 10_000 }],
      roofs: [{ levelRef: 'a', skip: true, pitchDeg: 84.9, quarterTurns: 3, overhangMm: 5_000, parapetMm: 0 }],
      picks: {},
      seen: ['k'.repeat(256)],
    };

    expect(BuildingDecisionsSchema.safeParse(edges).success).toBe(true);
  });

  it.each([
    ['cốt ngoài dải', { levels: [{ levelRef: 'v', elevationMm: 400_000 }] }],
    ['chiều cao ngoài dải', { levels: [{ levelRef: 'v', heightMm: 1_000 }] }],
    ['độ dốc từ 85°', { roofs: [{ levelRef: 'v', skip: false, pitchDeg: 85 }] }],
    ['hướng mái ngoài 0..3', { roofs: [{ levelRef: 'v', skip: false, quarterTurns: 4 }] }],
    ['dạng mái lạ', { roofs: [{ levelRef: 'v', skip: false, form: 'dome' }] }],
    ['nguồn lạ', { picks: { 'elevationMm:v': 'guess' } }],
    ['null ở trường tuỳ chọn', { levels: [{ levelRef: 'v', heightMm: null }] }],
    ['khoá lạ', { unknown: 1 }],
    ['mái thiếu `skip`', { roofs: [{ levelRef: 'v' }] }],
    ['quá 60 quyết định tầng', { levels: Array.from({ length: 61 }, (_, index) => ({ levelRef: `v${String(index)}` })) }],
    ['quá 500 cảnh báo đã xem', { seen: Array.from({ length: 501 }, (_, index) => `k${String(index)}`) }],
    ['khoá đã xem dài quá 256 ký tự', { seen: ['k'.repeat(257)] }],
    ['khoá mâu thuẫn dài quá 96 ký tự', { picks: { ['k'.repeat(97)]: 'plan' } }],
    ['quá 120 lựa chọn nguồn', { picks: Object.fromEntries(Array.from({ length: 121 }, (_, index) => [`k${String(index)}`, 'plan'])) }],
    ['`levelRef` dài quá 64 ký tự', { levels: [{ levelRef: 'v'.repeat(65) }] }],
    ['khoá mang ký tự điều khiển', { seen: ['T-07|a\u0000b'] }],
  ])('từ chối %s', (_name, patch) => {
    expect(BuildingDecisionsSchema.safeParse({ levels: [], roofs: [], picks: {}, seen: [], ...patch }).success).toBe(false);
  });
});

describe('ReplaceViewsSchema — N59 kèm quyết định', () => {
  it('nhận thân có `building`, thân không có, và từ chối `building` sai hình', () => {
    const body = (extra: object) => ({ baseVersion: 2, body: { views: [EDIT], ...extra } });

    expect(ReplaceViewsSchema.safeParse(body({ building: DECISIONS })).success).toBe(true);
    expect(ReplaceViewsSchema.safeParse(body({})).success).toBe(true);
    expect(ReplaceViewsSchema.safeParse(body({ building: { levels: [] } })).success).toBe(false);
    expect(ReplaceViewsSchema.safeParse(body({ building: null })).success).toBe(false);
  });
});
