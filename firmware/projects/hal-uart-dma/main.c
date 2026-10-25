/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-uart-dma — USART1 TX by DMA, RX by circular DMA +
  *                   IDLE line detection; every received chunk is echoed.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  * USART1 on PA9 (TX) / PA10 (RX), 115200 8N1 (BRR 0x271).
  *
  * DMA (RM0008 Table 78): USART1_TX = DMA1 channel 4 (memory → peripheral,
  * bytes, normal mode), USART1_RX = DMA1 channel 5 (peripheral → memory,
  * bytes, CIRCULAR into rx_ring[32]).
  *
  * RX: HAL_UARTEx_ReceiveToIdle_DMA(rx_ring, 32) reports reception events
  * through HAL_UARTEx_RxEventCallback(Size = write position in the ring):
  *   HT    half of the ring filled (DMA half transfer, 16 bytes)
  *   TC    ring filled up to its end (DMA transfer complete, wraps)
  *   IDLE  the line went idle for one frame (USART_SR.IDLE) before HT/TC
  * The callback queues the bytes between the previous and the new
  * position as one chunk (up to 8 chunks wait for the main loop).
  *
  * TX: "uart-dma ready\r\n" after init, then for every chunk
  *   "<idle|ht|tc> <n>: <bytes>\r\n"
  * sent with HAL_UART_Transmit_DMA; the main loop waits for the previous
  * DMA transmission (gState READY, set from the USART TC interrupt after
  * the DMA transfer-complete interrupt) before formatting the next line.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdarg.h>
#include "mini_printf.h"
/* USER CODE END Includes */

/* Private variables ---------------------------------------------------------*/
UART_HandleTypeDef huart1;
DMA_HandleTypeDef hdma_usart1_rx;
DMA_HandleTypeDef hdma_usart1_tx;

/* USER CODE BEGIN PV */
typedef struct
{
  uint8_t type;   /* HAL_UART_RXEVENT_TC / _HT / _IDLE */
  uint8_t len;
  char data[RX_RING_SIZE + 1]; /* NUL-terminated */
} RxChunk;

static uint8_t rx_ring[RX_RING_SIZE];              /* written by DMA1 channel 5 */
static uint32_t rx_pos;                            /* consumed up to here (ISR only) */
static RxChunk evq[EVT_QUEUE_DEPTH];
static volatile uint32_t ev_head;                  /* written by the USART1 / DMA ISRs */
static volatile uint32_t ev_tail;                  /* written by the main loop */
static char tx_buf[64];                            /* read by DMA1 channel 4 */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Send_Line(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
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
  MX_DMA_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  if (HAL_UARTEx_ReceiveToIdle_DMA(&huart1, rx_ring, RX_RING_SIZE) != HAL_OK)
  {
    Error_Handler();
  }
  Send_Line("uart-dma ready\r\n");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if (ev_tail != ev_head)
    {
      const RxChunk *e = &evq[ev_tail % EVT_QUEUE_DEPTH];
      const char *kind = e->type == HAL_UART_RXEVENT_HT ? "ht" : e->type == HAL_UART_RXEVENT_TC ? "tc" : "idle";
      Send_Line("%s %u: %s\r\n", kind, (unsigned)e->len, e->data);
      ev_tail++;
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
  * Enable DMA controller clock
  */
static void MX_DMA_Init(void)
{
  /* DMA controller clock enable */
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* DMA interrupt init */
  /* DMA1_Channel4_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA1_Channel4_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel4_IRQn);
  /* DMA1_Channel5_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA1_Channel5_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel5_IRQn);
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

/* Format into tx_buf and transmit it by DMA. tx_buf is read by DMA1
   channel 4 while the previous line is on the wire, so wait for that
   transmission to complete (gState READY) BEFORE formatting. */
static void Send_Line(const char *fmt, ...)
{
  while (huart1.gState != HAL_UART_STATE_READY)
  {
  }
  va_list ap;
  va_start(ap, fmt);
  int n = mini_vsnprintf(tx_buf, sizeof tx_buf, fmt, ap);
  va_end(ap);
  uint32_t len = n < 0 ? 0U : (uint32_t)n;
  if (len >= sizeof tx_buf)
  {
    len = sizeof tx_buf - 1U; /* truncated (mini_vsnprintf keeps the NUL) */
  }
  if (HAL_UART_Transmit_DMA(&huart1, (uint8_t *)tx_buf, (uint16_t)len) != HAL_OK)
  {
    Error_Handler();
  }
}

/* Reception event (ISR context): Size = DMA write position in rx_ring. */
void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size)
{
  if (huart->Instance != USART1 || Size == rx_pos)
  {
    return;
  }
  if (ev_head - ev_tail >= EVT_QUEUE_DEPTH)
  {
    rx_pos = Size % RX_RING_SIZE; /* queue full: the chunk is dropped */
    return;
  }
  RxChunk *e = &evq[ev_head % EVT_QUEUE_DEPTH];
  uint32_t n = 0;
  uint32_t p = rx_pos;
  while (p != Size && n < RX_RING_SIZE)
  {
    e->data[n++] = (char)rx_ring[p];
    p = (p + 1U) % RX_RING_SIZE;
    if (Size == RX_RING_SIZE && p == 0U)
    {
      break;
    }
  }
  e->data[n] = '\0';
  e->len = (uint8_t)n;
  e->type = (uint8_t)HAL_UARTEx_GetRxEventType(huart);
  ev_head++;
  rx_pos = Size % RX_RING_SIZE;
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
