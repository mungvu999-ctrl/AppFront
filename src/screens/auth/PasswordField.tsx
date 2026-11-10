/**
 * Ô mật khẩu của nhóm màn đăng nhập, kèm nút mắt hiện/ẩn chữ đã gõ — một chỗ cho
 * `/login`, nhận lời mời và đặt lại mật khẩu, để ba nơi cư xử như nhau (BUG-051).
 *
 * Hiện hay ẩn là trạng thái hiển thị của riêng ô, không thuộc mô hình: nó không đổi
 * gì trong thứ được gửi đi, nên ở đây chứ không ở hook của màn.
 */

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input, type InputProps } from '@/components/ui/Input';

/* Nhập THEO TÊN, không default — lý do ở `recoveryShared.ts`. */
import { auth as AUTH_MESSAGES } from '@/i18n/vi.json';

/**
 * Luật của ô (BUG-049) đi qua `hint` của `Input`: đoạn ấy có `id` và được `aria-describedby`
 * trỏ tới (FIX-651), và nhường chỗ cho câu lỗi khi có lỗi — đúng hai điều ô này cần.
 */
export type PasswordFieldProps = Omit<InputProps, 'type' | 'suffix'>;

export function PasswordField({ disabled, id, ...props }: PasswordFieldProps) {
  const [isVisible, setVisible] = useState(false);
  const fallbackId = useId();
  // Nút mắt cần id của ô cho `aria-controls`, nên id dựng ở đây rồi đưa xuống `Input`.
  const inputId = id ?? fallbackId;

  return (
    <Input
      {...props}
      id={inputId}
      type={isVisible ? 'text' : 'password'}
      disabled={disabled}
      suffix={
        // `type="button"`: Enter hay bấm trên nút chỉ đổi hiện/ẩn, không bao giờ gửi biểu mẫu (BUG-011).
        // Trạng thái nói bằng NHÃN đổi Hiện/Ẩn, không thêm `aria-pressed`: nhãn đổi cộng nút bật là
        // nói hai lần, mâu thuẫn nhau (APG "Button": nhãn đổi thì không dùng `aria-pressed`).
        <button
          type="button"
          disabled={disabled}
          aria-controls={inputId}
          aria-label={
            isVisible ? AUTH_MESSAGES.actions.hidePassword : AUTH_MESSAGES.actions.showPassword
          }
          onClick={() => {
            setVisible((visible) => !visible);
          }}
          // Vùng bấm 24 px, 44 px khi con trỏ thô (`coarse:`), icon vẫn 16 px; `-mr-*` ăn vào lề khối suffix để icon gần như không dời (BUG-040).
          // Vòng accent riêng như mọi nút (BUG-036): vòng `focus-within` của ô không nói tiêu điểm đang ở ô hay ở nút.
          // Không `disabled:opacity-*`: ô khoá đã mờ cả khối, mờ thêm ở đây là mờ hai lần.
          className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm outline-hidden coarse:-mr-3 coarse:h-11 coarse:w-11 text-text-muted transition-colors duration-120 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface disabled:cursor-not-allowed"
        >
          {isVisible ? (
            <EyeOff aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Eye aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      }
    />
  );
}
