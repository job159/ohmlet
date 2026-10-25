/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-spi-loopback — SPI1 full duplex with MOSI wired to MISO.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * SPI1 master, full duplex: PA5 SCK and PA7 MOSI alternate-function
  * push-pull, PA6 MISO input (no pull). A jumper wire connects PA7 to PA6,
  * so every bit sent is received on the same clock edge pair.
  * USART1 PA9 / PA10 115200 8N1 for the report.
  *
  * Four passes of HAL_SPI_TransmitReceive (blocking), each compared with
  * what was sent:
  *   1. mode 0 (CPOL 0, CPHA 1EDGE), MSB first, 8-bit, SCK 72 MHz / 8
  *      = 9 MHz, 64 bytes tx[i] = 37·i + 11  → "mode 0: 64 bytes ok"
  *   2. mode 3 (CPOL 1, CPHA 2EDGE), LSB first, 8-bit, 18 MHz, 64 bytes
  *                                           → "mode 3 lsb: 64 bytes ok"
  *   3. mode 1, MSB first, 16-bit frames, 4.5 MHz, 64 bytes as 32
  *      half-words                           → "16-bit: 32 words ok"
  *   4. mode 0, 8-bit, hardware CRC (polynomial 7), 64 bytes + CRC frame:
  *      the CRC the master sends comes back on MISO and must match its
  *      RXCRCR (HAL reports HAL_SPI_ERROR_CRC otherwise)
  *                                           → "crc: 64 bytes ok, crc 0xNN"
  * A difference prints "<pass>: mismatch at byte N: sent 0xSS got 0xRR\r\n"
  * and stops; a HAL error prints "<pass>: HAL status S, ErrorCode 0xE\r\n".
  * All passes good: "spi loopback ok\r\n". Then the core sleeps (WFI).
  * Without the PA7–PA6 wire MISO floats: the first pass reports a mismatch.
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
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
/* half-word aligned: the 16-bit pass hands them to HAL as uint16_t buffers */
static uint8_t tx[LOOP_LEN] __attribute__((aligned(4)));
static uint8_t rx[LOOP_LEN] __attribute__((aligned(4)));
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_SPI1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Halt(void);
static void Reconfigure(uint32_t polarity, uint32_t phase, uint32_t first, uint32_t size, uint32_t prescaler, uint32_t crc);
static int Pass(const char *name, uint32_t words);
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
  MX_SPI1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("SPI1 loopback (PA7 MOSI -> PA6 MISO)\r\n");
  for (uint32_t i = 0; i < LOOP_LEN; i++)
  {
    tx[i] = (uint8_t)(37U * i + 11U);
  }

  if (!Pass("mode 0", LOOP_LEN))
  {
    Halt();
  }
  mini_printf("mode 0: %u bytes ok\r\n", LOOP_LEN);

  Reconfigure(SPI_POLARITY_HIGH, SPI_PHASE_2EDGE, SPI_FIRSTBIT_LSB, SPI_DATASIZE_8BIT, SPI_BAUDRATEPRESCALER_4, SPI_CRCCALCULATION_DISABLE);
  if (!Pass("mode 3 lsb", LOOP_LEN))
  {
    Halt();
  }
  mini_printf("mode 3 lsb: %u bytes ok\r\n", LOOP_LEN);

  Reconfigure(SPI_POLARITY_LOW, SPI_PHASE_2EDGE, SPI_FIRSTBIT_MSB, SPI_DATASIZE_16BIT, SPI_BAUDRATEPRESCALER_16, SPI_CRCCALCULATION_DISABLE);
  if (!Pass("16-bit", LOOP_LEN / 2U))
  {
    Halt();
  }
  mini_printf("16-bit: %u words ok\r\n", LOOP_LEN / 2U);

  Reconfigure(SPI_POLARITY_LOW, SPI_PHASE_1EDGE, SPI_FIRSTBIT_MSB, SPI_DATASIZE_8BIT, SPI_BAUDRATEPRESCALER_8, SPI_CRCCALCULATION_ENABLE);
  if (!Pass("crc", LOOP_LEN))
  {
    Halt();
  }
  mini_printf("crc: %u bytes ok, crc 0x%02lX\r\n", LOOP_LEN, (unsigned long)(hspi1.Instance->TXCRCR & 0xFFU));

  mini_printf("spi loopback ok\r\n");
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
  hspi1.Init.CRCPolynomial = 7;
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
  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
}

/* USER CODE BEGIN 4 */

static void Halt(void)
{
  while (1)
  {
    __WFI();
  }
}

/* HAL_SPI_Init with new frame settings (HAL disables SPE first: CPOL/CPHA/DFF change only while disabled) */
static void Reconfigure(uint32_t polarity, uint32_t phase, uint32_t first, uint32_t size, uint32_t prescaler, uint32_t crc)
{
  hspi1.Init.CLKPolarity = polarity;
  hspi1.Init.CLKPhase = phase;
  hspi1.Init.FirstBit = first;
  hspi1.Init.DataSize = size;
  hspi1.Init.BaudRatePrescaler = prescaler;
  hspi1.Init.CRCCalculation = crc;
  if (HAL_SPI_Init(&hspi1) != HAL_OK)
  {
    Error_Handler();
  }
}

/* one TransmitReceive of `words` frames (bytes or half-words) and the comparison */
static int Pass(const char *name, uint32_t words)
{
  for (uint32_t i = 0; i < LOOP_LEN; i++)
  {
    rx[i] = 0;
  }
  HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, tx, rx, (uint16_t)words, 100);
  if (st != HAL_OK)
  {
    mini_printf("%s: HAL status %d, ErrorCode 0x%lX\r\n", name, (int)st, (unsigned long)hspi1.ErrorCode);
    return 0;
  }
  for (uint32_t i = 0; i < LOOP_LEN; i++)
  {
    if (rx[i] != tx[i])
    {
      mini_printf("%s: mismatch at byte %lu: sent 0x%02X got 0x%02X\r\n", name, (unsigned long)i, tx[i], rx[i]);
      return 0;
    }
  }
  return 1;
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
