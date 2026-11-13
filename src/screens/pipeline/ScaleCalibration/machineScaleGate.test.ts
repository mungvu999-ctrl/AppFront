import { describe, expect, it } from 'vitest';

import { machineScaleGateOf } from './machineScaleGate';

describe('machineScaleGateOf (R9, phản biện X F5)', () => {
  it('ước lượng / chưa xác định: chặn nhận số máy bằng nút chính; còn nút phụ khi không mâu thuẫn', () => {
    expect(machineScaleGateOf(true, 'estimated', ['door'])).toEqual({ allowAcceptMachine: true });
    expect(machineScaleGateOf(true, 'unresolved', ['chain', 'anisotropic'])).toEqual({ allowAcceptMachine: true });
  });

  it('nguồn mâu thuẫn: ẩn hẳn lựa chọn nhận số máy', () => {
    expect(machineScaleGateOf(true, 'unresolved', ['chain', 'sourceConflict'])).toEqual({ allowAcceptMachine: false });
  });

  it('đọc từ bản vẽ, máy chủ cũ, hoặc số người đã đo: không chặn', () => {
    expect(machineScaleGateOf(true, 'determined', ['chain'])).toBeNull();
    expect(machineScaleGateOf(true, undefined, undefined)).toBeNull();
    expect(machineScaleGateOf(false, 'estimated', ['door'])).toBeNull();
  });
});
