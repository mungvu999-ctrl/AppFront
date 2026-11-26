import { describe, expect, it } from 'vitest';

import type { BuildingProposal, Measured } from '@/api/schemas/setBuilding';

import type { ReviewFloor, ViewDraft } from './drawingSetReview';
import { houseBlockOf, houseLevelNames } from './setBuilding';
import { EMPTY_DECISIONS } from './setBuildingDecisions';

const measured = (
  value: number | string,
  source: Measured['source'],
  confidence = 0.9,
  viewIds: string[] = [],
): Measured => ({
  value,
  source,
  confidence,
  viewIds,
});

const draft = (id: string, target: ViewDraft['target'], storeyNo?: number): ViewDraft => ({
  id,
  fileId: 'file-1',
  pageIndex: 0,
  crop: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 },
  source: 'ai',
  excluded: false,
  kind: 'plan',
  kindConfidence: 0.9,
  titleText: undefined,
  sheetNo: undefined,
  storeyLabel: storeyNo === undefined ? undefined : 'floor',
  storeyNo,
  storeyConfidence: storeyNo === undefined ? undefined : 0.9,
  questions: [],
  imageUrl: undefined,
  target,
});

const FLOORS: readonly ReviewFloor[] = [
  { id: 'L-1', name: 'Trệt', hasDrawing: true, isSection: false },
];
const NAMES = new Map([
  ['v1', 'Tầng 1'],
  ['v2', 'Tầng 2'],
]);

const proposal = (patch: Partial<BuildingProposal> = {}): BuildingProposal => ({
  unitSystem: measured('metric', 'plan', 0.9),
  floors: [],
  levels: [],
  roofs: [],
  conflicts: [],
  violations: [],
  ...patch,
});

describe('houseLevelNames — tên tầng của từng hình', () => {
  it('lấy tên tầng mới người duyệt gõ, tên tầng có sẵn đã chọn, rồi mới tới tầng máy đọc', () => {
    const names = houseLevelNames(
      [
        draft('a', { mode: 'newFloor', floorId: 'L-9', name: ' Tầng lửng ' }, 2),
        draft('b', { mode: 'floor', floorId: 'L-1', replace: false }, 3),
        draft('c', { mode: 'none' }, 4),
        draft('d', { mode: 'newFloor', floorId: 'L-8', name: '  ' }, 5),
      ],
      FLOORS,
    );

    expect([...names]).toEqual([
      ['a', 'Tầng lửng'],
      ['b', 'Trệt'],
      ['c', 'Tầng 4'],
      ['d', 'Tầng 5'],
    ]);
  });

  it('hình chưa rõ tầng và chưa có đích không có tên; khối dùng câu chung', () => {
    const names = houseLevelNames([draft('a', { mode: 'none' })], FLOORS);

    expect(names.has('a')).toBe(false);
    expect(houseBlockOf(proposal({ levels: [{ levelRef: 'a' }] }), names).levels[0]?.name).toBe(
      'Tầng chưa rõ',
    );
  });
});

