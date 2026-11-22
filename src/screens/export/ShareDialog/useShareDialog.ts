/**
 * Tầng logic của hộp thoại chia sẻ: nối, không chế (R-61).
 *
 * Mọi câu chữ và mọi con số ở đây đến từ một hàm có sẵn trong `src/lib`:
 *
 * | Thứ view nhận | Ai sinh ra nó |
 * |---|---|
 * | `form.problems` | `validateShareLinkRequest` — hook **không tự nghĩ câu lỗi** |
 * | `rows[].url` | `shareLinkUrl(link)` — hook **không nối chuỗi URL** |
 * | `rows[].expiryText` | `describeShareLinkExpiry(link, now)` (P-02) |
 * | `rows[].statusLabel` | `SHARE_LINK_STATUS_LABELS` |
 * | `savedAtLabel` | `formatClockTime` (A15: hook không tự định dạng giờ) |
 *
 * ## Trạng thái máy chủ đi bằng `useQuery`/`useMutation` (R-64)
 *
 * Lượt đọc danh sách là một `useQuery`, hai lượt ghi là hai `useMutation`, và
 * `isLoading`/`error` đọc ra từ đó — **không** một `useState` nào ở file này giữ
 * trạng thái mạng. Đây là điểm file này khác `src/hooks/useShareLinks.ts`: hook
 * đó tự viết `isLoading`/`error` bằng tay và R-64 ghi rõ nó là "ngoại lệ đi
 * trước, không phải khuôn mẫu". `useState` ở đây chỉ giữ **lựa chọn của người
 * dùng** và ba dấu hiệu chớp tắt (khoá vừa đổi, mục vừa chép, câu nhắc liên kết
 * cũ), đúng như `useExportPanel.ts` giữ lựa chọn định dạng của nó.
 *
 * `queryKeys` không có nhánh `shareLinks`, nên khoá nối thêm vào khoá chi tiết
 * dự án — xem {@link shareLinksQueryKey}. `applyInvalidation` cũng không dùng
 * được: `WRITE_OPERATIONS` (`src/lib/query/invalidation.ts:5`) không có phép ghi
 * nào của chia sẻ, và `src/lib/query` nằm ngoài phạm vi sửa (R-68). Nên hai lượt
 * ghi gọi thẳng `invalidateQueries` trên đúng khoá của mình.
 *
 *
 * ## Không còn nhúng, mật khẩu, góc nhìn, quyền góp ý
 *
 * Máy chủ và trang chia sẻ không làm gì với bốn thứ đó, nên hộp thoại không chào mời chúng
 * (xem phần đầu `types.ts`). Liên kết mới luôn gửi quyền `view`, không mật khẩu, không góc nhìn.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ShareExpiryChoice } from '@/hooks/useShareLinks';
import {
  createShareLink,
  describeShareLinkExpiry,
  listShareLinks,
  revokeShareLink,
  selectActiveShareLinks,
  shareLinkUrl,
  SHARE_LINK_STATUS_LABELS,
  SHARE_PERMISSION_LABELS,
  validateShareLinkRequest,
  type CreateShareLinkRequest,
  type ShareLink,
  type ShareLinkRequestField,
  type ShareLinkStatus,
} from '@/lib/export/shareLink';
import { formatClockTime } from '@/lib/format/datetime';
import type { SevenState } from '@/lib/testing/sevenStateScenarios';

import {
  DEFAULT_SHARE_EXPIRY_CHOICE,
  expiryDateFor,
  MEMBERS_READ_ONLY_REASON,
  readShareLinkPermission,
  SHARE_EXPIRY_OPTIONS,
  SHARE_FORBIDDEN_REASON,
  shareLinksQueryKey,
  toExpiryChoice,
} from './shareDialogGateway';
import type {
  MemberRowModel,
  ShareDialogActions,
  ShareDialogModel,
  ShareDialogResult,
  ShareLinkRowModel,
  UseShareDialogOptions,
} from './types';

/* -------------------------------------------------------------------------- */
/* Hằng số                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Dấu tích "đã chép" giữ bao lâu.
 *
 * Đặc tả viết 1,2 giây; thang chuyển động của mục B chỉ có 120/180/260/340/700,
 * nên con số đó không hợp lệ. 700 ms là tiền lệ đang chạy — `COPY_FLASH_MS` ở
 * `src/hooks/useShareLinks.ts:251` — và là mức duy nhất trong thang đủ lâu để
 * đọc được một dấu tích.
 */
