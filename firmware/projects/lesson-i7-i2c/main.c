/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : lesson-i7-i2c — lesson i7 (I2C): bus scan, then an
  *                   AT24C02 write / read-back with ACK polling.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 PB6 (SCL) / PB7 (SDA) alternate-function open drain, 100 kHz
  * standard mode (PCLK1 36 MHz: FREQ 36, CCR 180 = 5 us high / 5 us low,
  * TRISE 37). The bus needs external pull-ups (4.7 kOhm to 3.3 V on each
  * line). AT24C02 at 0x50 (A2 = A1 = A0 = GND, WP = GND).
  * USART1 PA9 (TX) / PA10 (RX), 115200 8N1, for the report.
  *
  * Once after reset (blocking HAL calls only):
  *  1. "I2C1 scan 0x08-0x77\r\n"; HAL_I2C_IsDeviceReady (1 trial, 2 ms) on
  *     every address 0x08 ... 0x77: "found 0xNN\r\n" for each device that
  *     acknowledges. HAL_BUSY (SDA or SCL never released high: no pull-ups,
  *     a short) prints "bus busy at 0xNN: SDA/SCL stuck low (pull-ups?)\r\n",
  *     HAL_TIMEOUT "timeout at 0xNN\r\n"; either ends the scan early.
  *     Then "scan done N\r\n" (N = devices found). A bus error stops here.
  *  2. No device at 0x50: "eeprom not found at 0x50\r\n" and stop.
  *  3. Read the 8 bytes at 0x10 (one AT24C02 page): "before: XX ... XX\r\n"
  *     (non-volatile: what the previous run left; an erased part reads FF).
  *  4. Write the bitwise complement of those bytes back to 0x10 (one page
  *     write), so the data ALWAYS changes and a write that silently does not
  *     happen (WP high) cannot pass by accident. The EEPROM then runs its
  *     self-timed write cycle (t_WR <= 5 ms) and does not acknowledge its
  *     address; ACK polling (IsDeviceReady, 1 trial, about 112 us per NACK)
  *     counts the polls: "wrote 8 bytes at 0x10, ready after P polls\r\n"
  *     (P about 45 for a 5 ms cycle; 0 when the write was ignored).
  *  5. Read back and compare: "read 8 bytes ok\r\n" and "eeprom ok\r\n";
  *     else "mismatch at 0xAA: wrote 0xWW read 0xRR\r\n" and
  *     "eeprom write failed\r\n". A HAL error prints
  *     "<step> error: HAL status S, ErrorCode 0xE\r\n".
  * Then the core sleeps (WFI). Press reset to run again.
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
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_I2C1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Halt(void);
static int Check(HAL_StatusTypeDef st, const char *step);
static int ScanBus(uint32_t *found_ee);
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
  /* 1. who is on the bus? */
  uint32_t found_ee = 0;
  if (!ScanBus(&found_ee))
  {
    Halt();
  }
  if (!found_ee)
  {
    mini_printf("eeprom not found at 0x50\r\n");
    Halt();
  }

  /* 2. what is there now */
  if (!Check(HAL_I2C_Mem_Read(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, rd, EE_LEN, 50), "read before"))
  {
    Halt();
  }
  mini_printf("before:");
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    mini_printf(" %02X", rd[i]);
    wr[i] = (uint8_t)~rd[i]; /* always a change */
  }
  mini_printf("\r\n");

  /* 3. one page write + ACK polling through the write cycle */
  if (!Check(HAL_I2C_Mem_Write(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, wr, EE_LEN, 50), "write"))
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
  mini_printf("wrote %u bytes at 0x%02X, ready after %lu polls\r\n", EE_LEN, EE_START, (unsigned long)polls);

  /* 4. read back and compare */
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    rd[i] = 0;
  }
  if (!Check(HAL_I2C_Mem_Read(&hi2c1, EE_ADDR, EE_START, I2C_MEMADD_SIZE_8BIT, rd, EE_LEN, 50), "read back"))
  {
    Halt();
  }
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    if (rd[i] != wr[i])
    {
      mini_printf("mismatch at 0x%02lX: wrote 0x%02X read 0x%02X\r\n", (unsigned long)(EE_START + i), wr[i], rd[i]);
      mini_printf("eeprom write failed\r\n");
      Halt();
    }
  }
  mini_printf("read %u bytes ok\r\n", EE_LEN);
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

/* Probe 0x08..0x77; 1 = the scan ran to the end (bus healthy), 0 = it was
   cut short by a busy bus or a timeout. *found_ee = 1 when 0x50 answered. */
static int ScanBus(uint32_t *found_ee)
{
  uint32_t found = 0;
  int ok = 1;
  mini_printf("I2C1 scan 0x%02X-0x%02X\r\n", SCAN_FIRST, SCAN_LAST);
  for (uint32_t addr = SCAN_FIRST; addr <= SCAN_LAST; addr++)
  {
    HAL_StatusTypeDef st = HAL_I2C_IsDeviceReady(&hi2c1, (uint16_t)(addr << 1), 1, SCAN_TIMEOUT_MS);
    if (st == HAL_OK)
    {
      mini_printf("found 0x%02lX\r\n", (unsigned long)addr);
      found++;
      if ((addr << 1) == EE_ADDR)
      {
        *found_ee = 1;
      }
    }
    else if (st == HAL_BUSY)
    {
      mini_printf("bus busy at 0x%02lX: SDA/SCL stuck low (pull-ups?)\r\n", (unsigned long)addr);
      ok = 0;
      break;
    }
    else if (st == HAL_TIMEOUT)
    {
      mini_printf("timeout at 0x%02lX\r\n", (unsigned long)addr);
      ok = 0;
      break;
    }
    /* HAL_ERROR: no acknowledge (AF) -> nothing at this address */
  }
  mini_printf("scan done %lu\r\n", (unsigned long)found);
  return ok;
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
