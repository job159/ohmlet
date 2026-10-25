/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-tim-irq).
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
/** TIM4: 72 MHz / (71 + 1) = 1 MHz counter, ARR 999 → one update per 1000 µs */
#define TICK_PRESCALER 71U
#define TICK_PERIOD 999U
/** update interrupts per heartbeat half period: 500 × 1 ms = 500 ms → 1 Hz */
#define HEARTBEAT_HALF_TICKS 500U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
