/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-systick-timing — SysTick and HAL_Delay timing probe.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9). HAL_RCC_ClockConfig() re-runs
  * HAL_InitTick(), so after SystemClock_Config() SysTick reloads every
  * SystemCoreClock / 1000 = 72000 HCLK cycles (LOAD = 71999, CLKSOURCE =
  * processor clock; ARMv7-M ARM B3.3): one HAL tick = exactly 1.000 ms.
  *
  *   PB13 TICK_OUT   toggled in SysTick_Handler right after HAL_IncTick():
  *                   one edge per tick → 500 Hz square wave, 1 ms high /
  *                   1 ms low. Edge spacing = 72000 cycles minus/plus the
  *                   exception-entry jitter (a few cycles).
  *   PB14 DELAY_OUT  toggled by the main loop, then HAL_Delay(100).
  *                   HAL_Delay(n) adds uwTickFreq (1) "to guarantee minimum
  *                   wait" and spins until HAL_GetTick() − start ≥ n + 1, so
  *                   when it is entered just after a tick (as it is here,
  *                   every iteration but the first) it returns 101 ticks
  *                   later: PB14 edges are 101 ms apart → 202 ms period
  *                   (4.950 Hz), not 200 ms. The first interval is 100–101 ms
  *                   because the first call starts mid-tick.
  *
  * Each PB14 edge therefore follows a PB13 edge (same SysTick interrupt) by
  * the interrupt-return + loop latency, well under 10 µs. A simulator that
  * reproduces both numbers has SysTick reload, exception entry/return and
  * HAL_Delay's tick arithmetic right.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* USER CODE BEGIN PV */
volatile uint8_t tick_out_enabled;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* Configure the system clock */
  SystemClock_Config();

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  /* USER CODE BEGIN 2 */
  /* SysTick already runs (HAL_Init); start toggling PB13 only now that it is
     an output, so the ISR never writes GPIOB before its clock is enabled */
  tick_out_enabled = 1;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    HAL_GPIO_TogglePin(DELAY_OUT_GPIO_Port, DELAY_OUT_Pin);
    HAL_Delay(100);
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(GPIOB, TICK_OUT_Pin|DELAY_OUT_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pins : TICK_OUT_Pin DELAY_OUT_Pin */
  GPIO_InitStruct.Pin = TICK_OUT_Pin|DELAY_OUT_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  (void)file;
  (void)line;
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
