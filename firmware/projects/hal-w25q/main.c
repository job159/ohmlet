/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-w25q — W25Q32 SPI NOR flash: JEDEC ID, sector erase,
  *                   page program, read back (03h and 0Bh).
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * SPI1 master, mode 0, MSB first, 8-bit, SCK = 72 MHz / 8 = 9 MHz:
  *   PA5 SCK -> CLK, PA6 MISO <- DO (input pull-up), PA7 MOSI -> DI,
  *   PA4 -> CS (GPIO, high when idle). WP and HOLD tied to 3.3 V, VCC 3.3 V.
  * USART1 PA9 (TX), 115200 8N1: report.
  *
  * Report:
  *   "W25Q32 test (SPI1 9 MHz mode 0, CS PA4)\r\n"
  *   JEDEC ID (9Fh): "JEDEC ID EF 40 16\r\n" — any other answer:
  *     "no W25Q32: JEDEC ID xx xx xx\r\n" and the core sleeps
  *   "SR1 0xNN\r\n" (status register 1)
  *   "before: <16 bytes at 0x001000 in hex>\r\n" (FF.. when erased)
  *   06h + 20h 001000h, BUSY polled with 05h every millisecond:
  *     "sector erase: busy T ms\r\n"   (T = 45: tSE typ)
  *   06h + 02h 001000h with 64 bytes (i * 3 + 1):
  *     "page program 64 bytes: busy for N status reads\r\n"
  *   03h read back + 0Bh fast read compare:
  *     "read back ok\r\n" or "mismatch at 0xAAAAAA: wrote WW read RR\r\n"
  *   "w25q ok\r\n" (all steps passed) or "w25q FAILED\r\n"
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

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_SPI1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void cs(int high);
static void flash_cmd(const uint8_t *tx, uint32_t ntx, uint8_t *rx, uint32_t nrx);
static uint8_t flash_status(void);
static void flash_write_enable(void);
static void flash_read(uint8_t cmd, uint32_t addr, uint8_t *buf, uint32_t n);
/* USER CODE END PFP */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_SPI1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("W25Q32 test (SPI1 9 MHz mode 0, CS PA4)\r\n");
  uint8_t id[3];
  const uint8_t jedec = 0x9F;
  flash_cmd(&jedec, 1, id, 3);
  if (id[0] != 0xEF || id[1] != 0x40 || id[2] != 0x16)
  {
    mini_printf("no W25Q32: JEDEC ID %02X %02X %02X\r\n", id[0], id[1], id[2]);
    while (1)
    {
      __WFI();
    }
  }
  mini_printf("JEDEC ID %02X %02X %02X\r\n", id[0], id[1], id[2]);
  mini_printf("SR1 0x%02X\r\n", flash_status());

  uint8_t buf[TEST_LEN];
  flash_read(0x03, TEST_ADDR, buf, 16);
  mini_printf("before:");
  for (uint32_t i = 0; i < 16; i++)
  {
    mini_printf(" %02X", buf[i]);
  }
  mini_printf("\r\n");

  int ok = 1;

  /* sector erase 4 KiB at TEST_ADDR, BUSY polled every millisecond */
  flash_write_enable();
  uint8_t se[4] = {0x20, (uint8_t)(TEST_ADDR >> 16), (uint8_t)(TEST_ADDR >> 8), (uint8_t)TEST_ADDR};
  flash_cmd(se, 4, 0, 0);
  uint32_t t0 = HAL_GetTick();
  while (flash_status() & 0x01)
  {
    HAL_Delay(0);
  }
  mini_printf("sector erase: busy %lu ms\r\n", (unsigned long)(HAL_GetTick() - t0));

  /* page program TEST_LEN bytes */
  uint8_t pp[4 + TEST_LEN];
  pp[0] = 0x02;
  pp[1] = (uint8_t)(TEST_ADDR >> 16);
  pp[2] = (uint8_t)(TEST_ADDR >> 8);
  pp[3] = (uint8_t)TEST_ADDR;
  for (uint32_t i = 0; i < TEST_LEN; i++)
  {
    pp[4 + i] = (uint8_t)(i * 3 + 1);
  }
  flash_write_enable();
  flash_cmd(pp, sizeof(pp), 0, 0);
  uint32_t polls = 0;
  while (flash_status() & 0x01)
  {
    polls++;
  }
  mini_printf("page program %u bytes: busy for %lu status reads\r\n", (unsigned)TEST_LEN, (unsigned long)polls);

  /* read back: normal read and fast read */
  for (uint32_t pass = 0; pass < 2 && ok; pass++)
  {
    flash_read(pass == 0 ? 0x03 : 0x0B, TEST_ADDR, buf, TEST_LEN);
    for (uint32_t i = 0; i < TEST_LEN; i++)
    {
      if (buf[i] != (uint8_t)(i * 3 + 1))
      {
        mini_printf("mismatch at 0x%06lX: wrote %02X read %02X\r\n", (unsigned long)(TEST_ADDR + i), (unsigned)(uint8_t)(i * 3 + 1), buf[i]);
        ok = 0;
        break;
      }
    }
  }
  if (ok)
  {
    mini_printf("read back ok\r\n");
  }
  mini_printf(ok ? "w25q ok\r\n" : "w25q FAILED\r\n");
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

/* USER CODE BEGIN 4 */

/** CS line level: 1 = high (deselected), 0 = low (selected). */
static void cs(int high)
{
  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, high ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

/** One CS-framed instruction: send ntx bytes, then clock in nrx bytes. */
static void flash_cmd(const uint8_t *tx, uint32_t ntx, uint8_t *rx, uint32_t nrx)
{
  cs(1);
  cs(0);
  HAL_SPI_Transmit(&hspi1, (uint8_t *)tx, (uint16_t)ntx, 100);
  if (nrx > 0)
  {
    HAL_SPI_Receive(&hspi1, rx, (uint16_t)nrx, 100);
  }
  cs(1);
}

static uint8_t flash_status(void)
{
  const uint8_t c = 0x05;
  uint8_t sr = 0xFF;
  flash_cmd(&c, 1, &sr, 1);
  return sr;
}

static void flash_write_enable(void)
{
  const uint8_t c = 0x06;
  flash_cmd(&c, 1, 0, 0);
}

/** 03h read or 0Bh fast read (one dummy byte) of n bytes at addr. */
static void flash_read(uint8_t cmd, uint32_t addr, uint8_t *buf, uint32_t n)
{
  uint8_t h[5] = {cmd, (uint8_t)(addr >> 16), (uint8_t)(addr >> 8), (uint8_t)addr, 0x00};
  flash_cmd(h, cmd == 0x0B ? 5 : 4, buf, n);
}

/* mini_printf() sink: blocking USART1 transmit (report). */
void mini_putchar(char c)
{
  HAL_UART_Transmit(&huart1, (const uint8_t *)&c, 1, 10);
}

/* USER CODE END 4 */

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

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
  * @brief SPI1 Initialization Function: master, mode 0, 9 MHz.
  */
static void MX_SPI1_Init(void)
{
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
  * @brief USART1 Initialization Function (report)
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
  * @brief GPIO Initialization Function: PA4 = CS, high (deselected).
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();

  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_SET);
  GPIO_InitStruct.Pin = GPIO_PIN_4;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
}

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}

#ifdef  USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line)
{
  (void)file;
  (void)line;
}
#endif /* USE_FULL_ASSERT */
