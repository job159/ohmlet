/*
 * soc-clock — clock switching HSI 8 MHz → PLL 72 MHz → HSI 8 MHz.
 *
 * In each phase the firmware re-initialises USART1 at 115200 (HAL derives
 * BRR from the new PCLK2: 0x45 at 8 MHz = 115942 baud, 0x271 at 72 MHz =
 * 115200 baud), prints SystemCoreClock and drives a HAL_Delay(10) pulse on
 * PA5 (≥ 10 ms, HAL adds one tick). The pulse width must be the same in
 * every phase: the simulated time base follows the clock switches exactly.
 *
 * Expected on USART1:
 *   clk=8000000
 *   clk=72000000
 *   clk=8000000
 *   done
 */
#include "../soc-common/soc_common.h"
#include "mini_printf.h"

static void pulse(void) {
  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);
  HAL_Delay(10);
  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
  HAL_Delay(2);
}

static void phase(void) {
  soc_uart1_init(115200);
  mini_printf("clk=%lu\r\n", (unsigned long)SystemCoreClock);
  pulse();
}

int main(void) {
  GPIO_InitTypeDef g = {0};
  HAL_Init();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  g.Pin = GPIO_PIN_5;
  g.Mode = GPIO_MODE_OUTPUT_PP;
  g.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOA, &g);

  phase(); /* reset clock: HSI 8 MHz */
  soc_clock_72mhz();
  phase();
  soc_clock_hsi();
  phase();
  mini_printf("done\r\n");
  for (;;) {
  }
}
