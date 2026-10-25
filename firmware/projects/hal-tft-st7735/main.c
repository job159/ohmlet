/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-tft-st7735 — ST7735S 1.8" 128x160 TFT on SPI1: colour bars + text.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * SPI1 master "Transmit Only": PA5 SCK -> SCL, PA7 MOSI -> SDA (AF
  * push-pull), mode 0, MSB first, 8-bit, prescaler 8: SCK = 9 MHz (the
  * ST7735S write cycle allows 15 MHz). GPIO push-pull outputs: PA4 = CS,
  * PB0 = DC, PB1 = RES, PB10 = BL (backlight on).
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "ST7735 TFT demo\r\n"; RES low 10 ms, high 120 ms; the
  * "black tab" init of the common libraries: SWRESET + 150 ms, SLPOUT +
  * 120 ms, FRMCTR1-3, INVCTR, PWCTR1-5, VMCTR1, INVOFF, MADCTL C0h (upright
  * portrait, RGB), COLMOD 05h (16-bit RGB565), CASET 0..127, RASET 0..159,
  * GMCTRP1/GMCTRN1, NORON + 10 ms, DISPON + 100 ms; BL high;
  * "ST7735 ready\r\n".
  * Picture: eight 16-px colour bars over rows 0..99 (white, yellow, cyan,
  * green, magenta, red, blue, black), rows 100..159 black with
  * "ST7735 128x160" at (4,108) in white and "frame N" at (4,124) in yellow
  * (5x7 font, 6 px cells). "colour bars drawn\r\n".
  * Every 500 ms (deadline based) N = 1, 2, ... the "frame N" line is redrawn;
  * every 2nd time "frame N\r\n" on USART1.
  * Pixels are sent big-endian RGB565 inside CASET/RASET windows after RAMWR.
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
#define CS_LOW()   HAL_GPIO_WritePin(TFT_CS_GPIO_Port, TFT_CS_Pin, GPIO_PIN_RESET)
#define CS_HIGH()  HAL_GPIO_WritePin(TFT_CS_GPIO_Port, TFT_CS_Pin, GPIO_PIN_SET)
#define DC_CMD()   HAL_GPIO_WritePin(TFT_DC_GPIO_Port, TFT_DC_Pin, GPIO_PIN_RESET)
#define DC_DATA()  HAL_GPIO_WritePin(TFT_DC_GPIO_Port, TFT_DC_Pin, GPIO_PIN_SET)

static void spi(const uint8_t *b, uint16_t n)
{
  if (HAL_SPI_Transmit(&hspi1, (uint8_t *)b, n, 50) != HAL_OK) Error_Handler();
}

/** command byte + parameter bytes in one CS-low window */
static void tft_cmd(uint8_t c, const uint8_t *p, uint16_t n)
{
  CS_LOW();
  DC_CMD();
  spi(&c, 1);
  if (n)
  {
    DC_DATA();
    spi(p, n);
  }
  CS_HIGH();
}

/** CASET / RASET window then RAMWR; leaves CS low and DC high for the pixels */
static void tft_window(int x0, int y0, int x1, int y1)
{
  uint8_t ca[4] = { 0, (uint8_t)x0, 0, (uint8_t)x1 };
  uint8_t ra[4] = { 0, (uint8_t)y0, 0, (uint8_t)y1 };
  tft_cmd(0x2A, ca, 4);
  tft_cmd(0x2B, ra, 4);
  uint8_t c = 0x2C;
  CS_LOW();
  DC_CMD();
  spi(&c, 1);
  DC_DATA();
}

static void tft_fill(int x0, int y0, int x1, int y1, uint16_t color)
{
  static uint8_t line[2 * TFT_W];
  int w = x1 - x0 + 1;
  for (int i = 0; i < w; i++)
  {
    line[2 * i] = (uint8_t)(color >> 8);
    line[2 * i + 1] = (uint8_t)color;
  }
  tft_window(x0, y0, x1, y1);
  for (int y = y0; y <= y1; y++) spi(line, (uint16_t)(2 * w));
  CS_HIGH();
}

/** one 6x8 character cell (5x7 glyph + spacing) at (x, y) */
static void tft_char(int x, int y, char ch, uint16_t fg, uint16_t bg)
{
  uint8_t cell[6 * 8 * 2];
  if (ch < FONT5X7_FIRST || ch > FONT5X7_LAST) ch = '?';
  const uint8_t *g = font5x7[ch - FONT5X7_FIRST];
  for (int row = 0; row < 8; row++)
    for (int col = 0; col < 6; col++)
    {
      int on = col < 5 && row < 7 && (g[col] & (1U << row));
      uint16_t c = on ? fg : bg;
      cell[2 * (row * 6 + col)] = (uint8_t)(c >> 8);
      cell[2 * (row * 6 + col) + 1] = (uint8_t)c;
    }
  tft_window(x, y, x + 5, y + 7);
  spi(cell, sizeof cell);
  CS_HIGH();
}

