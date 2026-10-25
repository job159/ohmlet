/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : lesson-a7-i2c-multi — three I2C devices on ONE bus:
  *                   an AT24C02 EEPROM (0x50), an MPU-6050 on a GY-521
  *                   module (0x68) and a BME280 on a GY-BME280 module (0x76).
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 PB6 (SCL) / PB7 (SDA), AF open drain, 100 kHz standard mode. The
  * AT24C02 has NO pull-up resistors; the GY-521 brings 4.7 kOhm and the
  * GY-BME280 10 kOhm pull-ups on SCL and SDA (all of them in parallel on the
  * shared bus). USART1 PA9 (TX) 115200 8N1: the report.
  *
  * Boot: "I2C1 multi-device bus, lesson a7 (PB6 SCL / PB7 SDA, 100 kHz)\r\n",
  * 10 ms start-up time for the sensors, then once per CYCLE_MS (1 s):
  *  1. scan 0x08-0x77 with HAL_I2C_IsDeviceReady (1 trial; a NACKed probe is
  *     about 115 us on the bus). HAL_BUSY (SR2.BUSY never clears: SDA / SCL
  *     never read high — no pull-up on the bus, or an unpowered module
  *     holding the lines low) -> "bus busy: SDA/SCL stuck low (no pull-up on
  *     the bus?)\r\n" once when the bus becomes busy; the I2C peripheral is
  *     reset (HAL_I2C_DeInit + HAL_I2C_Init: SWRST) and the next cycle
  *     scans again, so the bus comes back by itself once it is fixed.
  *  2. when the set of answering addresses differs from the last one
  *     reported: "scan: 0x50 0x68 0x76 (3 devices)\r\n" (every answering
  *     address in order) and each of the three devices is set up:
  *       AT24C02  read 8 bytes at 0x20, write their complement (one page
  *                write), ACK polling through the self-timed write cycle,
  *                read back: "AT24C02 @0x50: page write 8 B, ready after P
  *                polls, read back ok\r\n" (P about 45 for 5 ms)
  *       MPU-6050 WHO_AM_I, then PWR_MGMT_1 = 0x00 (it powers up asleep),
  *                1 kHz sampling, +-2 g, +-250 dps: "MPU-6050 @0x68:
  *                WHO_AM_I=0x68, awake\r\n"
  *       BME280   chip id and trimming parameters: "BME280 @0x76: id=0x60,
  *                calibration read\r\n"
  *     a device that does not acknowledge: "<name> @0x<addr>: no ACK\r\n",
  *     the MPU-6050 with 0x69 answering instead: "MPU-6050 @0x68: no ACK
  *     (0x69 answers: AD0 is high)\r\n"; then "all 3 devices ok\r\n" or
  *     "<n> of 3 devices ok\r\n".
  *  3. the readings of the working sensors (forced BME280 conversion,
  *     oversampling x1, then one 14-byte MPU-6050 burst):
  *     "read: ax=<raw> ay=<raw> az=<raw> | T=<C> C P=<hPa> hPa H=<%> %\r\n"
  *     (raw = g x 16384; P and H fractions truncated to 0.01).
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "mini_printf.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */
typedef int32_t BME280_S32_t;
typedef uint32_t BME280_U32_t;
typedef int64_t BME280_S64_t;

/** one device of the lesson's bus */
typedef struct
{
  const char *name;
  uint8_t addr7;
  int (*setup)(void); /* 1 = works */
  int ok;
} Device;
/* USER CODE END PTD */

/* Private variables ---------------------------------------------------------*/
I2C_HandleTypeDef hi2c1;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
/* BME280 trimming parameters (datasheet Table 16) */
static uint16_t dig_T1;
static int16_t dig_T2, dig_T3;
static uint16_t dig_P1;
static int16_t dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
static uint8_t dig_H1, dig_H3;
static int16_t dig_H2, dig_H4, dig_H5;
static int8_t dig_H6;
static BME280_S32_t t_fine;

/** answering addresses of the last scan that was reported: one bit per 7-bit address */
static uint32_t shown[4];
static int shown_valid;
static uint32_t found[4];
static int bus_was_busy;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_I2C1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static int Scan(void);
static int Has(uint32_t addr7);
static int SetupEeprom(void);
static int SetupImu(void);
static int SetupEnv(void);
static void PrintReadings(void);
static HAL_StatusTypeDef RegRead(uint8_t addr7, uint8_t reg, uint8_t *buf, uint16_t n);
static HAL_StatusTypeDef RegWrite(uint8_t addr7, uint8_t reg, uint8_t value);
static BME280_S32_t BME280_compensate_T_int32(BME280_S32_t adc_T);
static BME280_U32_t BME280_compensate_P_int64(BME280_S32_t adc_P);
static BME280_U32_t bme280_compensate_H_int32(BME280_S32_t adc_H);
/* USER CODE END PFP */

