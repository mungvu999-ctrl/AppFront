/**
 * UX-R4 U40: ten phong khong hien tren mo hinh 3D. Nhan <Html> goc cua Pascal chi gan khi showZones bat,
 * opacity 0, chi sang khi re/chon (zone-system cac goi ep opacity). Them mot nhan thuong truc rieng
 * (khong id `${node.id}-label` nen cac system khong dung toi): ten + dien tich, nen mo, chu nho,
 * Bat/tat theo co "Ten phong" (roomLabels cua useFloorplanAnnotationVisibility),
 * doc lap voi showZones. Nhan goc (sua ten, ghim) giu nguyen.
 * Editor3D dot 2 (N1): nhan la nut bam duoc o che do Chon / Xem truoc: bam -> su kien window
 * `appfront:fit-room` (detail = id vung), viewer-toolbar.tsx bay camera toi phong (fitRoom). Nut chan
 * pointerdown/up/click nen su kien R3F cua canh khong chon tuong phia sau. Cong cu khac bat: pointer-events none.
 * U45: bay camera can bam dup (ban phim Enter van bay, detail = 0). Nhan nam giua san phong, bam don de chon gi do
 * ma camera phong toi la bat ngo.
 * U70 (09/11): nhan chi ve khi tang cua vung dang hien (`isLevelShown`, chung luat voi u70-hidden-level-no-shadow).
 * <Html> cua drei la DOM ngoai do thi three: `visible`/layer cua tang khong an duoc no, nen "Tang: tung tang" tung hien
 * ca nhan cua tang an (lo lung tren khong).
 */
const FILE = 'nodes/src/zone/renderer.tsx';

export const RULES = {
  [FILE]: [
    [
      "import { useNodeEvents, useViewer, ZONE_LAYER } from '@pascal-app/viewer'\n",
      "import { useNodeEvents, useViewer, ZONE_LAYER } from '@pascal-app/viewer'\n" +
        "import { useEditor, useFloorplanAnnotationVisibility } from '@pascal-app/editor'\n" +
        "import { isLevelShown } from '@/pascal-page/upstream/lib/level-shown'\n",
    ],
    [
      '  const showZones = useViewer((s) => s.showZones)\n',
      '  const showZones = useViewer((s) => s.showZones)\n' +
        '  const showRoomLabelsU40 = useFloorplanAnnotationVisibility((s) => s.visibility.roomLabels)\n' +
        "  const labelClickU40 = useEditor((s) => s.isPreviewMode || s.mode === 'select')\n" +
        '  const levelShownU70 = useViewer((s) => isLevelShown({ levelMode: s.levelMode, hasSelectedLevel: Boolean(s.selection.levelId), isSelected: s.selection.levelId === node.parentId }))\n' +
        '  const levelVisibleU70 = useScene((s) => (node.parentId ? s.nodes[node.parentId]?.visible : undefined) !== false)\n',
    ],
    [
      '  // Create materials\n',
      '  const areaU40 = useMemo(() => {\n' +
        '    if (!polygon || polygon.length < 3) return 0\n' +
        '    let s = 0\n' +
        '    for (let i = 0; i < polygon.length; i++) {\n' +
        '      const [x0, z0] = polygon[i]!\n' +
        '      const [x1, z1] = polygon[(i + 1) % polygon.length]!\n' +
        '      s += x0 * z1 - x1 * z0\n' +
        '    }\n' +
        '    return Math.abs(s) / 2\n' +
        '  }, [polygon])\n\n' +
        '  // Create materials\n',
    ],
    [
      '      {showZones && (\n        <>\n          <Html\n            name="label"\n',
      '      {showRoomLabelsU40 && levelShownU70 && levelVisibleU70 && node.visible !== false && node.name && (\n' +
        '        <Html position={[centroid[0], 0.05, centroid[1]]} style={{ pointerEvents: \'none\' }} zIndexRange={[5, 0]}>\n' +
        '          <button\n' +
        "            aria-label={`Xem gần ${node.name}`}\n" +
        '            data-room-label-u40=""\n' +
        "            onClick={(e) => { e.stopPropagation(); if (e.detail === 0) window.dispatchEvent(new CustomEvent('appfront:fit-room', { detail: node.id })) }}\n" +
        "            onDoubleClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('appfront:fit-room', { detail: node.id })) }}\n" +
        '            onPointerDown={(e) => e.stopPropagation()}\n' +
        '            onPointerUp={(e) => e.stopPropagation()}\n' +
        "            style={{ transform: 'translate3d(-50%, -50%, 0)', display: 'block', width: 'max-content', maxWidth: '160px', padding: '2px 8px', border: 0, borderRadius: '6px', background: 'rgba(255, 255, 255, 0.78)', color: '#1f2937', font: 'inherit', fontSize: '11px', lineHeight: '15px', textAlign: 'center', pointerEvents: labelClickU40 ? 'auto' : 'none', cursor: 'pointer', userSelect: 'none', opacity: 1 }}\n" +
        '            title="Bấm đúp để xem gần phòng này"\n' +
        '            type="button"\n' +
        '          >\n' +
        "            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</div>\n" +
        "            {areaU40 > 0.05 && <div style={{ fontSize: '10px', opacity: 0.75 }}>{areaU40.toFixed(1).replace('.', ',')} m²</div>}\n" +
        '          </button>\n' +
        '        </Html>\n' +
        '      )}\n' +
        '      {showZones && (\n        <>\n          <Html\n            name="label"\n',
    ],
  ],
};
