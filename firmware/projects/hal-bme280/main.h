/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-bme280).
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
/** BME280 / BMP280 7-bit address with SDO low (GY-BME280 pull-down), shifted for HAL */
#define BMX_ADDR (0x76U << 1)
/** registers (BME280 datasheet §5.3) */
#define BMX_CALIB00   0x88U
#define BMX_CALIB_H1  0xA1U
#define BMX_ID        0xD0U
#define BMX_CALIB26   0xE1U
#define BMX_CTRL_HUM  0xF2U
#define BMX_STATUS    0xF3U
#define BMX_CTRL_MEAS 0xF4U
#define BMX_CONFIG    0xF5U
#define BMX_DATA      0xF7U
#define BME280_CHIP_ID 0x60U
#define BMP280_CHIP_ID 0x58U
/** oversampling x16 (osrs = 101) for every channel, forced mode (01) */
#define OSRS_X16 5U
#define MODE_FORCED 1U
/** report period (ms) and the longest conversion we wait for (t_meas,max x16/x16/x16 = 112.8 ms) */
#define REPORT_PERIOD_MS 500U
#define CONVERSION_TIMEOUT_MS 150U
#define I2C_TIMEOUT_MS 10U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
