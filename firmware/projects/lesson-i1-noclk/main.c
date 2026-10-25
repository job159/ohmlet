/*
 * lesson-i1-noclk — lesson i1 (STM32 GPIO output), common mistake:
 * hal-blink with the GPIOA clock enable FORGOTTEN.
 *
 * Identical to hal-blink (72 MHz, PA5 + PC13 toggled, HAL_Delay(500))
 * except that MX_GPIO_Init() never calls __HAL_RCC_GPIOA_CLK_ENABLE(), so
 * RCC_APB2ENR.IOPAEN stays 0. A peripheral whose clock is gated ignores
 * register writes and reads back 0 (RM0008 §7.3.7): HAL_GPIO_Init() on
 * GPIOA has no effect, PA5 stays in its reset state (input floating) and
 * the external LED never lights. GPIOC is clocked, so the on-board PC13
 * LED still blinks: 501 ms on / 501 ms off.
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
  /* MISTAKE (on purpose): __HAL_RCC_GPIOA_CLK_ENABLE(); is missing here */

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
