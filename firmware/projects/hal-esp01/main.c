/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-esp01 — ESP-01 (ESP8266) AT dialogue over USART2.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * USART2 PA2 (TX) -> ESP-01 RXD, PA3 (RX) <- ESP-01 TXD, 115200 8N1.
  * PB0 -> ESP-01 CH_PD (push-pull, low after reset: the module is held off
  *        until the firmware enables it). ESP-01 VCC on 3.3 V.
  * USART1 PA9 (TX), 115200 8N1: progress report.
  *
  * Sequence (report on USART1):
  *   "ESP-01 test (USART2 115200 8N1, CH_PD on PB0)\r\n"
  *   PB0 high; every line received at 115200 is discarded until "ready"
  *   (the boot ROM banner at 74880 baud arrives as garbage first), up to
  *   READY_WAIT_MS:
  *     none -> "no ready from the ESP-01 (CH_PD high? 3.3 V?)\r\n", stop
  *   "ready after T ms\r\n"
  *   "ATE0 -> OK\r\n"                      (echo off; the echo of ATE0 itself is skipped)
  *   "AT -> OK\r\n"
  *   "AT+GMR -> <first line of the version>\r\n"
  *   "AT+CWMODE? -> +CWMODE:1 OK\r\n"
  *   "AT+CWJAP -> ERROR\r\n"               (joining a network: the lab has no Wi-Fi)
  *   "esp01 ok\r\n" when every answer was as expected, else "esp01 FAILED\r\n".
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
static void MX_USART2_UART_Init(void);
/* USER CODE BEGIN PFP */
static void esp_send(const char *s);
static int esp_readline(char *buf, uint32_t size, uint32_t timeout_ms);
static int at_command(const char *cmd, char *answer, uint32_t size, int first_line_only);
static int str_eq(const char *a, const char *b);
static int starts_with(const char *s, const char *prefix);
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
  MX_USART2_UART_Init();
  /* USER CODE BEGIN 2 */
  mini_printf("ESP-01 test (USART2 115200 8N1, CH_PD on PB0)\r\n");
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET);

  char line[64];
  uint32_t t0 = HAL_GetTick();
  int ready = 0;
  while (!ready && HAL_GetTick() - t0 < READY_WAIT_MS)
  {
    uint32_t used = HAL_GetTick() - t0;
    if (esp_readline(line, sizeof(line), READY_WAIT_MS - used) > 0 && str_eq(line, "ready"))
    {
      ready = 1;
    }
  }
  if (!ready)
  {
    mini_printf("no ready from the ESP-01 (CH_PD high? 3.3 V?)\r\n");
    while (1)
    {
      __WFI();
    }
  }
  mini_printf("ready after %lu ms\r\n", (unsigned long)(HAL_GetTick() - t0));

  char answer[96];
  int ok = 1;
  ok &= at_command("ATE0", answer, sizeof(answer), 0) == 1;
  mini_printf("ATE0 -> %s\r\n", answer);
  ok &= at_command("AT", answer, sizeof(answer), 0) == 1;
  mini_printf("AT -> %s\r\n", answer);
  ok &= at_command("AT+GMR", answer, sizeof(answer), 1) == 1 && starts_with(answer, "AT version:");
  mini_printf("AT+GMR -> %s\r\n", answer);
  ok &= at_command("AT+CWMODE?", answer, sizeof(answer), 0) == 1 && str_eq(answer, "+CWMODE:1 OK");
  mini_printf("AT+CWMODE? -> %s\r\n", answer);
  ok &= at_command("AT+CWJAP=\"ohmlet\",\"lab\"", answer, sizeof(answer), 0) == 0;
  mini_printf("AT+CWJAP -> %s\r\n", answer);
  mini_printf(ok ? "esp01 ok\r\n" : "esp01 FAILED\r\n");
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

static void esp_send(const char *s)
{
  uint32_t n = 0;
  while (s[n] != '\0')
  {
    n++;
  }
  HAL_UART_Transmit(&huart2, (const uint8_t *)s, (uint16_t)n, 100);
}

/**
  * Read one LF-terminated line from USART2 into buf (CR dropped, terminator
  * stripped, empty lines skipped). Returns its length, or -1 on timeout.
  */
static int esp_readline(char *buf, uint32_t size, uint32_t timeout_ms)
{
  uint32_t n = 0;
  uint32_t start = HAL_GetTick();
  while (1)
  {
    uint32_t used = HAL_GetTick() - start;
    if (used >= timeout_ms)
    {
      return -1;
    }
    uint8_t c;
    if (HAL_UART_Receive(&huart2, &c, 1, timeout_ms - used) != HAL_OK)
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
  * Send "<cmd>\r\n" and collect the answer lines up to "OK" / "ERROR"
  * (an echo of the command, or a fragment of one, is skipped): answer = the lines joined with ' ',
  * or only the first line plus nothing else when first_line_only. Returns
  * 1 for OK, 0 for ERROR, -1 on timeout ("(no answer)").
  */
static int at_command(const char *cmd, char *answer, uint32_t size, int first_line_only)
{
  answer[0] = '\0';
  esp_send(cmd);
  esp_send("\r\n");
  uint32_t used = 0;
  int lines = 0;
  while (1)
  {
    char line[64];
    if (esp_readline(line, sizeof(line), AT_TIMEOUT_MS) < 0)
    {
      const char *na = "(no answer)";
      uint32_t k = 0;
      while (na[k] != '\0' && k + 1 < size)
      {
        answer[k] = na[k];
        k++;
      }
      answer[k] = '\0';
      return -1;
    }
    if (starts_with(cmd, line))
    {
      /* the module's echo — or what is left of it: with echo on, the echoed
         characters arrive while the blocking transmit still runs, so USART2
         overruns and only the first echoed byte(s) survive */
      continue;
    }
    int done = str_eq(line, "OK") ? 1 : starts_with(line, "ERROR") ? 0 : -1;
    if (!first_line_only || lines == 0)
    {
      if (used > 0 && used + 2 < size)
      {
        answer[used++] = ' ';
      }
      uint32_t k = 0;
      while (line[k] != '\0' && used + 1 < size)
      {
        answer[used++] = line[k++];
      }
      answer[used] = '\0';
    }
    lines++;
    if (done >= 0)
    {
      return done;
    }
  }
}

static int str_eq(const char *a, const char *b)
{
  while (*a != '\0' && *a == *b)
  {
    a++;
    b++;
  }
  return *a == *b;
}

static int starts_with(const char *s, const char *prefix)
{
  while (*prefix != '\0')
  {
    if (*s++ != *prefix++)
    {
      return 0;
    }
  }
  return 1;
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
  * @brief USART2 Initialization Function (ESP-01)
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = ESP_BAUD;
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

  /* PB0 (ESP-01 CH_PD): output, low = module disabled until the firmware is ready */
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
  GPIO_InitStruct.Pin = GPIO_PIN_0;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
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
