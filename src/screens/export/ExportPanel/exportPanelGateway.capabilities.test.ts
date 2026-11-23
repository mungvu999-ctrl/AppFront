/** L3-N02: cờ năng lực PDF khai tường minh, đo trên cổng thật (không qua fixture ép `false`). */
import { describe, expect, it } from 'vitest';

import { createExportPanelGateway, readExportCapabilities } from './exportPanelGateway';

describe('cổng năng lực màn Xuất (cổng thật)', () => {
  it('canRenderPdfBytes là true: PDF dựng bằng renderPdfBlob, không suy từ tên hàm', () => {
    expect(readExportCapabilities().canRenderPdfBytes).toBe(true);
    expect(createExportPanelGateway().readCapabilities().canRenderPdfBytes).toBe(true);
  });

  it('chưa có khung nhìn 3D thì chưa chụp được ảnh', () => {
    expect(readExportCapabilities().canCaptureImage).toBe(false);
  });
});
