/**
 * Câu tiếng Việt cho vi phạm luật ghép của đề xuất ngôi nhà (NHA-06c). Thuần, không React.
 *
 * BE chỉ gửi mã (`T-01`…`T-07` cho tầng, `M-02`…`M-19` cho mái) kèm số liệu thô; câu và định dạng số là việc
 * của viewmodel (A15: dấu thập phân là dấu phẩy). Mã chưa có câu ra câu chung kèm mã, không ném lỗi: BE thêm
 * luật trước FE thì màn vẫn hiện được.
 */

import { formatNumber } from '@/lib/format/number';

export const BUILDING_RULE_CODES = [
  'T-01',
  'T-02',
  'T-03',
  'T-04',
  'T-05',
  'T-06',
  'T-07',
  'M-02',
  'M-03',
  'M-05',
  'M-06',
  'M-07',
  'M-09',
  'M-17',
  'M-18',
  'M-19',
] as const;
export type BuildingRuleCode = (typeof BUILDING_RULE_CODES)[number];

type Values = readonly (number | string)[];

export interface BuildingRuleInput {
  readonly code: string;
  readonly values: Values;
}

const mm = (value: number | string | undefined): string => `${formatNumber(Number(value), { fractionDigits: 0 })} mm`;
const deg = (value: number | string | undefined): string => `${formatNumber(Number(value), { maxFractionDigits: 1 })}°`;
const count = (value: number | string | undefined): string => formatNumber(Number(value), { fractionDigits: 0 });

/** Khoảng chiều cao tầng luật T-03 coi là thường gặp, và trần độ dốc của luật M-17 (BE `rules.py`). */
const STOREY_HEIGHT_OK_MM = { min: 2400, max: 4600 } as const;
const ROOF_PITCH_MAX_DEG = 85;

const ASSUMED_FIELDS: ReadonlyMap<string, string> = new Map([
  ['elevationMm', 'Cốt tầng'],
  ['heightMm', 'Chiều cao tầng'],
  ['roofForm', 'Dạng mái'],
  ['roofPitchDeg', 'Độ dốc mái'],
]);

const ROOF_MATERIALS: ReadonlyMap<string, string> = new Map([
  ['tile', 'ngói'],
  ['metal', 'tôn'],
  ['shingle', 'tấm lợp bitum'],
]);

const ROOF_FAULTS: ReadonlyMap<string, string> = new Map([
  ['ridgeBelowEave', 'đỉnh mái không cao hơn diềm'],
  ['pitchTooLow', 'mái dốc nhưng độ dốc dưới 5%'],
  ['pitchTooHigh', `độ dốc từ ${deg(ROOF_PITCH_MAX_DEG)} trở lên`],
]);

const SENTENCES: Record<BuildingRuleCode, (values: Values) => string> = {
  'T-01': ([gap]) =>
    Number(gap) < 0
      ? `Tầng trên thấp hơn đỉnh tầng dưới ${mm(Math.abs(Number(gap)))}: hai tầng chồng lấn nhau.`
      : `Giữa tầng trên và đỉnh tầng dưới còn hở ${mm(gap)}.`,
  'T-02': ([plans, sections]) => `Có ${count(plans)} tầng có mặt bằng nhưng mặt cắt cho thấy ${count(sections)} tầng.`,
  'T-03': ([height]) =>
    `Chiều cao tầng ${mm(height)} nằm ngoài khoảng thường gặp (${count(STOREY_HEIGHT_OK_MM.min)}–${mm(STOREY_HEIGHT_OK_MM.max)}).`,
  'T-04': () => 'Hai hình mặt bằng cùng được gán cho một tầng.',
  'T-05': (values) => `Cốt của tầng này khác nhau giữa các nguồn: ${values.map(mm).join(' và ')}. Hãy chọn nguồn đúng.`,
  'T-06': ([metric, imperial]) =>
    Number(metric) > 0 && Number(imperial) > 0
      ? 'Bộ hồ sơ lẫn cả hệ mét và feet-inch. Hãy kiểm tra hệ đơn vị.'
      : 'Chưa đủ chữ trên bản vẽ để biết bộ hồ sơ dùng hệ mét hay feet-inch.',
  'T-07': ([field]) => `${ASSUMED_FIELDS.get(String(field)) ?? 'Một giá trị'} là máy giả định, chưa đọc được từ bản vẽ.`,
  'M-02': ([eave, wallTop]) => `Cốt diềm mái ${mm(eave)} lệch đỉnh tường ${mm(wallTop)}.`,
  'M-03': (values) => `Độ dốc mái khác nhau giữa các nguồn: ${values.map(deg).join(' và ')}. Hãy chọn nguồn đúng.`,
  'M-05': () => 'Các nguồn không thống nhất mái bằng hay mái dốc.',
  'M-06': ([label, sloped]) => {
    if (sloped === 'sloped') return 'Bản vẽ ghi mái dốc trên nhà có tum nên máy không đề xuất mái. Hãy vẽ mái trong 3D.';

    return label === 'attic'
      ? 'Tầng cao nhất là tầng áp mái. Hãy kiểm tra mái máy đề xuất cho tầng này.'
      : 'Nhà có tum: máy đề xuất mái bằng trên tum và một tấm mái phủ tầng bên dưới. Hãy kiểm tra.';
  },
  'M-07': () => 'Mái bằng nhưng không thấy tường chắn mái hay chỗ thoát nước trên bản vẽ.',
  'M-09': ([pitch, minimum, material]) =>
    `Độ dốc ${deg(pitch)} thấp hơn mức tối thiểu ${deg(minimum)} của mái ${ROOF_MATERIALS.get(String(material)) ?? String(material)}.`,
  'M-17': (values) =>
    `Thông số mái không hợp lệ: ${values.map((fault) => ROOF_FAULTS.get(String(fault)) ?? String(fault)).join('; ') || 'cần xem lại'}.`,
  'M-18': () => 'Bộ có hình mặt bằng mái nhưng máy chưa đọc được dạng mái. Hãy chọn dạng mái.',
  'M-19': ([text]) => `Độ dốc ghi “${String(text)}” có hai cách đọc. Hãy chọn cách đọc đúng.`,
};

const isRuleCode = (code: string): code is BuildingRuleCode => (BUILDING_RULE_CODES as readonly string[]).includes(code);

/** Câu cho một vi phạm; mã chưa có câu → câu chung kèm mã. */
export function ruleSentence(hit: BuildingRuleInput): string {
  return isRuleCode(hit.code) ? SENTENCES[hit.code](hit.values) : `Máy báo một điểm cần xem lại (mã ${hit.code}).`;
}
