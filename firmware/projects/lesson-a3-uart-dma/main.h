/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-a3-uart-dma).
  ******************************************************************************
  */
/* USER CODE END Header */

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f1xx_hal.h"

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */
/** reception mode chosen from the experiment jumpers at reset */
typedef enum
{
  RX_DMA_CIRCULAR = 0, /* the lesson: circular DMA + IDLE line detection */
  RX_DMA_NORMAL_ONCE,  /* PB12 low: DMA normal mode, never re-armed (the classic bug) */
  RX_INTERRUPT         /* PB13 low: RXNE interrupt for every byte + IDLE */
} RxMode;

extern RxMode rx_mode;
extern volatile uint32_t rx_irqs;   /* USART1 + DMA1 channel 5 interrupts taken */
extern volatile uint32_t rx_cycles; /* core cycles spent inside those handlers */
/** USART1_IRQHandler: IDLE right after the ring wrapped (HAL v1.1.9 reports no event then) */
void App_IdleAtWrap(void);
/* USER CODE END EFP */

/* USER CODE BEGIN Private defines */
/** circular DMA receive ring (bytes): HT after 16, TC after 32 */
#define RX_RING_SIZE 32U
/** longest message assembled from the reception events */
#define MSG_MAX 63U
/** complete messages waiting for the main loop (power of two) */
#define MSG_QUEUE_DEPTH 4U
/** the USART2 "sensor" sends one message every PEER_PERIOD_MS, the first PEER_FIRST_MS after boot */
#define PEER_PERIOD_MS 200U
#define PEER_FIRST_MS 100U
/** experiment jumpers (inputs with pull-up, read once at reset) */
#define JMP_NORMAL_Pin GPIO_PIN_12
#define JMP_IT_Pin GPIO_PIN_13
#define JMP_GPIO_Port GPIOB
/** PB0: high while the CPU is inside USART1_IRQHandler / DMA1_Channel5_IRQHandler
    (reception work the CPU does; watch it next to PA10 on a logic analyzer) */
#define ISR_Pin GPIO_PIN_0
#define ISR_GPIO_Port GPIOB
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
