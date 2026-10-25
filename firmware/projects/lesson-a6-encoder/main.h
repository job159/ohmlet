/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-a6-encoder).
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
#define SW_Pin GPIO_PIN_12
#define SW_GPIO_Port GPIOB
#define RAW_Pin GPIO_PIN_13
#define RAW_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** IC1F / IC2F = 15: an edge must hold 256 timer clocks (3.6 us at 72 MHz) */
#define ENCODER_FILTER 15U
/** encoder mode 3 counts 4 edges per detent (one quadrature cycle) */
#define COUNTS_PER_DETENT 4
/** push-switch debounce window (ms) */
#define DEBOUNCE_MS 20U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
