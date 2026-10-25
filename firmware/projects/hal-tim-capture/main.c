/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-tim-capture — measure frequency and duty cycle with
  *                   TIM2 PWM input mode; TIM3 generates the test signal.
  ******************************************************************************
  * Blue Pill, 72 MHz. Bench wiring: a jumper from PA6 to PA0.
  *
  * Generator — TIM3 CH1 → PA6 (AF push-pull), PWM mode 1, PSC 0 (72 MHz).
  * Every SWITCH_MS it moves to the next entry of `signals` (ARR and CCR1 are
  * both preloaded, so the new frequency and duty start together at an update
  * event):  2000 Hz 30 %  →  5000 Hz 50 %  →  1250 Hz 75 %  →  2000 Hz …
  *
  * Meter — TIM2 CH1 ← PA0 (input), PWM input mode (RM0008 §15.3.6):
  *   IC1 = TI1FP1 rising edge  → CCR1, CC1 interrupt
  *   IC2 = TI1FP2 falling edge → CCR2 (indirect: channel 2 listens to TI1)
  *   slave mode RESET on TI1FP1: every rising edge restarts the counter.
  * The capture latches the counter just before that reset (RM0008
  * Figure 113: CCR1 = 0004 for a five-count period), so
  *   period = CCR1 + 1 counts,  high time = CCR2 + 1 counts.
  * With PSC 0 a period may last up to 65536 counts = 910 µs (≥ 1.1 kHz).
  * URS = 1 keeps the slave resets from raising update interrupts, so the
  * update interrupt means a real overflow: no rising edge for 65536 counts —
  * the signal is gone and the measurement is cleared.
  *
  * Report — every REPORT_MS (first one REPORT_PHASE_MS after start) on
  * USART1 PA9, 115200 8N1:   f=<Hz> d=<permille>\r\n
  * with f = 72 MHz / period and d = 1000 · high / period, both rounded;
  * "f=0 d=0" when there is no signal (e.g. the jumper is missing).
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
TIM_HandleTypeDef htim3;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
struct Signal
{
  uint32_t arr; /* period − 1 (counts of 13.9 ns) */
  uint32_t ccr; /* high time (counts) */
};
static const struct Signal signals[] = {
  {35999U, 10800U}, /* 2000 Hz, 30 % */
  {14399U, 7200U},  /* 5000 Hz, 50 % */
  {57599U, 43200U}, /* 1250 Hz, 75 % */
};
#define SIGNAL_COUNT (sizeof(signals) / sizeof(signals[0]))

static volatile uint32_t period_counts; /* 0 = no signal */
static volatile uint32_t high_counts;
static volatile uint32_t edges_seen;    /* rising edges since start / loss of signal */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_TIM3_Init(void);
static void MX_USART1_UART_Init(void);

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
  MX_TIM3_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("PWM input: TIM3 CH1 PA6 -> TIM2 CH1 PA0\r\n");

  /* meter: update interrupt only on a real counter overflow */
  __HAL_TIM_URS_ENABLE(&htim2);
  __HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
  __HAL_TIM_ENABLE_IT(&htim2, TIM_IT_UPDATE);
  if (HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_IC_Start(&htim2, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }
  /* generator */
  if (HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }

  uint32_t sig = 0;
  uint32_t start = HAL_GetTick();
  uint32_t next_report = start + REPORT_PHASE_MS;
  uint32_t next_switch = start + SWITCH_MS;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next_switch) >= 0)
    {
      next_switch += SWITCH_MS;
      sig = (sig + 1U) % SIGNAL_COUNT;
      /* both preloaded (ARPE, OC1PE): applied together at the next update */
      __HAL_TIM_SET_AUTORELOAD(&htim3, signals[sig].arr);
      __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, signals[sig].ccr);
    }
    if ((int32_t)(HAL_GetTick() - next_report) >= 0)
    {
      next_report += REPORT_MS;
      __disable_irq();
      uint32_t p = period_counts;
      uint32_t h = high_counts;
      __enable_irq();
      if (p == 0U)
      {
        mini_printf("f=0 d=0\r\n");
      }
      else
      {
        mini_printf("f=%lu d=%lu\r\n", (unsigned long)((TIMER_HZ + p / 2U) / p), (unsigned long)((h * 1000U + p / 2U) / p));
      }
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
  * @brief TIM2 Initialization Function (Combined Channels: PWM Input on CH1)
  * @param None
  * @retval None
  */
static void MX_TIM2_Init(void)
{
  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_SlaveConfigTypeDef sSlaveConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_IC_InitTypeDef sConfigIC = {0};

  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 0;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = 65535;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim2, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_IC_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sSlaveConfig.SlaveMode = TIM_SLAVEMODE_RESET;
  sSlaveConfig.InputTrigger = TIM_TS_TI1FP1;
  sSlaveConfig.TriggerPolarity = TIM_INPUTCHANNELPOLARITY_RISING;
  sSlaveConfig.TriggerPrescaler = TIM_ICPSC_DIV1;
  sSlaveConfig.TriggerFilter = 0;
  if (HAL_TIM_SlaveConfigSynchro(&htim2, &sSlaveConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigIC.ICPolarity = TIM_INPUTCHANNELPOLARITY_RISING;
  sConfigIC.ICSelection = TIM_ICSELECTION_DIRECTTI;
  sConfigIC.ICPrescaler = TIM_ICPSC_DIV1;
  sConfigIC.ICFilter = 0;
  if (HAL_TIM_IC_ConfigChannel(&htim2, &sConfigIC, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigIC.ICPolarity = TIM_INPUTCHANNELPOLARITY_FALLING;
  sConfigIC.ICSelection = TIM_ICSELECTION_INDIRECTTI;
  if (HAL_TIM_IC_ConfigChannel(&htim2, &sConfigIC, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief TIM3 Initialization Function (PWM Generation CH1)
  * @param None
  * @retval None
  */
static void MX_TIM3_Init(void)
{
  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_OC_InitTypeDef sConfigOC = {0};

  htim3.Instance = TIM3;
  htim3.Init.Prescaler = 0;
  htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim3.Init.Period = 35999;
  htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;
  if (HAL_TIM_Base_Init(&htim3) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim3, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_PWM_Init(&htim3) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim3, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigOC.OCMode = TIM_OCMODE_PWM1;
  sConfigOC.Pulse = 10800;
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
  if (HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  HAL_TIM_MspPostInit(&htim3);
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

/* USER CODE BEGIN 4 */

/* TIM2 CC1: a rising edge on PA0 was captured (and the counter reset). */
void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance == TIM2 && htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1)
  {
    uint32_t p = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1) + 1U;
    uint32_t h = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_2) + 1U;
    /* the first edge after start (or after a loss) ends a partial period */
    if (edges_seen < 2U)
    {
      edges_seen++;
      if (edges_seen < 2U)
      {
        return;
      }
    }
    period_counts = p;
    high_counts = h < p ? h : p;
  }
}

/* TIM2 update with URS = 1: the counter overflowed — no rising edge for 910 µs. */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance == TIM2)
  {
    period_counts = 0;
    high_counts = 0;
    edges_seen = 0;
  }
}

/* mini_printf() sink: blocking USART1 transmit, one byte per call. */
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
