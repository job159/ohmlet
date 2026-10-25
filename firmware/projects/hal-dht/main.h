/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-dht).
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
#define DHT_Pin GPIO_PIN_12
#define DHT_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** host start signal (AM2302: T_be 0.8-20 ms, typ 1 ms) */
#define DHT_START_US 1200U
/** first read after power-up (the sensor needs 2 s) and the read period (>= 2 s) */
#define DHT_FIRST_MS 2500U
#define DHT_PERIOD_MS 2500U
/** a data bit is '1' when its high phase is longer than this (26-28 us = 0, 70 us = 1) */
#define DHT_ONE_THRESHOLD_US 40U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
