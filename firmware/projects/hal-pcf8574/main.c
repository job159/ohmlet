/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-pcf8574 — LED chaser on a PCF8574 I/O expander
  *                   (P0-P6) and a push-button read on P7.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * I2C1 PB6 (SCL) / PB7 (SDA), AF open drain, 100 kHz; the PCF8574 module
  * (address 0x20, its 10 kOhm SDA/SCL pull-ups) on 3.3 V.
  * P0..P6: LED + 330 Ohm from 3.3 V into the pin (the PCF8574 sinks 25 mA
  * but sources only ~100 uA, so a 0 bit lights the LED).
  * P7: push-button to GND (the bit is kept at 1 = weak pull-up / input).
  * USART1 PA9 (TX), 115200 8N1: report.
  *
  * After reset: "PCF8574 chaser P0-P6, button P7 (I2C1 0x20)\r\n";
  * HAL_I2C_IsDeviceReady(0x40): no ACK -> "no PCF8574 at 0x20\r\n", stop.
  * Then every STEP_MS (deadline based): write ~(1 << step) & 0x7F | 0x80
  * (exactly one of P0..P6 low = one LED lit, P7 high), read the port back:
  *   - P7 low  -> "P7 button pressed (port 0xNN)\r\n"  (on change only)
  *   - P7 high -> "P7 button released (port 0xNN)\r\n" (on change only)
  *   - a port read that does not match the written outputs ->
  *     "port mismatch: wrote 0xWW read 0xRR\r\n" (once)
  * step = 0 .. 6 cyclically: P0, P1, ... P6, one at a time for 100 ms.
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

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_I2C1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("PCF8574 chaser P0-P6, button P7 (I2C1 0x%02X)\r\n", PCF_ADDR);
  if (HAL_I2C_IsDeviceReady(&hi2c1, PCF_ADDR << 1, 2, 5) != HAL_OK)
  {
    mini_printf("no PCF8574 at 0x%02X\r\n", PCF_ADDR);
    while (1)
    {
      __WFI();
    }
  }
  uint32_t step = 0;
  int pressed = -1;
  int mismatchReported = 0;
  uint32_t next = HAL_GetTick();
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    while ((int32_t)(HAL_GetTick() - next) < 0)
    {
      __WFI();
    }
    next += STEP_MS;
    uint8_t out = (uint8_t)((~(1U << step) & 0x7FU) | 0x80U);
    uint8_t in = 0xFF;
    if (HAL_I2C_Master_Transmit(&hi2c1, PCF_ADDR << 1, &out, 1, 5) != HAL_OK ||
        HAL_I2C_Master_Receive(&hi2c1, (PCF_ADDR << 1) | 1, &in, 1, 5) != HAL_OK)
    {
      mini_printf("I2C error 0x%lX\r\n", (unsigned long)HAL_I2C_GetError(&hi2c1));
      continue;
    }
    int p = (in & 0x80U) == 0;
    if (p != pressed)
    {
      pressed = p;
      mini_printf("P7 button %s (port 0x%02X)\r\n", p ? "pressed" : "released", in);
    }
    if ((in & 0x7FU) != (out & 0x7FU) && !mismatchReported)
    {
      mismatchReported = 1;
      mini_printf("port mismatch: wrote 0x%02X read 0x%02X\r\n", out, in);
    }
    step = (step + 1U) % 7U;
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
  * @brief GPIO Initialization Function
  */
static void MX_GPIO_Init(void)
{
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
}

/* USER CODE BEGIN 4 */

/* mini_printf() sink: blocking USART1 transmit (report). */
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
