/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-dc-motor — DC motor speed and direction through an L298N (TIM2 PWM on ENA).
  ******************************************************************************
  * Blue Pill, 72 MHz, driving a small DC motor through an L298N module
  * (bridge A): ENA = PA0 (TIM2_CH1 PWM, the module's ENA jumper removed),
  * IN1 = PB0, IN2 = PB1 (push-pull), motor on OUT1/OUT2, module +12V from a
  * 7.5–12 V supply with the 5V-EN regulator jumper fitted, GND common.
  *
  * TIM2: PSC 71 → 1 MHz, ARR 999 → 1 kHz PWM, PWM mode 1, CCR1 = 10 ×
  * duty % (preloaded). L298 truth table (ST datasheet): ENA high and
  * IN1 ≠ IN2 → the motor turns (IN1 = 1: forward); IN1 = IN2 with ENA high →
  * fast motor stop (brake); ENA low → free running (coast). PWM on ENA
  * therefore alternates drive and coast: during the low part of each period
  * the winding current freewheels through the module's diodes (fast decay).
  *
  * Demo, one phase every 400 ms on HAL_GetTick deadlines (no drift), logged
  * on USART1 (PA9, 115200 8N1): fwd 25 % → 50 % → 75 % → 100 % → brake →
  * rev 50 % → rev 100 % → coast → (repeat, 3.2 s per cycle). The motor sees
  * VS minus the L298's ≈ 2 V Darlington drop at full duty.
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
/** one demo phase: direction state, duty (%), log text */
typedef struct
{
  uint8_t dir;      /* see set_phase() */
  uint8_t duty;     /* % */
  const char *text;
} Phase;

static const Phase phases[] =
{
  { 1, 25, "fwd 25%" },
  { 1, 50, "fwd 50%" },
  { 1, 75, "fwd 75%" },
  { 1, 100, "fwd 100%" },
  { 0, 100, "brake" },
  { 2, 50, "rev 50%" },
  { 2, 100, "rev 100%" },
  { 0, 0, "coast" }
};
#define PHASE_COUNT (sizeof(phases) / sizeof(phases[0]))
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void set_phase(const Phase *p);
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
  uint32_t next_phase = HAL_GetTick() + PHASE_MS;
  uint32_t k = 0;
  if (HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }
  mini_printf("L298N DC motor demo\r\n");
  set_phase(&phases[0]);
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next_phase) >= 0)
    {
      next_phase += PHASE_MS;
      k = (k + 1) % PHASE_COUNT;
      set_phase(&phases[k]);
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
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level: IN1 IN2 */
  HAL_GPIO_WritePin(GPIOB, IN1_Pin|IN2_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pins: IN1 IN2 */
  GPIO_InitStruct.Pin = IN1_Pin|IN2_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4b */
/**
  * @brief  Apply a phase: direction pins in ONE BSRR write, then the duty
  *         (CCR1 is preloaded: the new duty starts with the next 1 ms period).
  */
static void set_phase(const Phase *p)
{
  /* IN1 = PB0, IN2 = PB1: set and reset in one BSRR store (RM0008 §9.2.5) */
  uint32_t set = (p->dir == 1U ? IN1_Pin : 0U) | (p->dir == 2U ? IN2_Pin : 0U);
  uint32_t reset = (IN1_Pin | IN2_Pin) & ~set;
  IN1_GPIO_Port->BSRR = set | (reset << 16);
  __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, (uint32_t)p->duty * 10U);
  mini_printf("%s\r\n", p->text);
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
