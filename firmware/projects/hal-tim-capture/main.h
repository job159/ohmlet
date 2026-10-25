/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-tim-capture).
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
void HAL_TIM_MspPostInit(TIM_HandleTypeDef *htim);
void Error_Handler(void);

/* USER CODE BEGIN Private defines */
/** both timers count TIMXCLK1 = 72 MHz with PSC 0 (13.9 ns per count) */
#define TIMER_HZ 72000000UL
/** time between measurement lines and between generator changes (HAL ticks = ms) */
#define REPORT_MS 250U
#define SWITCH_MS 1000U
/** first report this long after the start, so reports never coincide with a switch */
#define REPORT_PHASE_MS 125U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