/* USER CODE BEGIN 0 */
static Device devices[] = {
  {"AT24C02", EE_ADDR7, SetupEeprom, 0},
  {"MPU-6050", IMU_ADDR7, SetupImu, 0},
  {"BME280", ENV_ADDR7, SetupEnv, 0},
};
#define DEVICE_COUNT (sizeof(devices) / sizeof(devices[0]))
/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* MCU Configuration--------------------------------------------------------*/
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_I2C1_Init();
  MX_USART1_UART_Init();

  /* USER CODE BEGIN 2 */
  mini_printf("I2C1 multi-device bus, lesson a7 (PB6 SCL / PB7 SDA, 100 kHz)\r\n");
  HAL_Delay(10); /* sensor start-up time (BME280 2 ms, MPU-6050 register access) */
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
    next += CYCLE_MS;

    if (!Scan())
    {
      /* a busy bus: report it once, reset the peripheral, try again next cycle */
      if (!bus_was_busy)
      {
        mini_printf("bus busy: SDA/SCL stuck low (no pull-up on the bus?)\r\n");
      }
      bus_was_busy = 1;
      shown_valid = 0;
      for (uint32_t k = 0; k < DEVICE_COUNT; k++)
      {
        devices[k].ok = 0;
      }
      (void)HAL_I2C_DeInit(&hi2c1);
      MX_I2C1_Init();
      continue;
    }
    bus_was_busy = 0;

    int changed = !shown_valid;
    for (uint32_t w = 0; w < 4; w++)
    {
      changed |= found[w] != shown[w];
    }
    if (changed)
    {
      uint32_t n = 0;
      mini_printf("scan:");
      for (uint32_t a = SCAN_FIRST; a <= SCAN_LAST; a++)
      {
        if (Has(a))
        {
          mini_printf(" 0x%02lX", (unsigned long)a);
          n++;
        }
      }
      if (n == 1U)
      {
        mini_printf(" (1 device)\r\n");
      }
      else
      {
        mini_printf(" (%lu devices)\r\n", (unsigned long)n);
      }
      for (uint32_t w = 0; w < 4; w++)
      {
        shown[w] = found[w];
      }
      shown_valid = 1;

      uint32_t ok = 0;
      for (uint32_t k = 0; k < DEVICE_COUNT; k++)
      {
        Device *d = &devices[k];
        d->ok = 0;
        if (!Has(d->addr7))
        {
          if (d->addr7 == IMU_ADDR7 && Has(IMU_ADDR7 + 1U))
          {
            mini_printf("%s @0x%02X: no ACK (0x%02X answers: AD0 is high)\r\n", d->name, (unsigned)d->addr7, (unsigned)(IMU_ADDR7 + 1U));
          }
          else
          {
            mini_printf("%s @0x%02X: no ACK\r\n", d->name, (unsigned)d->addr7);
          }
          continue;
        }
        d->ok = d->setup();
        ok += (uint32_t)d->ok;
      }
      if (ok == DEVICE_COUNT)
      {
        mini_printf("all %u devices ok\r\n", (unsigned)DEVICE_COUNT);
      }
      else
      {
        mini_printf("%lu of %u devices ok\r\n", (unsigned long)ok, (unsigned)DEVICE_COUNT);
      }
    }
    PrintReadings();
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
  * @brief I2C1 Initialization Function: 100 kHz standard mode.
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

static int Has(uint32_t addr7)
{
  return (found[addr7 >> 5] >> (addr7 & 31U)) & 1U;
}

/* Probe 0x08..0x77 into found[]; 0 = the bus is busy (the scan stopped). */
static int Scan(void)
{
  for (uint32_t w = 0; w < 4; w++)
  {
    found[w] = 0;
  }
  for (uint32_t a = SCAN_FIRST; a <= SCAN_LAST; a++)
  {
    const HAL_StatusTypeDef st = HAL_I2C_IsDeviceReady(&hi2c1, (uint16_t)(a << 1), 1, SCAN_TIMEOUT_MS);
    if (st == HAL_OK)
    {
      found[a >> 5] |= 1UL << (a & 31U);
    }
    else if (st == HAL_BUSY)
    {
      return 0;
    }
    /* HAL_ERROR: no acknowledge (AF) -> nothing at this address */
  }
  return 1;
}

