/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-max7219 — MAX7219 8x8 LED matrix on SPI1: scrolling text.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * SPI1 master "Transmit Only", 16-bit frames (DFF), mode 0, MSB first,
  * prescaler 16: SCK = 4.5 MHz on PA5 -> CLK, MOSI PA7 -> DIN (AF
  * push-pull); PA4 -> CS (LOAD), GPIO push-pull, high when idle: its rising
  * edge latches the 16 bits (MAX7219 datasheet Table 1: D11..D8 address,
  * D7..D0 data).
  * The MAX7219 needs VIH >= 3.5 V at V+ = 5 V: with this 3.3 V MCU the
  * module runs from 4.5 V (VIH 3.15 V), or use a level shifter.
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "MAX7219 scroll demo\r\n"; 0F00 (test off), 0C00 (shutdown
  * while configuring), 0900 (no decode), 0A04 (intensity 9/32), 0B07 (scan
  * all 8 rows), 0x01..0x08 rows cleared, 0C01 (normal operation);
  * "MAX7219 ready\r\n".
  * The text "OHM " in a 5x7 font (5 columns + 1 blank per character = 24
  * columns, wrapping) scrolls left one column every 100 ms (deadline
  * based): at step s the matrix column c (0 = left) shows text column
  * (s + c) mod 24; font row r is matrix row r (digit r+1), bit 7 = left
  * column. Every 10 steps "step N\r\n" on USART1.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "mini_printf.h"
#include "font5x7.h"
/* USER CODE END Includes */

/* Private variables ---------------------------------------------------------*/
SPI_HandleTypeDef hspi1;
UART_HandleTypeDef huart1;

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_SPI1_Init(void);
static void MX_USART1_UART_Init(void);

/* USER CODE BEGIN 0 */
static const char text[] = "OHM ";
#define TEXT_COLS (6 * (sizeof text - 1))

/** one register write: CS low, 16-bit frame, CS high (rising edge = latch) */
static void max7219(uint8_t addr, uint8_t data)
{
  uint16_t w = (uint16_t)((addr << 8) | data);
  HAL_GPIO_WritePin(MAX_CS_GPIO_Port, MAX_CS_Pin, GPIO_PIN_RESET);
  if (HAL_SPI_Transmit(&hspi1, (uint8_t *)&w, 1, 10) != HAL_OK) Error_Handler();
  HAL_GPIO_WritePin(MAX_CS_GPIO_Port, MAX_CS_Pin, GPIO_PIN_SET);
}

/** column byte (bit 0 = top row) of text column i */
static uint8_t text_column(uint32_t i)
{
  uint32_t ch = i / 6U;
  uint32_t col = i % 6U;
  if (col == 5U) return 0;
  return font5x7[(uint8_t)text[ch] - FONT5X7_FIRST][col];
}

static void show(uint32_t step)
{
  uint8_t rows[8] = { 0 };
  for (uint32_t c = 0; c < 8U; c++)
  {
    uint8_t colbits = text_column((step + c) % TEXT_COLS);
    for (uint32_t r = 0; r < 8U; r++)
      if (colbits & (1U << r)) rows[r] |= (uint8_t)(0x80U >> c);
  }
  for (uint8_t r = 0; r < 8U; r++) max7219((uint8_t)(r + 1U), rows[r]);
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
  MX_SPI1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("MAX7219 scroll demo\r\n");
  max7219(0x0F, 0x00); /* display test off */
  max7219(0x0C, 0x00); /* shutdown while configuring */
  max7219(0x09, 0x00); /* no Code-B decode (matrix) */
  max7219(0x0A, 0x04); /* intensity 9/32 */
  max7219(0x0B, 0x07); /* scan digits 0..7 */
  for (uint8_t r = 1; r <= 8U; r++) max7219(r, 0x00);
  max7219(0x0C, 0x01); /* normal operation */
  mini_printf("MAX7219 ready\r\n");
  uint32_t step = 0;
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      next += STEP_MS;
      show(step);
      if (step % 10U == 0U) mini_printf("step %lu\r\n", (unsigned long)step);
      step++;
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
  * @brief SPI1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_SPI1_Init(void)
{
  /* SPI1 parameter configuration*/
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_2LINES;
  hspi1.Init.DataSize = SPI_DATASIZE_16BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_16;
  hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial = 10;
  if (HAL_SPI_Init(&hspi1) != HAL_OK)
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

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(MAX_CS_GPIO_Port, MAX_CS_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin : MAX_CS_Pin */
  GPIO_InitStruct.Pin = MAX_CS_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(MAX_CS_GPIO_Port, &GPIO_InitStruct);
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
