/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-stepper-uln2003 — 28BYJ-48 + ULN2003: half-step sequence, one revolution each way.
  ******************************************************************************
  * Blue Pill, 72 MHz, 28BYJ-48 geared stepper on a ULN2003 driver board:
  * IN1..IN4 = PB12..PB15 (push-pull), board VCC = 5 V, GND common, board
  * OUT1..OUT4 → motor ORANGE, YELLOW, PINK, BLUE, motor RED → VCC.
  *
  * Half-step sequence (IN1..IN4): 1000, 1100, 0100, 0110, 0010, 0011,
  * 0001, 1001 — one table entry every 2 ms on HAL_GetTick deadlines
  * (next += 2, no drift), written with ONE BSRR store so the coils switch
  * together (RM0008 §9.2.5). 4096 half steps = one output revolution
  * (64:1 gear train), clockwise first (ascending table), then the coils are
  * switched off for 500 ms, one revolution counter-clockwise (descending
  * table), off again, and the cycle repeats (≈ 17.4 s per cycle).
  *
  * USART1 (PA9, 115200 8N1) logs the progress every 1024 half steps
  * (a quarter turn): "cw 1024/4096", …, "cw 4096/4096", "ccw 1024/4096", …
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
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
/** half-step table, bit 0 = IN1 … bit 3 = IN4 */
static const uint8_t half_step[8] = { 0x1, 0x3, 0x2, 0x6, 0x4, 0xC, 0x8, 0x9 };
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void coils(uint8_t bits);
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
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("28BYJ-48 half-step 1 rev each way\r\n");
  uint32_t next = HAL_GetTick() + HALF_STEP_MS;
  int32_t dir = 1;
  uint32_t idx = 0;
  uint32_t done = 0;
  coils(half_step[idx]);
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      next += HALF_STEP_MS;
      idx = (idx + (uint32_t)(dir > 0 ? 1 : 7)) & 7U;
      coils(half_step[idx]);
      done++;
      if (done % REPORT_EVERY == 0U)
      {
        mini_printf("%s %lu/%u\r\n", dir > 0 ? "cw" : "ccw", (unsigned long)done, HALF_STEPS_PER_REV);
      }
      if (done == HALF_STEPS_PER_REV)
      {
        coils(0U);
        HAL_Delay(PAUSE_MS);
        dir = -dir;
        done = 0U;
        coils(half_step[idx]);
        next = HAL_GetTick() + HALF_STEP_MS;
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

  /*Configure GPIO pin Output Level: IN1 IN2 IN3 IN4 */
  HAL_GPIO_WritePin(GPIOB, IN1_Pin|IN2_Pin|IN3_Pin|IN4_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pins: IN1 IN2 IN3 IN4 */
  GPIO_InitStruct.Pin = IN1_Pin|IN2_Pin|IN3_Pin|IN4_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4b */
/**
  * @brief  Energize the coils: bit n → IN(n+1), all four pins in one BSRR store.
  */
static void coils(uint8_t bits)
{
  uint32_t set = ((bits & 1U) ? IN1_Pin : 0U) | ((bits & 2U) ? IN2_Pin : 0U) | ((bits & 4U) ? IN3_Pin : 0U) | ((bits & 8U) ? IN4_Pin : 0U);
  IN_GPIO_Port->BSRR = set | ((IN_ALL & ~set) << 16);
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
