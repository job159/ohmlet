/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-a4-freertos).
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
#define LED_Pin GPIO_PIN_5
#define LED_GPIO_Port GPIOA
#define BTN_Pin GPIO_PIN_12
#define BTN_GPIO_Port GPIOB
#define BTN_EXTI_IRQn EXTI15_10_IRQn
#define HOG_Pin GPIO_PIN_13
#define HOG_GPIO_Port GPIOB
#define BADPRIO_Pin GPIO_PIN_14
#define BADPRIO_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** EXTI15_10 NVIC priority: 6 is legal for ...FromISR() calls (>= 5, see FreeRTOSConfig.h) */
#define BTN_IRQ_PRIORITY 6U
/** the PB14 experiment: priority 2 is ABOVE configMAX_SYSCALL_INTERRUPT_PRIORITY (5) */
#define BTN_IRQ_PRIORITY_BAD 2U
/** button lock-out after an accepted edge (contact bounce), ms */
#define BTN_LOCKOUT_MS 50U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
