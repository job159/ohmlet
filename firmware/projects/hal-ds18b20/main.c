/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-ds18b20 — DS18B20 1-Wire thermometer bit-banged on PB12.
  ******************************************************************************
  * Blue Pill, 72 MHz, SysTick 1 kHz. DS18B20 DQ -> PB12, an OPEN-DRAIN
  * output that idles released; the bus needs the external 4.7 kOhm pull-up
  * to VDD. Slot timing with DWT->CYCCNT (72 cycles per us), every slot with
  * interrupts masked. USART1 PA9 115200 8N1.
  *
  * Boot: "DS18B20 on PB12 (1-Wire, DWT timing)\r\n", then READ ROM (0x33):
  * "ROM 28-xx-xx-xx-xx-xx-xx-cc CRC ok|bad\r\n".
  * Every second: reset + presence, SKIP ROM, CONVERT T (0x44), read slots
  * until the sensor answers 1 (conversion done: 750 ms at 12 bit), reset,
  * SKIP ROM, READ SCRATCHPAD (0xBE), 9 bytes with the Dallas CRC8:
  *   "T=[-]<C>.<dddd> C (conv <ms> ms)\r\n"   T = (int16)(b1 << 8 | b0) / 16
  * Failures (the real symptoms):
  *   the line reads low while released (no pull-up / short):
  *     "1-Wire bus low: missing 4.7k pull-up?\r\n"
  *   no presence pulse: "no DS18B20 (no presence pulse)\r\n"
  *   wrong CRC: "scratchpad CRC error\r\n"
  *   conversion never ends: "conversion timeout\r\n"
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
/* USER CODE BEGIN PFP */
static void dwt_init(void);
static void delay_us(uint32_t us);
static int ow_reset(void);
static void ow_write_bit(uint32_t bit);
static uint32_t ow_read_bit(void);
static void ow_write(uint8_t byte);
static uint8_t ow_read(void);
static uint8_t crc8(const uint8_t *p, int n);
static void report_reset_error(int r);
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
  dwt_init();
  mini_printf("DS18B20 on PB12 (1-Wire, DWT timing)\r\n");
  int r = ow_reset();
  if (r == 1)
  {
    uint8_t rom[8];
    ow_write(OW_READ_ROM);
    for (int i = 0; i < 8; i++)
    {
      rom[i] = ow_read();
    }
    mini_printf("ROM %02X-%02X-%02X-%02X-%02X-%02X-%02X-%02X CRC %s\r\n", rom[0], rom[1], rom[2], rom[3], rom[4], rom[5], rom[6],
                rom[7], crc8(rom, 7) == rom[7] ? "ok" : "bad");
  }
  else
  {
    report_reset_error(r);
  }
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) < 0)
    {
      __WFI();
      continue;
    }
    next += REPORT_PERIOD_MS;
    r = ow_reset();
    if (r != 1)
    {
      report_reset_error(r);
      continue;
    }
    ow_write(OW_SKIP_ROM);
    ow_write(DS_CONVERT_T);
    uint32_t t0 = HAL_GetTick();
    while (ow_read_bit() == 0 && HAL_GetTick() - t0 < CONVERSION_TIMEOUT_MS)
    {
    }
    uint32_t conv = HAL_GetTick() - t0;
    if (conv >= CONVERSION_TIMEOUT_MS)
    {
      mini_printf("conversion timeout\r\n");
      continue;
    }
    r = ow_reset();
    if (r != 1)
    {
      report_reset_error(r);
      continue;
    }
    ow_write(OW_SKIP_ROM);
    ow_write(DS_READ_SCRATCHPAD);
    uint8_t sp[9];
    for (int i = 0; i < 9; i++)
    {
      sp[i] = ow_read();
    }
    if (crc8(sp, 8) != sp[8])
    {
      mini_printf("scratchpad CRC error\r\n");
      continue;
    }
    int32_t raw = (int16_t)((sp[1] << 8) | sp[0]);
    uint32_t mag = (uint32_t)(raw < 0 ? -raw : raw);
    /* 1/16 C per LSB: fraction in 1/10000 C */
    mini_printf("T=%s%lu.%04lu C (conv %lu ms)\r\n", raw < 0 ? "-" : "", (unsigned long)(mag >> 4),
                (unsigned long)((mag & 0x0FU) * 625U), (unsigned long)conv);
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

  /*Configure GPIO pin Output Level: released */
  HAL_GPIO_WritePin(OW_GPIO_Port, OW_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin : OW_Pin (open drain: the bus needs its pull-up) */
  GPIO_InitStruct.Pin = OW_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(OW_GPIO_Port, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

static void dwt_init(void)
{
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

static void delay_us(uint32_t us)
{
  uint32_t t0 = DWT->CYCCNT;
  uint32_t n = us * (SystemCoreClock / 1000000U);
  while (DWT->CYCCNT - t0 < n)
  {
  }
}

static inline void ow_low(void)
{
  OW_GPIO_Port->BRR = OW_Pin;
}

static inline void ow_release(void)
{
  OW_GPIO_Port->BSRR = OW_Pin;
}

static inline uint32_t ow_level(void)
{
  return (OW_GPIO_Port->IDR & OW_Pin) ? 1U : 0U;
}

/* Reset pulse + presence: 1 = device present, 0 = no presence pulse, -1 = bus low while released. */
static int ow_reset(void)
{
  ow_release();
  delay_us(5);
  if (!ow_level())
  {
    return -1;
  }
  __disable_irq();
  ow_low();
  delay_us(OW_RESET_LOW_US);
  ow_release();
  delay_us(OW_PRESENCE_SAMPLE_US);
  uint32_t presence = !ow_level();
  delay_us(OW_RESET_TAIL_US);
  uint32_t idle = ow_level();
  __enable_irq();
  if (!idle)
  {
    return -1;
  }
  return presence ? 1 : 0;
}

/* Write slot: 1 = low 6 us then released, 0 = low 60 us (AN126 A/B, C/D). */
static void ow_write_bit(uint32_t bit)
{
  __disable_irq();
  ow_low();
  if (bit)
  {
    delay_us(6);
    ow_release();
    delay_us(64);
  }
  else
  {
    delay_us(60);
    ow_release();
    delay_us(10);
  }
  __enable_irq();
}

/* Read slot: low 3 us, release, sample at 13 us, finish the 65 us slot (AN126 A/E/F). */
static uint32_t ow_read_bit(void)
{
  __disable_irq();
  ow_low();
  delay_us(3);
  ow_release();
  delay_us(10);
  uint32_t b = ow_level();
  delay_us(OW_SLOT_US - 13U);
  __enable_irq();
  return b;
}

static void ow_write(uint8_t byte)
{
  for (int i = 0; i < 8; i++)
  {
    ow_write_bit((byte >> i) & 1U);
  }
}

static uint8_t ow_read(void)
{
  uint8_t v = 0;
  for (int i = 0; i < 8; i++)
  {
    v |= (uint8_t)(ow_read_bit() << i);
  }
  return v;
}

/* Dallas/Maxim CRC8: x^8 + x^5 + x^4 + 1, LSB first (AN27). */
static uint8_t crc8(const uint8_t *p, int n)
{
  uint8_t crc = 0;
  while (n--)
  {
    uint8_t b = *p++;
    for (int i = 0; i < 8; i++)
    {
      uint8_t mix = (crc ^ b) & 1U;
      crc >>= 1;
      if (mix)
      {
        crc ^= 0x8CU;
      }
      b >>= 1;
    }
  }
  return crc;
}

static void report_reset_error(int r)
{
  if (r < 0)
  {
    mini_printf("1-Wire bus low: missing 4.7k pull-up?\r\n");
  }
  else
  {
    mini_printf("no DS18B20 (no presence pulse)\r\n");
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
