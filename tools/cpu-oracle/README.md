# cpu-oracle — differential vectors for the Cortex-M3 core

`gen_vectors.py` produces `tests/fixtures/cpu/vectors-<family>.json.gz`, which
`tests/mcu/core/differential.test.ts` replays on our core (`src/mcu/core`).
The reference is **Unicorn Engine 2.1.4** — QEMU's ARMv7-M translator with the
Cortex-M3 CPU model (`UC_MODE_THUMB | UC_MODE_MCLASS`, `UC_CPU_ARM_CORTEX_M3`)
— an implementation written independently of ours.

**License boundary.** Unicorn is GPL-2.0. It is a development-time oracle
only: nothing in `src/` imports, bundles or copies it; this directory is never
part of the application build; only the generated vectors (Unicorn's
*output*: register and memory values) are committed.

## Regenerating

```sh
python -m venv .oracle && .oracle/Scripts/pip install unicorn==2.1.4   # (bin/ on Linux/macOS)
.oracle/Scripts/python tools/cpu-oracle/gen_vectors.py                 # all families
.oracle/Scripts/python tools/cpu-oracle/gen_vectors.py it sysreg       # some
.oracle/Scripts/python tools/cpu-oracle/gen_vectors.py --check         # byte-identical to the committed files?
OHMLET_CPU_VECTORS=<dir> npx vitest run tests/mcu/core/differential.test.ts   # replay vectors written with --out <dir>
```

Needs clang, ld.lld, llvm-objcopy and llvm-nm on PATH (or `OHMLET_CLANG_DIR`).
Generation is deterministic (fixed seed, `random.Random` per family, gzip
`mtime=0`): rerunning reproduces the committed files bit for bit. Set
`CPU_ORACLE_VERBOSE=1` to print the first rejected case of every rejection
reason.

## How a vector is made

1. A family generator emits a random but valid instruction sequence (1–7
   instructions, plus labels, literal data and branch tables) as UAL text.
   Operands are random; register values the sequence depends on (base
   registers, table indices, values later moved into SP) are chosen so every
   data access lands in the RAM window.
2. All cases of a family are assembled together by clang's integrated
   assembler and linked at 0x08000000. Cases the assembler rejects are
   dropped (it is the first validity filter).
3. Each case runs on a fresh Unicorn from its start label to its end label
   with random r0–r12/LR/APSR.NZCVQ, SP in the window and a 512-byte RAM
   window at 0x20000200 filled from a per-case xorshift32 seed (mirrored in
   the test). It runs **twice**: without hooks (the recorded result) and with
   memory hooks (every data access must hit the window, reads may also hit the
   code image) plus a code hook. A case is kept only if both runs reach the
   end label without an exception or invalid instruction and agree.
4. Recorded: r0–r12, LR, SP, xPSR (IT field 0, see below), the RAM words that
   changed, and for `sysreg` CONTROL (+ PRIMASK/BASEPRI/FAULTMASK when the case
   ends privileged).

## Families (27,400 cases)

