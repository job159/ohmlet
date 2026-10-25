/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-traffic-light — traffic light with pedestrian button.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  *
  *   PA1  RED     push-pull, active high (LED + resistor to GND)
  *   PA2  YELLOW  push-pull, active high
  *   PA3  GREEN   push-pull, active high
  *   PB0  PED_BTN input, internal pull-up, EXTI0 on the falling edge
  *                (push-button to GND)
  *   PA9/PA10     USART1 TX/RX, 115200 8N1
  *
  * Cycle: GREEN 3000 ms → YELLOW 1000 ms → RED 3000 ms → GREEN … starting
  * with GREEN right after init. Exactly one LED is lit at any time: each
  * change is ONE write to GPIOA_BSRR that sets the new pin and resets the
  * other two (RM0008 §9.2.5), so there is no instant with 0 or 2 LEDs on.
  * Phase ends are deadlines in HAL ticks (the next phase starts at the
  * previous deadline, not at "now"), so the cycle does not drift.
  *
  * Pedestrian request: a press is accepted when PB0 still reads low 20 ms
  * after its last falling edge (same debounce as hal-button-exti). If it is
  * accepted while GREEN is lit (and green was not already shortened), green
  * ends at max(green start + 1000 ms, now): green is cut to 1 s in total, or
  * ends at once if it has already been on longer. Presses accepted during
  * YELLOW or RED are ignored (not latched).
  *
  * UART: on every phase change, right after the LEDs switch,
  *   "light=GREEN\r\n" | "light=YELLOW\r\n" | "light=RED\r\n";
  * the yellow that follows a shortened green prints "light=YELLOW (walk)\r\n".
  * Nothing else is printed, so a line never delays a deadline (the shortest
  * phase is 1000 ms, a line takes < 2 ms).
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
typedef enum
{
  LIGHT_GREEN = 0,
  LIGHT_YELLOW = 1,
  LIGHT_RED = 2,
} Light;
/* USER CODE END PTD */

/* Private variables ---------------------------------------------------------*/
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
static const uint16_t light_pin[3] = {GREEN_Pin, YELLOW_Pin, RED_Pin};
static const uint32_t light_ms[3] = {GREEN_MS, YELLOW_MS, RED_MS};
static const char *const light_name[3] = {"GREEN", "YELLOW", "RED"};

static volatile uint32_t btn_edge_tick;   /* HAL tick of the most recent falling edge */
static volatile uint8_t btn_edge_pending; /* an edge is waiting for its settle check */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Light_Show(Light l);
static int Button_PressAccepted(void);
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
  Light state = LIGHT_GREEN;
  uint32_t phase_start = HAL_GetTick();
  uint32_t phase_end = phase_start + light_ms[state];
  int walk = 0; /* the current green has been shortened */
  Light_Show(state);
  mini_printf("light=%s\r\n", light_name[state]);
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    const uint32_t now = HAL_GetTick();
    if (Button_PressAccepted() && state == LIGHT_GREEN && !walk)
    {
      const uint32_t min_end = phase_start + WALK_GREEN_MS;
      walk = 1;
      phase_end = ((int32_t)(now - min_end) > 0) ? now : min_end;
    }
    if ((int32_t)(now - phase_end) >= 0)
    {
      const int shortened = (state == LIGHT_GREEN) && walk;
      state = (state == LIGHT_RED) ? LIGHT_GREEN : (Light)(state + 1);
      phase_start = phase_end;
      phase_end = phase_start + light_ms[state];
      walk = 0;
      Light_Show(state);
      mini_printf("light=%s%s\r\n", light_name[state], shortened ? " (walk)" : "");
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
  HAL_GPIO_WritePin(GPIOA, RED_Pin|YELLOW_Pin|GREEN_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pins : RED_Pin YELLOW_Pin GREEN_Pin */
  GPIO_InitStruct.Pin = RED_Pin|YELLOW_Pin|GREEN_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

  /*Configure GPIO pin : PED_BTN_Pin */
  GPIO_InitStruct.Pin = PED_BTN_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(PED_BTN_GPIO_Port, &GPIO_InitStruct);

  /* EXTI interrupt init*/
  HAL_NVIC_SetPriority(EXTI0_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}

/* USER CODE BEGIN 4 */

/* Light `l` on, the other two off, in one BSRR write: the low half sets, the
   high half resets (RM0008 §9.2.5), so the switch is a single bus cycle. */
static void Light_Show(Light l)
{
  const uint32_t all = RED_Pin | YELLOW_Pin | GREEN_Pin;
  const uint32_t on = light_pin[l];
  GREEN_GPIO_Port->BSRR = on | ((all & ~on) << 16);
}

/* EXTI0 falling edge: timestamp only (see Button_PressAccepted). */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
  if (GPIO_Pin == PED_BTN_Pin)
  {
    btn_edge_tick = HAL_GetTick();
    btn_edge_pending = 1;
  }
}

/* 1 exactly once per debounced press: PB0 must still read low DEBOUNCE_MS
   ticks after its LAST falling edge (each bounce restarts the window), so a
   bouncy press counts once and release bounce never counts. Runs with
   PRIMASK set (ARMv7-M ARM B1.4.3) so an edge cannot slip in between the
   timestamp check and clearing the flag. */
static int Button_PressAccepted(void)
{
  int accepted = 0;
  if (!btn_edge_pending)
  {
    return 0;
  }
  __disable_irq();
  if (btn_edge_pending && (HAL_GetTick() - btn_edge_tick) >= DEBOUNCE_MS)
  {
    btn_edge_pending = 0;
    accepted = HAL_GPIO_ReadPin(PED_BTN_GPIO_Port, PED_BTN_Pin) == GPIO_PIN_RESET;
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
