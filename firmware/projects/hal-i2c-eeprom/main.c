/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-i2c-eeprom — AT24C02 page writes with ACK polling,
  *                   read-back in blocking and interrupt mode.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 PB6 (SCL) / PB7 (SDA) open drain, 100 kHz (CCR 180 at PCLK1 36 MHz),
  * event + error interrupts enabled (I2C1_EV_IRQn / I2C1_ER_IRQn).
  * AT24C02 at 0x50 (A2 = A1 = A0 = GND, WP = GND), 4.7 kOhm pull-ups on SCL
  * and SDA. USART1 PA9 / PA10 115200 8N1 for the report.
  *
  * Once after reset:
  *  1. "AT24C02 test\r\n"; HAL_I2C_IsDeviceReady(0x50, 3 trials) — no answer:
  *     "eeprom not found at 0x50\r\n" and stop.
  *  2. HAL_I2C_Mem_Read of the 16 bytes at 0x1C (blocking, N > 3 procedure):
  *     "before: XX XX ... XX\r\n" (what an earlier run left: the EEPROM is
  *     non-volatile; an erased part reads FF).
  *  3. Writes 0xA0 + i to 0x1C + i (i = 0 … 15) in page-aligned pieces
  *     (4 bytes at 0x1C, 8 at 0x20, 4 at 0x28: an AT24C02 page write rolls
  *     over inside its 8-byte page, datasheet "Page Write"). After each
  *     HAL_I2C_Mem_Write the EEPROM is busy for its self-timed write cycle
  *     and does not acknowledge its address: the firmware polls with
  *     HAL_I2C_IsDeviceReady (1 trial) until it answers ("ACK polling") and
  *     prints "wrote N bytes at 0xAA, ready after P polls\r\n".
  *  4. Reads back and compares, printing one line per mode:
  *     "read 16 ok" (Mem_Read 16 bytes: RXNE loop + 3-last-bytes / BTF),
  *     "read 1 ok" (1 byte at 0x1C: ACK cleared before ADDR, STOP after),
  *     "read 2 ok" (2 bytes at 0x1D: POS procedure),
  *     "read 16 (IT) ok" (HAL_I2C_Mem_Read_IT, completion in
  *     HAL_I2C_MemRxCpltCallback);
  *     the first difference instead prints
  *     "mismatch at 0xAA: wrote 0xWW read 0xRR (<mode>)\r\n" and stops;
  *     a HAL error prints "<step> error: HAL status S, ErrorCode 0xE\r\n".
  *  5. "eeprom ok\r\n". Then the core sleeps (WFI).
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

