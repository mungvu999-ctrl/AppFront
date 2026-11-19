import { describe, expect, it } from 'vitest';

import * as copy from '@/lib/viewmodel/houseProposalParts';

import { elevationSignedText, heightMmText } from './floorFormat';

/** `src/lib` không nhập được `src/screens`: bản chép trong viewmodel phải viết số y như bảng tầng. */
describe('cách viết số của bảng đề xuất = bảng tầng', () => {
  it.each([0, 1, -1, 50, 300, -300, 999, 1000, 3600, -3000, 6900, 12345, 300000, -30000, 3600.4, 3599.6])('%d mm', (mm) => {
    expect(copy.elevationSignedText(mm)).toBe(elevationSignedText(mm));
    expect(copy.heightMmText(mm)).toBe(heightMmText(mm));
  });
});
