/* Shared clock / USART1 / MSP code for the soc-* firmware (see soc_common.h). */
#include "soc_common.h"
#include "mini_printf.h"

UART_HandleTypeDef huart1;

void soc_clock_72mhz(void) {
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

void soc_clock_hsi(void) {
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
  clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV1;
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_0) != HAL_OK) Error_Handler();

  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState = RCC_HSE_OFF;
  osc.PLL.PLLState = RCC_PLL_OFF;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
}

void soc_uart1_init(uint32_t baud) {
  huart1.Instance = USART1;
  huart1.Init.BaudRate = baud;
  huart1.Init.WordLength = UART_WORDLENGTH_8B;
  huart1.Init.StopBits = UART_STOPBITS_1;
  huart1.Init.Parity = UART_PARITY_NONE;
  huart1.Init.Mode = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart1.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart1) != HAL_OK) Error_Handler();
}

/* mini_printf output: blocking HAL transmit, one byte at a time */
void mini_putchar(char c) { HAL_UART_Transmit(&huart1, (uint8_t *)&c, 1, 100); }

/* ---- MSP callbacks (stm32f1xx_hal_msp.c in a CubeIDE project) */

void HAL_MspInit(void) {
  __HAL_RCC_AFIO_CLK_ENABLE();
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_AFIO_REMAP_SWJ_NOJTAG();
}

void HAL_UART_MspInit(UART_HandleTypeDef *huart) {
  GPIO_InitTypeDef g = {0};
  if (huart->Instance == USART1) {
    __HAL_RCC_USART1_CLK_ENABLE();
    __HAL_RCC_GPIOA_CLK_ENABLE();
    /* PA9 USART1_TX, PA10 USART1_RX */
    g.Pin = GPIO_PIN_9;
    g.Mode = GPIO_MODE_AF_PP;
    g.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(GPIOA, &g);
    g.Pin = GPIO_PIN_10;
    g.Mode = GPIO_MODE_INPUT;
    g.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOA, &g);
  }
}

void Error_Handler(void) {
  __disable_irq();
  while (1) {
  }
}

/* ---- Cortex-M3 exception handlers (stm32f1xx_it.c in a CubeIDE project) */

void NMI_Handler(void) {
  while (1) {
  }
}
void HardFault_Handler(void) {
  while (1) {
  }
}
void MemManage_Handler(void) {
  while (1) {
  }
}
void BusFault_Handler(void) {
  while (1) {
  }
}
void UsageFault_Handler(void) {
  while (1) {
  }
}
void SVC_Handler(void) {}
void DebugMon_Handler(void) {}
void PendSV_Handler(void) {}
void SysTick_Handler(void) { HAL_IncTick(); }