/* USER CODE BEGIN PV */
static uint8_t wr[EE_LEN];
static uint8_t rd[EE_LEN];
static volatile uint32_t it_done;
static volatile uint32_t it_error;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_I2C1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Halt(void);
static int Check(HAL_StatusTypeDef st, const char *step);
static int Compare(uint32_t addr, uint32_t n, const char *mode);
static void Clear(void);
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
  MX_I2C1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("AT24C02 test\r\n");
  if (HAL_I2C_IsDeviceReady(&hi2c1, EE_ADDR, 3, 5) != HAL_OK)
  {
    mini_printf("eeprom not found at 0x50\r\n");
    Halt();
  }

  /* 2. what is there now */
  Clear();
  if (!Check(HAL_I2C_Mem_Read(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, rd, EE_LEN, 50), "read before"))
  {
    Halt();
  }
  mini_printf("before:");
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    mini_printf(" %02X", rd[i]);
  }
  mini_printf("\r\n");

  /* 3. page-aligned writes with ACK polling */
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    wr[i] = (uint8_t)(0xA0U + i);
  }
  uint32_t addr = EE_START;
  uint32_t i = 0;
  while (i < EE_LEN)
  {
    uint32_t n = EE_PAGE - (addr % EE_PAGE);
    if (n > EE_LEN - i)
    {
      n = EE_LEN - i;
    }
    if (!Check(HAL_I2C_Mem_Write(&hi2c1, EE_ADDR, (uint16_t)addr, I2C_MEMADD_SIZE_8BIT, &wr[i], (uint16_t)n, 50), "write"))
    {
      Halt();
    }
    uint32_t t0 = HAL_GetTick();
    uint32_t polls = 0;
    while (HAL_I2C_IsDeviceReady(&hi2c1, EE_ADDR, 1, 2) != HAL_OK)
    {
      polls++;
      if (HAL_GetTick() - t0 > EE_WRITE_TIMEOUT_MS)
      {
        mini_printf("write cycle did not end within %u ms\r\n", EE_WRITE_TIMEOUT_MS);
        Halt();
      }
    }
    mini_printf("wrote %lu bytes at 0x%02lX, ready after %lu polls\r\n", (unsigned long)n, (unsigned long)addr, (unsigned long)polls);
    addr += n;
    i += n;
  }

  /* 4. read back in every receive procedure */
  Clear();
  if (!Check(HAL_I2C_Mem_Read(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, rd, EE_LEN, 50), "read 16") || !Compare(EE_START, EE_LEN, "read 16"))
  {
    Halt();
  }
  mini_printf("read 16 ok\r\n");

  Clear();
  if (!Check(HAL_I2C_Mem_Read(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, rd, 1, 50), "read 1") || !Compare(EE_START, 1, "read 1"))
  {
    Halt();
  }
  mini_printf("read 1 ok\r\n");

  Clear();
  if (!Check(HAL_I2C_Mem_Read(&hi2c1, EE_ADDR, EE_START + 1U, I2C_MEMADD_SIZE_8BIT, rd, 2, 50), "read 2") || !Compare(EE_START + 1U, 2, "read 2"))
  {
    Halt();
  }
  mini_printf("read 2 ok\r\n");

  Clear();
  it_done = 0;
  it_error = 0;
  if (!Check(HAL_I2C_Mem_Read_IT(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, rd, EE_LEN), "read 16 (IT)"))
  {
    Halt();
  }
  uint32_t t0 = HAL_GetTick();
  while (!it_done && !it_error)
  {
    if (HAL_GetTick() - t0 > 50U)
    {
      mini_printf("read 16 (IT) error: no completion callback\r\n");
      Halt();
    }
  }
  if (it_error)
  {
    mini_printf("read 16 (IT) error: ErrorCode 0x%lX\r\n", (unsigned long)hi2c1.ErrorCode);
    Halt();
  }
  if (!Compare(EE_START, EE_LEN, "read 16 (IT)"))
  {
    Halt();
  }
  mini_printf("read 16 (IT) ok\r\n");

  mini_printf("eeprom ok\r\n");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
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

static void Halt(void)
{
  while (1)
  {
    __WFI();
  }
}

static void Clear(void)
{
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    rd[i] = 0;
  }
}

/* 1 when the HAL call succeeded, else reports it */
static int Check(HAL_StatusTypeDef st, const char *step)
{
  if (st == HAL_OK)
  {
    return 1;
  }
  mini_printf("%s error: HAL status %d, ErrorCode 0x%lX\r\n", step, (int)st, (unsigned long)hi2c1.ErrorCode);
  return 0;
}

/* compare rd[0..n) with what was written at addr..addr+n */
static int Compare(uint32_t addr, uint32_t n, const char *mode)
{
  for (uint32_t i = 0; i < n; i++)
  {
    uint8_t want = wr[addr - EE_START + i];
    if (rd[i] != want)
    {
      mini_printf("mismatch at 0x%02lX: wrote 0x%02X read 0x%02X (%s)\r\n", (unsigned long)(addr + i), want, rd[i], mode);
      return 0;
    }
  }
  return 1;
}

void HAL_I2C_MemRxCpltCallback(I2C_HandleTypeDef *hi2c)
{
  if (hi2c->Instance == I2C1)
  {
    it_done = 1;
  }
}

void HAL_I2C_ErrorCallback(I2C_HandleTypeDef *hi2c)
{
  if (hi2c->Instance == I2C1)
  {
    it_error = 1;
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
