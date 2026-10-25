/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-sdcard — micro-SD card in SPI mode: initialization,
  *                   CSD, block 0 (MBR) and the FAT boot sector.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * SPI1 master, mode 0, MSB first: PA5 SCK, PA6 MISO (input pull-up),
  * PA7 MOSI; PA4 = CS (GPIO). SCK = 72 MHz / 256 = 281 kHz until the card
  * is initialized (SD spec: <= 400 kHz), then 72 MHz / 8 = 9 MHz.
  * The micro-SD module on 5 V (its regulator makes 3.3 V for the card).
  * USART1 PA9 (TX), 115200 8N1: report.
  *
  * Sequence (SD Physical Layer Simplified Spec. §7.2 / §7.3; report lines):
  *   "SD card SPI test (SPI1, CS PA4)\r\n"
  *   80 clocks with CS high (>= 74, §6.4.1.1)
  *   CMD0 (CRC 95h), up to 10 tries: "CMD0: idle (R1 0x01)\r\n"
  *     anything else: "CMD0: no card (R1 0xNN)\r\n", stop
  *   CMD8 (1AAh, CRC 87h): "CMD8: v2 card, echo 0x1AA\r\n" (or v1 / error)
  *   CMD55 + ACMD41 (HCS) every millisecond until R1 = 0:
  *     "ACMD41: ready after N tries\r\n"
  *   CMD58: "OCR 0xNNNNNNNN: SDHC (block addresses)\r\n" / "SDSC (byte addresses)"
  *   SCK -> 9 MHz
  *   CMD9: "CSD v2: M MiB\r\n" (v1: from C_SIZE / C_SIZE_MULT / READ_BL_LEN)
  *   CMD17 block 0 (data token FEh, CRC16 checked):
  *     "MBR: partition 1 type 0xTT at LBA L, S sectors\r\n"
  *     (a block 0 that is itself a FAT boot sector is used directly)
  *   CMD17 at the partition start: the BPB:
  *     "FAT32 volume \"LABEL\": 512 B/sector, 64 sectors/cluster,
  *      32 reserved, 2 FATs x F sectors, root cluster 2\r\n"
  *     (FAT16: "... root entries 512" instead of the root cluster)
  *   "sd ok\r\n" — any failure prints what failed and "sd FAILED\r\n".
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
static uint8_t block[512];
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_SPI1_Init(uint32_t prescaler);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static uint8_t xfer(uint8_t b);
static void cs(int high);
static uint8_t sd_cmd(uint8_t index, uint32_t arg, uint8_t crc, uint8_t *extra, uint32_t nextra);
static int sd_read_data(uint8_t *buf, uint32_t n);
static uint16_t crc16(const uint8_t *p, uint32_t n);
static uint32_t le32(const uint8_t *p);
static uint16_t le16(const uint8_t *p);
static void fail(const char *what);
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
  MX_SPI1_Init(SPI_BAUDRATEPRESCALER_256);
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("SD card SPI test (SPI1, CS PA4)\r\n");

  /* >= 74 clocks with CS high (and DI high) after power-up */
  cs(1);
  for (uint32_t i = 0; i < 10; i++)
  {
    xfer(0xFF);
  }

  uint8_t r1 = 0xFF;
  for (uint32_t i = 0; i < 10 && r1 != 0x01; i++)
  {
    r1 = sd_cmd(0, 0, 0x95, 0, 0);
  }
  if (r1 != 0x01)
  {
    mini_printf("CMD0: no card (R1 0x%02X)\r\n", r1);
    fail("init");
  }
  mini_printf("CMD0: idle (R1 0x01)\r\n");

  uint8_t r7[4];
  r1 = sd_cmd(8, 0x000001AA, 0x87, r7, 4);
  int v2 = 0;
  if (r1 == 0x01 && r7[2] == 0x01 && r7[3] == 0xAA)
  {
    v2 = 1;
    mini_printf("CMD8: v2 card, echo 0x1AA\r\n");
  }
  else if (r1 & 0x04)
  {
    mini_printf("CMD8: illegal command -> v1 card\r\n");
  }
  else
  {
    mini_printf("CMD8: unexpected R1 0x%02X\r\n", r1);
    fail("CMD8");
  }

  uint32_t tries = 0;
  do
  {
    tries++;
    sd_cmd(55, 0, 0x65, 0, 0);
    r1 = sd_cmd(41, v2 ? 0x40000000 : 0, 0x77, 0, 0);
    if (r1 != 0x00)
    {
      HAL_Delay(0);
    }
  } while (r1 == 0x01 && tries < ACMD41_TRIES);
  if (r1 != 0x00)
  {
    mini_printf("ACMD41: not ready (R1 0x%02X after %lu tries)\r\n", r1, (unsigned long)tries);
    fail("init");
  }
  mini_printf("ACMD41: ready after %lu tries\r\n", (unsigned long)tries);

  uint8_t ocr[4];
  sd_cmd(58, 0, 0xFD, ocr, 4);
  int sdhc = (ocr[0] & 0x40) != 0;
  mini_printf("OCR 0x%02X%02X%02X%02X: %s\r\n", ocr[0], ocr[1], ocr[2], ocr[3],
              sdhc ? "SDHC (block addresses)" : "SDSC (byte addresses)");

  /* initialized: full speed */
  MX_SPI1_Init(SPI_BAUDRATEPRESCALER_8);

  uint8_t csd[16];
  r1 = sd_cmd(9, 0, 0xAF, 0, 0);
  if (r1 != 0x00 || !sd_read_data(csd, 16))
  {
    fail("CMD9");
  }
  uint32_t mib;
  if ((csd[0] >> 6) == 1)
  {
    uint32_t csize = ((uint32_t)(csd[7] & 0x3F) << 16) | ((uint32_t)csd[8] << 8) | csd[9];
    mib = (csize + 1) / 2;
    mini_printf("CSD v2: %lu MiB\r\n", (unsigned long)mib);
  }
  else
  {
    uint32_t csize = ((uint32_t)(csd[6] & 0x03) << 10) | ((uint32_t)csd[7] << 2) | (csd[8] >> 6);
    uint32_t mult = ((csd[9] & 0x03) << 1) | (csd[10] >> 7);
    uint32_t bl = csd[5] & 0x0F;
    mib = ((csize + 1) << (mult + 2 + bl)) >> 20;
    mini_printf("CSD v1: %lu MiB\r\n", (unsigned long)mib);
  }

  /* block 0: MBR (or a superfloppy boot sector) */
  r1 = sd_cmd(17, 0, 0xFF, 0, 0);
  if (r1 != 0x00 || !sd_read_data(block, 512))
  {
    fail("CMD17 block 0");
  }
  if (block[510] != 0x55 || block[511] != 0xAA)
  {
    mini_printf("block 0: no 55AA signature\r\n");
    fail("MBR");
  }
  uint32_t lba = 0;
  if (!(block[0] == 0xEB || block[0] == 0xE9))
  {
    const uint8_t *e = &block[446];
    lba = le32(&e[8]);
    mini_printf("MBR: partition 1 type 0x%02X at LBA %lu, %lu sectors\r\n", e[4], (unsigned long)lba,
                (unsigned long)le32(&e[12]));
    r1 = sd_cmd(17, sdhc ? lba : lba * 512U, 0xFF, 0, 0);
    if (r1 != 0x00 || !sd_read_data(block, 512))
    {
      fail("CMD17 boot sector");
    }
  }

  /* BIOS parameter block */
  uint16_t bps = le16(&block[11]);
  uint8_t spc = block[13];
  uint16_t rsvd = le16(&block[14]);
  uint8_t nfats = block[16];
  uint16_t rootEnt = le16(&block[17]);
  uint16_t fat16sz = le16(&block[22]);
  char label[12];
  int fat32 = fat16sz == 0;
  const uint8_t *lab = fat32 ? &block[71] : &block[43];
  for (uint32_t i = 0; i < 11; i++)
  {
    label[i] = (char)lab[i];
  }
  label[11] = '\0';
  for (int i = 10; i >= 0 && label[i] == ' '; i--)
  {
    label[i] = '\0';
  }
  if (fat32)
  {
    mini_printf("FAT32 volume \"%s\": %u B/sector, %u sectors/cluster, %u reserved, %u FATs x %lu sectors, root cluster %lu\r\n",
                label, bps, spc, rsvd, nfats, (unsigned long)le32(&block[36]), (unsigned long)le32(&block[44]));
  }
  else
  {
    mini_printf("FAT16 volume \"%s\": %u B/sector, %u sectors/cluster, %u reserved, %u FATs x %u sectors, root entries %u\r\n",
                label, bps, spc, rsvd, nfats, fat16sz, rootEnt);
  }
  mini_printf("sd ok\r\n");
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

