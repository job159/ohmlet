/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lab-acceptance).
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

/* USER CODE BEGIN EFP */
/** application time base, called from SysTick_Handler right after HAL_IncTick() */
void App_Tick1ms(void);
/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define HEARTBEAT_Pin GPIO_PIN_13
#define HEARTBEAT_GPIO_Port GPIOC
#define LED_Pin GPIO_PIN_5
#define LED_GPIO_Port GPIOA
#define BTN_Pin GPIO_PIN_12
#define BTN_GPIO_Port GPIOB
#define BTN_EXTI_IRQn EXTI15_10_IRQn

/* USER CODE BEGIN Private defines */
/** a press counts once PB12 has stayed low this many HAL ticks (ms) after its last falling edge */
#define DEBOUNCE_MS 30U
/** on-board LED heartbeat: on for HEARTBEAT_ON_MS at the start of every HEARTBEAT_PERIOD_MS */
#define HEARTBEAT_PERIOD_MS 1000U
#define HEARTBEAT_ON_MS 50U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
