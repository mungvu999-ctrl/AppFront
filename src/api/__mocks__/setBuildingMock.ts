/**
 * Đề xuất ngôi nhà giả cho bộ hồ sơ giả (`./drawingSetClient.ts`), NHA-06c. Thuần: hình của bộ + quyết định
 * đã lưu → đề xuất, đủ để màn duyệt đi hết vòng "xem cảnh báo → xác nhận" khi chưa có BE.
 *
 * Luật của bản giả (đơn giản hơn BE, cùng hình dạng dây): mỗi mặt bằng đang dùng là một tầng cao 3,3 m xếp
 * chồng; tầng cao nhất có chiều cao mặc định và một mái bằng mặc định, mỗi thứ kèm một cảnh báo T-07 cho tới
 * khi người duyệt nhập số; mái bằng kèm gợi ý M-07. Khoá cảnh báo cùng công thức với BE (`mã|hình|số liệu`).
 *
 * Bản giả KHÔNG sinh mâu thuẫn giữa các nguồn hay vi phạm mức lỗi, không kiểm quyết định trỏ tới hình đã
 * loại, và không đóng băng đề xuất khi xác nhận: ba trong bốn lý do N60 từ chối chỉ thấy được với BE thật.
 */

import type { DrawingSetView } from '@/api/schemas/drawingSet';
import type { BuildingDecisions, BuildingProposal, Measured, RuleHit } from '@/api/schemas/setBuilding';

const STOREY_HEIGHT_MM = 3300;

const machine = (value: number | string, source: Measured['source'], confidence: number, viewIds: string[] = []): Measured => ({
  value,
  confidence,
  source,
  viewIds,
});

const typed = (value: number | string, viewId: string): Measured => ({ value, confidence: 1, source: 'reviewer', viewIds: [viewId] });

const hit = (code: string, level: RuleHit['level'], floorRefs: string[], values: (number | string)[]): RuleHit => ({
  key: [code, ...floorRefs, ...values.map(String)].join('|'),
  code,
  level,
  floorRefs,
  values,
});

export function mockBuildingProposal(views: readonly DrawingSetView[], decisions: BuildingDecisions | undefined): BuildingProposal {
  const plans = views.filter((view) => !view.excluded && view.kind === 'plan');
  const levelEdits = new Map((decisions?.levels ?? []).map((level) => [level.levelRef, level]));
  const violations: RuleHit[] = [];
  const levels = plans.map((view, index) => {
    const edit = levelEdits.get(view.id);
    const top = index === plans.length - 1;

    if (top && edit?.heightMm === undefined) violations.push(hit('T-07', 'warning', [view.id], ['heightMm', 'default']));

    return {
      levelRef: view.id,
      elevationMm: edit?.elevationMm === undefined ? machine(index * STOREY_HEIGHT_MM, 'plan', 0.8, [view.id]) : typed(edit.elevationMm, view.id),
      heightMm:
        edit?.heightMm === undefined
          ? machine(STOREY_HEIGHT_MM, top ? 'default' : 'plan', top ? 0.4 : 0.75, [view.id])
          : typed(edit.heightMm, view.id),
    };
  });
  const top = levels.at(-1);
  const roofEdit = decisions?.roofs.find((roof) => roof.levelRef === top?.levelRef);
  const roofs: BuildingProposal['roofs'] = [];

  if (top !== undefined && roofEdit?.skip !== true) {
    const ref = top.levelRef;
    const form = roofEdit?.form === undefined ? machine('flat', 'default', 0.3) : typed(roofEdit.form, ref);

    if (roofEdit?.form === undefined) violations.push(hit('T-07', 'warning', [ref], ['roofForm', 'default']));
    if (form.value === 'flat') violations.push(hit('M-07', 'hint', [ref], []));
    roofs.push({
      levelRef: ref,
      form,
      pitchDeg: roofEdit?.pitchDeg === undefined ? machine(0, 'default', 0.3) : typed(roofEdit.pitchDeg, ref),
      quarterTurns: machine(0, 'convention', 0.6),
      eaveElevationMm: machine(Number(top.elevationMm.value) + Number(top.heightMm.value), top.heightMm.source, top.heightMm.confidence, [ref]),
      overhangMm: machine(0, 'convention', 0.4),
    });
  }

  return {
    unitSystem: machine('metric', 'plan', 0.9),
    floors: plans.map((view, index) => ({
      floorId: view.id,
      kind: 'plan',
      kindConfidence: view.kindConfidence,
      storeyNo: index + 1,
      storeyConfidence: view.storeyConfidence ?? 0,
      elevationMm: index * STOREY_HEIGHT_MM,
      elevationConfidence: 0.8,
      elevationSource: 'plan',
      heightMm: STOREY_HEIGHT_MM,
      heightConfidence: index === plans.length - 1 ? 0.4 : 0.75,
      heightSource: index === plans.length - 1 ? 'default' : 'plan',
      questions: [],
    })),
    levels,
    roofs,
    conflicts: [],
    violations,
  };
}

/** Khoá các cảnh báo người duyệt chưa đánh dấu "Đã xem" — còn thì N60 từ chối (`building.warnings`). */
export const unseenWarningKeys = (proposal: BuildingProposal, decisions: BuildingDecisions): string[] =>
  proposal.violations.filter((item) => item.level === 'warning' && !decisions.seen.includes(item.key)).map((item) => item.key);
