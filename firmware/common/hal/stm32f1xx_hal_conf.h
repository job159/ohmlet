/*
 * HAL configuration for the STM32F103C8 "Blue Pill" test/example firmware,
 * equivalent to what STM32CubeMX generates for that board (8 MHz HSE crystal,
 * 32.768 kHz LSE, VDD 3.3 V, SysTick priority 15, prefetch on).
 * Modules are enabled as a superset; build.mjs links only the .c files a
 * project lists, so unused modules cost nothing.
 */
#ifndef __STM32F1xx_HAL_CONF_H
#define __STM32F1xx_HAL_CONF_H

#ifdef __cplusplus
extern "C" {
#endif

#define HAL_MODULE_ENABLED
#define HAL_ADC_MODULE_ENABLED
#define HAL_CORTEX_MODULE_ENABLED
#define HAL_CRC_MODULE_ENABLED
#define HAL_DMA_MODULE_ENABLED
#define HAL_EXTI_MODULE_ENABLED
#define HAL_FLASH_MODULE_ENABLED
#define HAL_GPIO_MODULE_ENABLED
#define HAL_I2C_MODULE_ENABLED
#define HAL_IWDG_MODULE_ENABLED
#define HAL_PWR_MODULE_ENABLED
#define HAL_RCC_MODULE_ENABLED
#define HAL_RTC_MODULE_ENABLED
#define HAL_SPI_MODULE_ENABLED
#define HAL_TIM_MODULE_ENABLED
#define HAL_UART_MODULE_ENABLED
#define HAL_WWDG_MODULE_ENABLED

#if !defined(HSE_VALUE)
#define HSE_VALUE 8000000U
#endif
#if !defined(HSE_STARTUP_TIMEOUT)
#define HSE_STARTUP_TIMEOUT 100U
#endif
#if !defined(HSI_VALUE)
#define HSI_VALUE 8000000U
#endif
#if !defined(LSI_VALUE)
#define LSI_VALUE 40000U
#endif
#if !defined(LSE_VALUE)
#define LSE_VALUE 32768U
#endif
#if !defined(LSE_STARTUP_TIMEOUT)
#define LSE_STARTUP_TIMEOUT 5000U
#endif

#define VDD_VALUE 3300U
#define TICK_INT_PRIORITY 15U
#define USE_RTOS 0U
#define PREFETCH_ENABLE 1U

#define USE_HAL_ADC_REGISTER_CALLBACKS 0U
#define USE_HAL_CAN_REGISTER_CALLBACKS 0U
#define USE_HAL_CEC_REGISTER_CALLBACKS 0U
#define USE_HAL_DAC_REGISTER_CALLBACKS 0U
#define USE_HAL_ETH_REGISTER_CALLBACKS 0U
#define USE_HAL_HCD_REGISTER_CALLBACKS 0U
#define USE_HAL_I2C_REGISTER_CALLBACKS 0U
#define USE_HAL_I2S_REGISTER_CALLBACKS 0U
#define USE_HAL_MMC_REGISTER_CALLBACKS 0U
#define USE_HAL_NAND_REGISTER_CALLBACKS 0U
#define USE_HAL_NOR_REGISTER_CALLBACKS 0U
#define USE_HAL_PCCARD_REGISTER_CALLBACKS 0U
#define USE_HAL_PCD_REGISTER_CALLBACKS 0U
#define USE_HAL_RTC_REGISTER_CALLBACKS 0U
#define USE_HAL_SD_REGISTER_CALLBACKS 0U
#define USE_HAL_SMARTCARD_REGISTER_CALLBACKS 0U
#define USE_HAL_IRDA_REGISTER_CALLBACKS 0U
#define USE_HAL_SRAM_REGISTER_CALLBACKS 0U
#define USE_HAL_SPI_REGISTER_CALLBACKS 0U
#define USE_HAL_TIM_REGISTER_CALLBACKS 0U
#define USE_HAL_UART_REGISTER_CALLBACKS 0U
#define USE_HAL_USART_REGISTER_CALLBACKS 0U
#define USE_HAL_WWDG_REGISTER_CALLBACKS 0U

#define USE_SPI_CRC 1U

#ifdef HAL_RCC_MODULE_ENABLED
#include "stm32f1xx_hal_rcc.h"
#endif
#ifdef HAL_GPIO_MODULE_ENABLED
#include "stm32f1xx_hal_gpio.h"
#endif
#ifdef HAL_EXTI_MODULE_ENABLED
#include "stm32f1xx_hal_exti.h"
#endif
#ifdef HAL_DMA_MODULE_ENABLED
#include "stm32f1xx_hal_dma.h"
#endif
#ifdef HAL_CORTEX_MODULE_ENABLED
#include "stm32f1xx_hal_cortex.h"
#endif
#ifdef HAL_ADC_MODULE_ENABLED
#include "stm32f1xx_hal_adc.h"
#endif
#ifdef HAL_CRC_MODULE_ENABLED
#include "stm32f1xx_hal_crc.h"
#endif
#ifdef HAL_FLASH_MODULE_ENABLED
#include "stm32f1xx_hal_flash.h"
#endif
#ifdef HAL_I2C_MODULE_ENABLED
#include "stm32f1xx_hal_i2c.h"
#endif
#ifdef HAL_IWDG_MODULE_ENABLED
#include "stm32f1xx_hal_iwdg.h"
#endif
#ifdef HAL_PWR_MODULE_ENABLED
#include "stm32f1xx_hal_pwr.h"
#endif
#ifdef HAL_RTC_MODULE_ENABLED
#include "stm32f1xx_hal_rtc.h"
#endif
#ifdef HAL_SPI_MODULE_ENABLED
#include "stm32f1xx_hal_spi.h"
#endif
#ifdef HAL_TIM_MODULE_ENABLED
#include "stm32f1xx_hal_tim.h"
#endif
#ifdef HAL_UART_MODULE_ENABLED
#include "stm32f1xx_hal_uart.h"
#endif
#ifdef HAL_WWDG_MODULE_ENABLED
#include "stm32f1xx_hal_wwdg.h"
#endif

#define assert_param(expr) ((void)0U)

#ifdef __cplusplus
}
#endif

#endif /* __STM32F1xx_HAL_CONF_H */
