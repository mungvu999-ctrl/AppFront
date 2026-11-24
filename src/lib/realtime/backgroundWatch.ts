/**
 * Sổ đăng ký các lượt xử lý đang được theo dõi **ở nền** — sau khi người dùng
 * rời màn Xử lý.
 *
 * ## Ranh giới vật lý, viết ra để không ai hứa quá
 *
 * Màn Xử lý hôm nay KHÔNG dùng kênh đẩy từ máy chủ (`completionNotice` vẫn
 * `supported: false`: máy chủ đã ghi thông báo xong/hỏng nhưng cổng chưa nối). Nên "chạy nền" ở đây có đúng một nghĩa, và không hơn:
 *
 * > **Rời MÀN NÀY trong cùng một phiên trình duyệt.** Đóng thẻ, tải lại trang,
 * > hoặc tắt trình duyệt là hết: dòng sự kiện chết theo trang, và không thông
 * > báo nào tới được nữa.
 *
 * Mọi chuỗi tiếng Việt mà nơi gọi viết ra phải nằm trong ranh giới đó.
 *
 * ## Module này KHÔNG tự mở kết nối
 *
 * Nó không biết `EventSource`, không biết quay vòng, không có giãn cách thử lại.
 * Việc mở dòng sự kiện vẫn là `createProgressStream` như trước; nơi gọi trao vào
 * đây **hàm huỷ đăng ký** của dòng đã mở và sổ này giữ cho hàm đó không bị gọi
 * lúc màn tháo (`BackgroundWatchEntry.release`).
 *
 * Đăng ký rồi rời màn thì KHÔNG huỷ — đó là toàn bộ lý do sổ này tồn tại. Cái
 * duy nhất kết thúc một lượt theo dõi là {@link BackgroundWatchRegistry.settle}:
 * nó nhả dòng sự kiện và gọi `onSettled` đúng MỘT lần, để nơi gọi đẩy một thông
 * báo.
 *
 * Không React ở đây (mục 0.4): `src/lib` chạy được trong worker và test được
 * không cần DOM.
 */

/** Một lượt theo dõi kết thúc theo đúng hai cách máy chủ báo về. */
export type BackgroundWatchOutcome = 'done' | 'failed';

export interface BackgroundWatchEntry {
  /** Danh tính của lượt xử lý — nơi gọi ghép, ví dụ `"<projectId>:<uploadId>"`. */
  readonly id: string;
  /** Nhãn tiếng Việt của thứ đang chạy, để câu thông báo gọi đúng tên. */
  readonly label: string;
  /**
   * Huỷ đăng ký dòng sự kiện đã mở. Sổ này CHỈ gọi nó lúc lượt kết thúc hoặc
   * lúc bị nhả thẳng — không bao giờ vì màn tháo.
   */
  readonly release: () => void;
  /** Gọi đúng một lần, sau khi dòng sự kiện đã được nhả. */
  readonly onSettled: (outcome: BackgroundWatchOutcome, entry: BackgroundWatchEntry) => void;
}

export interface BackgroundWatchRegistry {
  /**
   * Bắt đầu theo dõi một lượt ở nền.
   *
   * Đăng ký lại cùng một `id` thay bản cũ: bản cũ được nhả trước, vì hai dòng sự
   * kiện cho cùng một lượt là một rò rỉ, không phải hai lần theo dõi.
   */
  readonly watch: (entry: BackgroundWatchEntry) => void;
  /** Lượt này có đang được theo dõi ở nền không. */
  readonly has: (id: string) => boolean;
  /** Ảnh chụp danh sách đang theo dõi — để chẩn đoán và để test đọc. */
  readonly list: () => readonly BackgroundWatchEntry[];
  /**
   * Lượt đã kết thúc: nhả dòng sự kiện rồi gọi `onSettled`.
   *
   * Trả `false` khi `id` không nằm trong sổ — nhịp cuối của một lượt KHÔNG chạy
   * nền vẫn đi qua đây, và đó là chuyện bình thường, không phải lỗi.
   */
  readonly settle: (id: string, outcome: BackgroundWatchOutcome) => boolean;
  /** Nhả một lượt mà KHÔNG báo gì — dùng lúc dọn dẹp, không phải lúc xong việc. */
  readonly release: (id: string) => boolean;
  /** Nhả tất cả, không báo gì. Test gọi nó giữa hai lượt kiểm. */
  readonly releaseAll: () => void;
}

export function createBackgroundWatchRegistry(): BackgroundWatchRegistry {
  const entries = new Map<string, BackgroundWatchEntry>();

  const take = (id: string): BackgroundWatchEntry | undefined => {
    const entry = entries.get(id);

    if (entry === undefined) {
      return undefined;
    }

    // Rút khỏi sổ TRƯỚC khi gọi bất cứ thứ gì của nó: `onSettled` có thể đăng ký
    // lại, và một lượt không bao giờ được kết thúc hai lần.
    entries.delete(id);
    return entry;
  };

  return {
    watch: (entry) => {
      const previous = take(entry.id);

      previous?.release();
      entries.set(entry.id, entry);
    },

    has: (id) => entries.has(id),

    list: () => [...entries.values()],

    settle: (id, outcome) => {
      const entry = take(id);

      if (entry === undefined) {
        return false;
      }

      entry.release();
      entry.onSettled(outcome, entry);
      return true;
    },

    release: (id) => {
      const entry = take(id);

      if (entry === undefined) {
        return false;
      }

      entry.release();
      return true;
    },

    releaseAll: () => {
      for (const entry of [...entries.values()]) {
        entries.delete(entry.id);
        entry.release();
      }
    },
  };
}

/**
 * Sổ của cả ứng dụng.
 *
 * Một sổ, vì "còn lượt nào đang theo dõi ở nền không" là một câu hỏi của cả
 * phiên, không phải của một cây React. Nơi gọi nào cần cách ly (test, story)
 * thì dựng sổ riêng bằng {@link createBackgroundWatchRegistry} và tiêm vào.
 */
export const backgroundWatchRegistry: BackgroundWatchRegistry = createBackgroundWatchRegistry();
