/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-hc05 — HC-05 Bluetooth module: AT-command dialogue,
  *                   then data mode with the paired phone.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * USART2 PA2 (TX) -> HC-05 RXD, PA3 (RX) <- HC-05 TXD.
  * PB0 -> HC-05 EN, with a 10 kOhm pull-up to 3.3 V: PB0 is an input after
  *        reset, so EN is HIGH when the module powers up -> AT command mode
  *        (38400 8N1). The firmware drives PB0 low before AT+RESET so the
  *        module restarts in data mode.
  * PB1 <- HC-05 STATE (high while a phone is connected).
  * USART1 PA9 (TX), 115200 8N1: progress report.
  *
  * Sequence (report on USART1):
  *   "HC-05 test\r\n"
  *   wait START_WAIT_MS for the module to start, then up to AT_TRIES x "AT"
  *   at 38400 (AT_TIMEOUT_MS each):
  *     none answered -> "no answer from the HC-05 (EN high at power-up? 38400 8N1?)\r\n", stop
  *   "AT ok (try N)\r\n"
  *   for each of AT+VERSION?, AT+NAME=OHMLET, AT+NAME?, AT+UART=9600,0,0,
  *   AT+UART?, AT+ROLE?, AT+PSWD?: "<cmd> -> <answer lines joined by ' '>\r\n"
  *   PB0 low (EN), "AT+RESET -> OK\r\n", USART2 re-initialised at 9600 8N1
  *   wait for STATE (PB1) high, up to STATE_WAIT_MS:
  *     "phone connected (STATE high after T ms)\r\n" or "no phone (STATE low)\r\n", stop
  *   to the phone (USART2): "hello phone\r\n"
  *   then every line the phone sends (CR/LF terminated) is answered to the
  *   phone with "you said: <line>\r\n" and reported on USART1 as
  *   "phone: <line>\r\n".
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
UART_HandleTypeDef huart2;

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(uint32_t baud);
/* USER CODE BEGIN PFP */
static uint32_t bt_send(const char *s);
static int bt_readline(char *buf, uint32_t size, uint32_t timeout_ms);
static int at_command(const char *cmd, char *answer, uint32_t size);
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
  MX_USART1_UART_Init();
  MX_USART2_UART_Init(HC05_AT_BAUD);
  /* USER CODE BEGIN 2 */
  mini_printf("HC-05 test\r\n");
  HAL_Delay(START_WAIT_MS);

  char answer[96];
  int ok = 0;
  uint32_t tries = 0;
  while (!ok && tries < AT_TRIES)
  {
    tries++;
    ok = at_command("AT", answer, sizeof(answer)) > 0;
  }
  if (!ok)
  {
    mini_printf("no answer from the HC-05 (EN high at power-up? 38400 8N1?)\r\n");
    while (1)
    {
      __WFI();
    }
  }
  mini_printf("AT ok (try %lu)\r\n", (unsigned long)tries);

  static const char *const cmds[] = {
    "AT+VERSION?", "AT+NAME=OHMLET", "AT+NAME?", "AT+UART=9600,0,0", "AT+UART?", "AT+ROLE?", "AT+PSWD?",
  };
  for (uint32_t i = 0; i < sizeof(cmds) / sizeof(cmds[0]); i++)
  {
    if (at_command(cmds[i], answer, sizeof(answer)) < 0)
    {
      mini_printf("%s -> (no answer)\r\n", cmds[i]);
    }
    else
    {
      mini_printf("%s -> %s\r\n", cmds[i], answer);
    }
  }

  /* data mode: EN low, restart, then talk at the configured 9600 8N1 */
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
  GPIO_InitTypeDef g = {0};
  g.Pin = GPIO_PIN_0;
  g.Mode = GPIO_MODE_OUTPUT_PP;
  g.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &g);
  at_command("AT+RESET", answer, sizeof(answer));
  mini_printf("AT+RESET -> %s\r\n", answer);
  MX_USART2_UART_Init(HC05_DATA_BAUD);

  uint32_t t0 = HAL_GetTick();
  while (HAL_GPIO_ReadPin(GPIOB, GPIO_PIN_1) == GPIO_PIN_RESET && HAL_GetTick() - t0 < STATE_WAIT_MS)
  {
  }
  if (HAL_GPIO_ReadPin(GPIOB, GPIO_PIN_1) == GPIO_PIN_RESET)
  {
    mini_printf("no phone (STATE low)\r\n");
    while (1)
    {
      __WFI();
    }
  }
  mini_printf("phone connected (STATE high after %lu ms)\r\n", (unsigned long)(HAL_GetTick() - t0));
  bt_send("hello phone\r\n");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    char line[64];
    if (bt_readline(line, sizeof(line), HAL_MAX_DELAY) > 0)
    {
      mini_printf("phone: %s\r\n", line);
      bt_send("you said: ");
      bt_send(line);
      bt_send("\r\n");
    }
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/* USER CODE BEGIN 4 */

