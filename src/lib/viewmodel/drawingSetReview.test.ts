import { describe, expect, it } from 'vitest';

import type { DrawingSetView } from '@/api/schemas/drawingSet';

import {
  checkConfirm,
  chooseExistingFloor,
  chooseNewFloor,
  confirmSummaryText,
  confirmedLines,
  REPLACE_WARNING,
  sameEdits,
  setExcluded,
  setKind,
  setNewFloorName,
  setReplace,
  sortedBySheetNo,
  suggestedSetName,
  titleBlockRowsOf,
  suggestedFloorName,
  toDrafts,
  toViewEdits,
  viewCardOf,
  type ReviewFloor,
} from './drawingSetReview';

const CROP = { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 };
const view = (id: string, patch: Partial<DrawingSetView> = {}): DrawingSetView => ({
  id,
  fileId: 'f1',
  pageIndex: 0,
  crop: CROP,
  source: 'ai',
  excluded: false,
  kind: 'plan',
  kindConfidence: 0.95,
  storeyLabel: 'floor',
  storeyNo: 2,
  storeyConfidence: 0.8,
  questions: [],
  ...patch,
});
const FLOORS: ReviewFloor[] = [
  { id: 'L-1', name: 'Tầng 1', hasDrawing: true, isSection: false },
  { id: 'L-2', name: 'Tầng 2', hasDrawing: false, isSection: false },
  { id: 'L-S', name: 'Mặt cắt', hasDrawing: false, isSection: true },
];

describe('bản nháp: máy chỉ đề xuất, không tự chọn đích', () => {
  it('khởi đầu không đích dù máy đoán tầng; đích máy chủ đã lưu (của người duyệt) được giữ', () => {
    const drafts = toDrafts([view('a'), view('b', { target: { mode: 'floor', floorId: 'L-1', replace: true } })]);

    expect(drafts[0]?.target).toEqual({ mode: 'none' });
    expect(drafts[1]?.target).toEqual({ mode: 'floor', floorId: 'L-1', replace: true });
  });

  it('tên tầng mới gợi ý theo tầng máy đọc; chưa rõ thì rỗng', () => {
    expect(suggestedFloorName({ storeyLabel: 'floor', storeyNo: 2 })).toBe('Tầng 2');
    expect(suggestedFloorName({ storeyLabel: 'basement', storeyNo: undefined })).toBe('Tầng hầm');
    expect(suggestedFloorName({ storeyLabel: undefined, storeyNo: undefined })).toBe('');
  });

  it('thẻ: chip máy không bao giờ xanh (A5); độ chắc thấp → vàng/đỏ', () => {
    const high = viewCardOf(toDrafts([view('a', { kindConfidence: 0.99, storeyConfidence: 0.99 })])[0]!);
    const low = viewCardOf(toDrafts([view('b', { kindConfidence: 0.5, storeyConfidence: 0.8, questions: [{ code: 'STOREY_UNSURE' }] })])[0]!);

    expect(high.kindStatus).not.toBe('verified');
    expect(high.storeyStatus).not.toBe('verified');
    expect(low.kindStatus).toBe('violation');
    expect(low.kindChip).toBe('Chưa chắc');
    expect(low.questions).toHaveLength(1);
  });
});

