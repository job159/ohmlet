/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-esp01).
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
/** ESP-01 AT firmware line rate (its boot ROM talks at 74880 first) */
#define ESP_BAUD       115200U
/** how long to wait for "ready" after CH_PD goes high (ms) */
#define READY_WAIT_MS  1500U
/** answer timeout of one AT command (ms) */
#define AT_TIMEOUT_MS  200U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
