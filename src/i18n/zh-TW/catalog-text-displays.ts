/**
 * zh-TW display text for the display-module catalog data
 * (src/model/parts/displays.parts.ts) that catalog-text.ts does not cover:
 * pin notes shown by the inspector's pinout table (through tText). Keys are
 * the exact English catalog texts. Picked up by the src/i18n dictionary
 * glob; the rest of the display family's notes, part numbers and
 * manufacturers are in catalog-text.ts.
 */
const zh: Record<string, string> = {
  'Contrast: LCD drive = VDD − V0 (≈ 10 kΩ bias divider to VDD inside). Wiper of a 10 kΩ pot between VDD and GND, about 0.3–1 V; unconnected = invisible characters.':
    '對比：LCD 驅動電壓＝VDD − V0（內部有約 10 kΩ 的偏壓分壓接到 VDD）。接到跨在 VDD 與 GND 之間的 10 kΩ 可變電阻滑動端，約 0.3–1 V；未連接＝字元看不見。',
}

export default zh
