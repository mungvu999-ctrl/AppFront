/**
 * R9 (phản biện X F5): số tỷ lệ máy đề xuất mà máy chủ nói chỉ là ước lượng (`estimated`) hoặc chưa xác
 * định (`unresolved`) thì KHÔNG được thành "người dùng hiệu chỉnh" bằng một cú bấm. Nút chính là đo một
 * đoạn đã biết; nút áp khoá tới khi có đoạn + chiều dài; nhận số máy chỉ còn là nút phụ có hộp xác nhận,
 * và ẩn hẳn khi các nguồn tỷ lệ mâu thuẫn (`sourceConflict`).
 */
import type { WireScaleState } from '@/lib/viewmodel/provisionalScale';

export interface MachineScaleGate {
  /** Có nút phụ "Dùng tạm tỷ lệ máy ước lượng" (qua hộp xác nhận) hay không. */
  readonly allowAcceptMachine: boolean;
}

/** `null` = không chặn (số người đo/gõ, tỷ lệ đọc từ bản vẽ, hoặc máy chủ cũ không có `scaleState`). */
export function machineScaleGateOf(
  isMachineProposal: boolean,
  scaleState: WireScaleState | undefined,
  scaleReasons: readonly string[] | undefined,
): MachineScaleGate | null {
  if (!isMachineProposal || (scaleState !== 'estimated' && scaleState !== 'unresolved')) return null;

  return { allowAcceptMachine: !(scaleReasons ?? []).includes('sourceConflict') };
}

export const MEASURE_FIRST_LABEL = 'Đo một đoạn đã biết';
export const MEASURE_FIRST_HINT = 'Đặt một đoạn dọc cạnh đã biết rồi nhập chiều dài thật — nút Xác nhận tỷ lệ mở khi đủ.';
export const MEASURE_FIRST_NOTICE =
  'Tỷ lệ máy chỉ ước lượng hoặc chưa xác định, chưa dùng làm tỷ lệ của tầng được. Đo một đoạn đã biết (ví dụ một bức tường có ghi kích thước) rồi nhập chiều dài thật.';
export const ACCEPT_MACHINE_LABEL = 'Dùng tạm tỷ lệ máy ước lượng';
export const ACCEPT_MACHINE_CONFIRM = {
  title: 'Dùng tạm tỷ lệ máy ước lượng?',
  message:
    'Máy chỉ ước tỷ lệ này, chưa đo từ kích thước nào trên bản vẽ: mọi chiều dài, diện tích và mô hình 3D có thể sai tới ±40 %. Dùng tạm thì tầng vẫn ghi là tỷ lệ ước lượng, chưa xác nhận. Nên đo một đoạn đã biết thay vì dùng số này.',
  confirmLabel: 'Vẫn dùng số máy',
  cancelLabel: 'Đo một đoạn',
} as const;
