import { describe, expect, it } from 'vitest';

import type { HttpError } from '@/lib/http';

import { describeDrawingSetFailure } from './drawingSetText';

const validation = (field: string): HttpError => ({
  code: 'VALIDATION',
  kind: 'http',
  raw: { code: 'VALIDATION', field },
  requestId: 'r',
  retryable: false,
  status: 422,
});

describe('describeDrawingSetFailure — N60 từ chối vì khối ngôi nhà', () => {
  it('mỗi lý do chặn có câu riêng nói việc phải làm', () => {
    const fields = ['building.decisions', 'building.conflicts', 'building.violations', 'building.warnings'];
    const sentences = fields.map((field) => describeDrawingSetFailure(validation(field)));

    expect(new Set(sentences.map((failure) => failure.sentence)).size).toBe(4);
    expect(sentences.every((failure) => failure.kind === 'other')).toBe(true);
    expect(sentences[0]?.sentence).toContain('không còn trong bản duyệt');
    expect(sentences[1]?.sentence).toContain('mâu thuẫn');
    expect(sentences[2]?.sentence).toContain('còn lỗi');
    expect(sentences[3]?.sentence).toContain('cảnh báo');
  });

  it('`VALIDATION` ở trường khác vẫn rơi về câu chung', () => {
    const other = describeDrawingSetFailure(validation('views.0.target')).sentence;

    expect(other).not.toBe(describeDrawingSetFailure(validation('building.warnings')).sentence);
    expect(other.length).toBeGreaterThan(0);
  });
});
