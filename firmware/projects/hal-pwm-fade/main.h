/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-pwm-fade).
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
/** TIM3: 72 MHz / 72 = 1 MHz counter, ARR 999 → 1 kHz PWM, CCR1 0..1000 = 0..100 % */
#define FADE_PRESCALER 71U
#define FADE_PERIOD 999U
/** CCR1 counts per percent of duty cycle */
#define COUNTS_PER_PERCENT 10U
/** PWM periods (1 ms each) per 1 % step: 100 steps up + 100 down = 2000 ms */
#define PERIODS_PER_STEP 10U
#define STEPS_PER_CYCLE 200U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
