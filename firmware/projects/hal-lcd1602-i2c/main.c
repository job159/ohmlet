/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-lcd1602-i2c — LCD1602 through a PCF8574 I2C backpack.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 on PB6 (SCL) / PB7 (SDA), AF open drain, 100 kHz standard mode
  * (the PCF8574 maximum); the backpack has 4.7 kOhm pull-ups to its 5 V
  * VCC — PB6/PB7 are 5 V tolerant. PCF8574 at 0x27 (A2..A0 pads open).
  * Backpack wiring: P0 = RS, P1 = RW, P2 = E, P3 = backlight, P4..P7 = D4..D7.
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * After reset: "LCD1602 I2C demo\r\n", 50 ms, HAL_I2C_IsDeviceReady(0x27):
  *   HAL_BUSY -> "I2C bus busy: SDA/SCL stuck low (pull-ups?)\r\n", stop;
  *   no ACK   -> "PCF8574 not found at 0x27 (no ACK)\r\n", stop.
  * Every HD44780 nibble is one expander byte written twice (E high, then
  * E low) with the backlight bit set; one HD44780 byte = 4 expander bytes
  * (about 0.4 ms at 100 kHz, far longer than the 37 us execution time).
  * Init (4-bit by instruction): port 08h, 50 ms, nibble 3h, 5 ms, 3h, 1 ms,
  * 3h, 1 ms, 2h, then 28h, 0Ch, 01h + 2 ms, 06h. "LCD ready at 0x27\r\n".
  * Line 1: "Hello via I2C!"; line 2: "uptime" + seconds right-aligned in 6
  * digits at 4Ah. Every 1000 ms (deadline based) the seconds are rewritten
  * and "uptime N s\r\n" goes out on USART1. A failed transfer prints
  * "I2C error N\r\n" and stops.
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
I2C_HandleTypeDef hi2c1;
UART_HandleTypeDef huart1;

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_I2C1_Init(void);
static void MX_USART1_UART_Init(void);

/* USER CODE BEGIN 0 */
static int i2c_failed;

static void expander(const uint8_t *b, uint16_t n)
{
  if (i2c_failed) return;
  if (HAL_I2C_Master_Transmit(&hi2c1, LCD_ADDR, (uint8_t *)b, n, 20) != HAL_OK)
  {
    i2c_failed = 1;
    mini_printf("I2C error %lu\r\n", (unsigned long)HAL_I2C_GetError(&hi2c1));
  }
}

/** one nibble (upper 4 bits of n) with E pulsed high then low */
static void lcd_nibble(uint8_t n, uint8_t rs)
{
  uint8_t b[2];
  b[0] = (uint8_t)((n & 0xF0U) | LCD_BL | rs | LCD_E);
  b[1] = (uint8_t)((n & 0xF0U) | LCD_BL | rs);
  expander(b, 2);
}

static void lcd_byte(uint8_t v, uint8_t rs)
{
  uint8_t b[4];
  b[0] = (uint8_t)((v & 0xF0U) | LCD_BL | rs | LCD_E);
  b[1] = (uint8_t)((v & 0xF0U) | LCD_BL | rs);
  b[2] = (uint8_t)((uint8_t)(v << 4) | LCD_BL | rs | LCD_E);
  b[3] = (uint8_t)((uint8_t)(v << 4) | LCD_BL | rs);
  expander(b, 4);
}

static void lcd_cmd(uint8_t c) { lcd_byte(c, 0); }

static void lcd_text(const char *s)
{
  while (*s) lcd_byte((uint8_t)*s++, LCD_RS);
}

static void lcd_init(void)
{
  uint8_t bl = LCD_BL;
  expander(&bl, 1);
  HAL_Delay(50);
  lcd_nibble(0x30, 0);
  HAL_Delay(5);
  lcd_nibble(0x30, 0);
  HAL_Delay(1);
  lcd_nibble(0x30, 0);
  HAL_Delay(1);
  lcd_nibble(0x20, 0); /* 4-bit */
  lcd_cmd(0x28);       /* 2 lines, 5x8 */
  lcd_cmd(0x0C);       /* display on, cursor off */
  lcd_cmd(0x01);       /* clear: 1.52 ms */
  HAL_Delay(2);
  lcd_cmd(0x06);       /* increment */
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
  mini_printf("LCD1602 I2C demo\r\n");
  HAL_Delay(50);
  HAL_StatusTypeDef st = HAL_I2C_IsDeviceReady(&hi2c1, LCD_ADDR, 2, 5);
  if (st == HAL_BUSY)
  {
    mini_printf("I2C bus busy: SDA/SCL stuck low (pull-ups?)\r\n");
    while (1) __WFI();
  }
  if (st != HAL_OK)
  {
    mini_printf("PCF8574 not found at 0x%02X (no ACK)\r\n", LCD_ADDR >> 1);
    while (1) __WFI();
  }
  lcd_init();
  lcd_cmd(0x80);
  lcd_text("Hello via I2C!");
  lcd_cmd(0xC0);
  lcd_text("uptime");
  if (i2c_failed)
  {
    while (1) __WFI();
  }
  mini_printf("LCD ready at 0x%02X\r\n", LCD_ADDR >> 1);
  uint32_t seconds = 0;
  uint32_t next = HAL_GetTick() + 1000U;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      char digits[8];
      next += 1000U;
      seconds++;
      mini_snprintf(digits, sizeof digits, "%6lu", (unsigned long)seconds);
      lcd_cmd(0xCA);
      lcd_text(digits);
      if (i2c_failed)
      {
        while (1) __WFI();
      }
      mini_printf("uptime %lu s\r\n", (unsigned long)seconds);
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
  hi2c1.Init.ClockSpeed = 100000;
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