describe('houseBlockOf — bảng tầng', () => {
  it('cốt viết theo mét có dấu, chiều cao theo mm tách nghìn; ô vắng là null', () => {
    const vm = houseBlockOf(
      proposal({
        levels: [
          {
            levelRef: 'v1',
            elevationMm: measured(0, 'plan+section'),
            heightMm: measured(3300, 'section', 0.8),
          },
          { levelRef: 'v2', elevationMm: measured(3300, 'plan', 0.85) },
        ],
      }),
      NAMES,
    );

    expect(
      vm.levels.map((row) => [row.name, row.elevation?.text, row.height?.text ?? null]),
    ).toEqual([
      ['Tầng 1', '±0.000 m', '3.300 mm'],
      ['Tầng 2', '+3.300 m', null],
    ]);
  });

  it('chip nói nguồn bằng chữ kèm độ tin; máy không bao giờ được màu "đã xác minh"', () => {
    const cellOf = (value: Measured) =>
      houseBlockOf(proposal({ levels: [{ levelRef: 'v1', heightMm: value }] }), NAMES).levels[0]
        ?.height;

    expect(cellOf(measured(3300, 'section', 1))).toMatchObject({
      chip: 'Máy đọc từ mặt cắt · 100%',
      status: 'neutral',
    });
    expect(cellOf(measured(3300, 'default', 0.4))).toMatchObject({ chip: 'Máy giả định · 40%' });
    expect(cellOf(measured(3300, 'convention', 0.6))).toMatchObject({ chip: 'Theo quy ước · 60%' });
    expect(cellOf(measured(3300, 'roofPlan', 0.7))?.chip).toBe('Máy đọc từ mặt bằng mái · 70%');
    expect(cellOf(measured(3300, 'elevation', 0.7))?.chip).toBe('Máy đọc từ mặt đứng · 70%');
    expect(cellOf(measured(3300, 'default', 0.4))?.status).not.toBe('verified');
    expect(cellOf(measured(3300, 'default', 0.4))?.status).not.toBe('neutral');
  });

  it('số người duyệt nhập: chip riêng, màu "đã xác minh", không kèm độ tin', () => {
    const cell = houseBlockOf(
      proposal({ levels: [{ levelRef: 'v1', elevationMm: measured(150, 'reviewer', 1) }] }),
      NAMES,
    ).levels[0]?.elevation;

    expect(cell).toEqual({ text: '+0.150 m', chip: 'Người duyệt nhập', status: 'verified' });
  });
});

describe('houseBlockOf — thẻ mái', () => {
  it('đủ trường: tám dòng theo thứ tự cố định, số có đơn vị', () => {
    const [card] = houseBlockOf(
      proposal({
        roofs: [
          {
            levelRef: 'v2',
            form: measured('gable', 'roofPlan'),
            pitchDeg: measured(26.57, 'section'),
            quarterTurns: measured(1, 'convention', 0.6),
            eaveElevationMm: measured(6600, 'plan'),
            ridgeElevationMm: measured(8100, 'section'),
            overhangMm: measured(600, 'convention', 0.4),
            parapetMm: measured(0, 'default', 0.3),
            material: measured('tile', 'roofPlan'),
          },
        ],
      }),
      NAMES,
    ).roofs;

    expect(card?.title).toBe('Mái của Tầng 2');
    expect(card?.rows.map((row) => [row.label, row.cell.text])).toEqual([
      ['Dạng mái', 'Mái hai dốc'],
      ['Độ dốc', '26,6°'],
      ['Hướng mái', 'Xoay 90°'],
      ['Cốt diềm', '+6.600 m'],
      ['Cốt đỉnh', '+8.100 m'],
      ['Độ đua', '600 mm'],
      ['Vật liệu', 'Ngói'],
      ['Chiều cao tường chắn mái', '0 mm'],
    ]);
  });

  it('thiếu trường tuỳ chọn thì không có dòng đó; hướng 0 là "Không xoay"; giá trị lạ hiện nguyên văn', () => {
    const [card] = houseBlockOf(
      proposal({
        roofs: [
          {
            levelRef: 'v1',
            form: measured('butterfly', 'default', 0.3),
            pitchDeg: measured(0, 'default', 0.3),
            quarterTurns: measured(0, 'convention', 0.6),
            overhangMm: measured(0, 'convention', 0.4),
          },
        ],
      }),
      NAMES,
    ).roofs;

    expect(card?.rows.map((row) => [row.label, row.cell.text])).toEqual([
      ['Dạng mái', 'butterfly'],
      ['Độ dốc', '0°'],
      ['Hướng mái', 'Không xoay'],
      ['Độ đua', '0 mm'],
    ]);
  });
});

