/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-tm1637 — TM1637 4-digit display: counter + blinking colon.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * TM1637 two-wire bus bit-banged on PB6 = CLK and PB7 = DIO, both GPIO
  * open-drain outputs (released = high through the module's 10 kOhm
  * pull-ups to its 5 V VCC; PB6/PB7 are 5 V tolerant). About 4 us per
  * half clock (~ 100 kHz, below the TM1637's 250 kHz). Bytes LSB first,
  * DIO changed while CLK is low; the TM1637 acknowledges every byte by
  * pulling DIO low during the 9th clock (read back on its rising edge).
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "TM1637 counter demo\r\n", 10 ms, then the first frame:
  * START 40h STOP (auto-increment), START C0h + 4 segment bytes STOP,
  * START 8Ch STOP (display on, pulse width 11/16). Any byte without ACK
  * -> "TM1637: no ACK (check CLK/DIO wiring and power)\r\n" and stop;
  * otherwise "TM1637 ready\r\n".
  * Every 100 ms (deadline based) count = 0, 1, 2, ... (mod 10000) is shown
  * as 4 digits with leading zeros (segments a..g = bit 0..6: 3F 06 5B 4F
  * 66 6D 7D 07 7F 6F), the colon (bit 7 of digit 2) on while count mod 10
  * < 5 (1 Hz blink); every 10th count "count N\r\n" on USART1.
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

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);

/* USER CODE BEGIN 0 */
static const uint8_t seg7[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };
static uint32_t nacks;

static void half(void)
{
  for (volatile int i = 0; i < 24; i++)
  {
  }
}

static void clk(int high) { HAL_GPIO_WritePin(TM_CLK_GPIO_Port, TM_CLK_Pin, high ? GPIO_PIN_SET : GPIO_PIN_RESET); }
static void dio(int high) { HAL_GPIO_WritePin(TM_DIO_GPIO_Port, TM_DIO_Pin, high ? GPIO_PIN_SET : GPIO_PIN_RESET); }

static void tm_start(void)
{
  dio(1);
  clk(1);
  half();
  dio(0);
  half();
  clk(0);
  half();
}

static void tm_stop(void)
{
  clk(0);
  half();
  dio(0);
  half();
  clk(1);
  half();
  dio(1);
  half();
}

/** one byte LSB first + the 9th (ACK) clock; counts missing ACKs */
static void tm_write(uint8_t b)
{
  for (int i = 0; i < 8; i++)
  {
    clk(0);
    dio(b & 1U);
    b >>= 1;
    half();
    clk(1);
    half();
  }
  clk(0);
  dio(1); /* release DIO: the TM1637 pulls it low (ACK) */
  half();
  clk(1);
  half();
  if (HAL_GPIO_ReadPin(TM_DIO_GPIO_Port, TM_DIO_Pin) != GPIO_PIN_RESET) nacks++;
  clk(0);
  half();
}

static void tm_show(uint32_t n, int colon)
{
  uint8_t d[4];
  d[0] = seg7[(n / 1000U) % 10U];
  d[1] = (uint8_t)(seg7[(n / 100U) % 10U] | (colon ? 0x80U : 0U));
  d[2] = seg7[(n / 10U) % 10U];
  d[3] = seg7[n % 10U];
  tm_start();
  tm_write(0x40); /* data command: write, auto-increment */
  tm_stop();
  tm_start();
  tm_write(0xC0); /* address 0 */
  for (int i = 0; i < 4; i++) tm_write(d[i]);
  tm_stop();
  tm_start();
  tm_write(0x8C); /* display on, pulse width 11/16 */
  tm_stop();
}
/* USER CODE END 0 */

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
  mini_printf("TM1637 counter demo\r\n");
  HAL_Delay(10);
  tm_show(0, 1);
  if (nacks)
  {
    mini_printf("TM1637: no ACK (check CLK/DIO wiring and power)\r\n");
    while (1) __WFI();
  }
  mini_printf("TM1637 ready\r\n");
  uint32_t count = 0;
  uint32_t next = HAL_GetTick() + STEP_MS;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      next += STEP_MS;
      count = (count + 1U) % 10000U;
      tm_show(count, (count % 10U) < 5U);
      if (count % 10U == 0U) mini_printf("count %lu\r\n", (unsigned long)count);
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
  HAL_GPIO_WritePin(GPIOB, TM_CLK_Pin|TM_DIO_Pin, GPIO_PIN_SET);

  /*Configure GPIO pins : TM_CLK_Pin TM_DIO_Pin */
  GPIO_InitStruct.Pin = TM_CLK_Pin|TM_DIO_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

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
