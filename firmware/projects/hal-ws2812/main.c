/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-ws2812 — 8 WS2812B LEDs driven by SPI1 MOSI + DMA.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  *
  * Method: SPI1 master "Transmit Only", mode 0, MSB first, prescaler 32:
  * SCK = 72 MHz / 32 = 2.25 MHz, one SPI bit = 444 ns. Every WS2812 bit is
  * three SPI bits on MOSI (PA7 -> DIN): "0" = 100 (high 444 ns, low 889 ns),
  * "1" = 110 (high 889 ns, low 444 ns) — inside T0H 0.4 +-0.15 us / T1H
  * 0.8 +-0.15 us, period 1.33 us. One LED = 24 WS bits (G, R, B, MSB first)
  * = 72 SPI bits = 9 bytes; the frame (72 bytes) goes out by DMA1 channel 3
  * (SPI1_TX, memory -> peripheral, byte, memory increment) so the SPI never
  * starves: the bytes leave back to back whatever the CPU and interrupts do.
  * Each encoded bit ends low, so MOSI rests low after the frame; the next
  * frame starts 100 ms later, far beyond the 280 us reset (latch) time.
  * (Why not bit-banging: a 1.25 us bit period leaves no margin for
  * interrupts; why not TIM PWM + DMA: needs a timer channel and a
  * half-word buffer per bit — 3x more RAM — for the same timing.)
  * The strip needs VIH >= 0.7 x VDD: with this 3.3 V MCU power it from
  * 4.5 V, or level-shift DIN.
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "WS2812 demo (SPI1 + DMA, 2.25 MHz)\r\n". Every 100 ms
  * (deadline based) frame s = 0, 1, 2, ...: LED i shows palette[(i + s) mod 8]
  * (red, orange, yellow, green, cyan, blue, violet, white at about 1/4
  * brightness), sent with HAL_SPI_Transmit_DMA; the main loop waits for the
  * HAL_SPI_TxCpltCallback. Every 10th frame "frame N\r\n" on USART1.
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
SPI_HandleTypeDef hspi1;
DMA_HandleTypeDef hdma_spi1_tx;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
/** 9 SPI bytes per LED */
static uint8_t spi_buf[WS_LEDS * 9];
static volatile int tx_done = 1;

/** 0xRRGGBB at about 1/4 brightness */
static const uint32_t palette[8] = {
  0x400000, 0x401800, 0x404000, 0x004000, 0x004040, 0x000040, 0x200040, 0x303030,
};
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_SPI1_Init(void);
static void MX_USART1_UART_Init(void);

/* USER CODE BEGIN 0 */
/** one colour byte -> 24 SPI bits (3 bytes): WS "1" = 110, "0" = 100 */
static void encode_byte(uint8_t v, uint8_t *out)
{
  uint32_t bits = 0;
  for (int i = 7; i >= 0; i--) bits = (bits << 3) | ((v >> i) & 1U ? 6U : 4U);
  out[0] = (uint8_t)(bits >> 16);
  out[1] = (uint8_t)(bits >> 8);
  out[2] = (uint8_t)bits;
}

static void ws_show(const uint32_t *rgb)
{
  for (int i = 0; i < WS_LEDS; i++)
  {
    uint8_t r = (uint8_t)(rgb[i] >> 16), g = (uint8_t)(rgb[i] >> 8), b = (uint8_t)rgb[i];
    encode_byte(g, &spi_buf[i * 9]);
    encode_byte(r, &spi_buf[i * 9 + 3]);
    encode_byte(b, &spi_buf[i * 9 + 6]);
  }
  tx_done = 0;
  if (HAL_SPI_Transmit_DMA(&hspi1, spi_buf, sizeof spi_buf) != HAL_OK) Error_Handler();
  while (!tx_done)
  {
    __WFI();
  }
}

void HAL_SPI_TxCpltCallback(SPI_HandleTypeDef *hspi)
{
  if (hspi->Instance == SPI1) tx_done = 1;
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
  MX_DMA_Init();
  MX_SPI1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("WS2812 demo (SPI1 + DMA, 2.25 MHz)\r\n");
  uint32_t frame = 0;
  uint32_t next = HAL_GetTick() + 1U;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      uint32_t rgb[WS_LEDS];
      next += FRAME_MS;
      for (uint32_t i = 0; i < WS_LEDS; i++) rgb[i] = palette[(i + frame) % 8U];
      ws_show(rgb);
      if (frame % 10U == 0U) mini_printf("frame %lu\r\n", (unsigned long)frame);
      frame++;
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
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_32;
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
  * Enable DMA controller clock
  */
static void MX_DMA_Init(void)
{
  /* DMA controller clock enable */
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* DMA interrupt init */
  /* DMA1_Channel3_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA1_Channel3_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel3_IRQn);
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