describe('houseBlockOf — mâu thuẫn và vi phạm', () => {
  it('mâu thuẫn: tên trường kèm tên tầng, từng nguồn một dòng, nguồn đã chọn được đánh dấu', () => {
    const vm = houseBlockOf(
      proposal({
        conflicts: [
          {
            key: 'elevationMm:v2',
            field: 'elevationMm',
            candidates: [measured(3300, 'plan', 0.8), measured(3600, 'section', 0.9)],
            chosenSource: 'section',
          },
          {
            key: 'pitchDeg:v2',
            field: 'pitchDeg',
            candidates: [measured(30, 'roofPlan', 0.8), measured(35, 'section', 0.7)],
          },
        ],
      }),
      NAMES,
    );

    expect(vm.conflicts).toEqual([
      {
        key: 'elevationMm:v2',
        title: 'Cốt tầng — Tầng 2',
        candidates: [
          { text: '+3.300 m', chip: 'Máy đọc từ mặt bằng · 80%', source: 'plan', isChosen: false },
          { text: '+3.600 m', chip: 'Máy đọc từ mặt cắt · 90%', source: 'section', isChosen: true },
        ],
      },
      {
        key: 'pitchDeg:v2',
        title: 'Độ dốc mái — Tầng 2',
        candidates: [
          { text: '30°', chip: 'Máy đọc từ mặt bằng mái · 80%', source: 'roofPlan', isChosen: false },
          { text: '35°', chip: 'Máy đọc từ mặt cắt · 70%', source: 'section', isChosen: false },
        ],
      },
    ]);
  });

  it('vi phạm: chia nhóm lỗi → cảnh báo → gợi ý, nhóm rỗng không hiện, câu kèm tên tầng', () => {
    const vm = houseBlockOf(
      proposal({
        violations: [
          { key: 'k-hint', code: 'M-07', level: 'hint', floorRefs: ['v2'], values: [] },
          { key: 'k-err', code: 'T-01', level: 'error', floorRefs: ['v1', 'v2'], values: [-100] },
          { key: 'k-unit', code: 'T-06', level: 'hint', floorRefs: [], values: [0, 0] },
        ],
      }),
      NAMES,
    );

    expect(vm.violations.map((group) => [group.level, group.title, group.status])).toEqual([
      ['error', 'Lỗi', 'violation'],
      ['hint', 'Gợi ý', 'neutral'],
    ]);
    expect(vm.violations[0]?.items).toEqual([
      {
        key: 'k-err',
        text: 'Tầng 1, Tầng 2: Tầng trên thấp hơn đỉnh tầng dưới 100 mm: hai tầng chồng lấn nhau.',
        isSeen: false,
      },
    ]);
    expect(vm.violations[1]?.items.map((item) => item.text)).toEqual([
      'Tầng 2: Mái bằng nhưng không thấy tường chắn mái hay chỗ thoát nước trên bản vẽ.',
      'Chưa đủ chữ trên bản vẽ để biết bộ hồ sơ dùng hệ mét hay feet-inch.',
    ]);
  });

  it('hai tầng chưa có tên trong một vi phạm chỉ nêu "Tầng chưa rõ" một lần', () => {
    const vm = houseBlockOf(
      proposal({ violations: [{ key: 'k', code: 'T-04', level: 'error', floorRefs: ['x', 'y'], values: [] }] }),
      NAMES,
    );

    expect(vm.violations[0]?.items[0]?.text).toBe('Tầng chưa rõ: Hai hình mặt bằng cùng được gán cho một tầng.');
  });

  it('hệ đơn vị: mét hoặc feet-inch, kèm chip nguồn', () => {
    expect(houseBlockOf(proposal(), NAMES).unitSystem).toMatchObject({
      text: 'Hệ mét',
      chip: 'Máy đọc từ mặt bằng · 90%',
    });
    expect(
      houseBlockOf(proposal({ unitSystem: measured('imperial', 'plan', 0.5) }), NAMES).unitSystem
        .text,
    ).toBe('Feet-inch');
  });

  it('đề xuất rỗng: mọi danh sách rỗng', () => {
    const vm = houseBlockOf(proposal(), NAMES);

    expect([vm.levels, vm.roofs, vm.conflicts, vm.violations]).toEqual([[], [], [], []]);
  });
});