static HAL_StatusTypeDef RegRead(uint8_t addr7, uint8_t reg, uint8_t *buf, uint16_t n)
{
  return HAL_I2C_Mem_Read(&hi2c1, (uint16_t)(addr7 << 1), reg, I2C_MEMADD_SIZE_8BIT, buf, n, I2C_TIMEOUT_MS);
}

static HAL_StatusTypeDef RegWrite(uint8_t addr7, uint8_t reg, uint8_t value)
{
  return HAL_I2C_Mem_Write(&hi2c1, (uint16_t)(addr7 << 1), reg, I2C_MEMADD_SIZE_8BIT, &value, 1, I2C_TIMEOUT_MS);
}

/* AT24C02: one page write of the complement of the old contents (the data
   always changes), ACK polling through the write cycle, read back. */
static int SetupEeprom(void)
{
  uint8_t old[EE_LEN], wr[EE_LEN], rd[EE_LEN];
  if (RegRead(EE_ADDR7, EE_START, old, EE_LEN) != HAL_OK)
  {
    mini_printf("AT24C02 @0x50: read error\r\n");
    return 0;
  }
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    wr[i] = (uint8_t)~old[i];
  }
  if (HAL_I2C_Mem_Write(&hi2c1, EE_ADDR7 << 1, EE_START, I2C_MEMADD_SIZE_8BIT, wr, EE_LEN, I2C_TIMEOUT_MS) != HAL_OK)
  {
    mini_printf("AT24C02 @0x50: write error\r\n");
    return 0;
  }
  const uint32_t t0 = HAL_GetTick();
  uint32_t polls = 0;
  while (HAL_I2C_IsDeviceReady(&hi2c1, EE_ADDR7 << 1, 1, SCAN_TIMEOUT_MS) != HAL_OK)
  {
    polls++;
    if (HAL_GetTick() - t0 > EE_WRITE_TIMEOUT_MS)
    {
      mini_printf("AT24C02 @0x50: write cycle did not end\r\n");
      return 0;
    }
  }
  if (RegRead(EE_ADDR7, EE_START, rd, EE_LEN) != HAL_OK)
  {
    mini_printf("AT24C02 @0x50: read back error\r\n");
    return 0;
  }
  for (uint32_t i = 0; i < EE_LEN; i++)
  {
    if (rd[i] != wr[i])
    {
      mini_printf("AT24C02 @0x50: mismatch at 0x%02lX: wrote 0x%02X read 0x%02X\r\n", (unsigned long)(EE_START + i),
                  (unsigned)wr[i], (unsigned)rd[i]);
      return 0;
    }
  }
  mini_printf("AT24C02 @0x50: page write %u B, ready after %lu polls, read back ok\r\n", (unsigned)EE_LEN, (unsigned long)polls);
  return 1;
}

/* MPU-6050: WHO_AM_I, wake up (it powers up with SLEEP set), 1 kHz sampling, +-2 g, +-250 dps. */
static int SetupImu(void)
{
  uint8_t who = 0;
  if (RegRead(IMU_ADDR7, MPU_WHO_AM_I, &who, 1) != HAL_OK)
  {
    mini_printf("MPU-6050 @0x68: read error\r\n");
    return 0;
  }
  if (RegWrite(IMU_ADDR7, MPU_PWR_MGMT_1, 0x00) != HAL_OK || RegWrite(IMU_ADDR7, MPU_CONFIG, 0x01) != HAL_OK ||
      RegWrite(IMU_ADDR7, MPU_SMPLRT_DIV, 0x00) != HAL_OK || RegWrite(IMU_ADDR7, MPU_GYRO_CONFIG, 0x00) != HAL_OK ||
      RegWrite(IMU_ADDR7, MPU_ACCEL_CONFIG, 0x00) != HAL_OK)
  {
    mini_printf("MPU-6050 @0x68: write error\r\n");
    return 0;
  }
  mini_printf("MPU-6050 @0x68: WHO_AM_I=0x%02X, awake\r\n", (unsigned)who);
  return who == 0x68U;
}

