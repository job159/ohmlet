/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-i3-offby1).
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

/* Private defines -----------------------------------------------------------*/
#define TICK_Pin GPIO_PIN_12
#define TICK_GPIO_Port GPIOB
#define LED_Pin GPIO_PIN_13
#define LED_GPIO_Port GPIOC

/* USER CODE BEGIN Private defines */
/** MISTAKE (on purpose): the register values were written WITHOUT the "- 1".
 *  Wanted 72 MHz / 72 = 1 MHz and 1000 counts; the hardware divides by PSC + 1
 *  and counts ARR + 1, so this gives 72 MHz / 73 / 1001 = 985.31 Hz
 *  (one update every 1014.903 µs) instead of 1 kHz. */
#define TICK_PRESCALER 72U
#define TICK_PERIOD 1000U
/** update interrupts per heartbeat half period: 500 × 1 ms = 500 ms → 1 Hz */
#define HEARTBEAT_HALF_TICKS 500U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
