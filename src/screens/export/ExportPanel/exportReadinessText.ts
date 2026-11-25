/**
 * Cụm ngắn cho từng lý do "chưa sẵn sàng" của tầng (N16 `readiness.reasons`) trong dòng preflight của bảng xuất.
 * Tách khỏi `exportPanelGateway.ts` (NHA-07b) để tệp đó không dài thêm. `Record` theo `ReadinessReason` nên BE
 * thêm lý do mà thiếu cụm ở đây là lỗi biên dịch.
 */

import type { ReadinessReason } from '@/api/schemas/spatialLayer';

export const READINESS_REASON_SHORT: Readonly<Record<ReadinessReason, string>> = {
  scaleUnresolved: 'tỷ lệ tạm',
  criticalIssues: 'lỗi nghiêm trọng',
  geometrySuspect: 'hình học đáng ngờ',
  fallbackWallModel: 'tường dò bằng mô hình dự phòng',
  fallbackObjectModel: 'đồ vật dò bằng mô hình dự phòng',
  fallbackTextModel: 'chữ đọc bằng mô hình dự phòng',
  roofUnreviewed: 'mái máy dựng chưa duyệt',
};
