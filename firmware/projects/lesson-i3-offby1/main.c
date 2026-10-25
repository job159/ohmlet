/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : lesson-i3-offby1 — lesson i3 (timer interrupt), common
  *                   mistake: PSC/ARR written without the "- 1".
  ******************************************************************************
  * Identical to hal-tim-irq except TICK_PRESCALER = 72 and TICK_PERIOD = 1000
  * (main.h): f_UEV = 72 MHz / ((72 + 1) x (1000 + 1)) = 985.31 Hz, so PB12
  * toggles every 1.014903 ms (492.66 Hz instead of 500 Hz) and the PC13
  * heartbeat half period is 500 x 1.014903 = 507.45 ms instead of 500 ms -
  * an error of +1.49 % that a logic analyzer shows at once.
  *
  * Original description of hal-tim-irq:
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9); TIM4 counts TIMXCLK1 = 72 MHz
  * (APB1 36 MHz, ×2 because the APB1 prescaler is not 1 — RM0008 §7.2).
  *
  * TIM4: PSC 71 → 1 MHz, ARR 999 → an update event (UEV) every 1000 µs.
  * UIE is enabled (HAL_TIM_Base_Start_IT), so every update raises the TIM4
  * interrupt (IRQ 30); HAL_TIM_IRQHandler clears UIF and calls
  * HAL_TIM_PeriodElapsedCallback, which
  *   - toggles PB12 (push-pull): a 500 Hz square wave, 1 ms high / 1 ms low;
  *   - toggles PC13 (on-board LED, active low) every 500th interrupt: a
  *     1 Hz heartbeat, 500 ms on / 500 ms off.
  *
  * HAL v1.1.9 note: HAL_TIM_Base_Init() ends with EGR.UG to load PSC, which
  * also sets UIF (URS = 0, RM0008 §15.4.1). Started as is, the first
  * interrupt would fire immediately instead of after one period, so the
  * flag is cleared before HAL_TIM_Base_Start_IT().
  *
  * The CPU sleeps in __WFI() between interrupts.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private variables ---------------------------------------------------------*/
TIM_HandleTypeDef htim4;

/* USER CODE BEGIN PV */
static uint32_t tick_count; /* update interrupts since the last heartbeat toggle */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM4_Init(void);

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
  MX_TIM4_Init();
  /* USER CODE BEGIN 2 */
  /* UIF is still set by the UG of HAL_TIM_Base_Init: clear it, or the first
     interrupt comes right away instead of one period after the start */
  __HAL_TIM_CLEAR_FLAG(&htim4, TIM_FLAG_UPDATE);
  if (HAL_TIM_Base_Start_IT(&htim4) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    __WFI();
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
  * @brief TIM4 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM4_Init(void)
{
  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};

  htim4.Instance = TIM4;
  htim4.Init.Prescaler = TICK_PRESCALER;
  htim4.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim4.Init.Period = TICK_PERIOD;
  htim4.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim4.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim4) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim4, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim4, &sMasterConfig) != HAL_OK)
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
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(TICK_GPIO_Port, TICK_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : LED_Pin */
  GPIO_InitStruct.Pin = LED_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(LED_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : TICK_Pin */
  GPIO_InitStruct.Pin = TICK_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(TICK_GPIO_Port, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

/* TIM4 update (HAL_TIM_IRQHandler → here), once per millisecond. */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance == TIM4)
  {
    HAL_GPIO_TogglePin(TICK_GPIO_Port, TICK_Pin);
    if (++tick_count >= HEARTBEAT_HALF_TICKS)
    {
      tick_count = 0;
      HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
    }
  }
}

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line)
{
  (void)file;
  (void)line;
}
#endif /* USE_FULL_ASSERT */
