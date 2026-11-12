import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';

import { clearServerLibrary, registerServerLibrary } from '@/lib/pascal/furnitureCatalog';

import { creditPartsOf, ModelCreditCard } from '../ModelCreditCard';
import type { SwapModelStores } from '../SwapModelCard';

const LICENSE = 'https://creativecommons.org/licenses/by/4.0/';
const SOURCE = 'https://sketchfab.com/3d-models/abc';
const CC_BY = `“Bàn gỗ” · Tác giả A · CC-BY 4.0 · ${LICENSE} · ${SOURCE} · đã chỉnh sửa: chuyển đổi, chuẩn hoá tệp GLB`;

describe('creditPartsOf (NO-437)', () => {
  it('turns license and source URLs into short links and shortens the modification note', () => {
    expect(creditPartsOf(CC_BY)).toEqual([
      { kind: 'text', text: '“Bàn gỗ”' },
      { kind: 'text', text: 'Tác giả A' },
      { kind: 'text', text: 'CC-BY 4.0' },
      { kind: 'link', text: 'giấy phép', href: LICENSE },
      { kind: 'link', text: 'nguồn', href: SOURCE },
      { kind: 'text', text: 'đã chỉnh sửa' },
    ]);
  });

  it('keeps the old two-part credit as plain text and never links non-http text', () => {
    expect(creditPartsOf('Poly Haven · CC0')).toEqual([
      { kind: 'text', text: 'Poly Haven' },
      { kind: 'text', text: 'CC0' },
    ]);
    expect(creditPartsOf('javascript:alert(1)')).toEqual([{ kind: 'text', text: 'javascript:alert(1)' }]);
  });
});

describe('ModelCreditCard', () => {
  afterEach(() => clearServerLibrary());

  it('renders author, license link, source link and the full credit as tooltip for the selected item', () => {
    registerServerLibrary([{ id: 'credit-x', widthMm: 800, heightMm: 750, depthMm: 800, modelUrl: 'https://x.test/c.glb', attribution: CC_BY }]);
    const useViewer = create(() => ({ selection: { selectedIds: ['item_a'] as readonly string[] } }));
    const useScene = create(() => ({ nodes: { item_a: { id: 'item_a', type: 'item', asset: { id: 'credit-x' } } } }));

    const { container } = render(<ModelCreditCard stores={{ useViewer, useScene } as unknown as SwapModelStores} />);

    expect(container.textContent).toBe('Mẫu 3D: “Bàn gỗ” · Tác giả A · CC-BY 4.0 · giấy phép · nguồn · đã chỉnh sửa');
    expect(screen.getByRole('link', { name: 'giấy phép' }).getAttribute('href')).toBe(LICENSE);
    const source = screen.getByRole('link', { name: 'nguồn' });
    expect(source.getAttribute('href')).toBe(SOURCE);
    expect(source.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.firstElementChild?.getAttribute('title')).toBe(CC_BY);
  });
});
