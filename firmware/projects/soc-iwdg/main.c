/*
 * soc-iwdg — the independent watchdog resets the MCU.
 *
 * Every boot prints its number (kept in backup register BKP_DR1, which
 * survives a system reset) and the RCC_CSR reset flags, then clears them
 * (RMVF). Boots 1 and 2 start the IWDG (/4, reload 999 → 100 ms at the
 * 40 kHz LSI), refresh it three times every 50 ms, print "starving" and
 * stop refreshing → the IWDG resets the MCU 100 ms after the last refresh.
 * Boot 3 prints "done" and idles.
 *
 * Expected on USART1 (115200 8N1):
 *   boot 1 csr=0C000000 POR PIN
 *   starving
 *   boot 2 csr=24000000 IWDG PIN
 *   starving
 *   boot 3 csr=24000000 IWDG PIN
 *   done
 */
#include "../soc-common/soc_common.h"
#include "mini_printf.h"

static IWDG_HandleTypeDef hiwdg;

int main(void) {
  HAL_Init();
  soc_clock_72mhz();
  soc_uart1_init(115200);

  uint32_t csr = RCC->CSR;
  __HAL_RCC_BKP_CLK_ENABLE();
  HAL_PWR_EnableBkUpAccess();
  uint32_t boots = (BKP->DR1 & 0xffff) + 1;
  BKP->DR1 = boots;

  mini_printf("boot %lu csr=%08lX%s%s%s%s\r\n", (unsigned long)boots, (unsigned long)(csr & 0xfc000000u),
              (csr & RCC_CSR_PORRSTF) ? " POR" : "", (csr & RCC_CSR_SFTRSTF) ? " SFT" : "",
              (csr & RCC_CSR_IWDGRSTF) ? " IWDG" : "", (csr & RCC_CSR_PINRSTF) ? " PIN" : "");
  __HAL_RCC_CLEAR_RESET_FLAGS();

  if (boots < 3) {
    hiwdg.Instance = IWDG;
    hiwdg.Init.Prescaler = IWDG_PRESCALER_4;
    hiwdg.Init.Reload = 999;
    if (HAL_IWDG_Init(&hiwdg) != HAL_OK) Error_Handler();
    for (int i = 0; i < 3; i++) {
      HAL_Delay(50);
      HAL_IWDG_Refresh(&hiwdg);
    }
    mini_printf("starving\r\n");
    for (;;) {
    }
  }
  mini_printf("done\r\n");
  for (;;) {
  }
}
