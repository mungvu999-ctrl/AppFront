import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QC_BODY_CLASS, QC_NO_CHANGES_LABEL, QC_UNDO_LABEL, QcCanvasFrame, QcScreenFrame, QcStatusBar, QcWorkspace } from './QcScreenFrame';

describe('QcScreenFrame (BUG-324, BUG-329, BUG-413)', () => {
  it('[BUG-324, UX-R2] gốc màn lấp phần còn lại của vỏ nội dung (flex-1), không h-screen làm trang cuộn dưới header', () => {
    render(<QcScreenFrame label="Màn thử">nội dung</QcScreenFrame>);
    const root = screen.getByRole('region', { name: 'Màn thử' });

    expect(root).toHaveClass('flex-1', 'min-h-0');
    expect(root.className).not.toContain('h-screen');
    expect(root.className).not.toContain('h-full');
    expect(root.className).not.toContain('overflow-y-auto');
  });

  it('[BUG-329] màn dạng trang cuộn: gốc tự cuộn để thẻ cuối không bị cắt sát đáy', () => {
    render(
      <QcScreenFrame label="Màn cuộn" scroll>
        nội dung
      </QcScreenFrame>,
    );

    expect(screen.getByRole('region', { name: 'Màn cuộn' }).className).toContain('overflow-y-auto');
  });

  it('[BUG-413] một lề trang (p-2, gap-2) và một khung bản vẽ nền chìm bo 16 cho mọi màn', () => {
    expect(QC_BODY_CLASS).toBe('gap-2 p-2');

    render(<QcCanvasFrame label="Khung bản vẽ">x</QcCanvasFrame>);
    const canvas = screen.getByLabelText('Khung bản vẽ');

    expect(canvas.className).toContain('bg-bg-sunken');
    expect(canvas.className).toContain('rounded-2xl');
  });

  it('[A3] thanh trạng thái chung: Hoàn tác tắt khi màn chưa có ngăn hoàn tác, mặc định "Chưa có thay đổi"', () => {
    render(<QcStatusBar />);

    expect(screen.getByRole('button', { name: QC_UNDO_LABEL })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Thanh trạng thái' })).toHaveTextContent(QC_NO_CHANGES_LABEL);
  });

  it('wideLeft: cột trái 320 thay vì 240 ở >=1024', () => {
    const { rerender } = render(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" left={<p>trái</p>} />);
    expect(screen.getByText('trái').parentElement?.className).toContain('lg:w-[240px]');
    rerender(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" left={<p>trái</p>} wideLeft />);
    expect(screen.getByText('trái').parentElement?.className).toContain('lg:w-[320px]');
  });

  describe('[impeccable-1024] ngăn chi tiết 1024-1279 không che bản vẽ khi chưa chọn gì', () => {
    const DRAWER_HIDDEN = 'lg:max-xl:hidden';
    const renderWorkspace = (selectionKey: string | null) => (
      <QcWorkspace canvas={<p>bản vẽ</p>} canvasLabel="Bản vẽ" inspector={<p>chi tiết thử</p>} selectionKey={selectionKey} />
    );
    const drawer = () => screen.getByText('chi tiết thử').parentElement;

    it('chưa chọn: ngăn đóng, chỉ còn nút "Hiện chi tiết"; bấm thì mở', () => {
      render(renderWorkspace(null));

      expect(drawer()?.className).toContain(DRAWER_HIDDEN);
      const toggle = screen.getByRole('button', { name: 'Hiện chi tiết' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(toggle);
      expect(drawer()?.className).not.toContain(DRAWER_HIDDEN);
      expect(screen.getByRole('button', { name: 'Ẩn chi tiết' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('chọn đối tượng thì tự mở; ẩn tay giữ theo lần chọn; chọn cái khác mở lại; bỏ chọn thì đóng', () => {
      const { rerender } = render(renderWorkspace('a'));
      expect(drawer()?.className).not.toContain(DRAWER_HIDDEN);

      fireEvent.click(screen.getByRole('button', { name: 'Ẩn chi tiết' }));
      expect(drawer()?.className).toContain(DRAWER_HIDDEN);

      rerender(renderWorkspace('b'));
      expect(drawer()?.className).not.toContain(DRAWER_HIDDEN);

      rerender(renderWorkspace(null));
      expect(drawer()?.className).toContain(DRAWER_HIDDEN);
    });

    it('≥1280 vẫn là cột cố định: lớp ẩn chỉ áp trong khoảng lg:max-xl', () => {
      render(renderWorkspace(null));

      expect(drawer()?.className).toContain('xl:w-[240px]');
      expect(drawer()?.className.split(' ')).not.toContain('hidden');
    });
  });
});

describe('[figma-layout] QcWorkspace column: hai panel neo cùng cỡ', () => {
  const dock = () => screen.getByTestId('qc-inspector-dock');

  it('cột trái và panel phải cùng 260/280/320; không còn nút "Hiện/Ẩn chi tiết"', () => {
    render(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" column inspector={<p>chi tiết</p>} left={<p>trái</p>} selectionKey="a" />);
    for (const element of [screen.getByText('trái').parentElement, dock()]) {
      expect(element?.className).toContain('lg:w-[300px] xl:w-[340px] 2xl:w-[360px]');
    }
    expect(dock().className).not.toContain('lg:max-xl:hidden');
    expect(screen.queryByRole('button', { name: 'Hiện chi tiết' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ẩn chi tiết' })).toBeNull();
  });

  it('panel phải chỉ hiện khi đang chọn; dưới 1024 là tấm đáy ≤ 45 %', () => {
    const { rerender } = render(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" column inspector={<p>chi tiết</p>} selectionKey={null} />);
    expect(dock()).toHaveClass('max-lg:absolute', 'max-lg:bottom-2', 'max-lg:max-h-[45%]', 'hidden');
    rerender(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" column inspector={<p>chi tiết</p>} selectionKey="a" />);
    expect(dock()).not.toHaveClass('hidden');
  });

  it('thu gọn ẩn cả hai panel', () => {
    render(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" collapsed column inspector={<p>chi tiết</p>} left={<p>trái</p>} selectionKey="a" />);
    expect(screen.queryByText('chi tiết')).toBeNull();
    expect(screen.queryByText('trái')).toBeNull();
  });

  it('chưa chọn: nút "Chi tiết" ở mọi cỡ mở panel "Tầng này", Esc đóng; đang chọn thì không có nút', () => {
    const tree = (key: string | null) => <QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" column inspector={<p>Tầng này</p>} selectionKey={key} />;
    const { rerender } = render(tree(null));
    const toggle = screen.getByRole('button', { name: 'Chi tiết' });
    expect(toggle).toHaveClass('min-h-8');
    expect(toggle).not.toHaveClass('lg:hidden');
    expect(toggle).toHaveAttribute('aria-controls', dock().id);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(dock()).not.toHaveClass('hidden');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(dock()).toHaveClass('hidden');

    rerender(tree('a'));
    expect(screen.queryByRole('button', { name: 'Chi tiết' })).toBeNull();
    expect(dock()).not.toHaveClass('hidden');
    rerender(tree(null));
    expect(screen.getByRole('button', { name: 'Chi tiết' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('QcStatusBar nổi trên bản vẽ (bỏ thanh đáy)', () => {
  it('khe `status` đặt cụm vào trong vùng bản vẽ; cụm vẫn có Hoàn tác và trạng thái lưu', () => {
    const onUndo = vi.fn();
    render(<QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" column status={<QcStatusBar floating onUndo={onUndo} saveLabel="Đã lưu" />} />);

    const bar = screen.getByRole('status', { name: 'Thanh trạng thái' });
    expect(screen.getByRole('region', { name: 'Bản vẽ' })).toContainElement(bar);
    expect(bar).toHaveClass('rounded-lg', 'shadow-float');
    expect(bar).not.toHaveClass('border-t');
    fireEvent.click(screen.getByRole('button', { name: QC_UNDO_LABEL }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(bar).toHaveTextContent('Đã lưu');
  });

  it('chưa có thay đổi: cụm nổi chỉ còn nút Hoàn tác', () => {
    render(<QcStatusBar floating saveLabel={QC_NO_CHANGES_LABEL} />);
    expect(screen.getByRole('status', { name: 'Thanh trạng thái' })).toHaveTextContent(QC_UNDO_LABEL);
    expect(screen.queryByText(QC_NO_CHANGES_LABEL)).toBeNull();
  });

  it('panel chi tiết nổi đè lên bản vẽ: chọn không đổi lớp của khung, panel đứng ngoài luồng', () => {
    const tree = (key: string | null) => <QcWorkspace canvas={<p>bv</p>} canvasLabel="Bản vẽ" column inspector={<p>ct</p>} selectionKey={key} />;
    const { rerender } = render(tree(null));
    const before = screen.getByRole('region', { name: 'Bản vẽ' }).className;
    rerender(tree('a'));
    expect(screen.getByRole('region', { name: 'Bản vẽ' }).className).toBe(before);
    expect(screen.getByTestId('qc-inspector-dock')).toHaveClass('lg:absolute', 'max-lg:absolute');
  });
});

describe('QcStatusBar (U49)', () => {
  it('chữ thanh đáy 14 px: nút, trạng thái lưu và gợi ý cỡ caption của màn đều lên text-body', () => {
    render(
      <QcStatusBar saveLabel="Đã lưu">
        <span className="truncate text-caption">Kéo nền hoặc giữ Space để di chuyển</span>
      </QcStatusBar>,
    );
    expect(screen.getByRole('button', { name: QC_UNDO_LABEL })).toHaveClass('text-body');
    expect(screen.getByText('Đã lưu')).toHaveClass('text-body');
    expect(screen.getByText('Kéo nền hoặc giữ Space để di chuyển').parentElement).toHaveClass('[&_.text-caption]:text-body');
  });
});
