/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-servo).
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
/** TIM2: 72 MHz / 72 = 1 MHz (1 µs per count), ARR 19999 → 20 ms = 50 Hz servo frame */
#define SERVO_PRESCALER 71U
#define SERVO_PERIOD 19999U
/** pulse width range and step (µs = counts) */
#define SERVO_MIN_US 1000
#define SERVO_MAX_US 2000
#define SERVO_STEP_US 100
/** time between steps (HAL ticks = ms) */
#define SERVO_STEP_MS 200U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
