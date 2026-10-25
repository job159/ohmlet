/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-hc05).
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
/** HC-05 AT mode line rate (fixed, datasheet) and the data rate configured with AT+UART */
#define HC05_AT_BAUD   38400U
#define HC05_DATA_BAUD 9600U
/** time the module needs to start after power-up (ms) */
#define START_WAIT_MS  120U
/** "AT" attempts and the answer timeout per line (ms) */
#define AT_TRIES       3U
#define AT_TIMEOUT_MS  20U
/** how long to wait for STATE after AT+RESET (ms) */
#define STATE_WAIT_MS  1000U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
