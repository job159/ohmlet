/*
 * Bare-metal startup for STM32F103xB-class parts: vector table (16 system
 * exceptions + 43 IRQs, RM0008 Table 63), .data copy, .bss clear, main().
 * Every handler is a weak alias of Default_Handler, so a project defines only
 * the ones it uses — the same convention as ST's startup_stm32f103xb.s.
 */
#include <stdint.h>

extern uint32_t _estack, _sidata, _sdata, _edata, _sbss, _ebss;
extern void (*__init_array_start[])(void);
extern void (*__init_array_end[])(void);
int main(void);

void Reset_Handler(void);
void Default_Handler(void) { for (;;) {} }

#define WEAK __attribute__((weak, alias("Default_Handler")))
void NMI_Handler(void) WEAK;
void HardFault_Handler(void) WEAK;
void MemManage_Handler(void) WEAK;
void BusFault_Handler(void) WEAK;
void UsageFault_Handler(void) WEAK;
void SVC_Handler(void) WEAK;
void DebugMon_Handler(void) WEAK;
void PendSV_Handler(void) WEAK;
void SysTick_Handler(void) WEAK;
void WWDG_IRQHandler(void) WEAK;
void PVD_IRQHandler(void) WEAK;
void TAMPER_IRQHandler(void) WEAK;
void RTC_IRQHandler(void) WEAK;
void FLASH_IRQHandler(void) WEAK;
void RCC_IRQHandler(void) WEAK;
void EXTI0_IRQHandler(void) WEAK;
void EXTI1_IRQHandler(void) WEAK;
void EXTI2_IRQHandler(void) WEAK;
void EXTI3_IRQHandler(void) WEAK;
void EXTI4_IRQHandler(void) WEAK;
void DMA1_Channel1_IRQHandler(void) WEAK;
void DMA1_Channel2_IRQHandler(void) WEAK;
void DMA1_Channel3_IRQHandler(void) WEAK;
void DMA1_Channel4_IRQHandler(void) WEAK;
void DMA1_Channel5_IRQHandler(void) WEAK;
void DMA1_Channel6_IRQHandler(void) WEAK;
void DMA1_Channel7_IRQHandler(void) WEAK;
void ADC1_2_IRQHandler(void) WEAK;
void USB_HP_CAN1_TX_IRQHandler(void) WEAK;
void USB_LP_CAN1_RX0_IRQHandler(void) WEAK;
void CAN1_RX1_IRQHandler(void) WEAK;
void CAN1_SCE_IRQHandler(void) WEAK;
void EXTI9_5_IRQHandler(void) WEAK;
void TIM1_BRK_IRQHandler(void) WEAK;
void TIM1_UP_IRQHandler(void) WEAK;
void TIM1_TRG_COM_IRQHandler(void) WEAK;
void TIM1_CC_IRQHandler(void) WEAK;
void TIM2_IRQHandler(void) WEAK;
void TIM3_IRQHandler(void) WEAK;
void TIM4_IRQHandler(void) WEAK;
void I2C1_EV_IRQHandler(void) WEAK;
void I2C1_ER_IRQHandler(void) WEAK;
void I2C2_EV_IRQHandler(void) WEAK;
void I2C2_ER_IRQHandler(void) WEAK;
void SPI1_IRQHandler(void) WEAK;
void SPI2_IRQHandler(void) WEAK;
void USART1_IRQHandler(void) WEAK;
void USART2_IRQHandler(void) WEAK;
void USART3_IRQHandler(void) WEAK;
void EXTI15_10_IRQHandler(void) WEAK;
void RTC_Alarm_IRQHandler(void) WEAK;
void USBWakeUp_IRQHandler(void) WEAK;

__attribute__((section(".isr_vector"), used))
void (*const g_pfnVectors[16 + 43])(void) = {
  (void (*)(void))&_estack, Reset_Handler, NMI_Handler, HardFault_Handler,
  MemManage_Handler, BusFault_Handler, UsageFault_Handler, 0, 0, 0, 0,
  SVC_Handler, DebugMon_Handler, 0, PendSV_Handler, SysTick_Handler,
  WWDG_IRQHandler, PVD_IRQHandler, TAMPER_IRQHandler, RTC_IRQHandler,
  FLASH_IRQHandler, RCC_IRQHandler, EXTI0_IRQHandler, EXTI1_IRQHandler,
  EXTI2_IRQHandler, EXTI3_IRQHandler, EXTI4_IRQHandler,
  DMA1_Channel1_IRQHandler, DMA1_Channel2_IRQHandler, DMA1_Channel3_IRQHandler,
  DMA1_Channel4_IRQHandler, DMA1_Channel5_IRQHandler, DMA1_Channel6_IRQHandler,
  DMA1_Channel7_IRQHandler, ADC1_2_IRQHandler, USB_HP_CAN1_TX_IRQHandler,
  USB_LP_CAN1_RX0_IRQHandler, CAN1_RX1_IRQHandler, CAN1_SCE_IRQHandler,
  EXTI9_5_IRQHandler, TIM1_BRK_IRQHandler, TIM1_UP_IRQHandler,
  TIM1_TRG_COM_IRQHandler, TIM1_CC_IRQHandler, TIM2_IRQHandler, TIM3_IRQHandler,
  TIM4_IRQHandler, I2C1_EV_IRQHandler, I2C1_ER_IRQHandler, I2C2_EV_IRQHandler,
  I2C2_ER_IRQHandler, SPI1_IRQHandler, SPI2_IRQHandler, USART1_IRQHandler,
  USART2_IRQHandler, USART3_IRQHandler, EXTI15_10_IRQHandler,
  RTC_Alarm_IRQHandler, USBWakeUp_IRQHandler,
};

void Reset_Handler(void) {
  uint32_t *src = &_sidata, *dst = &_sdata;
  while (dst < &_edata) *dst++ = *src++;
  for (dst = &_sbss; dst < &_ebss;) *dst++ = 0;
  for (void (**f)(void) = __init_array_start; f < __init_array_end; f++) (*f)();
  main();
  for (;;) {}
}
