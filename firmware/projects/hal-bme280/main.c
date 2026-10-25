/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-bme280 — GY-BME280 / GY-BMP280 on I2C1 with the Bosch
  *                   integer compensation.
  ******************************************************************************
  * Blue Pill, 72 MHz, SysTick 1 kHz. I2C1 PB6 (SCL) / PB7 (SDA) 100 kHz to a
  * GY-BME280 (or GY-BMP280) module at 0x76 (SDO pulled low on the module,
  * 10 kOhm pull-ups to its 3.3 V). USART1 PA9 115200 8N1.
  *
  * Boot: "BME280 on I2C1 (PB6 SCL / PB7 SDA)\r\n"; 10 ms for the sensor's
  * start-up (t_startup 2 ms); chip id (0xD0): 0x60 -> BME280, 0x58 -> BMP280
  * (no humidity), else "no BME280/BMP280 at 0x76" and idle. The trimming
  * parameters are read once (0x88..0xA1, and 0xE1..0xE7 on the BME280),
  * printed as "id=0x60 dig_T1=<n> dig_P1=<n> dig_H1=<n>\r\n".
  * Every 500 ms: ctrl_hum = x16 (BME280) and ctrl_meas = T x16, P x16,
  * forced mode; status.measuring is polled (1 ms steps, 150 ms timeout),
  * then 8 (6) bytes are burst-read from 0xF7 and converted with the
  * datasheet's own code (BME280 datasheet §4.2.3 / BMP280 §8.2):
  *   BME280_compensate_T_int32  -> 0.01 C
  *   BMP280_compensate_P_int64  -> Pa in Q24.8
  *   bme280_compensate_H_int32  -> %RH in Q22.10
  * and printed as "T=<C>.<cc> P=<Pa>.<pp> H=<%>.<hh>\r\n" (BMP280: no H).
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
/* USER CODE END PTD */

/* Private variables ---------------------------------------------------------*/
I2C_HandleTypeDef hi2c1;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
/* trimming parameters (datasheet Table 16) */
static uint16_t dig_T1;
static int16_t dig_T2, dig_T3;
static uint16_t dig_P1;
static int16_t dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
static uint8_t dig_H1, dig_H3;
static int16_t dig_H2, dig_H4, dig_H5;
static int8_t dig_H6;
static BME280_S32_t t_fine;
static int has_humidity;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_I2C1_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static HAL_StatusTypeDef bmx_read(uint8_t reg, uint8_t *buf, uint16_t n);
static HAL_StatusTypeDef bmx_write(uint8_t reg, uint8_t value);
static int read_trimming(void);
static BME280_S32_t BME280_compensate_T_int32(BME280_S32_t adc_T);
static BME280_U32_t BME280_compensate_P_int64(BME280_S32_t adc_P);
static BME280_U32_t bme280_compensate_H_int32(BME280_S32_t adc_H);
static void print_fixed(int32_t whole, uint32_t frac);
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
  mini_printf("BME280 on I2C1 (PB6 SCL / PB7 SDA)\r\n");
  HAL_Delay(10);
  uint8_t id = 0;
  if (bmx_read(BMX_ID, &id, 1) != HAL_OK || (id != BME280_CHIP_ID && id != BMP280_CHIP_ID))
  {
    mini_printf("no BME280/BMP280 at 0x76\r\n");
    while (1)
    {
      __WFI();
    }
  }
  has_humidity = id == BME280_CHIP_ID;
  if (!read_trimming())
  {
    mini_printf("trimming read failed\r\n");
    Error_Handler();
  }
  mini_printf("id=0x%02X dig_T1=%u dig_P1=%u dig_H1=%u\r\n", (unsigned)id, (unsigned)dig_T1, (unsigned)dig_P1, (unsigned)dig_H1);
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
    if (has_humidity && bmx_write(BMX_CTRL_HUM, OSRS_X16) != HAL_OK)
    {
      mini_printf("i2c error\r\n");
      continue;
    }
    /* ctrl_hum takes effect with this ctrl_meas write (BME280 §5.4.3) */
    if (bmx_write(BMX_CTRL_MEAS, (OSRS_X16 << 5) | (OSRS_X16 << 2) | MODE_FORCED) != HAL_OK)
    {
      mini_printf("i2c error\r\n");
      continue;
    }
    uint32_t t0 = HAL_GetTick();
    uint8_t status = 0x08;
    do
    {
      HAL_Delay(1);
      if (bmx_read(BMX_STATUS, &status, 1) != HAL_OK)
      {
        status = 0xFF;
        break;
      }
    } while ((status & 0x08) && HAL_GetTick() - t0 < CONVERSION_TIMEOUT_MS);
    if (status & 0x08)
    {
      mini_printf("conversion timeout\r\n");
      continue;
    }
    uint8_t d[8];
    if (bmx_read(BMX_DATA, d, has_humidity ? 8 : 6) != HAL_OK)
    {
      mini_printf("i2c error\r\n");
      continue;
    }
    BME280_S32_t adc_P = ((BME280_S32_t)d[0] << 12) | ((BME280_S32_t)d[1] << 4) | (d[2] >> 4);
    BME280_S32_t adc_T = ((BME280_S32_t)d[3] << 12) | ((BME280_S32_t)d[4] << 4) | (d[5] >> 4);
    BME280_S32_t t100 = BME280_compensate_T_int32(adc_T);
    BME280_U32_t p256 = BME280_compensate_P_int64(adc_P);
    mini_printf("T=");
    print_fixed(t100 / 100, (uint32_t)((t100 < 0 ? -t100 : t100) % 100));
    mini_printf(" P=%lu.%02lu", (unsigned long)(p256 >> 8), (unsigned long)(((p256 & 0xFFU) * 100U) >> 8));
    if (has_humidity)
    {
      BME280_S32_t adc_H = ((BME280_S32_t)d[6] << 8) | d[7];
      BME280_U32_t h1024 = bme280_compensate_H_int32(adc_H);
      mini_printf(" H=%lu.%02lu", (unsigned long)(h1024 >> 10), (unsigned long)(((h1024 & 0x3FFU) * 100U) >> 10));
    }
    mini_printf("\r\n");
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

