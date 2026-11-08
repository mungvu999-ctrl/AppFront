/**
 * M2 — mục "Lớp đề xuất" trong menu "Xem" của trang 3D. View thuần (`SuggestionsPanel`, chỉ props) + nối kho
 * (`SuggestionsCard`, qua `useSuggestionLayer`). Mỗi tầng: công tắc lớp (cờ máy chủ `suggestionsEnabled`; bật lại thì
 * máy chủ chạy luật ngay), nhóm theo luật kèm số đang bật, công tắc từng món, "Gợi ý cũ" (xám, kèm lý do).
 */
import { SECTION_TITLE_CLASS } from './menuGroup';
import type { FloorSuggestionsView } from './suggestionLayer';
import { useSuggestionLayer, type SuggestionLayerView } from './useSuggestionLayer';

const ROW = 'flex min-h-7 items-start gap-2 rounded-lg px-2 py-1 text-[12px] text-[var(--pa-text-2)]';
const CHECK = 'mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--pa-accent)]';

function FloorBlock({ floor, view }: { readonly floor: FloorSuggestionsView; readonly view: SuggestionLayerView }) {
  const headingId = `suggestions-${floor.floorId}`;
  return (
    <section aria-labelledby={headingId} className="pb-1">
      <p className={SECTION_TITLE_CLASS} id={headingId}>
        Lớp đề xuất · {floor.floorName}
      </p>
      <label className={ROW}>
        <input
          checked={floor.visible}
          className={CHECK}
          disabled={view.readOnly}
          onChange={() => view.onToggleVisible(floor.floorId)}
          type="checkbox"
        />
        <span>Bật lớp đề xuất của tầng</span>
      </label>
      {floor.groups.map((group) => (
        <details className="px-1" key={group.rule}>
          <summary className="flex min-h-7 cursor-pointer items-center justify-between gap-2 rounded-lg px-1 text-[12px] text-[var(--pa-text)] hover:bg-[var(--pa-sunken)] outline-none focus-visible:outline-2 focus-visible:outline-[var(--pa-accent)]">
            <span>{group.title}</span>
            <span className="text-[var(--pa-text-3)]">
              {group.countLabel}
              {group.listOnly ? ' · chỉ liệt kê' : ''}
            </span>
          </summary>
          <ul aria-label={group.title}>
            {group.items.map((item) => (
              <li key={item.id}>
                <label className={ROW}>
                  <input
                    checked={item.on}
                    className={CHECK}
                    disabled={view.readOnly || item.adopted}
                    onChange={(event) => view.onToggleItem(floor.floorId, item.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>
                    {item.label}
                    {item.adopted ? ' (đã nhận làm đồ thật)' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {floor.stale.length === 0 ? null : (
        <details className="px-1">
          <summary className="flex min-h-7 cursor-pointer items-center justify-between gap-2 rounded-lg px-1 text-[12px] text-[var(--pa-text-3)] hover:bg-[var(--pa-sunken)] outline-none focus-visible:outline-2 focus-visible:outline-[var(--pa-accent)]">
            <span>Gợi ý cũ</span>
            <span>{floor.stale.length}</span>
          </summary>
          <ul aria-label="Gợi ý cũ">
            {floor.stale.map((item) => (
              <li className={`${ROW} flex-col gap-0 text-[var(--pa-text-3)]`} key={item.id}>
                <span>{item.label}</span>
                <span>{item.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {floor.visible && floor.groups.length === 0 && floor.stale.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-[var(--pa-text-3)]">Máy chủ chưa có gợi ý cho tầng này; lượt lưu tới sẽ sinh.</p>
      ) : null}
      {floor.pending ? (
        <p className="px-2 text-[11px] text-[var(--pa-text-3)]" role="status">
          Đang chờ lưu thay đổi của lớp đề xuất.
        </p>
      ) : null}
    </section>
  );
}

export function SuggestionsPanel({ view }: { readonly view: SuggestionLayerView }) {
  if (view.floors.length === 0) {
    return (
      <div className="pb-1">
        <p className={SECTION_TITLE_CLASS}>Lớp đề xuất</p>
        <p className="px-2 py-1 text-[12px] text-[var(--pa-text-3)]">Dự án chưa có tầng nào.</p>
      </div>
    );
  }
  if (!view.supported) {
    return (
      <div className="pb-1">
        <p className={SECTION_TITLE_CLASS}>Lớp đề xuất</p>
        <p className="px-2 py-1 text-[12px] text-[var(--pa-text-3)]" role="status">
          Máy chủ chưa hỗ trợ lớp đề xuất.
        </p>
      </div>
    );
  }
  return (
    <div>
      {view.floors.map((floor) => (
        <FloorBlock floor={floor} key={floor.floorId} view={view} />
      ))}
    </div>
  );
}

/** Mục nối kho cho menu "Xem". */
export function SuggestionsCard({ readOnly }: { readonly readOnly: boolean }) {
  return <SuggestionsPanel view={useSuggestionLayer(readOnly)} />;
}