describe('toViewEdits — thân N59', () => {
  it('mặt cắt thành dòng mặt cắt (tên theo chữ đọc được, không có thì đánh số); mặt bằng mang đích; hình bỏ không mang đích', () => {
    const drafts = toDrafts([
      view('p', { target: { mode: 'newFloor', floorId: 'L-N', name: ' Tầng 2 ' } }),
      view('s1', { kind: 'section', titleText: 'Mặt cắt A-A' }),
      view('s2', { kind: 'section' }),
      view('s3', { kind: 'section' }),
      view('x', { excluded: true, target: { mode: 'floor', floorId: 'L-2' } }),
      view('e', { kind: 'elevation' }),
    ]);
    const edits = toViewEdits(drafts);

    expect(edits[0]?.target).toEqual({ mode: 'newFloor', floorId: 'L-N', name: 'Tầng 2' });
    expect(edits[1]?.target).toEqual({ mode: 'section', name: 'Mặt cắt A-A' });
    expect(edits[2]?.target).toEqual({ mode: 'section', name: 'Mặt cắt 2' });
    expect(edits[3]?.target).toEqual({ mode: 'section', name: 'Mặt cắt 3' });
    expect(edits[4]).toEqual(expect.objectContaining({ id: 'x', excluded: true }));
    expect(edits[4]?.target).toBeUndefined();
    expect(edits[5]?.target).toBeUndefined();
  });

  it('tầng mới tên trống: giữ hình, bỏ đích; replace chỉ gửi khi true; storeyNo đi nguyên', () => {
    const blank = toViewEdits(toDrafts([view('p', { target: { mode: 'newFloor', floorId: 'L-N', name: '  ' } })]));
    const noReplace = toViewEdits(toDrafts([view('p', { target: { mode: 'floor', floorId: 'L-1' } })]));
    const replace = toViewEdits(toDrafts([view('p', { target: { mode: 'floor', floorId: 'L-1', replace: true } })]));

    expect(blank[0]?.target).toBeUndefined();
    expect(noReplace[0]?.target).toEqual({ mode: 'floor', floorId: 'L-1' });
    expect(replace[0]?.target).toEqual({ mode: 'floor', floorId: 'L-1', replace: true });
    expect(replace[0]?.storeyNo).toBe(2);
    expect(sameEdits(replace, replace.map((edit) => ({ ...edit })))).toBe(true);
  });

  it('đổi loại khỏi mặt bằng thì mất đích', () => {
    let drafts = toDrafts([view('p')]);

    drafts = chooseNewFloor(drafts, 'p', 'L-N');
    expect(drafts[0]?.target).toEqual({ mode: 'newFloor', floorId: 'L-N', name: 'Tầng 2' });
    drafts = setKind(drafts, 'p', 'roof');
    expect(drafts[0]?.target).toEqual({ mode: 'none' });
  });
});

describe('checkConfirm — không "dựng luôn", chặn trước khi gửi N60', () => {
  it('chưa chọn đích nào → không xác nhận được, có câu nói', () => {
    const check = checkConfirm(toDrafts([view('a'), view('b')]), FLOORS);

    expect(check.canConfirm).toBe(false);
    expect(check.problems.filter((problem) => problem.viewId !== undefined)).toHaveLength(2);
    expect(check.problems.some((problem) => problem.viewId === undefined)).toBe(true);
  });

  it('khối "Ngôi nhà" còn việc (NHA-08b): mỗi câu thành một vấn đề của cả bộ và chặn xác nhận', () => {
    const drafts = chooseNewFloor(toDrafts([view('a')]), 'a', 'L-N');

    expect(checkConfirm(drafts, FLOORS, []).canConfirm).toBe(true);
    const blocked = checkConfirm(drafts, FLOORS, ['Còn 1 lỗi.', 'Còn 2 cảnh báo chưa xem.']);

    expect(blocked.canConfirm).toBe(false);
    expect(blocked.problems).toEqual([{ text: 'Còn 1 lỗi.' }, { text: 'Còn 2 cảnh báo chưa xem.' }]);
  });

  it('một hình có đích, hình còn lại chưa chọn → chặn đúng hình đó; bỏ hình ấy thì qua', () => {
    let drafts = chooseNewFloor(toDrafts([view('a'), view('b')]), 'a', 'L-N');
    const blocked = checkConfirm(drafts, FLOORS);

    expect(blocked.canConfirm).toBe(false);
    expect(blocked.problems).toEqual([{ viewId: 'b', text: 'Chọn tầng cho hình mặt bằng này.' }]);
    drafts = setExcluded(drafts, 'b', true);
    expect(checkConfirm(drafts, FLOORS).canConfirm).toBe(true);
  });

  it('hai hình cùng một tầng; tầng mới tên trống; tầng là dòng mặt cắt', () => {
    const same = chooseExistingFloor(chooseExistingFloor(toDrafts([view('a'), view('b')]), 'a', 'L-2'), 'b', 'L-2');

    expect(checkConfirm(same, FLOORS).problems.some((problem) => problem.viewId === 'b' && problem.text.includes('một tầng'))).toBe(false);
    expect(checkConfirm(same, FLOORS).problems.some((problem) => problem.viewId === 'b' && problem.text.includes('Mỗi tầng chỉ có một mặt bằng'))).toBe(true);
    const blankName = setNewFloorName(chooseNewFloor(toDrafts([view('a')]), 'a', 'L-N'), 'a', ' ');

    expect(checkConfirm(blankName, FLOORS).problems[0]?.text).toBe('Đặt tên cho tầng mới.');
    const section = chooseExistingFloor(toDrafts([view('a')]), 'a', 'L-S');

    expect(checkConfirm(section, FLOORS).problems[0]?.text).toBe('Tầng này không còn dùng được. Chọn tầng khác.');
  });

  it('tầng đã có bản vẽ: chặn tới khi tick "Thay bản vẽ cũ", và tóm tắt nói tầng đó phải duyệt lại', () => {
    let drafts = chooseExistingFloor(toDrafts([view('a')]), 'a', 'L-1');
    const blocked = checkConfirm(drafts, FLOORS);

    expect(blocked.canConfirm).toBe(false);
    expect(blocked.problems[0]?.text).toContain('Tầng 1 đã có bản vẽ');
    drafts = setReplace(drafts, 'a', true);
    const ok = checkConfirm(drafts, FLOORS);

    expect(ok.canConfirm).toBe(true);
    expect(ok.summary.replacedFloorNames).toEqual(['Tầng 1']);
    expect(confirmSummaryText(ok.summary)).toContain('phải duyệt lại');
    expect(REPLACE_WARNING).toContain('duyệt lại');
  });

  it('tầng chưa có bản vẽ gắn thẳng, không cần tick; mặt cắt được đếm vào tóm tắt', () => {
    const drafts = chooseExistingFloor(toDrafts([view('a'), view('s', { kind: 'section' })]), 'a', 'L-2');
    const check = checkConfirm(drafts, FLOORS);

    expect(check.canConfirm).toBe(true);
    expect(check.summary).toMatchObject({ existingFloors: 1, newFloors: 0, sections: 1, replacedFloorNames: [] });
    expect(confirmSummaryText(check.summary)).toBe('Máy sẽ gắn bản vẽ vào 1 tầng đã có, thêm 1 dòng mặt cắt, rồi chạy xử lý từng mặt bằng.');
  });

  it('chỉ có mặt cắt, không mặt bằng → không xác nhận được', () => {
    expect(checkConfirm(toDrafts([view('s', { kind: 'section' })]), FLOORS).canConfirm).toBe(false);
  });
});

