/**
 * zh-TW runtime messages of the sensors family
 * (src/sim/models/sensors.model.ts + sensors-*.ts): the "not simulated"
 * notes the MPU-6050 / BMP280 / BME280 / DS18B20 models log on first use,
 * the DHT11 / DHT22 start-signal rules and the ACS712 supply / range
 * warnings. Bodies without a component prefix are composed by the generic
 * «id»: «message» wrapper of messages-core ("U3: …", "BME280: …",
 * "DHT22: …"). Ids, pin and register names, numbers and units stay
 * verbatim; Chinese sentences use full-width punctuation.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'

export const MESSAGES_ZH: MessagePattern[] = [
  // ---- MPU-6050 (logged once per feature)
  tpl('MPU-6050: FSYNC (EXT_SYNC_SET) is not simulated', () => 'MPU-6050：未模擬 FSYNC（EXT_SYNC_SET）'),
  tpl('MPU-6050: self-test is not simulated — outputs unchanged', () => 'MPU-6050：未模擬自我測試——輸出值不變'),
  tpl('MPU-6050: external-sensor FIFO words are not simulated', () => 'MPU-6050：未模擬外部感測器的 FIFO 字組'),
  tpl('MPU-6050: the auxiliary I²C master / bypass mode is not simulated', () => 'MPU-6050：未模擬輔助 I²C 主端／旁路模式'),
  tpl(
    'MPU-6050: I2C_IF_DIS must be 0 on the MPU-6050 (SPI exists only on the MPU-6000)',
    () => 'MPU-6050：MPU-6050 的 I2C_IF_DIS 必須為 0（只有 MPU-6000 有 SPI）',
  ),
  tpl('MPU-6050: writes to FIFO_R_W are ignored', () => 'MPU-6050：已忽略寫入 FIFO_R_W 的資料'),
  tpl('MPU-6050: DMP (registers 0x6D–0x70) is not simulated — writes ignored', () => 'MPU-6050：未模擬 DMP（暫存器 0x6D–0x70）——已忽略寫入'),

  // ---- BMP280 / BME280 ("BME280: …" through the id wrapper)
  tpl('CSB low selects SPI, which is not simulated — use I²C (CSB high)', () => 'CSB 拉低會選擇 SPI，而 SPI 未模擬——請使用 I²C（CSB 接高準位）'),
  tpl('3-wire SPI (spi3w_en) is not simulated', () => '未模擬 3 線式 SPI（spi3w_en）'),

  // ---- DHT11 / DHT22 ("DHT22: …")
  tpl(
    'start signal ignored — the sensor needs «s» s after power-up before the first read',
    (g) => `已忽略起始訊號——感測器通電後需等待 ${g.s} s 才能進行第一次讀取`,
  ),
  tpl('start signal ignored — reads must be at least «s» s apart', (g) => `已忽略起始訊號——兩次讀取至少需間隔 ${g.s} s`),

  // ---- DS18B20 ("DS18B20: …", the issue also carries the component id)
  tpl(
    'VDD is at GND (parasite-power mode), which is not simulated — power VDD from 3.3–5 V',
    () => 'VDD 接在 GND（寄生供電模式），此模式未模擬——請由 3.3–5 V 供電給 VDD',
  ),
  tpl('unknown ROM command 0x«c» ignored', (g) => `已忽略未知的 ROM 指令 0x${g.c}`),
  tpl('unknown function command 0x«c» ignored', (g) => `已忽略未知的功能指令 0x${g.c}`),

  // ---- ACS712 module ("U4: ACS712 …")
  tpl(
    'ACS712 supply «v#» V is outside 4.5–5.5 V: output zero point and sensitivity are not specified there',
    (g) => `ACS712 電源 ${g.v} V 超出 4.5–5.5 V：在此範圍外，輸出零點與靈敏度沒有規格保證`,
  ),
  tpl('ACS712 current «i#» A exceeds its ±5 A range', (g) => `ACS712 電流 ${g.i} A 超出其 ±5 A 量測範圍`),
]
