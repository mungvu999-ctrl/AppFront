import { describe, expect, it } from 'vitest';

import { approvedRoofMetadata, roofNodeOfSelection, roofTrustLabelOf } from '../roofReview';

const AI = { appfront: { confidence: 0.6, source: 'ai', reviewed: false } };
const APPROVED = { appfront: { confidence: 0.6, source: 'human', reviewed: true } };
const HAND_DRAWN = { appfront: { confidence: 1, source: 'human', reviewed: false } };

describe('roofTrustLabelOf — nhãn của một mái', () => {
  it('mái máy dựng chưa ai duyệt: nói rõ cần duyệt, không bao giờ mang màu "đã xác minh" (A5)', () => {
    expect(roofTrustLabelOf(AI)).toEqual({
      text: 'Mái do máy dựng — cần duyệt',
      tone: 'attention',
      needsApproval: true,
    });
  });

  it('mái người đã duyệt: màu "đã xác minh", không còn gì để duyệt', () => {
    expect(roofTrustLabelOf(APPROVED)).toEqual({
      text: 'Bạn đã duyệt',
      tone: 'verified',
      needsApproval: false,
    });
  });

  it('túi `ai` mang `reviewed: true` (cặp dây cấm, lượt lưu không nhận): vẫn là cần duyệt, không xanh (A5)', () => {
    expect(roofTrustLabelOf({ appfront: { source: 'ai', reviewed: true } })).toMatchObject({
      tone: 'attention',
      needsApproval: true,
    });
  });

  it('mái người vẽ, mái vừa vẽ trong 3D (chưa có túi AppFront), và không có metadata: không nói gì', () => {
    expect(roofTrustLabelOf(HAND_DRAWN)).toBeNull();
    expect(roofTrustLabelOf({})).toBeNull();
    expect(roofTrustLabelOf(undefined)).toBeNull();
  });
});

describe('approvedRoofMetadata — "Duyệt mái"', () => {
  it('đổi CẢ nguồn lẫn cờ duyệt (dây cấm `ai` đi cùng `reviewed: true`), giữ độ tin và mọi khoá khác', () => {
    const metadata = {
      appfront: { confidence: 0.6, source: 'ai', reviewed: false, fields: { note: 'x' } },
      appfrontDefaults: ['fascia'],
    };

    expect(approvedRoofMetadata(metadata)).toEqual({
      appfront: { confidence: 0.6, source: 'human', reviewed: true, fields: { note: 'x' } },
      appfrontDefaults: ['fascia'],
    });
    expect(metadata.appfront.source).toBe('ai');
  });
});

describe('roofNodeOfSelection — mái chủ của node đang chọn', () => {
  const nodes = {
    roof_1: { id: 'roof_1', type: 'roof', parentId: 'level_1', metadata: AI },
    rseg_1: { id: 'rseg_1', type: 'roof-segment', parentId: 'roof_1' },
    rseg_orphan: { id: 'rseg_orphan', type: 'roof-segment', parentId: 'gone' },
    wall_1: { id: 'wall_1', type: 'wall', parentId: 'level_1' },
  };

  it('chọn mái thì là chính nó; chọn một mặt mái thì là mái cha', () => {
    expect(roofNodeOfSelection(nodes, 'roof_1')).toBe(nodes.roof_1);
    expect(roofNodeOfSelection(nodes, 'rseg_1')).toBe(nodes.roof_1);
  });

  it('node khác loại, mặt mái mất cha, hoặc id lạ: không có mái', () => {
    expect(roofNodeOfSelection(nodes, 'wall_1')).toBeUndefined();
    expect(roofNodeOfSelection(nodes, 'rseg_orphan')).toBeUndefined();
    expect(roofNodeOfSelection(nodes, 'nope')).toBeUndefined();
  });
});
