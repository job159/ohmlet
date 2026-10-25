/*
 * soc-exti — HAL external interrupt: PB12 is an input with pull-up and
 * EXTI falling-edge interrupt (GPIO_MODE_IT_FALLING → AFIO_EXTICR4 = port
 * B, EXTI_FTSR/IMR bit 12, NVIC EXTI15_10_IRQn). HAL_GPIO_EXTI_Callback
 * toggles PA5. The main loop sleeps in WFI between interrupts.
 */
#include "../soc-common/soc_common.h"

static void MX_GPIO_Init(void) {
  GPIO_InitTypeDef g = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
  g.Pin = GPIO_PIN_5;
  g.Mode = GPIO_MODE_OUTPUT_PP;
  g.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOA, &g);

  g.Pin = GPIO_PIN_12;
  g.Mode = GPIO_MODE_IT_FALLING;
  g.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(GPIOB, &g);

  HAL_NVIC_SetPriority(EXTI15_10_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(EXTI15_10_IRQn);
}

void EXTI15_10_IRQHandler(void) { HAL_GPIO_EXTI_IRQHandler(GPIO_PIN_12); }

void HAL_GPIO_EXTI_Callback(uint16_t pin) {
  if (pin == GPIO_PIN_12) HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);
}

int main(void) {
  HAL_Init();
  soc_clock_72mhz();
  MX_GPIO_Init();
  for (;;) {
    __WFI();
  }
}
