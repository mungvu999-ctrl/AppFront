/**
 * Tấm xung đột — 400px, mở BÊN CẠNH, không bao giờ là hộp thoại.
 *
 * Đây là phần duy nhất của lớp cộng tác có tầng logic thật đỡ phía sau
 * (`src/lib/versioning/conflict.ts`, D-09), nên nó là phần duy nhất chạy được
 * bằng dữ liệu thật thay vì bằng props tiêm vào. `ConflictVm` đã do hook dựng
 * xong: mọi thứ ở đây là chuỗi, không có một phép tính hay một lần định dạng
 * số nào (A15).
 *
 * ## Vì sao không phải hộp thoại
 *
 * Một hộp thoại khoá bàn phím sau lưng nó và bắt người dùng trả lời trước khi
 * làm bất cứ việc gì khác. Xung đột thì ngược lại: người dùng thường cần nhìn
 * lại chính đối tượng đang tranh chấp trên bản vẽ rồi mới quyết được. Nên tấm
 * này là `role="region"`, không `aria-modal`, không bẫy tiêu điểm, không nền
 * mờ — phần còn lại của màn vẫn thao tác được trong lúc nó mở. Cùng lý do,
 * phím Esc đăng ký ở tầng `sidePanel` chứ không phải `dialog`: nó hoãn tấm
 * này lại, nó không khoá màn.
 *
 * ## Vì sao không có lựa chọn mặc định
 *
 * Không nút nào được `autoFocus`, không đồng hồ đếm ngược, không "sau 10 giây
 * thì lấy bản mới nhất". Hoãn lại (`onDeferConflict`) KHÔNG phải một lựa chọn
 * thứ tư: nó không ghi giá trị nào, chỉ cất tấm đi để người dùng quay lại sau.
 * Cho tới khi một con người bấm một trong ba nút quyết, không giá trị nào bị
 * ghi đè.
 *
 * ## Vì sao hai bên trông giống hệt nhau
 *
 * "Không bảng màu riêng cho từng người" là lệnh cấm tuyệt đối của đặc tả. Hai
 * khối giá trị dùng chung một nền, một viền, một cỡ chữ; thứ duy nhất phân
 * biệt chúng là nhãn và nội dung. Tô bên mình một màu và bên họ một màu khác
 * là cách âm thầm mớm cho người dùng một câu trả lời mà chỉ họ mới có quyền
 * đưa ra.
 */

import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';

import { AnimatePresence, motion } from '@/components/motion';
import { Button } from '@/components/ui/Button';
import { useShortcut } from '@/hooks/useShortcut';
import { durationSeconds, MOTION_EASINGS } from '@/lib/motion';
import { Z_INDEX } from '@/lib/zIndex';

import type { ConflictChoice, ConflictSideVm, ConflictVm } from './types';

/* -------------------------------------------------------------------------- */
/* Chữ tĩnh — bản dịch cố định của giao diện, không tới từ props.              */
/* -------------------------------------------------------------------------- */

const TITLE_LABEL = 'Xung đột: hai người cùng sửa một chỗ';
const OBJECT_LABEL = 'Đối tượng';
const MINE_LABEL = 'Bản của tôi';
const THEIRS_LABEL = 'Bản của họ';
const KEEP_MINE_LABEL = 'Giữ bản của tôi';
const TAKE_THEIRS_LABEL = 'Lấy bản của họ';
const MANUAL_LABEL = 'Nhập thủ công';
const DEFER_LABEL = 'Hoãn lại';

const INTRO_MESSAGE =
  'Chưa giá trị nào được ghi. Chọn một bản để tiếp tục, hoặc hoãn lại rồi quay lại.';
const DEFER_NOTE =
  'Hoãn lại không phải là một lựa chọn: không giá trị nào bị ghi đè, và xung đột vẫn còn đó.';

/**
 * Bảng khép kín: `EntityKind` có chín giá trị, thiếu một khoá là hỏng ở bước
 * typecheck chứ không phải hiện ra chữ tiếng Anh trên màn của người dùng.
 */
const ENTITY_KIND_LABEL: Readonly<Record<ConflictVm['entityType'], string>> = {
  vertex: 'đỉnh',
  wall: 'tường',
  door: 'cửa đi',
  window: 'cửa sổ',
  furniture: 'nội thất',
  room: 'phòng',
  dimension: 'kích thước',
  roof: 'mái',
  suggestion: 'đề xuất',
};

/* -------------------------------------------------------------------------- */
/* Số đo của tấm.                                                              */
/* -------------------------------------------------------------------------- */

/** Bề ngang đặc tả chốt cho tấm xung đột. */
const PANEL_WIDTH_PX = 400;

/** Quãng trượt vào từ mép phải — đủ để thấy hướng, không đủ để thành cú quăng. */
const PANEL_SLIDE_PX = 16;

/*
  Hai khe chuyển động, cả hai lấy từ thang: đặc tả xin 240ms nhưng thang chỉ
  có 120/180/260/340/700, nên tấm này đi vào ở `standard` (260ms) với đường
  cong `enter` — thứ đang tới thì giảm tốc. Biến mất là mờ dần ở đường cong
  `exit` — thứ đang rời đi thì tăng tốc.
*/
const ENTER_TRANSITION = {
  duration: durationSeconds('standard'),
  ease: MOTION_EASINGS.enter.points,
} as const;

const EXIT_TRANSITION = {
  duration: durationSeconds('standard'),
  ease: MOTION_EASINGS.exit.points,
} as const;