describe('confirmedLines', () => {
  it('liệt kê tầng mới, mặt cắt, tầng có sẵn (thay bản cũ nhắc duyệt lại); bỏ hình đã loại', () => {
    const lines = confirmedLines([
      view('a', { target: { mode: 'newFloor', floorId: 'L-N', name: 'Tầng 2' } }),
      view('s', { kind: 'section', target: { mode: 'section', name: 'Mặt cắt' } }),
      view('r', { target: { mode: 'floor', floorId: 'L-1', replace: true } }),
      view('x', { excluded: true, target: { mode: 'floor', floorId: 'L-2' } }),
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('duyệt lại');
  });
});

describe('K-65: số bản vẽ và khung tên', () => {
  it('sắp theo số bản vẽ (so số theo giá trị), hình không số xếp sau theo thứ tự cũ; thân N59 không mang sheetNo', () => {
    const drafts = toDrafts([view('a', { sheetNo: 'KT-10' }), view('b'), view('c', { sheetNo: 'KT-2' }), view('d')]);

    expect(sortedBySheetNo(drafts).map((draft) => draft.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(JSON.stringify(toViewEdits(drafts))).not.toContain('sheetNo');
  });

  it('không hình nào có số: giữ thứ tự máy chủ', () => {
    const drafts = toDrafts([view('a'), view('b'), view('c')]);

    expect(sortedBySheetNo(drafts).map((draft) => draft.id)).toEqual(['a', 'b', 'c']);
  });

  it('dòng khung tên chỉ gồm trường có; gợi ý tên bộ lấy từ công trình và không đè tên đã có', () => {
    const block = { owner: 'Anh An', project: ' Nhà phố An ', date: '01/11/2026' };

    expect(titleBlockRowsOf(block).map((row) => row.label)).toEqual(['Chủ đầu tư', 'Công trình', 'Ngày']);
    expect(titleBlockRowsOf(undefined)).toEqual([]);
    expect(suggestedSetName(block, undefined)).toBe('Nhà phố An');
    expect(suggestedSetName(block, 'Tên cũ')).toBeNull();
    expect(suggestedSetName({ owner: 'Anh An' }, undefined)).toBeNull();
  });
});
