/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-acs712).
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
#define ISENSE_Pin GPIO_PIN_0
#define ISENSE_GPIO_Port GPIOA

/* USER CODE BEGIN Private defines */
/** samples averaged per report, report period (ms) */
#define SAMPLES 16U
#define REPORT_PERIOD_MS 200U
/** ADC reference (VDDA, mV) and the ACS712-05B at VCC = 5.000 V: zero at 2500 mV, 185 mV/A */
#define VDDA_MV 3300U
#define ZERO_MV 2500
#define SENS_MV_PER_A 185
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