static void tft_text(int x, int y, const char *s, uint16_t fg, uint16_t bg)
{
  for (; *s; s++, x += 6) tft_char(x, y, *s, fg, bg);
}

static void tft_init(void)
{
  static const uint8_t frmctr[] = { 0x01, 0x2C, 0x2D, 0x01, 0x2C, 0x2D };
  static const uint8_t gmctrp[] = { 0x02, 0x1C, 0x07, 0x12, 0x37, 0x32, 0x29, 0x2D, 0x29, 0x25, 0x2B, 0x39, 0x00, 0x01, 0x03, 0x10 };
  static const uint8_t gmctrn[] = { 0x03, 0x1D, 0x07, 0x06, 0x2E, 0x2C, 0x29, 0x2D, 0x2E, 0x2E, 0x37, 0x3F, 0x00, 0x00, 0x02, 0x10 };
  uint8_t p[4];
  HAL_GPIO_WritePin(TFT_RES_GPIO_Port, TFT_RES_Pin, GPIO_PIN_RESET);
  HAL_Delay(10);
  HAL_GPIO_WritePin(TFT_RES_GPIO_Port, TFT_RES_Pin, GPIO_PIN_SET);
  HAL_Delay(120);
  tft_cmd(0x01, 0, 0); /* SWRESET */
  HAL_Delay(150);
  tft_cmd(0x11, 0, 0); /* SLPOUT */
  HAL_Delay(120);
  tft_cmd(0xB1, frmctr, 3);
  tft_cmd(0xB2, frmctr, 3);
  tft_cmd(0xB3, frmctr, 6);
  p[0] = 0x07;
  tft_cmd(0xB4, p, 1); /* INVCTR */
  p[0] = 0xA2; p[1] = 0x02; p[2] = 0x84;
  tft_cmd(0xC0, p, 3);
  p[0] = 0xC5;
  tft_cmd(0xC1, p, 1);
  p[0] = 0x0A; p[1] = 0x00;
  tft_cmd(0xC2, p, 2);
  p[0] = 0x8A; p[1] = 0x2A;
  tft_cmd(0xC3, p, 2);
  p[0] = 0x8A; p[1] = 0xEE;
  tft_cmd(0xC4, p, 2);
  p[0] = 0x0E;
  tft_cmd(0xC5, p, 1); /* VMCTR1 */
  tft_cmd(0x20, 0, 0); /* INVOFF */
  p[0] = 0xC0;
  tft_cmd(0x36, p, 1); /* MADCTL: MY | MX, RGB */
  p[0] = 0x05;
  tft_cmd(0x3A, p, 1); /* COLMOD: 16-bit */
  p[0] = 0; p[1] = 0; p[2] = 0; p[3] = TFT_W - 1;
  tft_cmd(0x2A, p, 4);
  p[3] = TFT_H - 1;
  tft_cmd(0x2B, p, 4);
  tft_cmd(0xE0, gmctrp, sizeof gmctrp);
  tft_cmd(0xE1, gmctrn, sizeof gmctrn);
  tft_cmd(0x13, 0, 0); /* NORON */
  HAL_Delay(10);
  tft_cmd(0x29, 0, 0); /* DISPON */
  HAL_Delay(100);
  HAL_GPIO_WritePin(TFT_BL_GPIO_Port, TFT_BL_Pin, GPIO_PIN_SET);
}

static const uint16_t bars[8] = { 0xFFFF, 0xFFE0, 0x07FF, 0x07E0, 0xF81F, 0xF800, 0x001F, 0x0000 };
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
  mini_printf("ST7735 TFT demo\r\n");
  tft_init();
  mini_printf("ST7735 ready\r\n");
  for (int i = 0; i < 8; i++) tft_fill(i * 16, 0, i * 16 + 15, 99, bars[i]);
  tft_fill(0, 100, TFT_W - 1, TFT_H - 1, 0x0000);
  tft_text(4, 108, "ST7735 128x160", 0xFFFF, 0x0000);
  mini_printf("colour bars drawn\r\n");
  uint32_t frame = 0;
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      char line[20];
      next += FRAME_MS;
      frame++;
      mini_snprintf(line, sizeof line, "frame %lu", (unsigned long)frame);
      tft_text(4, 124, line, 0xFFE0, 0x0000);
      if (frame % 2U == 0U) mini_printf("frame %lu\r\n", (unsigned long)frame);
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
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_8;
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
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(TFT_CS_GPIO_Port, TFT_CS_Pin, GPIO_PIN_SET);
  HAL_GPIO_WritePin(GPIOB, TFT_DC_Pin|TFT_RES_Pin, GPIO_PIN_SET);
  HAL_GPIO_WritePin(TFT_BL_GPIO_Port, TFT_BL_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : TFT_CS_Pin */
  GPIO_InitStruct.Pin = TFT_CS_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(TFT_CS_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pins : TFT_DC_Pin TFT_RES_Pin TFT_BL_Pin */
  GPIO_InitStruct.Pin = TFT_DC_Pin|TFT_RES_Pin|TFT_BL_Pin;
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
