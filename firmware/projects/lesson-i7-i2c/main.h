/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-i7-i2c).
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
/** scanned 7-bit address range (0x00-0x07 and 0x78-0x7F are reserved, I2C-bus spec §3.1.12) */
#define SCAN_FIRST   0x08U
#define SCAN_LAST    0x77U
/** HAL_I2C_IsDeviceReady timeout per probe (ms) */
#define SCAN_TIMEOUT_MS 2U
/** AT24C02 with A2 = A1 = A0 = 0: 7-bit address 0x50 (HAL wants it shifted left) */
#define EE_ADDR      (0x50U << 1)
/** test block: 8 bytes at 0x10 = exactly one AT24C02 page (0x10-0x17) */
#define EE_START     0x10U
#define EE_LEN       8U
/** give up waiting for the write cycle (t_WR max 5 ms) after this many ms */
#define EE_WRITE_TIMEOUT_MS 20U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
