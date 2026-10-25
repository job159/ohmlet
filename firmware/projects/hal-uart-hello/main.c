/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-uart-hello — USART1 banner, periodic ticks, line echo.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  * USART1 on PA9 (TX) / PA10 (RX), 115200 8N1. PCLK2 = 72 MHz, so HAL
  * programs BRR = 0x271 (USARTDIV 39.0625, RM0008 §27.3.4) and the rate is
  * exactly 115200 Bd: one 8N1 frame = 86.806 µs.
  *
  * TX (blocking, HAL_UART_Transmit via mini_printf/mini_putchar):
  *   "Hello from STM32F103!\r\n" once after init, then "tick N\r\n" with
  *   N = 1, 2, … every TICK_PERIOD_MS. The schedule is deadline based
  *   (next += period), so it never drifts even when an echo delays a line.
  *
  * RX (interrupt driven, HAL_UART_Receive_IT one byte at a time):
  *   bytes accumulate in a line buffer; CR or LF ends the line. A non-empty
  *   line is queued and echoed by the main loop as "echo: <line>\r\n".
  *   Empty lines are ignored, so "abc\r\n" (CR+LF) echoes once. A line keeps
  *   its first 63 bytes (the rest is dropped up to the terminator). Up to 4
  *   finished lines wait for the main loop; a line finished while all 4 are
  *   pending is dropped. Bytes received with a framing, noise or parity
  *   error are discarded.
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

/* USER CODE BEGIN PV */
static uint8_t rx_byte;                 /* HAL_UART_Receive_IT target */
static char rx_line[RX_LINE_SIZE];      /* line being assembled (USART1 ISR only) */
static uint32_t rx_len;                 /* USART1 ISR only */
/* single-producer (ISR) / single-consumer (main loop) ring of finished lines:
   the ISR writes slot head and then advances rx_head; main reads slot tail and
   then advances rx_tail, so a slot is never written while it is being echoed */
static char rx_queue[RX_QUEUE_DEPTH][RX_LINE_SIZE];
static volatile uint32_t rx_head;
static volatile uint32_t rx_tail;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Rx_Byte(uint8_t c);
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
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  /* arm reception first so bytes typed while the banner is sent are kept */
  if (HAL_UART_Receive_IT(&huart1, &rx_byte, 1) != HAL_OK)
  {
    Error_Handler();
  }
  uint32_t next_tick = HAL_GetTick() + TICK_PERIOD_MS;
  uint32_t tick_count = 0;
  mini_printf("Hello from STM32F103!\r\n");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next_tick) >= 0)
    {
      next_tick += TICK_PERIOD_MS;
      tick_count++;
      mini_printf("tick %lu\r\n", (unsigned long)tick_count);
    }
    if (rx_tail != rx_head)
    {
      mini_printf("echo: %s\r\n", rx_queue[rx_tail % RX_QUEUE_DEPTH]);
      rx_tail++;
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
  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
}

/* USER CODE BEGIN 4 */

/* Line assembly, USART1 ISR context. */
static void Rx_Byte(uint8_t c)
{
  if (c == '\r' || c == '\n')
  {
    if (rx_len > 0U)
    {
      if (rx_head - rx_tail < RX_QUEUE_DEPTH)
      {
        char *slot = rx_queue[rx_head % RX_QUEUE_DEPTH];
        for (uint32_t i = 0; i < rx_len; i++)
        {
          slot[i] = rx_line[i];
        }
        slot[rx_len] = '\0';
        rx_head++;
      }
      rx_len = 0;
    }
  }
  else if (rx_len < RX_LINE_SIZE - 1U)
  {
    rx_line[rx_len++] = (char)c;
  }
}

/* One byte received (USART1 ISR). HAL_UART_IRQHandler records FE/NE/PE in
   ErrorCode BEFORE it completes the transfer that carries the bad byte, so
   the flag is still visible here; re-arming below clears it. */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
  if (huart->Instance == USART1)
  {
    if ((huart->ErrorCode & (HAL_UART_ERROR_PE | HAL_UART_ERROR_NE | HAL_UART_ERROR_FE)) == 0U)
    {
      Rx_Byte(rx_byte);
    }
    (void)HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
  }
}

/* An overrun (SR.ORE, RM0008 §27.6.1) makes HAL abort the reception;
   re-arm so the echo keeps working. HAL_BUSY (already re-armed by the
   complete callback) is harmless. */
void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
  if (huart->Instance == USART1)
  {
    (void)HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
  }
}

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
