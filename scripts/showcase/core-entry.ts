// จุดรวม export ของ core ที่สคริปต์ showcase ใช้ใน Node (bundle ด้วย esbuild → tmp/showcase/core.mjs)
// — ตัว parse ไฟล์งาน, ไลบรารีลาย, template/วัสดุ สำหรับตรวจและเติมไฟล์ที่ agent เขียน
export { parseProjectFile, serializeProject, PROJECT_FILE_VERSION } from '../../src/core/projectFile'
export { parseProject } from '../../src/core/project'
export { PRESETS, presetById, presetDataUrl } from '../../src/core/presets'
export { TEMPLATES } from '../../src/core/templates'
export { MATERIALS, getMaterial } from '../../src/core/materials'
export { FONTS } from '../../src/core/artwork'
export { generateVessel } from '../../src/core/vessel'
export { generatePouch } from '../../src/core/pouch'
export { generateSticker } from '../../src/core/templates/sticker'
