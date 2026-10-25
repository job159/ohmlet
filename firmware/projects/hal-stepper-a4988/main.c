/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-stepper-a4988 — NEMA 17 on an A4988: accelerated moves with microstepping (TIM2 STEP pulses).
  ******************************************************************************
  * Blue Pill, 72 MHz, NEMA 17 stepper on an A4988 StepStick carrier:
  * STEP = PA0 (TIM2_CH1 PWM, one 10 µs pulse per timer period), DIR = PB0,
  * MS1/MS2/MS3 = PB12/PB13/PB14, EN = PB15 (low = enabled); RST tied to SLP
  * on the carrier, VDD = 3.3 V, VMOT = 12 V, coil 1 on 1A/1B, coil 2 on
  * 2A/2B.
  *
  * Moves (trapezoidal speed profile, computed per step in the TIM2 update
  * interrupt — ARR is preloaded, so a new period starts exactly at the
  * update event; the last period gets CCR1 = 0 so no extra pulse leaves):
  *   1. +1600 steps in 1/8 microstepping (MS1 = MS2 = 1, MS3 = 0) = +200
  *      full steps = one revolution: 400 → 3200 steps/s over 400 steps,
  *      800 steps at 3200 steps/s, 400 steps back down.
  *   2. −100 full steps (MS1–3 = 0, DIR = 0): 200 → 400 steps/s over 50
  *      steps, 50 steps back down: half a revolution back.
  *   3. −800 steps in 1/8 again (DIR = 0): back to the start.
  * Each move is logged on USART1 (PA9, 115200 8N1) when it starts and when
  * the timer has stopped; 300 ms pause between moves, then the sequence
  * repeats. A4988 timing (Allegro datasheet Fig. 1): DIR and MSx are set
  * ≥ 1 ms before the first STEP edge (setup ≥ 200 ns), STEP high 10 µs ≥ 1 µs.
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
/** one move: signed step count, microstep code (MS1 | MS2 << 1 | MS3 << 2), speeds (steps/s), ramp length (steps) */
typedef struct
{
  int32_t steps;
  uint8_t ms;
  uint16_t f_start;
  uint16_t f_max;
  uint16_t ramp;
  const char *text;
} Move;

static const Move moves[] =
{
  { 1600, 0x3, 400, 3200, 400, "+1600 steps 1/8 (1 rev)" },
  { -100, 0x0, 200, 400, 50, "-100 steps full (1/2 rev)" },
  { -800, 0x3, 400, 3200, 400, "-800 steps 1/8 (1/2 rev)" },
};
#define MOVE_COUNT (sizeof(moves) / sizeof(moves[0]))

static volatile uint32_t steps_done;  /* completed STEP periods of the current move */
static volatile uint32_t steps_total;
static volatile uint8_t move_busy;
static const Move *cur;
static int32_t position;              /* eighth steps from the start */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void start_move(const Move *m);
static uint32_t period_for(uint32_t n);
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
  uint32_t k = 0;
  /* EN = PB15 low (enabled): every control pin was initialized low */
  mini_printf("A4988 stepper demo\r\n");
  HAL_Delay(PAUSE_MS);
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    start_move(&moves[k]);
    while (move_busy)
    {
      __WFI();
    }
    int32_t scale = (moves[k].ms == 0x3U) ? 1 : 8; /* eighth steps per STEP pulse */
    position += moves[k].steps * scale;
    mini_printf("done, position %ld/8 full steps\r\n", (long)position);
    k = (k + 1) % MOVE_COUNT;
    HAL_Delay(PAUSE_MS);
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
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level: DIR MS1 MS2 MS3 EN */
  HAL_GPIO_WritePin(GPIOB, DIR_Pin|MS1_Pin|MS2_Pin|MS3_Pin|EN_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pins: DIR MS1 MS2 MS3 EN */
  GPIO_InitStruct.Pin = DIR_Pin|MS1_Pin|MS2_Pin|MS3_Pin|EN_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4b */
/**
  * @brief  Step period (µs) of step n (0-based) of the current move:
  *         linear frequency ramp up over `ramp` steps, cruise, ramp down.
  */
static uint32_t period_for(uint32_t n)
{
  uint32_t total = steps_total;
  uint32_t ramp = cur->ramp;
  if (2U * ramp > total)
  {
    ramp = total / 2U;
  }
  uint32_t from_end = total - 1U - n;
  uint32_t r = (n < from_end) ? n : from_end;
  uint32_t f = cur->f_max;
  if (r < ramp && ramp > 0U)
  {
    f = cur->f_start + ((uint32_t)(cur->f_max - cur->f_start) * r) / ramp;
  }
  return 1000000U / f;
}

/**
  * @brief  Set DIR / MSx, wait the setup time, start the STEP timer.
  */
static void start_move(const Move *m)
{
  cur = m;
  steps_total = (uint32_t)(m->steps < 0 ? -m->steps : m->steps);
  steps_done = 0U;
  uint32_t set = (m->steps > 0 ? DIR_Pin : 0U) | ((m->ms & 1U) ? MS1_Pin : 0U) | ((m->ms & 2U) ? MS2_Pin : 0U) | ((m->ms & 4U) ? MS3_Pin : 0U);
  uint32_t reset = (DIR_Pin | MS1_Pin | MS2_Pin | MS3_Pin) & ~set;
  CTRL_GPIO_Port->BSRR = set | (reset << 16);
  mini_printf("move %s\r\n", m->text);
  HAL_Delay(1); /* DIR/MSx setup before the first STEP edge */
  move_busy = 1U;
  __HAL_TIM_SET_COUNTER(&htim2, 0U);
  __HAL_TIM_SET_AUTORELOAD(&htim2, period_for(0U) - 1U);
  __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, STEP_PULSE_US);
  /* load ARR / CCR1 now (UG), then clear the flag so the first interrupt ends period 1 */
  htim2.Instance->EGR = TIM_EGR_UG;
  __HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
  if (steps_total == 1U)
  {
    __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, 0U); /* (preloaded) no pulse after the first */
  }
  else
  {
    __HAL_TIM_SET_AUTORELOAD(&htim2, period_for(1U) - 1U);
  }
  if (HAL_TIM_Base_Start_IT(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief  TIM2 update: one STEP period finished.
  */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance != TIM2)
  {
    return;
  }
  uint32_t n = ++steps_done;
  if (n >= steps_total)
  {
    (void)HAL_TIM_PWM_Stop(&htim2, TIM_CHANNEL_1);
    (void)HAL_TIM_Base_Stop_IT(&htim2);
    move_busy = 0U;
    return;
  }
  if (n + 1U >= steps_total)
  {
    /* the period that starts now carries the last pulse: none after it */
    __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, 0U);
  }
  else
  {
    __HAL_TIM_SET_AUTORELOAD(&htim2, period_for(n + 1U) - 1U);
  }
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
