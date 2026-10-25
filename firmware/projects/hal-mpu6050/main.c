/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-mpu6050 — GY-521 (MPU-6050) accelerometer / gyro over I2C1.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 on PB6 (SCL) / PB7 (SDA), 100 kHz standard mode, to a GY-521 module
  * (MPU-6050 at 0x68: AD0 is pulled down on the module; the module has its
  * own 4.7 kOhm pull-ups to 3.3 V). USART1 PA9 (TX) 115200 8N1.
  *
  * Boot:
  *   "MPU-6050 on I2C1 (PB6 SCL / PB7 SDA)\r\n"
  *   WHO_AM_I (0x75) read with HAL_I2C_Mem_Read:
  *     no acknowledge -> "MPU-6050 not found at 0x68\r\n", then idle;
  *     else            -> "WHO_AM_I=0x68\r\n".
  *   The MPU-6050 powers up in SLEEP mode (PWR_MGMT_1 = 0x40, RM §4.28).
  *   Unless PB12 is tied to GND (input pull-up: the "forgot to wake it"
  *   lab exercise), the firmware wakes it and configures:
  *     PWR_MGMT_1   = 0x00  SLEEP cleared, internal 8 MHz oscillator
  *     CONFIG       = 0x03  DLPF 44 Hz -> gyro output rate 1 kHz
  *     SMPLRT_DIV   = 9     sample rate 1 kHz / (1 + 9) = 100 Hz
  *     GYRO_CONFIG  = 0x00  +-250 deg/s  (131 LSB per deg/s)
  *     ACCEL_CONFIG = 0x00  +-2 g        (16384 LSB per g)
  *   and prints "awake: +-2 g, +-250 dps, 100 Hz\r\n"; with PB12 low it
  *   prints "PB12 low: PWR_MGMT_1 not written, the sensor stays asleep\r\n".
  * Every 100 ms (deadline based) one 14-byte burst read from ACCEL_XOUT_H
  * (0x3B) returns accel X/Y/Z, temperature and gyro X/Y/Z of ONE sample
  * (big-endian int16) and the firmware prints the raw counts and the
  * temperature (T = raw / 340 + 36.53 C, RM §4.18) in 0.01 C:
  *   "ax=<n> ay=<n> az=<n> gx=<n> gy=<n> gz=<n> t=<C>.<cc>\r\n"
  * A failed transfer prints "i2c error <HAL status>\r\n" for that period.
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
/* USER CODE BEGIN PFP */
static HAL_StatusTypeDef mpu_write(uint8_t reg, uint8_t value);
static void print_centi(int32_t v);
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
  mini_printf("MPU-6050 on I2C1 (PB6 SCL / PB7 SDA)\r\n");
  uint8_t who = 0;
  if (HAL_I2C_Mem_Read(&hi2c1, MPU_ADDR, MPU_WHO_AM_I, I2C_MEMADD_SIZE_8BIT, &who, 1, I2C_TIMEOUT_MS) != HAL_OK)
  {
    mini_printf("MPU-6050 not found at 0x68\r\n");
    while (1)
    {
      __WFI();
    }
  }
  mini_printf("WHO_AM_I=0x%02X\r\n", (unsigned)who);

  if (HAL_GPIO_ReadPin(NOWAKE_GPIO_Port, NOWAKE_Pin) == GPIO_PIN_SET)
  {
    if (mpu_write(MPU_PWR_MGMT_1, 0x00) != HAL_OK || mpu_write(MPU_CONFIG, 0x03) != HAL_OK ||
        mpu_write(MPU_SMPLRT_DIV, 9) != HAL_OK || mpu_write(MPU_GYRO_CONFIG, 0x00) != HAL_OK ||
        mpu_write(MPU_ACCEL_CONFIG, 0x00) != HAL_OK)
    {
      mini_printf("configuration failed\r\n");
    }
    else
    {
      mini_printf("awake: +-2 g, +-250 dps, 100 Hz\r\n");
    }
  }
  else
  {
    mini_printf("PB12 low: PWR_MGMT_1 not written, the sensor stays asleep\r\n");
  }
  uint32_t next = HAL_GetTick() + REPORT_PERIOD_MS;
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
    uint8_t b[14];
    HAL_StatusTypeDef st = HAL_I2C_Mem_Read(&hi2c1, MPU_ADDR, MPU_ACCEL_XOUT_H, I2C_MEMADD_SIZE_8BIT, b, sizeof b, I2C_TIMEOUT_MS);
    if (st != HAL_OK)
    {
      mini_printf("i2c error %d\r\n", (int)st);
      continue;
    }
    int16_t w[7];
    for (int i = 0; i < 7; i++)
    {
      w[i] = (int16_t)((b[2 * i] << 8) | b[2 * i + 1]);
    }
    /* T = raw / 340 + 36.53 C, in 0.01 C */
    int32_t t100 = ((int32_t)w[3] * 100) / 340 + 3653;
    mini_printf("ax=%d ay=%d az=%d gx=%d gy=%d gz=%d t=", w[0], w[1], w[2], w[4], w[5], w[6]);
    print_centi(t100);
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
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin : NOWAKE_Pin */
  GPIO_InitStruct.Pin = NOWAKE_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(NOWAKE_GPIO_Port, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

/* One register write: [reg, value] in a single HAL_I2C_Mem_Write. */
static HAL_StatusTypeDef mpu_write(uint8_t reg, uint8_t value)
{
  return HAL_I2C_Mem_Write(&hi2c1, MPU_ADDR, reg, I2C_MEMADD_SIZE_8BIT, &value, 1, I2C_TIMEOUT_MS);
}

/* Print a value in hundredths as [-]<int>.<cc>. */
static void print_centi(int32_t v)
{
  if (v < 0)
  {
    mini_putchar('-');
    v = -v;
  }
  mini_printf("%ld.%02ld", (long)(v / 100), (long)(v % 100));
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
