/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-stepper-uln2003).
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
/** ULN2003 board IN1..IN4 = PB12..PB15, push-pull (one BSRR store per step) */
#define IN1_Pin GPIO_PIN_12
#define IN2_Pin GPIO_PIN_13
#define IN3_Pin GPIO_PIN_14
#define IN4_Pin GPIO_PIN_15
#define IN_GPIO_Port GPIOB
#define IN_ALL (IN1_Pin | IN2_Pin | IN3_Pin | IN4_Pin)

/* USER CODE BEGIN Private defines */
/** 28BYJ-48: 4096 half steps per output revolution (64:1 gear train) */
#define HALF_STEPS_PER_REV 4096U
/** one half step every 2 ms (500 half steps/s ≈ 7.3 rpm) */
#define HALF_STEP_MS 2U
/** progress report every 1024 half steps (a quarter turn) */
#define REPORT_EVERY 1024U
/** pause between the two directions (ms) */
#define PAUSE_MS 500U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
