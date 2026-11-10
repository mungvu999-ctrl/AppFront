/**
 * Ô email và nút "Thêm thành viên" của thẻ thành viên — chỉ dựng khi `canEdit`.
 *
 * Lỗi nằm dưới ô (`Input` tự nối `aria-describedby`). Nút khoá trong lúc đang gửi
 * và, sau một lần 429, cho tới hết thời gian chờ mà hook đếm.
 */

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

import type { MembersTabProps } from './MembersTab';
import { MEMBER_ACCESS_OPTIONS } from './useProjectMembers';

const ACCESS_OPTIONS = MEMBER_ACCESS_OPTIONS.map((option) => ({ label: option.label, value: option.value as string }));

export type AddMemberFormProps = Pick<
  MembersTabProps,
  | 'memberEmail'
  | 'memberAccess'
  | 'setMemberAccess'
  | 'memberError'
  | 'isAddingMember'
  | 'isAddMemberLocked'
  | 'setMemberEmail'
  | 'addMember'
  | 'inviteEmail'
  | 'isInvitingMember'
  | 'inviteMember'
>;

export function AddMemberForm(props: AddMemberFormProps) {
  return (
    <div className="flex flex-col gap-2">
      <form
      className="flex items-start gap-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        props.addMember();
      }}
    >
      <Input
        type="email"
        label="Email người cần thêm"
        value={props.memberEmail}
        onChange={(event) => props.setMemberEmail(event.target.value)}
        error={props.memberError}
        wrapperClassName="min-w-0 flex-1"
        disabled={props.isAddingMember}
      />
      {/* U24: quyền của người này trong riêng dự án này. */}
      <Select.Root
        className="w-[200px]"
        disabled={props.isAddingMember}
        onChange={(value) => {
          const picked = MEMBER_ACCESS_OPTIONS.find((option) => option.value === value);
          if (picked !== undefined) props.setMemberAccess(picked.value);
        }}
        options={ACCESS_OPTIONS}
        value={props.memberAccess}
      >
        <Select.Label>Quyền trong dự án</Select.Label>
        <Select.Trigger options={ACCESS_OPTIONS} />
        <Select.Content>
          {ACCESS_OPTIONS.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Button
        type="submit"
        variant="secondary"
        // Nhãn ô cao 28 px (20 + mb-2); nút cao đúng bằng khung ô (46/38 px) nên đỉnh và đáy
        // thẳng hàng ở mọi khổ. Không `items-end`: khi có câu lỗi dưới ô, nút sẽ tụt theo nó.
        className="mt-7 h-[46px] min-h-[46px] sm:h-[38px] sm:min-h-[38px]"
        loading={props.isAddingMember}
        disabled={props.isAddMemberLocked}
      >
        Thêm thành viên
      </Button>
      </form>
      {/* N4-02: quản trị hệ thống mời được ngay, không phải tự tìm sang Quản trị › Người dùng. */}
      {props.inviteEmail !== null && (
        <div>
          <Button type="button" variant="secondary" size="sm" loading={props.isInvitingMember} onClick={props.inviteMember}>
            Mời người này vào hệ thống
          </Button>
        </div>
      )}
    </div>
  );
}
