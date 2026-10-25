/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-oled-ssd1306 — SSD1306 0.96" 128x64 OLED on I2C1.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 on PB6 (SCL) / PB7 (SDA), AF open drain, 400 kHz fast mode
  * (PCLK1 36 MHz: DUTY 2, CCR 30 = 0.83 us high / 1.67 us low). The OLED
  * module carries its own 4.7 kOhm pull-ups and 3.3 V regulator.
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "SSD1306 OLED demo\r\n", 100 ms for the module supply, then
  * HAL_I2C_IsDeviceReady(0x3C) (2 trials, 5 ms):
  *   - HAL_BUSY  -> "I2C bus busy: SDA/SCL stuck low (pull-ups?)\r\n", stop;
  *   - no ACK    -> "SSD1306 not found at 0x3C (no ACK)\r\n", stop;
  *   - ACK       -> the init sequence of the common libraries (AEh, D5h 80h,
  *                  A8h 3Fh, D3h 00h, 40h, 8Dh 14h charge pump, 20h 00h
  *                  horizontal addressing, A1h, C8h, DAh 12h, 81h CFh,
  *                  D9h F1h, DBh 40h, A4h, A6h, 2Eh, AFh) in one transfer,
  *                  "SSD1306 at 0x3C ready\r\n".
  * Then every 200 ms (deadline based): the 1024-byte frame buffer is redrawn
  * (border, "Hello, ohmlet!", "SSD1306 128x64", "frame N", a progress bar
  * filling with N mod 100 and a circle) and sent with HAL_I2C_Mem_Write
  * (control byte 40h = GDDRAM stream, window 21h 0..127 / 22h 0..7 first);
  * every 5th frame "frame N\r\n" on USART1. A failed transfer prints
  * "I2C error N\r\n" and stops.
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
I2C_HandleTypeDef hi2c1;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
/** GDDRAM image: page p, column x at fb[p * 128 + x], bit 0 = top row of the page */
static uint8_t fb[OLED_W * OLED_PAGES];
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_I2C1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static HAL_StatusTypeDef oled_commands(const uint8_t *cmd, uint16_t n);
static void draw_frame(uint32_t n);
/* USER CODE END PFP */

/* USER CODE BEGIN 0 */
static const uint8_t oled_init_seq[] = {
  0xAE,             /* display off */
  0xD5, 0x80,       /* clock divide 1, oscillator 8 */
  0xA8, 0x3F,       /* multiplex 64 */
  0xD3, 0x00,       /* display offset 0 */
  0x40,             /* start line 0 */
  0x8D, 0x14,       /* charge pump ON (the module has no external VCC) */
  0x20, 0x00,       /* horizontal addressing */
  0xA1,             /* segment remap: column 127 -> SEG0 */
  0xC8,             /* COM scan COM63 -> COM0 */
  0xDA, 0x12,       /* alternative COM pins (128x64 glass) */
  0x81, 0xCF,       /* contrast */
  0xD9, 0xF1,       /* precharge */
  0xDB, 0x40,       /* VCOMH */
  0xA4,             /* display follows RAM */
  0xA6,             /* normal (not inverted) */
  0x2E,             /* scrolling off */
  0xAF,             /* display on */
};

static void set_pixel(int x, int y)
{
  if (x < 0 || x >= OLED_W || y < 0 || y >= OLED_H) return;
  fb[(y >> 3) * OLED_W + x] |= (uint8_t)(1U << (y & 7));
}

static void hline(int x0, int x1, int y)
{
  for (int x = x0; x <= x1; x++) set_pixel(x, y);
}

static void vline(int x, int y0, int y1)
{
  for (int y = y0; y <= y1; y++) set_pixel(x, y);
}

static void rect(int x0, int y0, int x1, int y1)
{
  hline(x0, x1, y0);
  hline(x0, x1, y1);
  vline(x0, y0, y1);
  vline(x1, y0, y1);
}

static void fill_rect(int x0, int y0, int x1, int y1)
{
  for (int y = y0; y <= y1; y++) hline(x0, x1, y);
}

