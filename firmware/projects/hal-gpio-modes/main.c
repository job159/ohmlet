/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-gpio-modes — every GPIO input/output mode on one board.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  * Fixture firmware for the GPIO electrical tests (pull resistors, floating
  * inputs, open-drain wired-AND):
  *
  *   PB6  OD_A      open-drain output, starts RELEASED (ODR=1, Hi-Z)
  *   PB7  OD_B      open-drain output, starts LOW (ODR=0, N-MOS on)
  *                  Both toggle every 50 ms with ONE BSRR write, so they are
  *                  always in opposite phase: 10 Hz square waves. Released
  *                  means Hi-Z (RM0008 §9.1.8): the pin only reads high with
  *                  an external pull-up (PB6/PB7 are 5 V tolerant, DS5319
  *                  Table 5, so a pull-up to 5 V is legal too).
  *   PA1  IN_PU     input, internal pull-up   (30–50 kΩ, DS5319 §5.3.13)
  *   PA2  IN_PD     input, internal pull-down
  *   PA3  IN_FLOAT  floating input (no pull: undefined when unconnected)
  *   PA9/PA10       USART1 TX/RX, 115200 8N1
  *
  * Every 200 ms (first report right after init) the three inputs are sampled
  * and printed as "PA1=x PA2=y PA3=z\r\n" (x, y, z = 0 or 1). Reports fall
  * on every fourth PB6/PB7 toggle; the toggle is done first, so output edges
  * are never delayed by the ~1.7 ms the report takes to transmit.
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
UART_HandleTypeDef huart1;

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);

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
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  const uint32_t t0 = HAL_GetTick();
  uint32_t next_toggle = t0 + OD_HALF_PERIOD_MS;
  uint32_t next_report = t0;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    const uint32_t now = HAL_GetTick();
    if ((int32_t)(now - next_toggle) >= 0)
    {
      next_toggle += OD_HALF_PERIOD_MS;
      /* HAL_GPIO_TogglePin writes BSRR once for both pins (set the ones
         that were 0, reset the ones that were 1), so PB6 and PB7 change
         in the same bus cycle. */
      HAL_GPIO_TogglePin(GPIOB, OD_A_Pin | OD_B_Pin);
    }
    if ((int32_t)(now - next_report) >= 0)
    {
      next_report += REPORT_PERIOD_MS;
      const unsigned pu = HAL_GPIO_ReadPin(IN_PU_GPIO_Port, IN_PU_Pin) == GPIO_PIN_SET;
      const unsigned pd = HAL_GPIO_ReadPin(IN_PD_GPIO_Port, IN_PD_Pin) == GPIO_PIN_SET;
      const unsigned fl = HAL_GPIO_ReadPin(IN_FLOAT_GPIO_Port, IN_FLOAT_Pin) == GPIO_PIN_SET;
      mini_printf("PA1=%u PA2=%u PA3=%u\r\n", pu, pd, fl);
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

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(OD_A_GPIO_Port, OD_A_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(OD_B_GPIO_Port, OD_B_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : IN_PU_Pin */
  GPIO_InitStruct.Pin = IN_PU_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(IN_PU_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : IN_PD_Pin */
  GPIO_InitStruct.Pin = IN_PD_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  HAL_GPIO_Init(IN_PD_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : IN_FLOAT_Pin */
  GPIO_InitStruct.Pin = IN_FLOAT_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(IN_FLOAT_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pins : OD_A_Pin OD_B_Pin */
  GPIO_InitStruct.Pin = OD_A_Pin|OD_B_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

/* mini_printf() sink: blocking USART1 transmit, one byte per call. At
   115200 Bd an 8N1 frame takes 86.8 µs; the 10 ms timeout only fires if the
   USART never sets TXE/TC (RM0008 §27.3.2). */
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
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  (void)file;
  (void)line;
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
