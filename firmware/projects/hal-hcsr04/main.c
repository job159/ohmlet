/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-hcsr04 — HC-SR04 distance with TIM4 input capture (PB6).
  ******************************************************************************
  * Blue Pill, 72 MHz, SysTick 1 kHz. HC-SR04 powered from 5 V:
  *   TRIG <- PB12 push-pull (3.3 V is above the module's input threshold)
  *   ECHO -> PB6  (5 V signal: PB6 is five-volt tolerant, no internal pull)
  * TIM4 counts at 1 MHz (PSC 71, ARR 0xFFFF). Channel 1 captures the rising
  * edge of TI1 (ECHO), channel 2 the falling edge of the same input
  * (indirect TI1, RM0008 §15.3.6 "PWM input"), so ECHO high time =
  * CCR2 - CCR1 microseconds (mod 2^16).
  *
  * Boot: "HC-SR04: TRIG PB12, ECHO PB6 (TIM4 CH1/CH2 capture)\r\n".
  * Every 100 ms: capture flags cleared, a 12 us trigger pulse (DWT timed),
  * then
  *   no rising edge within 10 ms   -> "no echo (sensor not powered?)\r\n"
  *   no falling edge within 60 ms  -> "echo stuck high\r\n"
  *   high time >= 30000 us         -> "out of range (echo <t> us)\r\n"
  *   else "d=<cm>.<mm> cm (echo <t> us)\r\n" with d = t x 0.0343 / 2.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "mini_printf.h"
/* USER CODE END Includes */

/* Private variables ---------------------------------------------------------*/
TIM_HandleTypeDef htim4;
UART_HandleTypeDef huart1;

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM4_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void delay_us(uint32_t us);
static int wait_flag(uint32_t flag, uint32_t timeout_ms);
/* USER CODE END PFP */

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
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
  if (HAL_TIM_IC_Start(&htim4, TIM_CHANNEL_1) != HAL_OK || HAL_TIM_IC_Start(&htim4, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }
  mini_printf("HC-SR04: TRIG PB12, ECHO PB6 (TIM4 CH1/CH2 capture)\r\n");
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) < 0)
    {
      __WFI();
      continue;
    }
    next += PERIOD_MS;
    __HAL_TIM_CLEAR_FLAG(&htim4, TIM_FLAG_CC1 | TIM_FLAG_CC2 | TIM_FLAG_CC1OF | TIM_FLAG_CC2OF);
    HAL_GPIO_WritePin(TRIG_GPIO_Port, TRIG_Pin, GPIO_PIN_SET);
    delay_us(TRIG_US);
    HAL_GPIO_WritePin(TRIG_GPIO_Port, TRIG_Pin, GPIO_PIN_RESET);
    if (!wait_flag(TIM_FLAG_CC1, 10))
    {
      mini_printf("no echo (sensor not powered?)\r\n");
      continue;
    }
    if (!wait_flag(TIM_FLAG_CC2, 60))
    {
      mini_printf("echo stuck high\r\n");
      continue;
    }
    uint32_t rise = HAL_TIM_ReadCapturedValue(&htim4, TIM_CHANNEL_1);
    uint32_t fall = HAL_TIM_ReadCapturedValue(&htim4, TIM_CHANNEL_2);
    uint32_t us = (fall - rise) & 0xFFFFU;
    if (us >= OUT_OF_RANGE_US)
    {
      mini_printf("out of range (echo %lu us)\r\n", (unsigned long)us);
      continue;
    }
    /* d (0.1 mm) = us x 0.0343 cm/us / 2 x 100 = us x 343 / 200 */
    uint32_t d_tenth_mm = (us * SOUND_CM_PER_US_X10000 + 100U) / 200U;
    mini_printf("d=%lu.%lu cm (echo %lu us)\r\n", (unsigned long)(d_tenth_mm / 100U), (unsigned long)((d_tenth_mm % 100U) / 10U),
                (unsigned long)us);
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
  * @brief TIM4 Initialization Function (input capture CH1 direct rising, CH2 indirect falling)
  * @param None
  * @retval None
  */
static void MX_TIM4_Init(void)
{
  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_IC_InitTypeDef sConfigIC = {0};

  htim4.Instance = TIM4;
  htim4.Init.Prescaler = 71;
  htim4.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim4.Init.Period = 65535;
  htim4.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim4.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_IC_Init(&htim4) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim4, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigIC.ICPolarity = TIM_INPUTCHANNELPOLARITY_RISING;
  sConfigIC.ICSelection = TIM_ICSELECTION_DIRECTTI;
  sConfigIC.ICPrescaler = TIM_ICPSC_DIV1;
  sConfigIC.ICFilter = 0;
  if (HAL_TIM_IC_ConfigChannel(&htim4, &sConfigIC, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigIC.ICPolarity = TIM_INPUTCHANNELPOLARITY_FALLING;
  sConfigIC.ICSelection = TIM_ICSELECTION_INDIRECTTI;
  if (HAL_TIM_IC_ConfigChannel(&htim4, &sConfigIC, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief USART1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART1_UART_Init(void)
{
  huart1.Instance = USART1;
  huart1.Init.BaudRate = 115200;
  huart1.Init.WordLength = UART_WORDLENGTH_8B;
  huart1.Init.StopBits = UART_STOPBITS_1;
  huart1.Init.Parity = UART_PARITY_NONE;
  huart1.Init.Mode = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart1.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart1) != HAL_OK)
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
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(TRIG_GPIO_Port, TRIG_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : TRIG_Pin */
  GPIO_InitStruct.Pin = TRIG_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(TRIG_GPIO_Port, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

static void delay_us(uint32_t us)
{
  uint32_t t0 = DWT->CYCCNT;
  uint32_t n = us * (SystemCoreClock / 1000000U);
  while (DWT->CYCCNT - t0 < n)
  {
  }
}

/* Poll a TIM4 status flag; 0 on timeout. */
static int wait_flag(uint32_t flag, uint32_t timeout_ms)
{
  uint32_t t0 = HAL_GetTick();
  while (!__HAL_TIM_GET_FLAG(&htim4, flag))
  {
    if (HAL_GetTick() - t0 > timeout_ms)
    {
      return 0;
    }
  }
  return 1;
}

/* mini_printf() sink: blocking USART1 transmit, one byte per call (86.8 us at 115200 Bd). */
void mini_putchar(char c)
{
  HAL_UART_Transmit(&huart1, (const uint8_t *)&c, 1, 10);
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
