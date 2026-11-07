/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** M1-01: `compiler` bật "GLB dựng trên máy chủ" ở màn Xuất; vắng hoặc `legacy` = chỉ GLB nhanh. */
  readonly VITE_EXPORT_ENGINE?: 'legacy' | 'compiler';
}
