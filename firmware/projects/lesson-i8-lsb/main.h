/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-i8-lsb).
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
/** 74HC595 RCLK (storage register clock) on PA4, GPIO push-pull */
#define RCLK_Pin GPIO_PIN_4
#define RCLK_GPIO_Port GPIOA

/* USER CODE BEGIN Private defines */
/** one chaser step every STEP_MS HAL ticks (10 Hz) */
#define STEP_MS 100U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
