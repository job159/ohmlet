/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-sg90).
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

/* Private defines -----------------------------------------------------------*/
/** SG90 signal: PA0 = TIM2_CH1 (AF push-pull) */
#define SERVO_SIG_Pin GPIO_PIN_0
#define SERVO_SIG_GPIO_Port GPIOA

/* USER CODE BEGIN Private defines */
/** TIM2: 72 MHz / 72 = 1 MHz (1 µs per count), ARR 19999 → 20 ms frame = 50 Hz */
#define TIM2_PRESCALER 71U
#define TIM2_PERIOD 19999U
/** first pulse: 0.5 ms = 0° */
#define TIM2_PULSE 500U
/** SG90: 0.5 ms = 0°, 2.5 ms = 180° */
#define SERVO_US_0 500
#define SERVO_US_180 2500
/** sweep: one 30° step every 500 ms */
#define SWEEP_STEP_DEG 30
#define SWEEP_STEP_MS 500U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
