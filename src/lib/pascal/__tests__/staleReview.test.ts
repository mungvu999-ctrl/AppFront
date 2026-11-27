import { describe, expect, it } from 'vitest';

import { hasRevertedBadge, hasStaleReviewBadge } from '../staleReview';

const bag = (reviewed: boolean) => ({ appfront: { confidence: 0.6, source: 'human', reviewed } });
const nodes = (roofReviewed: boolean) => ({
  'roof_R-1': { id: 'roof_R-1', type: 'roof', metadata: bag(roofReviewed) },
  rseg_abc: { id: 'rseg_abc', type: 'roof-segment' },
  'item_F-1': { id: 'item_F-1', type: 'item', metadata: bag(true) },
  'wall_W-1': { id: 'wall_W-1', type: 'wall', metadata: {} },
  'wall_W-2': { id: 'wall_W-2', type: 'wall', metadata: bag(true) },
});
const kindOf = (id: string): string => (id.startsWith('F-') ? 'furniture' : id.startsWith('W-') ? 'wall' : 'roof');
const saved = (id: string, reviewed: boolean) => ({ kind: kindOf(id), after: { id, reviewed } });

describe('hasStaleReviewBadge — cảnh còn nói "đã duyệt" mà bản lưu đã bỏ', () => {
  it('mái đã duyệt bị sửa hình: bản lưu là chưa duyệt, túi của cảnh vẫn "đã duyệt" → cần đặt cảnh lại', () => {
    expect(hasStaleReviewBadge(nodes(true), [saved('R-1', false)])).toBe(true);
  });

  it('đồ đạc cũng vậy', () => {
    expect(hasStaleReviewBadge(nodes(false), [saved('F-1', false)])).toBe(true);
  });

  it('bản lưu vẫn là đã duyệt (vừa bấm "Duyệt mái", hay chỉ đổi tên): không cần', () => {
    expect(hasStaleReviewBadge(nodes(true), [saved('R-1', true), saved('F-1', true)])).toBe(false);
  });

  it('túi của cảnh đã là chưa duyệt, node không có túi, hay node không còn trong cảnh: không cần', () => {
    expect(hasStaleReviewBadge(nodes(false), [saved('R-1', false)])).toBe(false);
    expect(hasStaleReviewBadge(nodes(true), [saved('W-1', false)])).toBe(false);
    expect(hasStaleReviewBadge(nodes(true), [saved('R-9', false)])).toBe(false);
  });

  it('một lượt lưu có cả mục còn duyệt lẫn mục mất duyệt: chỉ cần một mục lệch là đủ', () => {
    expect(hasStaleReviewBadge(nodes(true), [saved('F-1', true), saved('R-1', false)])).toBe(true);
  });

  it('PR 115 P2 — tường, cửa, phòng đã duyệt bị sửa: không thẻ nào đọc túi ấy nên không dựng lại cảnh giữa lúc kéo', () => {
    expect(hasStaleReviewBadge(nodes(true), [saved('W-2', false)])).toBe(false);
    expect(hasStaleReviewBadge(nodes(true), [saved('W-2', false), saved('R-1', false)])).toBe(true);
  });

  it('lượt xoá (không có "sau") và lượt không đổi gì: không cần', () => {
    expect(hasStaleReviewBadge(nodes(true), [{ kind: 'roof', after: null }])).toBe(false);
    expect(hasStaleReviewBadge(nodes(true), [])).toBe(false);
  });
});

describe('hasRevertedBadge — PR 115 P2: lượt không ghi gì mà túi nguồn/duyệt của cảnh lệch cảnh đã lưu', () => {
  const origin = (source: string, reviewed: boolean) => ({ appfront: { confidence: 0.6, source, reviewed } });
  const scene = (source: string, reviewed: boolean) => ({
    'roof_R-1': { id: 'roof_R-1', type: 'roof', metadata: origin(source, reviewed) },
    'wall_W-1': { id: 'wall_W-1', type: 'wall', metadata: {} },
    'wall_W-2': { id: 'wall_W-2', type: 'wall', metadata: origin(source, reviewed) },
    'item_F-1': { id: 'item_F-1', type: 'item', metadata: origin(source, reviewed) },
  });

  it('Ctrl+Z đưa túi `ai` về trong khi bản lưu là người sửa, chưa duyệt: cần dựng lại', () => {
    expect(hasRevertedBadge(scene('human', false), scene('ai', false), ['roof_R-1'])).toBe(true);
    expect(hasRevertedBadge(scene('human', false), scene('human', true), ['roof_R-1'])).toBe(true);
    expect(hasRevertedBadge(scene('human', false), scene('ai', false), ['item_F-1'])).toBe(true);
  });

  it('túi không đổi, node đổi không phải node ấy, node không có túi: không cần', () => {
    expect(hasRevertedBadge(scene('human', false), scene('human', false), ['roof_R-1'])).toBe(false);
    expect(hasRevertedBadge(scene('human', false), scene('ai', false), ['wall_W-1'])).toBe(false);
    // Tường cũng mang túi, nhưng không thẻ nào đọc nó: không dựng lại cảnh vì tường.
    expect(hasRevertedBadge(scene('human', false), scene('ai', false), ['wall_W-2'])).toBe(false);
    expect(hasRevertedBadge(scene('human', false), scene('ai', false), [])).toBe(false);
  });

  it('node mới chưa có trong cảnh đã lưu, hay đã bị gỡ khỏi cảnh: không cần (dựng lại sẽ xoá node đang vẽ dở)', () => {
    expect(hasRevertedBadge({}, scene('ai', false), ['roof_R-1'])).toBe(false);
    expect(hasRevertedBadge(scene('human', false), {}, ['roof_R-1'])).toBe(false);
  });
});
