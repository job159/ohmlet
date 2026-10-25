import { bluePillBench, mcuChannel, tap } from './lib.mjs'

export default {
  id: 'stepper-a4988',
  order: 30,
  category: 'motor',
  difficulty: 'advanced',
  title: 'NEMA 17 步進馬達與 A4988 驅動器',
  summary: 'TIM2 產生 STEP 脈波並在更新中斷裡做梯形加減速；MS1–MS3 切換 1/8 微步與全步',
  description: [
    'A4988 把雙極步進馬達的兩組線圈電流控制全部包辦：MCU 只要給 DIR（方向）和 STEP（上升緣走一步），再用 MS1–MS3 選全步、1/2、1/4、1/8 或 1/16 微步。NEMA 17 一圈 200 個全步，1/8 微步就是 1600 個 STEP 脈波。',
    '韌體：TIM2 CH1（PA0）輸出 STEP 脈波，每個更新中斷依梯形曲線重新計算下一步的週期（加速 → 等速 → 減速），避免馬達一開始就失步；PB0 = DIR、PB12–PB14 = MS1–MS3、PB15 = EN（低電位致能）。動作依序：+1600 步（1/8 微步，一圈）、−100 步（全步，半圈）、−800 步（1/8，半圈），每次完成後印出位置。',
    '接線：馬達電源 PS2 12 V 接 VMOT（實際電路要在 VMOT 與 GND 間並聯一顆 100 µF 電解電容，吸收長電源線電感造成的電壓突波；模擬中的電源沒有導線電感，所以範例省略）；VDD 接 3.3 V；RST 與 SLP 互相短接（RST 沒有內部上拉，不能空接）；線圈 A 接 1A / 1B、線圈 B 接 2A / 2B。試試看：在屬性面板調整「限流 VREF」，太低時馬達扭力不足而失步。',
  ].join('\n\n'),
  tags: ['步進馬達', 'A4988', 'NEMA 17', '微步', '加減速', 'TIM2'],
  glyph: 'a4988_driver',
  firmware: 'hal-stepper-a4988',
  simulation: 'full',
  build() {
    const b = bluePillBench()
    b.add({ id: 'PS2', type: 'power_supply', params: { voltage: 12 } })
    // A4988 at g40: EN g40 MS1 g41 MS2 g42 MS3 g43 RST g44 SLP g45 STEP g46 DIR g47 /
    //               VMOT d40 GND_MOT d41 2B d42 2A d43 1A d44 1B d45 VDD d46 GND d47
    b.add({ id: 'DRV1', type: 'a4988_driver', at: 'g40' })
    b.add({ id: 'M1', type: 'nema17_stepper' })
    b.wire('PS2:+', 'a40', 'red') // VMOT 12 V
    b.wire('PS2:-', b.rail('top-', 42), 'black')
    b.toRail('a41', 'top-') // GND_MOT
    b.toRail('a46', 'top+') // VDD 3.3 V
    b.toRail('a47', 'top-') // logic GND
    b.wire('c44', 'M1:A+', 'green') // 1A
    b.wire('c45', 'M1:A-', 'black') // 1B
    b.wire('c43', 'M1:B+', 'red') // 2A
    b.wire('c42', 'M1:B-', 'blue') // 2B
    b.wire('j40', tap('PB15'), 'white') // EN
    b.wire('j41', tap('PB12'), 'gray') // MS1
    b.wire('j42', tap('PB13'), 'gray') // MS2
    b.wire('j43', tap('PB14'), 'gray') // MS3
    b.wire('i44', 'i45', 'orange') // RST ↔ SLP
    b.wire('j46', tap('PA0'), 'yellow') // STEP
    b.wire('j47', tap('PB0'), 'green') // DIR
    return b
  },
  logic: { channels: [mcuChannel(0, 'PA0', 'PA0 STEP'), mcuChannel(1, 'PB0', 'PB0 DIR'), mcuChannel(2, 'PB15', 'PB15 EN')] },
  tray: 'uart',
  expect: { seconds: 0.5, uart: { USART1: 'A4988 stepper demo\r\nmove +1600 steps 1/8 (1 rev)\r\n' } },
}
