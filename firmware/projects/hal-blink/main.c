/*
 * hal-blink — the canonical STM32CubeIDE "blinky" for a Blue Pill:
 * HSE 8 MHz × PLL9 = 72 MHz, SysTick 1 kHz (HAL_Delay), PC13 (on-board LED,
 * active low) and PA5 (external LED) toggled every 500 ms.
 *
 * Expected on the simulator: PA5 and PC13 square waves, 501 ms high / 501 ms
 * low (HAL v1.1.9 HAL_Delay(n) waits n + uwTickFreq ticks), PC13 = !PA5.
 * First edge ≈ 501 ms after the clock setup.
 */
#include "stm32f1xx_hal.h"

static void SystemClock_Config(void);
static void MX_GPIO_Init(void);
void Error_Handler(void);

int main(void) {
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();

  while (1) {
    HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);
    HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
    HAL_Delay(500);
  }
}

static void SystemClock_Config(void) {
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState = RCC_HSE_ON;
  osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  osc.HSIState = RCC_HSI_ON;
  osc.PLL.PLLState = RCC_PLL_ON;
  osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();

  clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) Error_Handler();
}

static void MX_GPIO_Init(void) {
  GPIO_InitTypeDef g = {0};
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();

  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET); /* LED off (active low) */
  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);

  g.Pin = GPIO_PIN_13;
  g.Mode = GPIO_MODE_OUTPUT_PP;
  g.Pull = GPIO_NOPULL;
  g.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOC, &g);

  g.Pin = GPIO_PIN_5;
  HAL_GPIO_Init(GPIOA, &g);
}

void Error_Handler(void) {
  __disable_irq();
  while (1) {
  }
}
