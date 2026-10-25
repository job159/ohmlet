/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-sg90 — SG90 micro servo sweep 0° → 180° → 0° (TIM2 PWM, 50 Hz).
  ******************************************************************************
  * Blue Pill, 72 MHz. TowerPro SG90 micro servo: SIG (orange) on PA0 =
  * TIM2_CH1 (AF push-pull), VCC (red) from the 5 V bench supply, GND (brown)
  * common with the Blue Pill.
  *
  * TIM2: PSC 71 → 1 MHz (1 µs per count), ARR 19999 → 20 ms frame (50 Hz),
  * PWM mode 1, active high: every frame starts with a CCR1 µs HIGH pulse.
  * SG90: 0.5 ms = 0°, 1.5 ms = 90°, 2.5 ms = 180°, so
  * CCR1 = 500 + angle·2000/180 (rounded). CCR1 is preloaded (OC1PE): a new
  * width starts with the next 20 ms frame, never inside a pulse.
  *
  * Sweep 0 → 180 → 0°: one 30° step every 500 ms on HAL_GetTick deadlines
  * (next += 500, no drift): 0, 30, 60, 90, 120, 150, 180, 150, …, 0, 30, …
  * (a full sweep there and back every 6 s). The servo needs ≈ 50 ms per 30°
  * at 4.8 V (0.1 s/60°), so it reaches every angle long before the next
  * step. USART1 (PA9, 115200 8N1) reports every command:
  * "servo <angle> deg (<pulse> us)\r\n".
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
TIM_HandleTypeDef htim2;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
static int32_t angle_deg;   /* commanded angle (°) */
static int32_t step_deg = SWEEP_STEP_DEG;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static uint32_t servo_set_angle(int32_t deg);
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
  MX_TIM2_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  uint32_t next_step = HAL_GetTick() + SWEEP_STEP_MS;
  if (HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  mini_printf("SG90 sweep 0-180 deg\r\n");
  angle_deg = 0;
  mini_printf("servo %ld deg (%lu us)\r\n", (long)angle_deg, (unsigned long)servo_set_angle(angle_deg));
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next_step) >= 0)
    {
      next_step += SWEEP_STEP_MS;
      angle_deg += step_deg;
      if (angle_deg >= 180)
      {
        angle_deg = 180;
        step_deg = -SWEEP_STEP_DEG;
      }
      else if (angle_deg <= 0)
      {
        angle_deg = 0;
        step_deg = SWEEP_STEP_DEG;
      }
      uint32_t us = servo_set_angle(angle_deg);
      mini_printf("servo %ld deg (%lu us)\r\n", (long)angle_deg, (unsigned long)us);
    }
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
  * @brief TIM2 Initialization Function: PWM generation on CH1 (PA0)
  * @param None
  * @retval None
  */
static void MX_TIM2_Init(void)
{
  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_OC_InitTypeDef sConfigOC = {0};

  htim2.Instance = TIM2;
  htim2.Init.Prescaler = TIM2_PRESCALER;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = TIM2_PERIOD;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;
  if (HAL_TIM_Base_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim2, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigOC.OCMode = TIM_OCMODE_PWM1;
  sConfigOC.Pulse = TIM2_PULSE;
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  HAL_TIM_MspPostInit(&htim2);
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
  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
}

/* USER CODE BEGIN 4b */
/**
  * @brief  Pulse width for an angle: 500 µs + angle·2000/180 (rounded), preloaded into CCR1.
  * @retval the pulse width in µs (= TIM2 counts)
  */
static uint32_t servo_set_angle(int32_t deg)
{
  uint32_t us = (uint32_t)(SERVO_US_0 + (deg * (SERVO_US_180 - SERVO_US_0) + 90) / 180);
  __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, us);
  return us;
}
/* USER CODE END 4b */

/* USER CODE BEGIN 4 */
/* mini_printf() sink: blocking USART1 transmit, one byte per call */
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