/* -------------------------------------------------------------------------- */
/* Một bên của xung đột.                                                       */
/* -------------------------------------------------------------------------- */

interface ConflictSideProps {
  readonly heading: string;
  readonly side: ConflictSideVm;
}

/**
 * Một khối giá trị. Hai lần gọi cho ra hai khối giống hệt nhau về mặt thị
 * giác — xem phần đầu file về lệnh cấm bảng màu riêng.
 *
 * Giá trị nằm trong `<code>` vì nó là dữ liệu bản vẽ chứ không phải câu chữ:
 * chữ đều giữ cho "220" và "330" thẳng cột nhau, và bộ soát tiếng Việt bỏ qua
 * `<code>` nên một giá trị hợp lệ không bị báo là chữ mất dấu.
 */
function ConflictSide({ heading, side }: ConflictSideProps) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border-default bg-bg-sunken p-3">
      <h3 className="text-[13px] font-medium leading-[18px] text-text-secondary">{heading}</h3>

      <code className="block wrap-break-word font-mono text-[15px] leading-5 text-text-primary">
        {side.valueLabel}
      </code>

      {/*
        Tác giả và thời điểm nằm trong hai `<span>` riêng, không phải ba mẩu chữ
        trần trong cùng một `<p>`: đặc tả bắt xung đột hiện CẢ HAI tác giả, nên
        mỗi tên phải là một mẩu tự nó đọc được — trộn chung thì "Bạn" chỉ còn tồn
        tại như một khúc của chuỗi "Bạn · vừa xong", không ai trỏ vào riêng được.
      */}
      <p className="text-[13px] leading-[18px] text-text-muted">
        <span>{side.authorName}</span>
        {' · '}
        <span>{side.atLabel}</span>
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tấm.                                                                        */
/* -------------------------------------------------------------------------- */

export interface ConflictPanelProps {
  /** `null` khi không có xung đột — tấm không dựng, và không chiếm chỗ. */
  readonly conflict: ConflictVm | null;
  /** Ba lựa chọn của con người. Không có lựa chọn thứ tư. */
  readonly onResolveConflict: (choice: ConflictChoice) => void;
  /** Cất tấm đi. Không ghi gì cả. */
  readonly onDeferConflict: () => void;
}

export function ConflictPanel({
  conflict,
  onResolveConflict,
  onDeferConflict,
}: ConflictPanelProps) {
  const titleId = useId();

  /*
    A12: Esc đóng lớp trên cùng. Tầng `sidePanel`, không phải `dialog` — tấm
    này không khoá bàn phím sau lưng nó, nên nó cũng không được chiếm tầng
    modal của registry. Chỉ đăng ký khi tấm thật sự đang mở.
  */
  useShortcut(
    {
      id: 'sidePanel.collaborationConflict.defer',
      combo: 'Escape',
      scope: 'sidePanel',
      description: 'Hoãn lại, đóng tấm xung đột mà không chọn bản nào',
      onTrigger: onDeferConflict,
    },
    { enabled: conflict !== null },
  );

  return (
    <AnimatePresence>
      {conflict !== null && (
        <motion.aside
          key="conflict-panel"
          role="region"
          aria-labelledby={titleId}
          className="fixed bottom-0 right-0 top-0 flex flex-col gap-4 overflow-y-auto border-l border-border-default bg-bg-surface p-4 shadow-panel"
          style={{ width: PANEL_WIDTH_PX, zIndex: Z_INDEX.panel }}
          initial={{ opacity: 0, x: PANEL_SLIDE_PX }}
          animate={{ opacity: 1, x: 0, transition: ENTER_TRANSITION }}
          exit={{ opacity: 0, transition: EXIT_TRANSITION }}
        >
          <header className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle
                aria-hidden="true"
                size={20}
                strokeWidth={1.5}
                className="mt-0.5 shrink-0 text-state-attention"
              />
              <h2
                id={titleId}
                className="text-[15px] font-semibold leading-5 text-text-primary"
              >
                {TITLE_LABEL}
              </h2>
            </div>

            <p className="text-[15px] leading-5 text-text-primary">{conflict.fieldLabel}</p>

            <p className="text-[13px] leading-[18px] text-text-muted">
              {OBJECT_LABEL}
              {': '}
              {ENTITY_KIND_LABEL[conflict.entityType]}{' '}
              <code className="font-mono">{conflict.entityId}</code>
            </p>

            <p className="text-[13px] leading-[18px] text-text-secondary">{INTRO_MESSAGE}</p>
          </header>

          {/*
            Cả hai bên, luôn luôn cả hai — đặc tả không cho phép một bên trống.
            Thứ tự "của tôi" trước "của họ" là thứ tự đọc, không phải thứ tự ưu
            tiên: không bên nào được đánh dấu là mặc định.
          */}
          <div className="flex flex-col gap-3">
            <ConflictSide heading={MINE_LABEL} side={conflict.mine} />
            <ConflictSide heading={THEIRS_LABEL} side={conflict.theirs} />
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                onResolveConflict('mine');
              }}
            >
              {KEEP_MINE_LABEL}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                onResolveConflict('theirs');
              }}
            >
              {TAKE_THEIRS_LABEL}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                onResolveConflict('manual');
              }}
            >
              {MANUAL_LABEL}
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-t border-border-default pt-3">
            <Button variant="ghost" fullWidth onClick={onDeferConflict}>
              {DEFER_LABEL}
            </Button>
            <p className="text-[13px] leading-[18px] text-text-muted">{DEFER_NOTE}</p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
