/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-i2c-scan).
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
/** first and last 7-bit address probed (0x00-0x07 and 0x78-0x7F are reserved, UM10204 §3.1.12) */
#define SCAN_FIRST 0x08U
#define SCAN_LAST  0x77U
/** HAL_I2C_IsDeviceReady timeout per address (ms) */
#define SCAN_TIMEOUT_MS 2U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