const COPY_FLASH_MS = 700;

/** Ba màu trạng thái, đúng ba (A4). */
const TONE_BY_STATUS: Readonly<Record<ShareLinkStatus, ShareLinkRowModel['tone']>> = {
  /**
   * Xanh "đã xác minh" ở đây đánh dấu một việc **người dùng đã làm** — họ tạo
   * liên kết và máy chủ xác nhận nó đang chạy. A5 cấm suy đoán của máy đặt màu
   * này; không có suy đoán nào ở đây, chỉ có `status` máy chủ trả về.
   */
  active: 'verified',
  /** Hết hạn là việc cần làm gì đó: tạo lại một liên kết mới. */
  expired: 'attention',
  /** Thu hồi là việc đã xong theo đúng ý người dùng, không phải một vấn đề. */
  revoked: 'neutral',
};

const EMPTY_MEMBERS: readonly MemberRowModel[] = Object.freeze([]);
const EMPTY_LINKS: readonly ShareLink[] = Object.freeze([]);

/* -------------------------------------------------------------------------- */
/* Dấu chớp tắt                                                               */
/* -------------------------------------------------------------------------- */

interface Flash<TValue> {
  readonly value: TValue;
  /** Đổi mỗi lần đặt lại, kể cả khi `value` không đổi — nếu không thì hiệu ứng không chạy lại. */
  readonly nonce: number;
}