static HAL_StatusTypeDef bmx_read(uint8_t reg, uint8_t *buf, uint16_t n)
{
  return HAL_I2C_Mem_Read(&hi2c1, BMX_ADDR, reg, I2C_MEMADD_SIZE_8BIT, buf, n, I2C_TIMEOUT_MS);
}

static HAL_StatusTypeDef bmx_write(uint8_t reg, uint8_t value)
{
  return HAL_I2C_Mem_Write(&hi2c1, BMX_ADDR, reg, I2C_MEMADD_SIZE_8BIT, &value, 1, I2C_TIMEOUT_MS);
}

/* Trimming parameters: little-endian words at 0x88.., humidity at 0xA1 / 0xE1.. (Table 16). */
static int read_trimming(void)
{
  uint8_t c[24];
  if (bmx_read(BMX_CALIB00, c, sizeof c) != HAL_OK)
  {
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
  if (has_humidity)
  {
    uint8_t h[7];
    if (bmx_read(BMX_CALIB_H1, &dig_H1, 1) != HAL_OK || bmx_read(BMX_CALIB26, h, sizeof h) != HAL_OK)
    {
      return 0;
    }
    dig_H2 = (int16_t)(h[0] | (h[1] << 8));
    dig_H3 = h[2];
    dig_H4 = (int16_t)(((int8_t)h[3] * 16) | (h[4] & 0x0F));
    dig_H5 = (int16_t)(((int8_t)h[5] * 16) | (h[4] >> 4));
    dig_H6 = (int8_t)h[6];
  }
  return 1;
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

/* Returns pressure in Pa as unsigned 32 bit integer in Q24.8 format (24 integer bits and 8 fractional bits).
   Output value of "24674867" represents 24674867/256 = 96386.2 Pa = 963.862 hPa */
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

/* Returns humidity in %RH as unsigned 32 bit integer in Q22.10 format (22 integer and 10 fractional bits).
   Output value of "47445" represents 47445/1024 = 46.333 %RH */
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

/* Print <whole>.<frac:02> keeping the sign of values between -1 and 0. */
static void print_fixed(int32_t whole, uint32_t frac)
{
  if (whole == 0 && t_fine < 0 && frac != 0)
  {
    mini_putchar('-');
  }
  mini_printf("%ld.%02lu", (long)whole, (unsigned long)frac);
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