static uint8_t xfer(uint8_t b)
{
  uint8_t r = 0xFF;
  HAL_SPI_TransmitReceive(&hspi1, &b, &r, 1, 10);
  return r;
}

/** CS line level: 1 = high (deselected), 0 = low (selected). */
static void cs(int high)
{
  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, high ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

/**
  * One command with CS low: 6 command bytes, then up to 8 fill bytes for
  * R1 (Ncr), then `nextra` response bytes (R3 / R7). CS stays low when a
  * data block follows (CMD9 / CMD17: read it with sd_read_data), else it is
  * released with one trailing clock byte.
  */
static uint8_t sd_cmd(uint8_t index, uint32_t arg, uint8_t crc, uint8_t *extra, uint32_t nextra)
{
  cs(1);
  xfer(0xFF);
  cs(0);
  xfer(0x40 | index);
  xfer((uint8_t)(arg >> 24));
  xfer((uint8_t)(arg >> 16));
  xfer((uint8_t)(arg >> 8));
  xfer((uint8_t)arg);
  xfer(crc);
  uint8_t r1 = 0xFF;
  for (uint32_t i = 0; i < 8 && (r1 & 0x80); i++)
  {
    r1 = xfer(0xFF);
  }
  for (uint32_t i = 0; i < nextra; i++)
  {
    extra[i] = xfer(0xFF);
  }
  if (!(index == 9 || index == 17) || r1 != 0x00)
  {
    cs(1);
    xfer(0xFF);
  }
  return r1;
}

/** Wait for the FEh data token, read n bytes and check the CRC16; CS released after. */
static int sd_read_data(uint8_t *buf, uint32_t n)
{
  uint8_t tok = 0xFF;
  uint32_t t0 = HAL_GetTick();
  while (tok == 0xFF && HAL_GetTick() - t0 < 100)
  {
    tok = xfer(0xFF);
  }
  if (tok != 0xFE)
  {
    mini_printf("no data token (0x%02X)\r\n", tok);
    cs(1);
    return 0;
  }
  for (uint32_t i = 0; i < n; i++)
  {
    buf[i] = xfer(0xFF);
  }
  uint16_t crc = (uint16_t)((xfer(0xFF) << 8) | xfer(0xFF));
  cs(1);
  xfer(0xFF);
  if (crc != crc16(buf, n))
  {
    mini_printf("data CRC16 mismatch\r\n");
    return 0;
  }
  return 1;
}

/** CRC16-CCITT (x^16 + x^12 + x^5 + 1, initial 0) of SD data blocks (§7.3.4). */
static uint16_t crc16(const uint8_t *p, uint32_t n)
{
  uint16_t crc = 0;
  for (uint32_t k = 0; k < n; k++)
  {
    crc ^= (uint16_t)(p[k] << 8);
    for (int i = 0; i < 8; i++)
    {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}

static uint32_t le32(const uint8_t *p)
{
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t le16(const uint8_t *p)
{
  return (uint16_t)(p[0] | (p[1] << 8));
}

static void fail(const char *what)
{
  (void)what;
  mini_printf("sd FAILED\r\n");
  while (1)
  {
    __WFI();
  }
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
  * @brief SPI1 Initialization Function: master, mode 0, the given prescaler.
  */
static void MX_SPI1_Init(uint32_t prescaler)
{
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_2LINES;
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = prescaler;
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