/** Một giá trị tự bỏ sau `holdMs`. */
function useFlash<TValue>(holdMs: number): readonly [TValue | null, (value: TValue) => void] {
  const [flash, setFlash] = useState<Flash<TValue> | null>(null);

  useEffect(() => {
    if (flash === null) {
      return;
    }

    const timer = setTimeout(() => setFlash(null), holdMs);

    return () => clearTimeout(timer);
  }, [flash, holdMs]);

  const show = useCallback((value: TValue) => {
    setFlash((current) => ({ value, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  return [flash?.value ?? null, show];
}

/* -------------------------------------------------------------------------- */
/* Bảng lỗi                                                                   */
/* -------------------------------------------------------------------------- */

/** `readonly ShareLinkRequestProblem[]` → bảng tra theo trường mà view đọc. */
function toProblemMap(
  request: CreateShareLinkRequest,
): Partial<Record<ShareLinkRequestField, string>> {
  const problems: Partial<Record<ShareLinkRequestField, string>> = {};

  for (const problem of validateShareLinkRequest(request)) {
    problems[problem.field] ??= problem.message;
  }

  return problems;
}

/** Câu người đọc thấy khi một lượt gọi hỏng. */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'Không thực hiện được thao tác chia sẻ; hãy thử lại';
}

/**
 * Chép mặc định, khi nơi gọi không tiêm đường chép nào.
 *
 * Từ chối thay vì lặng lẽ thành công khi trình duyệt không mở bộ nhớ tạm ra
 * (ngữ cảnh không bảo mật, hoặc người dùng đã chặn quyền): một dấu tích "đã
 * chép" trên một lượt chép chưa từng xảy ra là lời nói dối đắt nhất màn này có
 * thể nói.
 */
function writeToClipboard(value: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;

  return clipboard === undefined
    ? Promise.reject(new Error('trình duyệt không cho trang này ghi vào bộ nhớ tạm'))
    : clipboard.writeText(value);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mọi thứ `ShareDialog` cần, dựng từ cổng chia sẻ, quyền và store.
 *
 * `const [model, actions] = useShareDialog({ gateway, projectId, roles });`
 */
export function useShareDialog(options: UseShareDialogOptions): ShareDialogResult {
  const { gateway, projectId, roles } = options;
  const members = options.members ?? EMPTY_MEMBERS;
  const { onToast, onDismiss, copyToClipboard } = options;

  const nowFn = options.now;
  const readNow = useCallback((): Date => nowFn?.() ?? new Date(), [nowFn]);

  const queryClient = useQueryClient();

  /* ---------------------------------------------------------------------- */
  /* Quyền                                                                   */
  /* ---------------------------------------------------------------------- */

  const canCreateLink = useMemo(() => readShareLinkPermission(roles), [roles]);

  // Máy chủ v1 không phục vụ liên kết chia sẻ (BE-BIND #47–#49 là v2): phần liên
  // kết và mã nhúng rời DOM, không lượt gọi nào tới cổng. Đây là năng lực tắt,
  // không phải thiếu quyền — không dùng `forbidden`.
  const linksSupported = gateway.supported;

  /* ---------------------------------------------------------------------- */
  /* Lựa chọn của người dùng — thứ duy nhất `useState` giữ                   */
  /* ---------------------------------------------------------------------- */

  const [expiryChoice, setExpiryChoice] = useState<ShareExpiryChoice>(DEFAULT_SHARE_EXPIRY_CHOICE);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  const [copiedTargetId, flashCopied] = useFlash<string>(COPY_FLASH_MS);

  /* ---------------------------------------------------------------------- */
  /* Danh sách liên kết — `useQuery` (R-64)                                  */
  /* ---------------------------------------------------------------------- */

  const listQuery = useQuery({
    queryKey: shareLinksQueryKey(projectId),
    queryFn: async ({ signal }): Promise<readonly ShareLink[]> => {
      const result = await listShareLinks(gateway, { projectId, signal });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      return result.data.links;
    },
    // Hộp thoại đóng thì không gọi mạng: `ExportPanel` gắn sẵn hộp thoại, nên không có
    // điều kiện này mỗi lượt tải `/export` đọc danh sách liên kết (B-V3-09).
    enabled: canCreateLink && linksSupported && (options.isOpen ?? true),
  });

  const links = listQuery.data ?? EMPTY_LINKS;
  const activeLinks = useMemo(() => selectActiveShareLinks(links), [links]);

  /* ---------------------------------------------------------------------- */
  /* Form                                                                    */
  /* ---------------------------------------------------------------------- */

  const buildRequest = useCallback(
    (now: Date): CreateShareLinkRequest => ({
      projectId,
      permission: 'view',
      expiresAt: expiryDateFor(expiryChoice, now),
      now,
    }),
    [projectId, expiryChoice],
  );

  const problems = useMemo(() => toProblemMap(buildRequest(readNow())), [buildRequest, readNow]);

  /* ---------------------------------------------------------------------- */
  /* Hai lượt ghi — `useMutation` (R-64)                                     */
  /* ---------------------------------------------------------------------- */

  const invalidateLinks = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: shareLinksQueryKey(projectId) });
  }, [queryClient, projectId]);

  const createMutation = useMutation<ShareLink, Error, void>({
    mutationFn: async () => {
      const result = await createShareLink(gateway, buildRequest(readNow()));
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      return result.data;
    },
    onSuccess: () => {
      setActionError(null);
      setSavedAtMs(readNow().getTime());
      invalidateLinks();
      onToast?.({ message: 'Đã tạo liên kết chia sẻ' });
    },
    onError: (error) => setActionError(messageOf(error)),
  });

  const revokeMutation = useMutation<ShareLink, Error, string>({
    mutationFn: async (linkId) => {
      const result = await revokeShareLink(gateway, { projectId, linkId });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      return result.data;
    },
    onSuccess: () => {
      setActionError(null);
      setSavedAtMs(readNow().getTime());
      invalidateLinks();
      onToast?.({ message: 'Đã thu hồi liên kết' });
    },
    onError: (error) => setActionError(messageOf(error)),
  });

  /* ---------------------------------------------------------------------- */
  /* Chép                                                                    */
  /* ---------------------------------------------------------------------- */

  const copy = useCallback(
    (targetId: string, text: string, toastMessage: string): void => {
      if (text.length === 0) {
        return;
      }

      const write = copyToClipboard ?? writeToClipboard;

      void Promise.resolve(write(text)).then(
        () => {
          flashCopied(targetId);
          onToast?.({ message: toastMessage });
        },
        () => setActionError('không chép được vào bộ nhớ tạm; hãy chọn và chép thủ công'),
      );
    },
    [copyToClipboard, flashCopied, onToast],
  );

  /* ---------------------------------------------------------------------- */
  /* Hàng liên kết                                                           */
  /* ---------------------------------------------------------------------- */

  const rows = useMemo<readonly ShareLinkRowModel[]>(() => {
    const now = readNow();

    return links.map((link) => {
      const expiry = describeShareLinkExpiry(link, now);

      return {
        id: link.id,
        url: shareLinkUrl(link),
        permissionLabel: SHARE_PERMISSION_LABELS[link.permission],
        statusLabel: SHARE_LINK_STATUS_LABELS[expiry.status],
        tone: TONE_BY_STATUS[expiry.status],
        expiryText: expiry.text,
        canRevoke: canCreateLink && expiry.status === 'active',
      };
    });
  }, [links, readNow, canCreateLink]);

  /* ---------------------------------------------------------------------- */
  /* Bảy trạng thái (A11)                                                    */
  /* ---------------------------------------------------------------------- */

  const isBusy = listQuery.isPending || createMutation.isPending || revokeMutation.isPending;
  const errorMessage =
    actionError ?? (listQuery.error === null ? null : messageOf(listQuery.error));

  /**
   * Thứ tự quyết định, và vì sao theo thứ tự đó.
   *
   * Quyền đi trước tất cả: không tạo được liên kết thì mọi thứ phía sau là câu
   * hỏi không cần trả lời. Rồi tới lượt gọi đang chạy, rồi tới lỗi — một lỗi vừa
   * xảy ra quan trọng hơn số hàng đang có. Ba trạng thái cuối đọc từ dữ liệu.
   */
  const state = useMemo<SevenState>(() => {
    // Năng lực tắt đi trước cả quyền: truy vấn tắt vẫn `isPending`, nên để nó
    // rơi xuống sẽ treo ở `loading`; còn `forbidden` là chuyện thiếu quyền.
    if (!linksSupported) {
      return 'success';
    }
    if (!canCreateLink) {
      return 'forbidden';
    }
    if (isBusy) {
      return 'loading';
    }
    if (errorMessage !== null) {
      return 'error';
    }
    if (links.length === 0) {
      return 'empty';
    }

    return activeLinks.length === 0 ? 'partial' : 'success';
  }, [linksSupported, canCreateLink, isBusy, errorMessage, links.length, activeLinks.length]);

  /* ---------------------------------------------------------------------- */
  /* Việc làm được                                                           */
  /* ---------------------------------------------------------------------- */

  const actions = useMemo<ShareDialogActions>(
    () => ({
      setExpiryChoice: (id: string) => setExpiryChoice(toExpiryChoice(id)),
      createLink: () => {
        if (linksSupported) createMutation.mutate();
      },
      // A9: thu hồi không có đường khôi phục, nên bấm "thu hồi" chỉ HỎI (B-V3-06).
      revokeLink: (id: string) => {
        if (linksSupported) setPendingRevokeId(id);
      },
      confirmRevoke: () => {
        if (pendingRevokeId !== null) revokeMutation.mutate(pendingRevokeId);
        setPendingRevokeId(null);
      },
      cancelRevoke: () => setPendingRevokeId(null),
      copyLink: (id: string) => {
        const row = rows.find((candidate) => candidate.id === id);
        if (row !== undefined) {
          copy(id, row.url, 'Đã chép liên kết');
        }
      },
      dismiss: () => onDismiss?.(),
    }),
    [linksSupported, createMutation, revokeMutation, pendingRevokeId, rows, copy, onDismiss],
  );

  /* ---------------------------------------------------------------------- */
  /* Model                                                                   */
  /* ---------------------------------------------------------------------- */

  const model = useMemo<ShareDialogModel>(
    () => ({
      state,
      savedAtLabel: savedAtMs === null ? null : `Đã lưu lúc ${formatClockTime(savedAtMs)}`,
      canCreateLink,
      linksSupported,
      noPermissionReason: !linksSupported || canCreateLink ? null : SHARE_FORBIDDEN_REASON,
      members,
      membersReadOnlyReason: MEMBERS_READ_ONLY_REASON,
      form: {
        expiryChoiceId: expiryChoice,
        expiryChoices: SHARE_EXPIRY_OPTIONS,
        problems,
        canSubmit:
          linksSupported && canCreateLink && Object.keys(problems).length === 0 && !isBusy,
      },
      rows,
      copiedTargetId,
      errorMessage,
      pendingRevokeUrl: rows.find((row) => row.id === pendingRevokeId)?.url ?? null,
    }),
    [
      state,
      savedAtMs,
      canCreateLink,
      linksSupported,
      members,
      expiryChoice,
      problems,
      isBusy,
      rows,
      copiedTargetId,
      errorMessage,
      pendingRevokeId,
    ],
  );

  return [model, actions];
}
