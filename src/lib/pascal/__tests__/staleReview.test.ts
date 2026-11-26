import { describe, expect, it } from 'vitest';

import { hasStaleReviewBadge } from '../staleReview';

const bag = (reviewed: boolean) => ({ appfront: { confidence: 0.6, source: 'human', reviewed } });
const nodes = (roofReviewed: boolean) => ({
  'roof_R-1': { id: 'roof_R-1', type: 'roof', metadata: bag(roofReviewed) },
  rseg_abc: { id: 'rseg_abc', type: 'roof-segment' },
  'item_F-1': { id: 'item_F-1', type: 'item', metadata: bag(true) },
  'wall_W-1': { id: 'wall_W-1', type: 'wall', metadata: {} },
});
const saved = (id: string, reviewed: boolean) => ({ after: { id, reviewed } });

describe('hasStaleReviewBadge — cảnh còn nói "đã duyệt" mà bản lưu đã bỏ', () => {
  it('mái đã duyệt bị sửa hình: bản lưu là chưa duyệt, túi của cảnh vẫn "đã duyệt" → cần đặt cảnh lại', () => {
    expect(hasStaleReviewBadge(nodes(true), [saved('R-1', false)])).toBe(true);
  });

  it('đồ đạc cũng vậy: so theo thân id, không theo loại node', () => {
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

  it('lượt xoá (không có "sau") và lượt không đổi gì: không cần', () => {
    expect(hasStaleReviewBadge(nodes(true), [{ after: null }])).toBe(false);
    expect(hasStaleReviewBadge(nodes(true), [])).toBe(false);
  });
});