/* BME280: chip id and the trimming parameters (little-endian words at 0x88.., humidity at 0xA1 / 0xE1..). */
static int SetupEnv(void)
{
  uint8_t id = 0;
  uint8_t c[24];
  uint8_t h[7];
  if (RegRead(ENV_ADDR7, BMX_ID, &id, 1) != HAL_OK || id != BME280_CHIP_ID)
  {
    mini_printf("BME280 @0x76: chip id 0x%02X, not a BME280\r\n", (unsigned)id);
    return 0;
  }
  if (RegRead(ENV_ADDR7, BMX_CALIB00, c, sizeof c) != HAL_OK || RegRead(ENV_ADDR7, BMX_CALIB_H1, &dig_H1, 1) != HAL_OK ||
      RegRead(ENV_ADDR7, BMX_CALIB26, h, sizeof h) != HAL_OK)
  {
    mini_printf("BME280 @0x76: calibration read error\r\n");
    return 0;
  }
  dig_T1 = (uint16_t)(c[0] | (c[1] << 8));
  dig_T2 = (int16_t)(c[2] | (c[3] << 8));
  dig_T3 = (int16_t)(c[4] | (c[5] << 8));
  dig_P1 = (uint16_t)(c[6] | (c[7] << 8));
  dig_P2 = (int16_t)(c[8] | (c[9] << 8));
  dig_P3 = (int16_t)(c[10] | (c[11] << 8));
  dig_P4 = (int16_t)(c[12] | (c[13] << 8));
  dig_P5 = (int16_t)(c[14] | (c[15] << 8));
  dig_P6 = (int16_t)(c[16] | (c[17] << 8));
  dig_P7 = (int16_t)(c[18] | (c[19] << 8));
  dig_P8 = (int16_t)(c[20] | (c[21] << 8));
  dig_P9 = (int16_t)(c[22] | (c[23] << 8));
  dig_H2 = (int16_t)(h[0] | (h[1] << 8));
  dig_H3 = h[2];
  dig_H4 = (int16_t)(((int8_t)h[3] * 16) | (h[4] & 0x0F));
  dig_H5 = (int16_t)(((int8_t)h[5] * 16) | (h[4] >> 4));
  dig_H6 = (int8_t)h[6];
  mini_printf("BME280 @0x76: id=0x%02X, calibration read\r\n", (unsigned)id);
  return 1;
}

/* One line with the readings of the working sensors. */
static void PrintReadings(void)
{
  const int imu = devices[1].ok;
  const int env = devices[2].ok;
  if (!imu && !env)
  {
    return;
  }
  int32_t t100 = 0;
  uint32_t p256 = 0, h1024 = 0;
  int env_read = 0;
  if (env)
  {
    uint8_t status = 0x08;
    uint8_t d[8];
    if (RegWrite(ENV_ADDR7, BMX_CTRL_HUM, OSRS_X1) == HAL_OK &&
        RegWrite(ENV_ADDR7, BMX_CTRL_MEAS, (OSRS_X1 << 5) | (OSRS_X1 << 2) | MODE_FORCED) == HAL_OK)
    {
      const uint32_t t0 = HAL_GetTick();
      do
      {
        HAL_Delay(1);
        if (RegRead(ENV_ADDR7, BMX_STATUS, &status, 1) != HAL_OK)
        {
          status = 0xFF;
          break;
        }
      } while ((status & 0x08) && HAL_GetTick() - t0 < CONVERSION_TIMEOUT_MS);
      if (!(status & 0x08) && RegRead(ENV_ADDR7, BMX_DATA, d, 8) == HAL_OK)
      {
        const BME280_S32_t adc_P = ((BME280_S32_t)d[0] << 12) | ((BME280_S32_t)d[1] << 4) | (d[2] >> 4);
        const BME280_S32_t adc_T = ((BME280_S32_t)d[3] << 12) | ((BME280_S32_t)d[4] << 4) | (d[5] >> 4);
        const BME280_S32_t adc_H = ((BME280_S32_t)d[6] << 8) | d[7];
        t100 = BME280_compensate_T_int32(adc_T);
        p256 = BME280_compensate_P_int64(adc_P);
        h1024 = bme280_compensate_H_int32(adc_H);
        env_read = 1;
      }
    }
  }
  uint8_t m[6];
  const int imu_read = imu && RegRead(IMU_ADDR7, MPU_ACCEL_XOUT_H, m, 6) == HAL_OK;

  mini_printf("read:");
  if (imu)
  {
    if (imu_read)
    {
      mini_printf(" ax=%d ay=%d az=%d", (int)(int16_t)((m[0] << 8) | m[1]), (int)(int16_t)((m[2] << 8) | m[3]),
                  (int)(int16_t)((m[4] << 8) | m[5]));
    }
    else
    {
      mini_printf(" MPU-6050 read error");
    }
  }
  if (env)
  {
    mini_printf(imu ? " |" : "");
    if (env_read)
    {
      const uint32_t pa = p256 >> 8;
      const int32_t whole = t100 / 100;
      const uint32_t frac = (uint32_t)((t100 < 0 ? -t100 : t100) % 100);
      mini_printf(" T=%s%ld.%02lu C P=%lu.%02lu hPa H=%lu.%02lu %%", (t100 < 0 && whole == 0) ? "-" : "", (long)whole,
                  (unsigned long)frac, (unsigned long)(pa / 100U), (unsigned long)(pa % 100U), (unsigned long)(h1024 >> 10),
                  (unsigned long)(((h1024 & 0x3FFU) * 100U) >> 10));
    }
    else
    {
      mini_printf(" BME280 read error");
    }
  }
  mini_printf("\r\n");
}

