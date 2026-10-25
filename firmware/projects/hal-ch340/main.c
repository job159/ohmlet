/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-ch340 — line echo over USART2 through a CH340
  *                   USB-to-TTL adapter (the PC's virtual COM port).
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * USART2 on PA2 (TX) / PA3 (RX), 115200 8N1 (PCLK1 36 MHz: BRR = 312.5 ->
  * 0x138, RM0008 §27.3.4). Wiring: PA2 -> CH340 RXD, PA3 <- CH340 TXD,
  * GND <-> GND, the CH340 logic jumper at 3.3 V (PA3 is not 5 V tolerant).
  *
  * Once after reset (on USART2, i.e. the COM port):
  *   "CH340 echo on USART2 (115200 8N1)\r\n"
  * Then every received line (ended by CR or LF, empty lines ignored, at most
  * 63 characters kept) is answered with
  *   "echo N: <line>\r\n"   (N = 1, 2, ... lines so far)
  * Bytes are polled with HAL_UART_Receive (one at a time), so a line must
  * not arrive while the previous echo is still being sent.
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
UART_HandleTypeDef huart2;

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART2_UART_Init(void);

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART2_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("CH340 echo on USART2 (115200 8N1)\r\n");
  char line[ECHO_LINE_MAX + 1];
  uint32_t n = 0;
  uint32_t lines = 0;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    uint8_t c;
    if (HAL_UART_Receive(&huart2, &c, 1, HAL_MAX_DELAY) != HAL_OK)
    {
      continue;
    }
    if (c == '\r' || c == '\n')
    {
      if (n == 0)
      {
        continue;
      }
      line[n] = '\0';
      lines++;
      mini_printf("echo %lu: %s\r\n", (unsigned long)lines, line);
      n = 0;
    }
    else if (n < ECHO_LINE_MAX)
    {
      line[n++] = (char)c;
    }
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
  * @brief USART2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK)
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
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
}

/* USER CODE BEGIN 4 */

/* mini_printf() sink: blocking USART2 transmit (the COM port side). */
void mini_putchar(char c)
{
  HAL_UART_Transmit(&huart2, (const uint8_t *)&c, 1, 10);
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
