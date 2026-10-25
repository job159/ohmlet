/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-i2c-eeprom).
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
/** AT24C02 with A2 = A1 = A0 = 0: 7-bit address 0x50 (HAL wants it shifted left) */
#define EE_ADDR      (0x50U << 1)
/** test block: 16 bytes from 0x1C — crosses the page boundaries at 0x20 and 0x28 */
#define EE_START     0x1CU
#define EE_LEN       16U
/** AT24C02 page size (bytes) */
#define EE_PAGE      8U
/** give up waiting for the write cycle (t_WR max 5 ms) after this many ms */
#define EE_WRITE_TIMEOUT_MS 20U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
