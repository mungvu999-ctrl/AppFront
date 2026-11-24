// @vitest-environment jsdom
/** L6-N06 — hộp thoại chia sẻ nói đúng phạm vi của liên kết: mọi tầng; địa chỉ không ra trang chia sẻ. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import vi from '@/i18n/vi.json';

import { ShareDialog } from './ShareDialog';
import { buildShareDialogProps } from './shareDialogFixtures';
import { SHARE_SCOPE_NOTE } from './shareDialogGateway';

afterEach(cleanup);

describe('L6-N06 — dòng phạm vi chia sẻ', () => {
  it('hiện dòng nói người có liên kết xem được mọi tầng và địa chỉ không hiển thị', () => {
    render(<ShareDialog {...buildShareDialogProps('success')} />);
    const note = screen.getByText(SHARE_SCOPE_NOTE);
    expect(note.textContent).toContain('mọi tầng của dự án');
    expect(note.textContent).toContain('Địa chỉ dự án không hiển thị');
  });

  it('từ điển vi.json giữ cùng một câu', () => {
    expect(vi.shareDialog.link.scopeNote).toBe(SHARE_SCOPE_NOTE);
  });
});