describe('houseBlockOf — quyết định của người duyệt (NHA-08b)', () => {
  const twoLevels = proposal({
    levels: [
      { levelRef: 'v1', elevationMm: measured(0.4, 'plan'), heightMm: measured(3300, 'default', 0.4) },
      { levelRef: 'v2', elevationMm: measured(150, 'reviewer', 1), heightMm: measured(12000, 'section') },
    ],
  });

  it('"Nhận" ghi số của máy đã làm tròn; không có khi số đã là của người duyệt, ngoài dải, hoặc máy chưa có số', () => {
    const [first, second] = houseBlockOf(twoLevels, NAMES).levels;

    expect(first?.elevationEdit).toEqual({ typedMm: undefined, acceptMm: 0 });
    expect(first?.heightEdit).toEqual({ typedMm: undefined, acceptMm: 3300 });
    expect(second?.elevationEdit.acceptMm).toBeUndefined();
    expect(second?.heightEdit.acceptMm).toBeUndefined();
    expect(houseBlockOf(proposal({ levels: [{ levelRef: 'v1' }] }), NAMES).levels[0]?.heightEdit).toEqual({
      typedMm: undefined,
      acceptMm: undefined,
    });
  });

  it('số vừa nhập hiện ngay trong ô sửa và tắt nút "Nhận", dù đề xuất chưa đọc lại', () => {
    const vm = houseBlockOf(twoLevels, NAMES, { ...EMPTY_DECISIONS, levels: [{ levelRef: 'v1', heightMm: 3600 }] });

    expect(vm.levels[0]?.heightEdit).toEqual({ typedMm: 3600, acceptMm: undefined });
    expect(vm.levels[0]?.elevationEdit.acceptMm).toBe(0);
  });

  const roof = { form: measured('flat', 'default', 0.3), pitchDeg: measured(0, 'default', 0.3), quarterTurns: measured(0, 'convention'), overhangMm: measured(0, 'convention') };

  it('"không dựng mái": thẻ của mái đó được đánh dấu; mái máy không còn đề xuất vẫn có thẻ để bỏ chọn', () => {
    const decisions = { ...EMPTY_DECISIONS, roofs: [{ levelRef: 'v1', skip: true }, { levelRef: 'v2', skip: true }] };
    const vm = houseBlockOf(proposal({ roofs: [{ levelRef: 'v1', ...roof }] }), NAMES, decisions);

    expect(vm.roofs.map((card) => [card.key, card.title, card.isSkipped, card.rows.length])).toEqual([
      ['v1', 'Mái của Tầng 1', true, 4],
      ['v2', 'Mái của Tầng 2', true, 0],
    ]);
    expect(houseBlockOf(proposal({ roofs: [{ levelRef: 'v1', ...roof }] }), NAMES).roofs[0]?.isSkipped).toBe(false);
  });

  it('nguồn vừa chọn thắng nguồn đã lưu; cảnh báo vừa xem được đánh dấu', () => {
    const vm = houseBlockOf(
      proposal({
        conflicts: [
          { key: 'elevationMm:v2', field: 'elevationMm', candidates: [measured(3300, 'plan'), measured(3600, 'section')], chosenSource: 'section' },
        ],
        violations: [
          { key: 'w1', code: 'T-07', level: 'warning', floorRefs: [], values: ['heightMm'] },
          { key: 'w2', code: 'T-07', level: 'warning', floorRefs: [], values: ['roofForm'] },
        ],
      }),
      NAMES,
      { ...EMPTY_DECISIONS, picks: { 'elevationMm:v2': 'plan' }, seen: ['w2'] },
    );

    expect(vm.conflicts[0]?.candidates.map((candidate) => candidate.isChosen)).toEqual([true, false]);
    expect(vm.violations[0]?.items.map((item) => item.isSeen)).toEqual([false, true]);
  });
});