| family | cases | what |
|---|---|---|
| alu16 | 2400 | every 16-bit data-processing encoding (shift imm, add/sub reg/imm3/imm8, the 16 ALU ops, high-register ADD/CMP/MOV, extends, REV*) |
| dp_imm | 2000 | 32-bit modified-immediate ops, S and non-S, every ThumbExpandImm form (carry out of rotated immediates) |
| dp_plain | 2000 | ADDW/SUBW/MOVW/MOVT, SSAT/USAT with LSL/ASR (Q flag), SBFX/UBFX/BFI/BFC |
| dp_shift | 2400 | 32-bit shifted-register ops incl. RRX, MOV/MVN shifts, TST/TEQ/CMP/CMN with shifts |
| dp_reg | 1600 | register-controlled shifts (amounts ≥ 32, 255, 256 …), SXT*/UXT* with rotation, REV*/RBIT/CLZ |
| mul_div | 1600 | MUL/MULS/MLA/MLS, S/UMULL, S/UMLAL, SDIV/UDIV incl. ÷0 and INT_MIN/−1 |
| ldst_imm | 2400 | LDR/STR B/H/SB/SH: 16-bit imm5, SP-relative, imm12, negative imm8, pre/post-indexed write-back, LDRT-class; aligned and unaligned |
| ldst_reg | 1600 | register offset (16-bit, LSL #0–3 with wrapping index), literal loads forward/backward, unaligned literal addresses |
| ldst_multi | 2000 | LDM/STM 16/32-bit, IA/DB, write-back rules, base in list, PUSH/POP 16/32, LDRD/STRD offset/pre/post |
| excl | 1200 | LDREX/STREX (B/H/word, imm offset), monitor closed by CLREX/STREX, STREX without LDREX |
| branch | 2000 | B/B<c> 16/32, BL, BX/BLX, CBZ/CBNZ, MOV/ADD PC, LDR PC (literal and from memory), POP/LDM/LDMDB {…,PC}, TBB/TBH (PC and register base), counted backward loops |
| it | 2000 | IT blocks of 1–4 slots (then/else, AL) with 16-bit ops that do not set flags inside IT, flag-setting compares inside the block, 32-bit S ops, conditional loads/stores, a branch as the last slot |
| sp | 1400 | every SP arithmetic form, MOV SP, LDR/STR SP, LDR SP (reg/write-back/literal), SP write-back bases, LDRD/STRD on SP, CMP SP |
| pcrel | 1400 | ADR T1/T2/T3, ADD/MOV Rd, PC, literal loads of every size, LDRD literal, ADDW/SUBW Rd, PC, TBB [PC] — at both PC alignments |
| sysreg | 1400 | MRS of every xPSR view, MSR APSR_nzcvq, PRIMASK/BASEPRI/BASEPRI_MAX/FAULTMASK/CONTROL/MSP/PSP, CPS, unprivileged MRS/MSR after CONTROL.nPRIV, SPSEL stack switch |

## What is never generated, and why

UNPREDICTABLE and IMPLEMENTATION DEFINED encodings or operand combinations
(SP/PC where the ARM ARM forbids them, STM with the base in the list at a
position other than the lowest when written back — UNKNOWN, LDM write-back
with the base in the list, RdHi = RdLo, STREX with Rd = Rt/Rn, …), anything
that raises an exception (UDF, SVC, BKPT, faults), and the patterns below
where Unicorn 2.1.4 deviates from the architecture or from the Cortex-M3
(`QUIRKS` in the script). Every one of these has a directed test in
`tests/mcu/core` instead.

| quirk | Unicorn / QEMU | architecture (DDI 0403E unless noted) |
|---|---|---|
| unaligned-ldm-ldrd | LDM/STM/LDRD/STRD/LDREX at an address that is not word aligned complete | MemA[] accesses: UsageFault UNALIGNED regardless of CCR.UNALIGN_TRP (A3.2.1) |
| sp-low-bits | `MOV SP, Rm` / `ADD SP, Rm` with Rm[1:0] ≠ 0 keep the low bits | Cortex-M3 SP ignores writes to bits [1:0] (Cortex-M3 TRM DDI 0337 §2.3.2; B1.4.1) |
| strex-address | STREX to an address/size other than the last LDREX's fails without an access (QEMU compares address and value) | whether the local monitor checks the address is IMPLEMENTATION DEFINED (A3.4.5); the Cortex-M3 monitor holds no address: any STREX matches the last LDREX (Cortex-M3 TRM DDI 0337, "Exclusive monitor") |
| interworking-even | BX/BLX/LDR PC/POP PC to an even address branches | BXWritePC/LoadWritePC clear EPSR.T; the next instruction raises INVSTATE (A2.3.1, B1.4.2) |
| yield-wfi-wfe | YIELD stops Unicorn with UC_ERR_INSN_INVALID | hints; WFI/WFE/SEV belong to the sleep model, not to the register state |
| it-readout | reg_read(XPSR) after emu_start can still show the IT field of a finished IT block | ITSTATE is 0 after the last instruction of a block (ITAdvance, A7.3.3); all cases end outside IT, so IT is recorded as 0 |
| unicorn-hooks | with memory hooks installed, some IT blocks containing a load/store continue with a wrong IT state (11 of 2,011 `it` candidates) | A7.3.3; such cases are rejected by the two-run comparison |
| control-fpca | MSR CONTROL keeps bit 2 (FPCA) on the Cortex-M3 model | without the FP extension CONTROL is nPRIV/SPSEL only (B1.4.4, MSR B5.2.3) |
| basepri-bits | BASEPRI keeps all 8 bits | the number of priority bits is IMPLEMENTATION DEFINED (B1.5.4); `sysreg` therefore runs our core with `priorityBits: 8`; the STM32 4-bit behaviour has directed tests |

## Mismatches found

The first replay found one real bug in our core, now fixed: unprivileged
`MRS Rd, PRIMASK|BASEPRI|BASEPRI_MAX|FAULTMASK` returned the register; the
MRS pseudocode (B5.2.2) reads these only when CurrentModeIsPrivileged(), so
unprivileged code reads zero (CONTROL and the xPSR views stay readable).
Every other difference traced back to a Unicorn quirk in the table above.
