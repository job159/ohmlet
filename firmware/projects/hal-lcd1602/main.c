/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-lcd1602 — HD44780 16x2 LCD, 4-bit bus with busy-flag polling.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * LCD1602 (5 V module) in 4-bit mode on 5 V tolerant pins:
  *   RS = PB10, RW = PB11, E = PB1 (push-pull outputs),
  *   D4..D7 = PB12..PB15 (push-pull outputs while writing, floating inputs
  *   while reading the busy flag — the LCD then drives them to 5 V, which
  *   the FT pins accept). D0..D3 unconnected.
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "LCD1602 4-bit demo\r\n", then initialization by instruction
  * (HD44780U Figure 24): 50 ms, nibble 3h, 5 ms, 3h, 150 us, 3h, 150 us,
  * 2h (4-bit), 150 us; from here every instruction waits for BF = 0
  * (busy-flag read: RS = 0, RW = 1, two E pulses, D7 of the first nibble):
  * 28h (2 lines, 5x8), 08h, 01h (clear), 06h (increment), 0Ch (display
  * on). Prints "LCD ready, BF polls during clear: N\r\n" (N = reads of
  * BF = 1 while the 1.52 ms clear executed). If BF never clears within
  * 10 ms: "LCD busy timeout\r\n" and stop.
  * CGRAM: character 0 = heart, character 1 = smiley.
  * Line 1 (DDRAM 00h): "Hello, ohmlet!"; line 2 (40h): char 0, " count:",
  * the counter right-aligned in 5 digits at 48h..4Ch, a space and char 1.
  * Every 250 ms (deadline based) the counter increments and is rewritten
  * (DDRAM address 48h); every 4th update "count N\r\n" on USART1.
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
/** busy-flag reads that returned BF = 1 since the last reset of the counter */
static uint32_t bf_polls;
static int lcd_timeout;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);

/* USER CODE BEGIN 0 */

/** about n microseconds at 72 MHz (busy loop, used only for the init waits) */
static void delay_us(uint32_t n)
{
  for (volatile uint32_t i = 0; i < n * 12U; i++)
  {
  }
}

/** E high for >= 450 ns, then low (data latched on the falling edge) */
static void lcd_pulse(void)
{
  HAL_GPIO_WritePin(LCD_E_GPIO_Port, LCD_E_Pin, GPIO_PIN_SET);
  for (volatile int i = 0; i < 8; i++)
  {
  }
  HAL_GPIO_WritePin(LCD_E_GPIO_Port, LCD_E_Pin, GPIO_PIN_RESET);
}

/** D4..D7 = nibble, one BSRR store */
static void lcd_put_nibble(uint8_t n)
{
  GPIOB->BSRR = ((uint32_t)(n & 0x0FU) << 12) | ((uint32_t)(~n & 0x0FU) << (12 + 16));
}

static void lcd_data_dir(int input)
{
  GPIO_InitTypeDef g = {0};
  g.Pin = LCD_D4_Pin | LCD_D5_Pin | LCD_D6_Pin | LCD_D7_Pin;
  g.Mode = input ? GPIO_MODE_INPUT : GPIO_MODE_OUTPUT_PP;
  g.Pull = GPIO_NOPULL;
  g.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &g);
}

