/**
 * A1 P1: cột minh hoạ là mặt bằng nét mực tĩnh của trang chào (`planSvg`, không canvas 3D) và vẫn hiện dưới `lg`.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { drawablePlan } from './drawablePlan';
import { ValuePanel } from './ValuePanel';

afterEach(() => {
  cleanup();
});

describe('ValuePanel — mặt bằng nét mực', () => {
  it('vẽ mặt bằng của trang chào bằng SVG, không canvas, và không ẩn dưới lg', async () => {
    const { container } = render(<ValuePanel />);

    await waitFor(() => {
      expect(container.querySelector('.auth-plan-art svg')).not.toBeNull();
    });
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('section')?.className).not.toMatch(/(^| )hidden( |$)/u);
    expect(screen.getByText('Soát bản vẽ mặt bằng trước khi sai sót kịp ra công trường.')).toBeTruthy();
  });

  it('chuẩn bị nét để vẽ dần: pathLength 1 và trễ tăng dần theo thứ tự', () => {
    const out = drawablePlan('<svg><polygon points="0,0 1,1"/><line x1="0"/><text>a</text><circle r="1"/></svg>');

    expect(out.match(/pathLength="1"/gu)).toHaveLength(3);
    expect([...out.matchAll(/--d:(\d+)ms/gu)].map((m) => Number(m[1]))).toEqual([0, 300, 600]);
    expect(out).toContain('<text>a</text>');
  });
});

describe('A-11 — hoạ tiết không vào cây truy cập', () => {
  it('drawablePlan bỏ role/nhãn của SVG gốc', () => {
    const out = drawablePlan('<svg role="img" aria-label="Mặt bằng"><line x1="0"/></svg>');
    expect(out).not.toContain('role="img"');
    expect(out).not.toContain('aria-label');
    expect(out).toContain('aria-hidden="true"');
  });
});