static uint32_t bt_send(const char *s)
{
  uint32_t n = 0;
  while (s[n] != '\0')
  {
    n++;
  }
  HAL_UART_Transmit(&huart2, (const uint8_t *)s, (uint16_t)n, 100);
  return n;
}

/**
  * Read one CR LF / LF terminated line from USART2 into buf (terminator
  * stripped). Returns its length, or -1 on timeout before a terminator.
  */
static int bt_readline(char *buf, uint32_t size, uint32_t timeout_ms)
{
  uint32_t n = 0;
  uint32_t start = HAL_GetTick();
  while (1)
  {
    uint8_t c;
    uint32_t left = timeout_ms;
    if (timeout_ms != HAL_MAX_DELAY)
    {
      uint32_t used = HAL_GetTick() - start;
      if (used >= timeout_ms)
      {
        return -1;
      }
      left = timeout_ms - used;
    }
    if (HAL_UART_Receive(&huart2, &c, 1, left) != HAL_OK)
    {
      return -1;
    }
    if (c == '\r')
    {
      continue;
    }
    if (c == '\n')
    {
      if (n == 0)
      {
        continue;
      }
      buf[n] = '\0';
      return (int)n;
    }
    if (n + 1 < size)
    {
      buf[n++] = (char)c;
    }
  }
}

/**
  * Send "<cmd>\r\n" and collect the answer lines up to "OK" / "ERROR...":
  * answer = the lines joined with ' '. Returns 1 for OK, 0 for ERROR, -1
  * when the module did not finish an answer within AT_TIMEOUT_MS.
  */
static int at_command(const char *cmd, char *answer, uint32_t size)
{
  answer[0] = '\0';
  bt_send(cmd);
  bt_send("\r\n");
  uint32_t used = 0;
  while (1)
  {
    char line[48];
    if (bt_readline(line, sizeof(line), AT_TIMEOUT_MS) < 0)
    {
      return -1;
    }
    uint32_t k = 0;
    while (line[k] != '\0' && used + 2 < size)
    {
      answer[used++] = line[k++];
    }
    answer[used] = '\0';
    if (line[0] == 'O' && line[1] == 'K' && line[2] == '\0')
    {
      return 1;
    }
    if (line[0] == 'E' && line[1] == 'R' && line[2] == 'R')
    {
      return 0;
    }
    if (used + 2 < size)
    {
      answer[used++] = ' ';
      answer[used] = '\0';
    }
  }
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
  * @brief USART1 Initialization Function (report)
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
  * @brief USART2 Initialization Function (HC-05)
  * @param baud: line rate (38400 in AT mode, the stored rate in data mode)
  * @retval None
  */
static void MX_USART2_UART_Init(uint32_t baud)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = baud;
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
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /* PB0 (HC-05 EN): input, left to the external 10 kOhm pull-up until data mode */
  GPIO_InitStruct.Pin = GPIO_PIN_0;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

  /* PB1 (HC-05 STATE): input with pull-down (low while the module is off) */
  GPIO_InitStruct.Pin = GPIO_PIN_1;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* mini_printf() sink: blocking USART1 transmit (report). */
void mini_putchar(char c)
{
  HAL_UART_Transmit(&huart1, (const uint8_t *)&c, 1, 10);
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
