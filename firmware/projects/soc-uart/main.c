/*
 * soc-uart — HAL USART1 at 115200 8N1 on a 72 MHz Blue Pill.
 *
 * Sends "hello\r\n" with HAL_UART_Transmit, then echoes every byte it gets
 * through HAL_UART_Receive (polling, HAL_MAX_DELAY) and toggles PC13 per
 * echoed byte. At 72 MHz HAL programs BRR = 0x271 (USARTDIV 39.0625):
 * exactly 115200 baud, one bit = 625 PCLK2 cycles = 8.6806 µs.
 */
#include "../soc-common/soc_common.h"

static void MX_GPIO_Init(void) {
  GPIO_InitTypeDef g = {0};
  __HAL_RCC_GPIOC_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET);
  g.Pin = GPIO_PIN_13;
  g.Mode = GPIO_MODE_OUTPUT_PP;
  g.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOC, &g);
}

int main(void) {
  HAL_Init();
  soc_clock_72mhz();
  MX_GPIO_Init();
  soc_uart1_init(115200);

  static const uint8_t hello[] = "hello\r\n";
  HAL_UART_Transmit(&huart1, (uint8_t *)hello, sizeof hello - 1, 100);

  for (;;) {
    uint8_t c;
    if (HAL_UART_Receive(&huart1, &c, 1, HAL_MAX_DELAY) == HAL_OK) {
      HAL_UART_Transmit(&huart1, &c, 1, 100);
      HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
    }
  }
}
