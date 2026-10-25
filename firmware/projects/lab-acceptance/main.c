/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : lab-acceptance — the first-release demo firmware.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  *
  *   PA5   LED        external LED (push-pull, active high)
  *   PC13  HEARTBEAT  on-board LED (push-pull, active LOW): on 50 ms at the
  *                    start of every second, independent of everything else
  *   PB12  BTN        input, internal pull-up, EXTI12 falling edge
  *                    (push-button to GND); 30 ms debounce
  *   PA9/PA10         USART1 TX/RX, 115200 8N1
  *
  * Modes (BTN advances 0 → 1 → 2 → 3 → 0 …):
  *   mode=0 blink 2 Hz   PA5 250 ms on / 250 ms off
  *   mode=1 blink 5 Hz   PA5 100 ms on / 100 ms off
  *   mode=2 solid on     PA5 high
  *   mode=3 off          PA5 low
  * Entering a mode drives PA5 to its "on" level (high, except mode 3) in that
  * tick; a blink pattern then toggles every half period from that tick.
  *
  * All timing runs in App_Tick1ms(), called by SysTick_Handler after
  * HAL_IncTick() (USER CODE section of stm32f1xx_it.c). Every PA5/PC13 edge
  * therefore lands within microseconds of a SysTick interrupt, and blocking
  * UART output in the main loop can never delay one. The main loop only
  * prints:
  *   "boot ok\r\n" once after init, then "mode=<n> <description>\r\n" on
  *   every mode entry, starting with "mode=0 blink 2 Hz\r\n" when the
  *   application starts on the first tick after "boot ok" has been sent.
  *
  * Debounce (as hal-button-exti, but 30 ms): a falling edge timestamps
  * itself and restarts the window; the press is accepted in the SysTick tick
  * where HAL_GetTick() − edge reaches 30, if PB12 still reads low. That is
  * 29–30 ms after the LAST falling edge of the press; release bounce never
  * counts.
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
typedef struct
{
  uint32_t half_period_ms; /* 0 = steady */
  GPIO_PinState level;     /* PA5 level on entry (steady level when not blinking) */
  const char *desc;
} LedMode;
/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define MODE_COUNT 4U
/* USER CODE END PD */

/* Private variables ---------------------------------------------------------*/
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
static const LedMode modes[MODE_COUNT] = {
  {250U, GPIO_PIN_SET, "blink 2 Hz"},
  {100U, GPIO_PIN_SET, "blink 5 Hz"},
  {0U, GPIO_PIN_SET, "solid on"},
  {0U, GPIO_PIN_RESET, "off"},
};

static volatile uint8_t app_start_request; /* main → SysTick: start on the next tick */
static volatile uint32_t mode;             /* written in SysTick context only */
static volatile uint32_t mode_seq;         /* +1 per mode entry; main prints when it changes */
static uint8_t app_running;                /* SysTick context only */
static uint32_t led_next_toggle;           /* SysTick context only */
static uint32_t hb_phase;                  /* SysTick context only: ms into the heartbeat period */

static volatile uint32_t btn_edge_tick;    /* HAL tick of the most recent falling edge */
static volatile uint8_t btn_edge_pending;  /* an edge is waiting for its settle check */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Mode_Enter(uint32_t m, uint32_t now);
static int Button_PressAccepted(uint32_t now);
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
  mini_printf("boot ok\r\n");
  app_start_request = 1;
  uint32_t printed_seq = 0;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* consistent (seq, mode) snapshot: both change together in SysTick */
    uint32_t seq;
    uint32_t m;
    do
    {
      seq = mode_seq;
      m = mode;
    } while (seq != mode_seq);
    if (seq != printed_seq)
    {
      printed_seq = seq;
      mini_printf("mode=%lu %s\r\n", (unsigned long)m, modes[m].desc);
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
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(HEARTBEAT_GPIO_Port, HEARTBEAT_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : HEARTBEAT_Pin */
  GPIO_InitStruct.Pin = HEARTBEAT_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(HEARTBEAT_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : LED_Pin */
  GPIO_InitStruct.Pin = LED_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(LED_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : BTN_Pin */
  GPIO_InitStruct.Pin = BTN_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(BTN_GPIO_Port, &GPIO_InitStruct);

  /* EXTI interrupt init*/
  HAL_NVIC_SetPriority(EXTI15_10_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(EXTI15_10_IRQn);
}

/* USER CODE BEGIN 4 */

/* Application time base: SysTick context (priority 15, TICK_INT_PRIORITY),
   once per HAL tick, after HAL_IncTick(). */
void App_Tick1ms(void)
{
  const uint32_t now = HAL_GetTick();
  if (!app_running)
  {
    if (!app_start_request)
    {
      return;
    }
    app_running = 1;
    hb_phase = 0;
    Mode_Enter(0, now);
  }
  else
  {
    hb_phase = (hb_phase + 1U == HEARTBEAT_PERIOD_MS) ? 0U : hb_phase + 1U;
    if (Button_PressAccepted(now))
    {
      Mode_Enter((mode + 1U) % MODE_COUNT, now);
    }
    else if (modes[mode].half_period_ms != 0U && (int32_t)(now - led_next_toggle) >= 0)
    {
      HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
      led_next_toggle += modes[mode].half_period_ms;
    }
  }
  /* only the two edges are written, so the pin sees no redundant writes */
  if (hb_phase == 0U)
  {
    HAL_GPIO_WritePin(HEARTBEAT_GPIO_Port, HEARTBEAT_Pin, GPIO_PIN_RESET); /* LED on */
  }
  else if (hb_phase == HEARTBEAT_ON_MS)
  {
    HAL_GPIO_WritePin(HEARTBEAT_GPIO_Port, HEARTBEAT_Pin, GPIO_PIN_SET);
  }
}

/* SysTick context. mode and mode_seq change together, inside the ISR, so the
   main loop can take a consistent snapshot. */
static void Mode_Enter(uint32_t m, uint32_t now)
{
  mode = m;
  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, modes[m].level);
  led_next_toggle = now + modes[m].half_period_ms;
  mode_seq++;
}

/* EXTI12 falling edge (priority 0, preempts SysTick): timestamp only. */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
  if (GPIO_Pin == BTN_Pin)
  {
    btn_edge_tick = HAL_GetTick();
    btn_edge_pending = 1;
  }
}

/* SysTick context. 1 exactly once per debounced press. EXTI12 has a higher
   priority than SysTick, so the check runs with PRIMASK set (ARMv7-M ARM
   B1.4.3): an edge cannot slip in between the timestamp check and clearing
   the flag, and PB12 is sampled in the same section. */
static int Button_PressAccepted(uint32_t now)
{
  int accepted = 0;
  if (!btn_edge_pending)
  {
    return 0;
  }
  __disable_irq();
  if (btn_edge_pending && (now - btn_edge_tick) >= DEBOUNCE_MS)
  {
    btn_edge_pending = 0;
    accepted = HAL_GPIO_ReadPin(BTN_GPIO_Port, BTN_Pin) == GPIO_PIN_RESET;
  }
  __enable_irq();
  return accepted;
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
