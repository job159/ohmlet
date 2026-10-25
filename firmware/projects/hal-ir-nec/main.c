/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-ir-nec — NEC IR remote decoder (VS1838B on PB12, EXTI + TIM2).
  ******************************************************************************
  * Blue Pill, 72 MHz, SysTick 1 kHz. VS1838B (powered from 3.3 V) OUT ->
  * PB12: input with pull-up, EXTI12 on BOTH edges (the output is active
  * low: low = burst received). TIM2 runs free at 1 MHz (PSC 71, ARR
  * 0xFFFF) and timestamps every edge, so each edge closes a measured burst
  * (rising edge) or space (falling edge). NEC protocol:
  *   9 ms burst + 4.5 ms space   -> start of a frame
  *   9 ms burst + 2.25 ms space  -> repeat code
  *   562.5 us burst + 562.5 us space = 0, + 1687.5 us space = 1,
  *   LSB first, 32 bits: address, ~address, command, ~command
  * (leader / spaces +-20 %, bit times +-40 %; anything else aborts).
  * USART1 PA9 115200 8N1, printed from the main loop:
  *   boot  "NEC IR receiver on PB12 (EXTI12 + TIM2 1 MHz)\r\n"
  *   frame "NEC addr=0x<aa> cmd=0x<cc>\r\n"   (inverse bytes checked)
  *         "NEC frame error <32-bit hex>\r\n" when an inverse is wrong
  *   held  "NEC repeat\r\n"
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
static volatile uint16_t lastEdge;
/* decoder state: 0 idle, 1 after a leader burst, 2 receiving bits */
static volatile int state;
static volatile int bitCount;
static volatile uint32_t shift;
static volatile uint32_t frame;
static volatile uint8_t frameReady;
static volatile uint8_t repeats;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static int within(uint32_t v, uint32_t target, uint32_t pct);
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
  if (HAL_TIM_Base_Start(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  mini_printf("NEC IR receiver on PB12 (EXTI12 + TIM2 1 MHz)\r\n");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if (frameReady)
    {
      __disable_irq();
      uint32_t f = frame;
      frameReady = 0;
      __enable_irq();
      uint8_t a = (uint8_t)f, na = (uint8_t)(f >> 8), c = (uint8_t)(f >> 16), nc = (uint8_t)(f >> 24);
      if ((uint8_t)~a == na && (uint8_t)~c == nc)
      {
        mini_printf("NEC addr=0x%02X cmd=0x%02X\r\n", a, c);
      }
      else
      {
        mini_printf("NEC frame error %08lX\r\n", (unsigned long)f);
      }
    }
    else if (repeats)
    {
      __disable_irq();
      repeats--;
      __enable_irq();
      mini_printf("NEC repeat\r\n");
    }
    else
    {
      __WFI();
    }
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
  * @brief TIM2 Initialization Function (free-running 1 MHz time base)
  * @param None
  * @retval None
  */
static void MX_TIM2_Init(void)
{
  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};

  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 71;
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
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
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

  /*Configure GPIO pin : IR_Pin */
  GPIO_InitStruct.Pin = IR_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_RISING_FALLING;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(IR_GPIO_Port, &GPIO_InitStruct);

  /* EXTI interrupt init*/
  HAL_NVIC_SetPriority(IR_EXTI_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(IR_EXTI_IRQn);
}

/* USER CODE BEGIN 4 */

static int within(uint32_t v, uint32_t target, uint32_t pct)
{
  uint32_t tol = target * pct / 100U;
  return v + tol >= target && v <= target + tol;
}

/* Every edge of the receiver output closes a burst (rising) or a space (falling). */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
  if (GPIO_Pin != IR_Pin)
  {
    return;
  }
  uint16_t now = (uint16_t)__HAL_TIM_GET_COUNTER(&htim2);
  uint32_t dt = (uint16_t)(now - lastEdge);
  lastEdge = now;
  if (HAL_GPIO_ReadPin(IR_GPIO_Port, IR_Pin) == GPIO_PIN_SET)
  {
    /* rising: a burst of dt us just ended */
    if (within(dt, NEC_LEADER_MARK_US, 20))
    {
      state = 1;
    }
    else if (!(state == 2 && within(dt, NEC_BIT_MARK_US, 40)))
    {
      state = 0;
    }
    return;
  }
  /* falling: a space of dt us just ended */
  if (state == 1)
  {
    if (within(dt, NEC_FRAME_SPACE_US, 20))
    {
      state = 2;
      bitCount = 0;
      shift = 0;
    }
    else
    {
      if (within(dt, NEC_REPEAT_SPACE_US, 20))
      {
        repeats++;
      }
      state = 0;
    }
    return;
  }
  if (state != 2)
  {
    return;
  }
  if (within(dt, NEC_ONE_SPACE_US, 40))
  {
    shift |= 1UL << bitCount;
  }
  else if (!within(dt, NEC_ZERO_SPACE_US, 40))
  {
    state = 0;
    return;
  }
  if (++bitCount == 32)
  {
    frame = shift;
    frameReady = 1;
    state = 0;
  }
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
