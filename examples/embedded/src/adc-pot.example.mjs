import { bluePillBench, tap } from './lib.mjs'

export default {
  id: 'adc-pot',
  order: 10,
  category: 'sensor',
  difficulty: 'beginner',
  title: 'ADC 讀取可變電阻',
  summary: 'ADC1 通道 0（PA0）每 100 ms 轉換一次，印出 12 位元原始值與換算的毫伏',
  description: [
    '可變電阻（電位計）的兩端接 3.3 V 與 GND，中間的滑動端就是一個可調的分壓器。韌體先執行 HAL_ADCEx_Calibration_Start 做自我校正，之後每 100 ms 以 HAL_ADC_Start / PollForConversion 讀一次 ADC1 通道 0（PA0 設為類比輸入），印出 `adc=<0–4095> mv=<毫伏>`，換算公式：毫伏 = 原始值 × 3300 ÷ 4095。',
    '接線：電位計逆時針那一端接 GND、順時針那一端接 3.3 V（Blue Pill 的 3V3 腳，也就是 ADC 的參考電壓 VDDA），滑動端接 PA0。示波器探棒 CH1 夾在滑動端上，可以同時看到類比電壓。',
    '試試看：模擬執行時在屬性面板拖動電位計的「旋鈕位置」，終端機的讀數跟著改變；把順時針那一端改接 5 V（下方 + 電源軌），再把旋鈕順時針轉到底，PA0 會被拉到 5 V，問題面板就會出現「U1 PA0 電壓過高」——PA0 不是 5 V 容忍腳位。',
  ].join('\n\n'),
  tags: ['ADC', '類比輸入', '電位計', '分壓', '校正'],
  glyph: 'potentiometer',
  firmware: 'hal-adc-pot',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    // 10 kΩ potentiometer: ccw c40, wiper c41, cw c42 (its body covers b/d 39–43)
    b.add({ id: 'RV1', type: 'potentiometer', holes: ['c40', 'c41', 'c42'], params: { resistance: 10000, position: 0.5 } })
    b.toRail('a40', 'top-') // ccw → GND
    b.toRail('a42', 'top+') // cw → 3.3 V
    b.wire('a41', tap('PA0'), 'green') // wiper → PA0
    b.add({ id: 'PRB1', type: 'scope_probe', holes: ['e41'], params: { channel: 1 } })
    return b
  },
  tray: 'uart',
  expect: { seconds: 0.6 },
}
