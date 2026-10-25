/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-i4-nomoe).
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
/* Timer kernel clocks at 72 MHz: TIM2/TIM3 on APB1 (36 MHz, ×2), TIM1 on APB2 (72 MHz) */
#define PWM2_PRESCALER 71U   /* 72 MHz / 72 = 1 MHz */
#define PWM2_PERIOD 999U     /* 1000 µs → 1 kHz */
#define PWM2_PULSE 250U      /* 25 % */
#define PWM3_PRESCALER 0U    /* 72 MHz */
#define PWM3_PERIOD 3599U    /* 3600 ticks → 20 kHz */
#define PWM3_PULSE 1800U     /* 50 % */
#define PWM1_PRESCALER 71U   /* 1 MHz */
#define PWM1_PERIOD 499U     /* 500 µs → 2 kHz */
#define PWM1_PULSE 375U      /* 75 % */
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