/** midpoint circle outline */
static void circle(int cx, int cy, int r)
{
  int x = r, y = 0, err = 1 - r;
  while (x >= y)
  {
    set_pixel(cx + x, cy + y); set_pixel(cx - x, cy + y);
    set_pixel(cx + x, cy - y); set_pixel(cx - x, cy - y);
    set_pixel(cx + y, cy + x); set_pixel(cx - y, cy + x);
    set_pixel(cx + y, cy - x); set_pixel(cx - y, cy - x);
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x) + 1; }
  }
}

/** 5x7 glyph at (x, y) = its top-left dot; 6 px advance */
static int draw_char(int x, int y, char c)
{
  if (c < FONT5X7_FIRST || c > FONT5X7_LAST) c = '?';
  const uint8_t *g = font5x7[c - FONT5X7_FIRST];
  for (int col = 0; col < 5; col++)
    for (int row = 0; row < 7; row++)
      if (g[col] & (1U << row)) set_pixel(x + col, y + row);
  return x + 6;
}

static void draw_text(int x, int y, const char *s)
{
  while (*s) x = draw_char(x, y, *s++);
}

static void draw_frame(uint32_t n)
{
  char line[24];
  for (uint32_t i = 0; i < sizeof fb; i++) fb[i] = 0;
  rect(0, 0, OLED_W - 1, OLED_H - 1);
  draw_text(8, 6, "Hello, ohmlet!");
  draw_text(8, 18, "SSD1306 128x64");
  mini_snprintf(line, sizeof line, "frame %lu", (unsigned long)n);
  draw_text(8, 30, line);
  /* progress bar: outline 8..99 x 44..53, filled with n mod 100 */
  rect(8, 44, 99, 53);
  int w = (int)((n % 100U) * 88U / 99U);
  if (w > 0) fill_rect(10, 46, 9 + w, 51);
  circle(113, 48, 9);
}

/** control byte 00h + command stream in one transfer */
static HAL_StatusTypeDef oled_commands(const uint8_t *cmd, uint16_t n)
{
  return HAL_I2C_Mem_Write(&hi2c1, OLED_ADDR, 0x00, I2C_MEMADD_SIZE_8BIT, (uint8_t *)cmd, n, 20);
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
  MX_I2C1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("SSD1306 OLED demo\r\n");
  HAL_Delay(100); /* module supply / power-on reset settling */
  HAL_StatusTypeDef st = HAL_I2C_IsDeviceReady(&hi2c1, OLED_ADDR, 2, 5);
  if (st == HAL_BUSY)
  {
    mini_printf("I2C bus busy: SDA/SCL stuck low (pull-ups?)\r\n");
    while (1) __WFI();
  }
  if (st != HAL_OK)
  {
    mini_printf("SSD1306 not found at 0x%02X (no ACK)\r\n", OLED_ADDR >> 1);
    while (1) __WFI();
  }
  if (oled_commands(oled_init_seq, sizeof oled_init_seq) != HAL_OK)
  {
    mini_printf("I2C error %lu\r\n", (unsigned long)HAL_I2C_GetError(&hi2c1));
    while (1) __WFI();
  }
  mini_printf("SSD1306 at 0x%02X ready\r\n", OLED_ADDR >> 1);
  uint32_t frame = 0;
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      next += FRAME_MS;
      frame++;
      draw_frame(frame);
      static const uint8_t window[] = { 0x21, 0x00, 0x7F, 0x22, 0x00, 0x07 };
      if (oled_commands(window, sizeof window) != HAL_OK ||
          HAL_I2C_Mem_Write(&hi2c1, OLED_ADDR, 0x40, I2C_MEMADD_SIZE_8BIT, fb, sizeof fb, 100) != HAL_OK)
      {
        mini_printf("I2C error %lu\r\n", (unsigned long)HAL_I2C_GetError(&hi2c1));
        while (1) __WFI();
      }
      if (frame % 5U == 0U) mini_printf("frame %lu\r\n", (unsigned long)frame);
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
  * @brief I2C1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_I2C1_Init(void)
{
  hi2c1.Instance = I2C1;
  hi2c1.Init.ClockSpeed = 400000;
  hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
  hi2c1.Init.OwnAddress1 = 0;
  hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
  hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
  hi2c1.Init.OwnAddress2 = 0;
  hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
  hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
  if (HAL_I2C_Init(&hi2c1) != HAL_OK)
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
  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
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
