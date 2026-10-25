/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-uart-hello).
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

/* USER CODE BEGIN Private defines */
/** period of the "tick N" lines (HAL ticks = ms) */
#define TICK_PERIOD_MS 1000U
/** received line buffer incl. the terminating NUL: lines keep their first 63 bytes */
#define RX_LINE_SIZE 64U
/** completed lines waiting to be echoed (must be a power of two) */
#define RX_QUEUE_DEPTH 4U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