/* Returns temperature in DegC, resolution is 0.01 DegC. Output value of "5123" equals 51.23 DegC.
   t_fine carries fine temperature as global value (BME280 datasheet §4.2.3). */
static BME280_S32_t BME280_compensate_T_int32(BME280_S32_t adc_T)
{
  BME280_S32_t var1, var2, T;
  var1 = ((((adc_T >> 3) - ((BME280_S32_t)dig_T1 << 1))) * ((BME280_S32_t)dig_T2)) >> 11;
  var2 = (((((adc_T >> 4) - ((BME280_S32_t)dig_T1)) * ((adc_T >> 4) - ((BME280_S32_t)dig_T1))) >> 12) *
          ((BME280_S32_t)dig_T3)) >> 14;
  t_fine = var1 + var2;
  T = (t_fine * 5 + 128) >> 8;
  return T;
}

/* Returns pressure in Pa as unsigned 32 bit integer in Q24.8 format (24 integer bits and 8 fractional bits). */
static BME280_U32_t BME280_compensate_P_int64(BME280_S32_t adc_P)
{
  BME280_S64_t var1, var2, p;
  var1 = ((BME280_S64_t)t_fine) - 128000;
  var2 = var1 * var1 * (BME280_S64_t)dig_P6;
  var2 = var2 + ((var1 * (BME280_S64_t)dig_P5) << 17);
  var2 = var2 + (((BME280_S64_t)dig_P4) << 35);
  var1 = ((var1 * var1 * (BME280_S64_t)dig_P3) >> 8) + ((var1 * (BME280_S64_t)dig_P2) << 12);
  var1 = (((((BME280_S64_t)1) << 47) + var1)) * ((BME280_S64_t)dig_P1) >> 33;
  if (var1 == 0)
  {
    return 0; /* avoid exception caused by division by zero */
  }
  p = 1048576 - adc_P;
  p = (((p << 31) - var2) * 3125) / var1;
  var1 = (((BME280_S64_t)dig_P9) * (p >> 13) * (p >> 13)) >> 25;
  var2 = (((BME280_S64_t)dig_P8) * p) >> 19;
  p = ((p + var1 + var2) >> 8) + (((BME280_S64_t)dig_P7) << 4);
  return (BME280_U32_t)p;
}

/* Returns humidity in %RH as unsigned 32 bit integer in Q22.10 format (22 integer and 10 fractional bits). */
static BME280_U32_t bme280_compensate_H_int32(BME280_S32_t adc_H)
{
  BME280_S32_t v_x1_u32r;
  v_x1_u32r = (t_fine - ((BME280_S32_t)76800));
  v_x1_u32r = (((((adc_H << 14) - (((BME280_S32_t)dig_H4) << 20) - (((BME280_S32_t)dig_H5) * v_x1_u32r)) +
                 ((BME280_S32_t)16384)) >> 15) *
               (((((((v_x1_u32r * ((BME280_S32_t)dig_H6)) >> 10) *
                    (((v_x1_u32r * ((BME280_S32_t)dig_H3)) >> 11) + ((BME280_S32_t)32768))) >> 10) +
                  ((BME280_S32_t)2097152)) * ((BME280_S32_t)dig_H2) + 8192) >> 14));
  v_x1_u32r = (v_x1_u32r - (((((v_x1_u32r >> 15) * (v_x1_u32r >> 15)) >> 7) * ((BME280_S32_t)dig_H1)) >> 4));
  v_x1_u32r = (v_x1_u32r < 0 ? 0 : v_x1_u32r);
  v_x1_u32r = (v_x1_u32r > 419430400 ? 419430400 : v_x1_u32r);
  return (BME280_U32_t)(v_x1_u32r >> 12);
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