/** read BF + AC (two E pulses in 4-bit mode); returns the 8-bit status */
static uint8_t lcd_read_status(void)
{
  uint8_t v = 0;
  HAL_GPIO_WritePin(LCD_RS_GPIO_Port, LCD_RS_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(LCD_RW_GPIO_Port, LCD_RW_Pin, GPIO_PIN_SET);
  for (int k = 0; k < 2; k++)
  {
    HAL_GPIO_WritePin(LCD_E_GPIO_Port, LCD_E_Pin, GPIO_PIN_SET);
    for (volatile int i = 0; i < 8; i++)
    {
    }
    v = (uint8_t)((v << 4) | ((GPIOB->IDR >> 12) & 0x0FU));
    HAL_GPIO_WritePin(LCD_E_GPIO_Port, LCD_E_Pin, GPIO_PIN_RESET);
    for (volatile int i = 0; i < 4; i++)
    {
    }
  }
  HAL_GPIO_WritePin(LCD_RW_GPIO_Port, LCD_RW_Pin, GPIO_PIN_RESET);
  return v;
}

/** poll BF until 0 (10 ms timeout) */
static void lcd_wait(void)
{
  if (lcd_timeout) return;
  lcd_data_dir(1);
  uint32_t t0 = HAL_GetTick();
  while (lcd_read_status() & 0x80U)
  {
    bf_polls++;
    if (HAL_GetTick() - t0 > 10U)
    {
      lcd_timeout = 1;
      break;
    }
  }
  lcd_data_dir(0);
}

static void lcd_write(uint8_t rs, uint8_t b)
{
  lcd_wait();
  HAL_GPIO_WritePin(LCD_RS_GPIO_Port, LCD_RS_Pin, rs ? GPIO_PIN_SET : GPIO_PIN_RESET);
  HAL_GPIO_WritePin(LCD_RW_GPIO_Port, LCD_RW_Pin, GPIO_PIN_RESET);
  lcd_put_nibble((uint8_t)(b >> 4));
  lcd_pulse();
  lcd_put_nibble(b);
  lcd_pulse();
}

static void lcd_cmd(uint8_t c) { lcd_write(0, c); }
static void lcd_char(uint8_t d) { lcd_write(1, d); }

static void lcd_text(const char *s)
{
  while (*s) lcd_char((uint8_t)*s++);
}

/** initialization by instruction, 4-bit (HD44780U Figure 24) */
static void lcd_init(void)
{
  HAL_Delay(50);
  HAL_GPIO_WritePin(LCD_RS_GPIO_Port, LCD_RS_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(LCD_RW_GPIO_Port, LCD_RW_Pin, GPIO_PIN_RESET);
  lcd_put_nibble(0x3);
  lcd_pulse();
  HAL_Delay(5);
  lcd_pulse();
  delay_us(150);
  lcd_pulse();
  delay_us(150);
  lcd_put_nibble(0x2);
  lcd_pulse();
  delay_us(150);
  lcd_cmd(0x28); /* 4-bit, 2 lines, 5x8 */
  lcd_cmd(0x08); /* display off */
  lcd_cmd(0x01); /* clear: 1.52 ms */
  bf_polls = 0;
  lcd_wait();
  lcd_cmd(0x06); /* increment, no shift */
  lcd_cmd(0x0C); /* display on, cursor off */
}

static const uint8_t glyph_heart[8] = { 0x00, 0x0A, 0x1F, 0x1F, 0x0E, 0x04, 0x00, 0x00 };
static const uint8_t glyph_smile[8] = { 0x00, 0x0A, 0x0A, 0x00, 0x11, 0x0E, 0x00, 0x00 };
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
  mini_printf("LCD1602 4-bit demo\r\n");
  lcd_init();
  uint32_t polls = bf_polls;
  if (lcd_timeout)
  {
    mini_printf("LCD busy timeout\r\n");
    while (1) __WFI();
  }
  mini_printf("LCD ready, BF polls during clear: %lu\r\n", (unsigned long)polls);
  /* CGRAM characters 0 and 1 */
  lcd_cmd(0x40);
  for (int i = 0; i < 8; i++) lcd_char(glyph_heart[i]);
  for (int i = 0; i < 8; i++) lcd_char(glyph_smile[i]);
  lcd_cmd(0x80);
  lcd_text("Hello, ohmlet!");
  lcd_cmd(0xC0);
  lcd_char(0);
  lcd_text(" count:");
  lcd_cmd(0xCE);
  lcd_char(1);
  uint32_t count = 0;
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      char digits[8];
      next += STEP_MS;
      mini_snprintf(digits, sizeof digits, "%5lu", (unsigned long)count);
      lcd_cmd(0xC8);
      lcd_text(digits);
      if (count % 4U == 0U) mini_printf("count %lu\r\n", (unsigned long)count);
      count++;
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
  HAL_GPIO_WritePin(GPIOB, LCD_E_Pin|LCD_RS_Pin|LCD_RW_Pin|LCD_D4_Pin|LCD_D5_Pin|LCD_D6_Pin|LCD_D7_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pins : LCD_E_Pin LCD_RS_Pin LCD_RW_Pin LCD_D4_Pin LCD_D5_Pin LCD_D6_Pin LCD_D7_Pin */
  GPIO_InitStruct.Pin = LCD_E_Pin|LCD_RS_Pin|LCD_RW_Pin|LCD_D4_Pin|LCD_D5_Pin|LCD_D6_Pin|LCD_D7_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
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
