#!/usr/bin/env python3
"""
Differential test vectors for the Cortex-M3 core (src/mcu/core) from an
INDEPENDENT reference: Unicorn Engine 2.1.4 (QEMU's ARMv7-M translator) with
the Cortex-M3 CPU model.

    <venv>/python tools/cpu-oracle/gen_vectors.py              # every family
    <venv>/python tools/cpu-oracle/gen_vectors.py alu16 mem    # selected families
    <venv>/python tools/cpu-oracle/gen_vectors.py --check      # regenerate, compare with the committed files

For every instruction family a deterministic RNG (seed below) generates
randomized but VALID instruction sequences as assembly text. The family is
assembled with clang's integrated assembler, linked at 0x08000000 with ld.lld
and every case is run on a fresh Unicorn instance from its start label to its
end label with random r0-r12/LR/APSR(NZCVQ) and a 512-byte RAM window filled
from a per-case xorshift32 seed. A case is kept only if Unicorn reaches the end
label without an exception, an invalid instruction or a memory access outside
the window (reads may also hit the code image). The final r0-r12, SP, LR, PC,
xPSR, the changed RAM words and (family `sysreg`) the special registers are
written to tests/fixtures/cpu/vectors-<family>.json.gz, which
tests/mcu/core/differential.test.ts replays on our core.

What is never generated (README.md lists the reasons with ARM ARM citations):
UNPREDICTABLE and IMPLEMENTATION DEFINED encodings or operand combinations,
exception-raising sequences, and the patterns where QEMU/Unicorn deviates from
the architecture (QUIRKS below).

LICENSE NOTE: Unicorn is GPL-2.0. It is a development-time oracle only: this
script is never imported or bundled by the application, nothing of Unicorn is
copied into src/, and only its OUTPUT (the vectors) is committed.
"""
import argparse
import gzip
import io
import json
import os
import random
import subprocess
import sys
import tempfile

try:
    from unicorn import Uc, UcError, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_INTR, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE
    from unicorn import arm_const as A
    import unicorn
except ImportError:  # pragma: no cover
    sys.exit('gen_vectors.py needs the unicorn package (pip install unicorn==2.1.4)')

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'tests', 'fixtures', 'cpu')
EXE = '.exe' if os.name == 'nt' else ''
TOOLDIR = os.environ.get('OHMLET_CLANG_DIR')

SEED = 0x0C0FFEE3
M = 0xFFFFFFFF
CODE_BASE = 0x08000000
RAM_MAP = 0x20000000  # Unicorn mapping (one 4 KiB page)
WIN = 0x20000200  # data window: every data access must fall inside it
WIN_SIZE = 0x200
SP_LO, SP_HI = 0x20000300, 0x20000378  # initial SP (8-byte aligned, inside the window)
MAX_INSNS = 400

# Known QEMU/Unicorn 2.1.4 deviations from the architecture (never generated; see README.md):
QUIRKS = [
    ('unaligned-ldm-ldrd',
     'LDM/STM/LDRD/STRD/LDREX at an address that is not word aligned complete in Unicorn; '
     'they are MemA[] accesses and raise UsageFault UNALIGNED (DDI 0403E A3.2.1, A7.7.41/A7.7.50)'),
    ('sp-low-bits',
     'writes of a value with bits[1:0] != 0 to SP (MOV/ADD SP, ...) keep those bits in Unicorn; '
     'Cortex-M3 SP ignores writes to bits[1:0] (Cortex-M3 TRM DDI 0337 §2.3.2, DDI 0403E B1.4.1)'),
    ('strex-address',
     'STREX to an address/size other than the last LDREX fails in Unicorn (QEMU compares address, '
     'size and value); whether the local monitor checks the address is IMPLEMENTATION DEFINED (A3.4.5)'),
    ('interworking-even',
     'BX/BLX/LDR PC/POP PC to an address with bit 0 clear branches in Unicorn instead of raising '
     'INVSTATE on the next instruction (A2.3.1 BXWritePC/LoadWritePC, B1.4.2 EPSR.T)'),
    ('yield-wfi-wfe',
     'YIELD stops Unicorn with UC_ERR_INSN_INVALID; WFI/WFE/SEV interact with the sleep model, '
     'not with architectural registers (A7.7.x hints): excluded'),
    ('it-readout',
     'after emu_start() stops, reg_read(XPSR) can still show the IT field of an IT block that has '
     'completed (QEMU keeps ITSTATE in the translator until the TB ends); every case ends outside an '
     'IT block, where ITSTATE is 0 by ITAdvance() (A7.3.3), so the vectors record IT = 0'),
    ('unicorn-hooks',
     'with UC_HOOK_MEM_READ/WRITE installed, some sequences with a load or store inside an IT block '
     'continue with a wrong IT state (a later conditional instruction is skipped or executed '
     'against its condition, A7.3.3); every case is run without hooks (recorded) and with memory + '
     'code hooks (window check) and kept only when the two runs agree'),
    ('control-fpca',
     'MSR CONTROL stores bit 2 (FPCA) in Unicorn\'s Cortex-M3 model; without the FP extension CONTROL '
     'has only nPRIV and SPSEL and bit 2 is reserved (B1.4.4, MSR pseudocode B5.2.3): values written '
     'to CONTROL have bit 2 clear'),
    ('dsp-on-m3',
     'Unicorn\'s Cortex-M3 model executes ARMv7E-M DSP encodings (PKH*, SXTA*/UXTA*, *16 extends, '
     'parallel add/subtract, QADD..., SEL, SMLA<x><y>, SMLAD, SMMUL, USAD8, SMLAL<x><y>, SMLALD, '
     'UMAAL); the Cortex-M3 has no DSP extension, they are UNDEFINED (A5.3 tables, "ARMv7E-M"); raw '
     'cases that Unicorn executes and is_dsp() classifies as DSP are rejected'),
    ('basepri-bits',
     'QEMU stores all 8 bits of BASEPRI (no NVIC priority-bit masking); the sysreg family therefore '
     'runs our core with priorityBits = 8 (the number of implemented priority bits is '
     'IMPLEMENTATION DEFINED, B1.5.4); the 4-bit STM32 behaviour has directed tests'),
]

LOW = list(range(8))
GP = list(range(13)) + [14]
HI = [8, 9, 10, 11, 12, 14]
CONDS = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le']
SPECIAL = [0, 1, 2, 3, 4, 0x7FFFFFFF, 0x80000000, 0x80000001, 0xFFFFFFFF, 0xFFFFFFFE, 0x7FFFFFFE,
           0x8000, 0x7FFF, 0xFFFF, 0x10000, 0xFFFF8000, 0xFFFF7FFF, 0xFF, 0x80, 0x7F, 0x100, 0xFF00,
           0xFF000000, 0x00FF0000, 0x55555555, 0xAAAAAAAA, 0x1F, 0x20, 0x21, 0x3F, 0x40, 0xFF80, 0xFFFFFF80]


def tool(name):
    return os.path.join(TOOLDIR, name + EXE) if TOOLDIR else name + EXE


def rname(r):
    return {13: 'sp', 14: 'lr', 15: 'pc'}.get(r, 'r%d' % r)


def thumb_expand(imm12):
    """ThumbExpandImm (DDI 0403E A5.3.2)"""
    imm8 = imm12 & 0xFF
    if imm12 & 0xC00 == 0:
        return [imm8, (imm8 << 16) | imm8, (imm8 << 24) | (imm8 << 8), imm8 * 0x01010101][(imm12 >> 8) & 3]
    unrot = 0x80 | (imm12 & 0x7F)
    rot = (imm12 >> 7) & 31
    return ((unrot >> rot) | (unrot << (32 - rot))) & M


def ram_fill(seed):
    """the RAM window's initial contents: xorshift32 words (mirrored in differential.test.ts)"""
    x = seed & M
    out = bytearray(WIN_SIZE)
    for i in range(0, WIN_SIZE, 4):
        x ^= (x << 13) & M
        x ^= x >> 17
        x ^= (x << 5) & M
        out[i:i + 4] = x.to_bytes(4, 'little')
    return bytes(out)


class Gen:
    """one case under construction: assembly lines plus the register values it relies on"""

    def __init__(self, rng, idx):
        self.rng = rng
        self.idx = idx
        self.pre = []  # data placed before the code (jumped over): backward literal targets
        self.body = []
        self.post = []  # after the end label: literals, tables (never executed)
        self.fixed = {}  # register -> initial value the generator relies on
        self.written = set()  # registers written by the sequence so far (value unknown)
        self.cur = {}  # registers whose current value is tracked (base registers)
        self.nlab = 0
        self.sp = rng.randrange(SP_LO, SP_HI + 1, 8)
        self.psp = rng.randrange(WIN + 0x40, WIN + 0xC0, 8)
        self.apsr = rng.getrandbits(5) << 27
        self.config = None

    # -------------------------------------------------------------- helpers
    def r(self, pool=GP, avoid=()):
        c = [x for x in pool if x not in avoid]
        return self.rng.choice(c)

    def lab(self):
        self.nlab += 1
        return 'c%d_l%d' % (self.idx, self.nlab)

    def e(self, s):
        self.body.append(s)

    def val(self):
        rng = self.rng
        p = rng.random()
        if p < 0.34:
            return rng.getrandbits(32)
        if p < 0.54:
            return rng.choice(SPECIAL)
        if p < 0.68:
            return rng.randrange(0, 40)
        if p < 0.76:
            return (-rng.randrange(1, 40)) & M
        if p < 0.84:
            return rng.getrandbits(16)
        if p < 0.92:
            return (rng.getrandbits(8) << rng.randrange(0, 25)) & M
        if p < 0.96:
            return rng.choice([255, 256, 257, 0x1FF, 0xFFFFFF00 | rng.randrange(0, 40)])
        return 1 << rng.randrange(32)

    def wr(self, *regs):
        """the sequence writes these registers (their values are no longer tracked)"""
        for x in regs:
            self.written.add(x)
            self.cur.pop(x, None)

    def fresh(self, pool=GP, avoid=()):
        """a register not yet written or fixed (its initial value can still be chosen)"""
        c = [x for x in pool if x not in avoid and x not in self.written and x not in self.fixed]
        return self.rng.choice(c) if c else None

    def fix(self, reg, value):
        self.fixed[reg] = value & M
        self.cur[reg] = value & M

    def init_regs(self):
        return [self.fixed[i] if i in self.fixed else self.val() for i in list(range(13)) + [14]]

    def mod_imm(self):
        while True:
            i12 = self.rng.getrandbits(12)
            if i12 & 0xC00 == 0 and i12 & 0x300 and i12 & 0xFF == 0:
                continue  # imm8 = 0 with a replicated pattern is UNPREDICTABLE (A5.3.2)
            return thumb_expand(i12)

    def target(self, size, align=None):
        """a random address in the data window for an access of `size` bytes"""
        a = align if align is not None else size
        if a > 1 and self.rng.random() < 0.2 and align is None:
            a = 1  # unaligned LDR/STR/LDRH/STRH are architecturally allowed on ARMv7-M (A3.2.1)
        hi = WIN_SIZE - size
        return WIN + self.rng.randrange(0, hi // a + 1) * a

    def base_for(self, lo, hi, step, size, align=None, avoid=()):
        """
        choose a base register and an offset in [lo, hi] (multiple of `step`) so that
        base + offset is a valid window address. Reuses a tracked base when possible.
        Returns (reg, offset) or None.
        """
        rng = self.rng
        tracked = [x for x in self.cur if x not in avoid and x not in (13,)]
        if tracked and rng.random() < 0.35:
            b = rng.choice(tracked)
            for _ in range(8):
                t = self.target(size, align)
                off = t - self.cur[b]
                if lo <= off <= hi and off % step == 0:
                    return b, off
        b = self.fresh(GP, avoid)
        if b is None:
            return None
        t = self.target(size, align)
        off = rng.randrange(-(-lo // step), hi // step + 1) * step if hi > lo else lo  # (ceil(lo/step))
        self.fix(b, t - off)
        return b, off

    # ------------------------------------------------------------- emission
    def asm(self):
        lines = []
        if self.pre:
            skip = self.lab()
            lines += ['  b.w %s' % skip, '  .p2align 2'] + self.pre + ['%s:' % skip]
        return lines + self.body


# =========================================================== instruction families

def alu16(g):
    rng = g.rng
    lo = lambda *av: g.r(LOW, av)
    for _ in range(rng.randrange(1, 7)):
        k = rng.randrange(25)
        d, n, m = lo(), lo(), lo()
        if k == 0:
            g.e('lsls.n %s, %s, #%d' % (rname(d), rname(m), rng.randrange(0, 32)))
        elif k == 1:
            g.e('%s.n %s, %s, #%d' % (rng.choice(['lsrs', 'asrs']), rname(d), rname(m), rng.randrange(1, 33)))
        elif k == 2:
            g.e('%s.n %s, %s, %s' % (rng.choice(['adds', 'subs']), rname(d), rname(n), rname(m)))
        elif k == 3:
            g.e('%s.n %s, %s, #%d' % (rng.choice(['adds', 'subs']), rname(d), rname(n), rng.randrange(8)))
        elif k == 4:
            g.e('movs.n %s, #%d' % (rname(d), rng.randrange(256)))
        elif k == 5:
            g.e('cmp.n %s, #%d' % (rname(n), rng.randrange(256)))
        elif k == 6:
            g.e('%s.n %s, #%d' % (rng.choice(['adds', 'subs']), rname(d), rng.randrange(256)))
        elif k <= 10:
            op = rng.choice(['ands', 'eors', 'lsls', 'lsrs', 'asrs', 'adcs', 'sbcs', 'rors', 'orrs', 'bics'])
            g.e('%s.n %s, %s' % (op, rname(d), rname(m)))
        elif k == 11:
            g.e('%s.n %s, %s' % (rng.choice(['tst', 'cmp', 'cmn']), rname(n), rname(m)))
        elif k == 12:
            g.e('rsbs.n %s, %s, #0' % (rname(d), rname(n)))
        elif k == 13:
            g.e('muls.n %s, %s, %s' % (rname(d), rname(n), rname(d)))
        elif k == 14:
            g.e('mvns.n %s, %s' % (rname(d), rname(m)))
        elif k <= 16:
            # ADD (register) T2: any of r0-r12, lr (both low is allowed from ARMv6T2 on)
            g.e('add.n %s, %s' % (rname(g.r()), rname(g.r())))
        elif k == 17:
            a = g.r()
            b = g.r(HI) if a < 8 else g.r()
            if rng.random() < 0.5:
                a, b = b, a
            g.e('cmp.n %s, %s' % (rname(a), rname(b)))  # CMP T2: not both low (UNPREDICTABLE)
        elif k <= 19:
            g.e('mov.n %s, %s' % (rname(g.r()), rname(g.r())))
        elif k <= 21:
            g.e('%s.n %s, %s' % (rng.choice(['sxth', 'sxtb', 'uxth', 'uxtb']), rname(d), rname(m)))
        else:
            g.e('%s.n %s, %s' % (rng.choice(['rev', 'rev16', 'revsh']), rname(d), rname(m)))


DP_OPS = ['and', 'bic', 'orr', 'orn', 'eor', 'add', 'adc', 'sbc', 'sub', 'rsb']


def wide(op):
    return op if op in ('orn', 'teq') else op + '.w'


def dp_imm(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 6)):
        k = rng.randrange(10)
        s = rng.choice(['', 's'])
        d, n = g.r(), g.r()
        imm = g.mod_imm()
        if k < 6:
            # (only ADD/SUB have 16-bit immediate forms; clang rejects `.w` on e.g. ADC/SBC immediate)
            op = rng.choice(DP_OPS)
            g.e('%s%s%s %s, %s, #0x%x' % (op, s, '.w' if op in ('add', 'sub') else '', rname(d), rname(n), imm))
        elif k < 8:
            op = rng.choice(['mov', 'mvn'])
            g.e('%s%s%s %s, #0x%x' % (op, s, '.w' if op == 'mov' else '', rname(d), imm))
        else:
            op = rng.choice(['tst.w', 'teq', 'cmn.w', 'cmp.w'])
            g.e('%s %s, #0x%x' % (op, rname(n), imm))


def dp_plain(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 6)):
        k = rng.randrange(9)
        d, n = g.r(), g.r()
        if k == 0:
            g.e('%s %s, %s, #%d' % (rng.choice(['addw', 'subw']), rname(d), rname(n), rng.randrange(4096)))
        elif k == 1:
            g.e('%s %s, #0x%x' % (rng.choice(['movw', 'movt']), rname(d), rng.getrandbits(16)))
        elif k <= 3:
            sh = rng.choice(['', ', lsl #%d' % rng.randrange(1, 32), ', asr #%d' % rng.randrange(1, 32)])
            if rng.random() < 0.5:
                g.e('ssat %s, #%d, %s%s' % (rname(d), rng.randrange(1, 33), rname(n), sh))
            else:
                g.e('usat %s, #%d, %s%s' % (rname(d), rng.randrange(0, 32), rname(n), sh))
        elif k <= 5:
            lsb = rng.randrange(32)
            w = rng.randrange(1, 33 - lsb)
            g.e('%s %s, %s, #%d, #%d' % (rng.choice(['sbfx', 'ubfx']), rname(d), rname(n), lsb, w))
        elif k <= 7:
            lsb = rng.randrange(32)
            w = rng.randrange(1, 33 - lsb)
            g.e('bfi %s, %s, #%d, #%d' % (rname(d), rname(n), lsb, w))
        else:
            lsb = rng.randrange(32)
            w = rng.randrange(1, 33 - lsb)
            g.e('bfc %s, #%d, #%d' % (rname(d), lsb, w))


def shift_text(rng, allow_none=True):
    k = rng.randrange(6 if allow_none else 5)
    if k == 0:
        return ', lsl #%d' % rng.randrange(1, 32)
    if k == 1:
        return ', lsr #%d' % rng.randrange(1, 33)
    if k == 2:
        return ', asr #%d' % rng.randrange(1, 33)
    if k == 3:
        return ', ror #%d' % rng.randrange(1, 32)
    if k == 4:
        return ', rrx'
    return ''


def dp_shift(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 6)):
        k = rng.randrange(10)
        s = rng.choice(['', 's'])
        d, n, m = g.r(), g.r(), g.r()
        if k < 5:
            op = rng.choice(DP_OPS)
            g.e('%s %s, %s, %s%s' % (wide(op + s) if op != 'orn' else 'orn' + s, rname(d), rname(n), rname(m), shift_text(rng)))
        elif k < 7:
            op = rng.choice(['mov', 'mvn'])
            g.e('%s%s.w %s, %s%s' % (op, s, rname(d), rname(m), shift_text(rng)))
        elif k < 8:
            x = rng.randrange(5)
            if x == 4:
                g.e('rrx%s %s, %s' % (s, rname(d), rname(m)))
            else:
                op = ['lsl', 'lsr', 'asr', 'ror'][x]
                amt = rng.randrange(1, 32) if op in ('lsl', 'ror') else rng.randrange(1, 33)
                g.e('%s%s.w %s, %s, #%d' % (op, s, rname(d), rname(m), amt))
        else:
            op = rng.choice(['tst.w', 'teq.w', 'cmn.w', 'cmp.w'])
            g.e('%s %s, %s%s' % (op, rname(n), rname(m), shift_text(rng)))


def dp_reg(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 6)):
        k = rng.randrange(8)
        d, n, m = g.r(), g.r(), g.r()
        if k < 4:
            op = rng.choice(['lsl', 'lsr', 'asr', 'ror']) + rng.choice(['', 's'])
            g.e('%s.w %s, %s, %s' % (op, rname(d), rname(n), rname(m)))
        elif k < 6:
            rot = rng.choice(['', '', ', ror #8', ', ror #16', ', ror #24'])
            g.e('%s.w %s, %s%s' % (rng.choice(['sxtb', 'sxth', 'uxtb', 'uxth']), rname(d), rname(m), rot))
        else:
            op = rng.choice(['rev.w', 'rev16.w', 'revsh.w', 'rbit', 'clz'])
            g.e('%s %s, %s' % (op, rname(d), rname(m)))


def mul_div(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 5)):
        k = rng.randrange(10)
        d, n, m, a = g.r(), g.r(), g.r(), g.r()
        if k == 0:
            g.e('mul %s, %s, %s' % (rname(d), rname(n), rname(m)))  # outside IT: the 32-bit T2 encoding
        elif k == 1:
            x, y = g.r(LOW), g.r(LOW)
            g.e('muls.n %s, %s, %s' % (rname(x), rname(y), rname(x)))
        elif k == 2:
            g.e('%s %s, %s, %s, %s' % (rng.choice(['mla', 'mls']), rname(d), rname(n), rname(m), rname(a)))
        elif k <= 6:
            lo_ = g.r()
            hi_ = g.r(GP, (lo_,))  # RdHi == RdLo is UNPREDICTABLE
            g.e('%s %s, %s, %s, %s' % (rng.choice(['smull', 'umull', 'smlal', 'umlal']), rname(lo_), rname(hi_), rname(n), rname(m)))
        else:
            g.e('%s %s, %s, %s' % (rng.choice(['sdiv', 'udiv']), rname(d), rname(n), rname(m)))


def alu_noise(g, avoid=()):
    """a data-processing instruction that does not touch tracked base registers"""
    rng = g.rng
    prot = set(avoid) | set(g.cur)
    pool = [x for x in GP if x not in prot]
    if not pool:
        return
    d = rng.choice(pool)
    n, m = g.r(), g.r()
    k = rng.randrange(4)
    if k == 0:
        g.e('adds.w %s, %s, %s' % (rname(d), rname(n), rname(m)))
    elif k == 1:
        g.e('eor.w %s, %s, %s, ror #%d' % (rname(d), rname(n), rname(m), rng.randrange(1, 32)))
    elif k == 2:
        g.e('mov.w %s, #0x%x' % (rname(d), g.mod_imm()))
    else:
        g.e('cmp.w %s, %s' % (rname(n), rname(m)))
        return
    g.wr(d)


LD_OPS = [('ldr', 4, False), ('ldrb', 1, False), ('ldrh', 2, False), ('ldrsb', 1, True), ('ldrsh', 2, True)]
ST_OPS = [('str', 4), ('strb', 1), ('strh', 2)]


def mem_single(g):
    """one LDR/STR-class access with an immediate offset"""
    rng = g.rng
    load = rng.random() < 0.55
    if load:
        op, size, _ = rng.choice(LD_OPS)
    else:
        op, size = rng.choice(ST_OPS)
    k = rng.randrange(7)
    if k == 0 and op in ('ldr', 'ldrb', 'ldrh', 'str', 'strb', 'strh'):
        # 16-bit T1: low registers, imm5 scaled
        r = g.base_for(0, 31 * size, size, size, align=size, avoid=tuple(range(8, 15)))
        if r is None:
            return
        b, off = r
        if b > 7:
            return
        t = g.r(LOW)
        g.e('%s.n %s, [%s, #%d]' % (op, rname(t), rname(b), off))
    elif k == 1 and op in ('ldr', 'str'):
        # SP-relative T2 (16-bit): imm8 * 4
        hi = min(1020, (WIN + WIN_SIZE - 4 - g.sp) // 4 * 4)
        if hi < 0:
            return
        t = g.r(LOW)
        g.e('%s.n %s, [sp, #%d]' % (op, rname(t), rng.randrange(0, hi // 4 + 1) * 4))
        b = None
    elif k <= 3:
        # T3: [Rn, #imm12]
        r = g.base_for(0, 4095, 1, size)
        if r is None:
            return
        b, off = r
        t = g.r(GP)
        g.e('%s.w %s, [%s, #%d]' % (op, rname(t), rname(b), off))
    elif k == 4:
        # T4 negative offset
        r = g.base_for(-255, -1, 1, size)
        if r is None:
            return
        b, off = r
        t = g.r(GP)
        g.e('%s %s, [%s, #%d]' % (op, rname(t), rname(b), off))
    elif k == 5:
        # T4 pre/post-indexed with writeback; Rt != Rn
        pre = rng.random() < 0.5
        r = g.base_for(-255, 255, 1, size) if pre else g.base_for(0, 0, 1, size)
        if r is None:
            return
        b, off = r
        if not pre:
            off = rng.randrange(-255, 256)
        t = g.r(GP, (b,))
        if pre:
            g.e('%s %s, [%s, #%d]!' % (op, rname(t), rname(b), off))
        else:
            g.e('%s %s, [%s], #%d' % (op, rname(t), rname(b), off))
        newb = (g.cur[b] + off) & M
        if load:
            g.wr(t)
        g.cur[b] = newb
        g.written.add(b)
        return
    else:
        # unprivileged LDRT/STRT class: [Rn, #imm8] (privileged Thread mode: ordinary access)
        r = g.base_for(0, 255, 1, size)
        if r is None:
            return
        b, off = r
        t = g.r(GP)
        g.e('%st %s, [%s, #%d]' % (op, rname(t), rname(b), off))
    if load:
        g.wr(t)


def ldst_imm(g):
    for _ in range(g.rng.randrange(1, 6)):
        if g.rng.random() < 0.25:
            alu_noise(g)
        mem_single(g)


def ldst_reg(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 5)):
        if rng.random() < 0.2:
            alu_noise(g)
        load = rng.random() < 0.55
        if load:
            op, size, _ = rng.choice(LD_OPS)
        else:
            op, size = rng.choice(ST_OPS)
        k = rng.randrange(5)
        if k <= 2:
            # register offset: 16-bit (low registers, no shift) or 32-bit with LSL #0-3
            narrow = k == 0
            pool = LOW if narrow else GP
            b = g.fresh(pool)
            x = g.fresh(pool, (b,))
            if b is None or x is None:
                continue
            sh = 0 if narrow else rng.randrange(4)
            xv = rng.choice([rng.randrange(-64, 65), rng.getrandbits(32), rng.randrange(0, 512)]) & M
            t_addr = g.target(size)
            g.fix(x, xv)
            g.fix(b, t_addr - ((xv << sh) & M))
            t = g.r(pool)
            if narrow:
                g.e('%s.n %s, [%s, %s]' % (op, rname(t), rname(b), rname(x)))
            else:
                g.e('%s.w %s, [%s, %s, lsl #%d]' % (op, rname(t), rname(b), rname(x), sh))
            if load:
                g.wr(t)
        else:
            # literal: forward (after the end label) or backward (before the code)
            t = g.r(LOW if (op == 'ldr' and rng.random() < 0.3) else GP)
            lab = g.lab()
            words = ['0x%08x' % g.val() for _ in range(3)]
            back = rng.random() < 0.4
            data = ['%s:' % lab, '  .word ' + ', '.join(words)]
            if back:
                g.pre.extend(data)
            else:
                g.post.extend(['  .p2align 2'] + data)
            delta = rng.randrange(0, 12 - size + 1)
            if op == 'ldr' and t < 8 and not back and rng.random() < 0.5:
                g.e('ldr.n %s, %s' % (rname(t), lab))  # 16-bit literal: word aligned, forward
            else:
                g.e('%s.w %s, %s+%d' % (op, rname(t), lab, delta) if delta else '%s.w %s, %s' % (op, rname(t), lab))
            if load:
                g.wr(t)
            else:
                # (stores have no literal form) — keep a store in the mix
                g.body.pop()
                mem_single(g)


def reglist(rng, pool, nmin, nmax, must=()):
    n = rng.randrange(nmin, nmax + 1)
    s = set(must)
    c = [x for x in pool if x not in s]
    rng.shuffle(c)
    s.update(c[:max(0, n - len(s))])
    return sorted(s)


def rl_text(regs):
    return '{' + ', '.join(rname(x) for x in regs) + '}'


def ldst_multi(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 5)):
        if rng.random() < 0.2:
            alu_noise(g)
        k = rng.randrange(11)
        if k <= 1:
            # 16-bit STM Rn!, {list}: Rn in the list only as the lowest register (A7.7.159)
            b = g.fresh(LOW)
            if b is None:
                continue
            regs = reglist(rng, LOW, 1, 8)
            if b in regs and min(regs) != b:
                regs.remove(b)
                if not regs:
                    continue
            g.fix(b, g.target(4 * len(regs), 4))
            g.e('stm.n %s!, %s' % (rname(b), rl_text(regs)))
            g.cur[b] = (g.cur[b] + 4 * len(regs)) & M
            g.written.add(b)
        elif k <= 3:
            # 16-bit LDM: writeback iff Rn not in the list
            b = g.fresh(LOW)
            if b is None:
                continue
            regs = reglist(rng, LOW, 1, 8)
            g.fix(b, g.target(4 * len(regs), 4))
            if b in regs:
                g.e('ldm.n %s, %s' % (rname(b), rl_text(regs)))
            else:
                g.e('ldm.n %s!, %s' % (rname(b), rl_text(regs)))
            g.wr(*regs)
            if b not in regs:
                g.cur[b] = (g.fixed[b] + 4 * len(regs)) & M
        elif k <= 5:
            # 32-bit LDM/LDMDB/STM/STMDB, list of r0-r12/lr (>= 2 registers)
            b = g.fresh(GP)
            if b is None:
                continue
            regs = reglist(rng, GP, 2, 9)
            wb = rng.random() < 0.6 and b not in regs
            ld = rng.random() < 0.5
            db = rng.random() < 0.5
            span = 4 * len(regs)
            t = g.target(span, 4)
            g.fix(b, t + span if db else t)
            op = ('ldmdb' if db else 'ldm.w') if ld else ('stmdb' if db else 'stm.w')
            if b == 13:
                continue
            g.e('%s %s%s, %s' % (op, rname(b), '!' if wb else '', rl_text(regs)))
            if ld:
                g.wr(*regs)
            if wb:
                g.cur[b] = (g.cur[b] + (-span if db else span)) & M
                g.written.add(b)
        elif k <= 7:
            # PUSH/POP (16- and 32-bit)
            if rng.random() < 0.5:
                if rng.random() < 0.5:
                    regs = reglist(rng, LOW + [14], 1, 9)
                    g.e('push.n %s' % rl_text(regs))
                else:
                    regs = reglist(rng, GP, 2, 10)
                    g.e('push.w %s' % rl_text(regs))
            else:
                if rng.random() < 0.5:
                    regs = reglist(rng, LOW, 1, 8)
                    g.e('pop.n %s' % rl_text(regs))
                else:
                    regs = reglist(rng, GP, 2, 10)
                    g.e('pop.w %s' % rl_text(regs))
                g.wr(*regs)
        else:
            # LDRD/STRD: offset / pre-indexed / post-indexed, word-aligned (unaligned faults on M3)
            ld = rng.random() < 0.5
            mode = rng.randrange(3)
            t1 = g.r()
            t2 = g.r(GP, (t1,) if ld else ())
            avoid = (t1, t2) if mode else ()
            if mode == 2:
                r = g.base_for(0, 0, 4, 8, align=4, avoid=avoid)
            else:
                r = g.base_for(-1020, 1020, 4, 8, align=4, avoid=avoid)
            if r is None:
                continue
            b, off = r
            if mode == 2:
                off = rng.randrange(-255, 256) * 4
            op = 'ldrd' if ld else 'strd'
            if mode == 0:
                g.e('%s %s, %s, [%s, #%d]' % (op, rname(t1), rname(t2), rname(b), off))
            elif mode == 1:
                g.e('%s %s, %s, [%s, #%d]!' % (op, rname(t1), rname(t2), rname(b), off))
            else:
                g.e('%s %s, %s, [%s], #%d' % (op, rname(t1), rname(t2), rname(b), off))
            if ld:
                g.wr(t1, t2)
            if mode:
                g.cur[b] = (g.cur[b] + off) & M
                g.written.add(b)


def excl(g):
    rng = g.rng
    g.e('clrex')
    for _ in range(rng.randrange(1, 4)):
        size = rng.choice([4, 4, 1, 2])
        b = g.fresh(GP)
        if b is None:
            break
        addr = g.target(size, size)
        if size == 4:
            imm = rng.randrange(0, 256) * 4 if rng.random() < 0.5 else 0
            g.fix(b, addr - imm)
            mem = '[%s, #%d]' % (rname(b), imm) if imm else '[%s]' % rname(b)
            sfx = ''
        else:
            g.fix(b, addr)
            mem = '[%s]' % rname(b)
            sfx = 'b' if size == 1 else 'h'
        k = rng.randrange(6)
        # Rt != Rn: otherwise the STREX below would address something else than the LDREX did,
        # whose outcome is IMPLEMENTATION DEFINED (QUIRKS strex-address)
        t = g.r(GP, (b,))
        if k == 0:
            # STREX with the monitor closed: fails (Rd = 1), no store
            d = g.r(GP, (b,))
            v = g.r(GP, (d,))  # Rd == Rn or Rd == Rt is UNPREDICTABLE (A7.7.167)
            g.e('strex%s %s, %s, %s' % (sfx, rname(d), rname(v), mem))
            g.wr(d)
            continue
        g.e('ldrex%s %s, %s' % (sfx, rname(t), mem))
        g.wr(t)
        for _ in range(rng.randrange(0, 3)):
            alu_noise(g, (b,))
        if k == 1:
            g.e('clrex')
        d = g.r(GP, (b,))
        v = g.r(GP, (d,))
        g.e('strex%s %s, %s, %s' % (sfx, rname(d), rname(v), mem))  # same address and size as the LDREX
        g.wr(d)
        if k == 2:
            d2 = g.r(GP, (b,))
            v2 = g.r(GP, (d2,))
            g.e('strex%s %s, %s, %s' % (sfx, rname(d2), rname(v2), mem))  # monitor closed by the first STREX
            g.wr(d2)
        g.cur.pop(b, None)
        g.written.add(b)  # never reuse this base (a later STREX elsewhere would be IMPLEMENTATION DEFINED)


def marker(g):
    """a flag-preserving instruction whose result shows which path ran"""
    d = g.r(GP)
    g.e('add.w %s, %s, #%d' % (rname(d), rname(d), g.rng.randrange(1, 256)))
    g.wr(d)


def flags(g):
    rng = g.rng
    if rng.random() < 0.5:
        n, m = g.r(), g.r()
        g.e('%s %s, %s' % (rng.choice(['cmp.w', 'cmn.w', 'tst.w', 'teq.w']), rname(n), rname(m)))


def branch(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 5)):
        flags(g)
        L = g.lab()
        k = rng.randrange(19)
        nmark = rng.randrange(0, 3)
        if k <= 1:
            g.e('b.n %s' % L if k == 0 else 'b.w %s' % L)
        elif k == 17:
            # LDR PC, [Rn, Rm, LSL #2]: a jump table in the window
            b = g.fresh(GP)
            x = g.fresh(GP, (b,))
            if x is None:
                continue
            xv = rng.randrange(-8, 9)
            t = g.target(4, 4)
            g.fix(x, xv & M)
            g.fix(b, t - 4 * xv)
            m = g.r(GP, (b, x))
            g.e('ldr %s, =%s+1' % (rname(m), L))
            g.e('str.w %s, [%s, %s, lsl #2]' % (rname(m), rname(b), rname(x)))
            g.e('ldr.w pc, [%s, %s, lsl #2]' % (rname(b), rname(x)))
            g.wr(m)
        elif k == 18:
            # LDR PC with write-back: pre-indexed or post-indexed (the base is updated, then the branch)
            b = g.fresh(GP)
            if b is None:
                continue
            m = g.r(GP, (b,))
            off = rng.randrange(-63, 64) * 4
            pre = rng.random() < 0.5
            t = g.target(4, 4)
            g.fix(b, t - off if pre else t)
            g.e('ldr %s, =%s+1' % (rname(m), L))
            g.e('str %s, [%s%s]' % (rname(m), rname(b), ', #%d' % off if pre else ''))
            g.e('ldr pc, [%s, #%d]!' % (rname(b), off) if pre else 'ldr pc, [%s], #%d' % (rname(b), off))
            g.wr(m, b)
        elif k <= 4:
            c = rng.choice(CONDS)
            g.e('b%s%s %s' % (c, rng.choice(['.n', '.w']), L))
        elif k == 5:
            g.e('bl %s' % L)
            g.wr(14)
        elif k == 6:
            g.e('%s %s, %s' % (rng.choice(['cbz', 'cbnz']), rname(g.r(LOW)), L))
            nmark = max(1, nmark)  # CBZ cannot branch to the next instruction
        elif k <= 8:
            m = g.r()
            g.e('ldr %s, =%s+1' % (rname(m), L))
            g.e('%s %s' % (rng.choice(['bx', 'blx']), rname(m)))
            g.wr(m, 14)
        elif k == 9:
            # MOV PC, Rm: BranchWritePC ignores bit 0
            m = g.r()
            g.e('ldr %s, =%s%s' % (rname(m), L, rng.choice(['', '+1'])))
            g.e('mov pc, %s' % rname(m))
            g.wr(m)
        elif k == 10:
            # ADD PC, Rm: PC reads as the instruction address + 4
            m = g.r()
            A_ = g.lab()
            g.e('ldr %s, =(%s - %s - 4)' % (rname(m), L, A_))
            g.e('%s: add pc, %s' % (A_, rname(m)))
            g.wr(m)
        elif k == 11:
            g.e('ldr pc, =%s+1' % L)
        elif k == 12:
            # LDR PC, [Rn, #imm] after storing the target into the window
            r = g.base_for(-255, 255, 4, 4, align=4)
            if r is None:
                continue
            b, off = r
            m = g.r(GP, (b,))
            g.e('ldr %s, =%s+1' % (rname(m), L))
            g.e('str %s, [%s, #%d]' % (rname(m), rname(b), off))
            g.e('ldr%s pc, [%s, #%d]' % ('.w' if off >= 0 and rng.random() < 0.5 else '', rname(b), off))
            g.wr(m)
        elif k == 13:
            # POP {..., PC} (16/32-bit) / LDM.W / LDMDB {..., PC}
            m = g.r(LOW)
            regs = reglist(rng, LOW, 0, 3, ())
            regs = [x for x in regs if x != m]
            x = rng.randrange(3)
            b = None
            if x == 2:
                if not regs:
                    regs = [g.r(LOW, (m,))]  # LDM.W/STM.W with fewer than 2 registers is UNPREDICTABLE
                b = g.fresh(GP, tuple(regs) + (m, 14))
                if b is None:
                    x = 0
            g.e('ldr %s, =%s+1' % (rname(m), L))
            g.e('mov lr, %s' % rname(m))
            if x == 0:
                g.e('push %s' % rl_text(regs + [14]))
                g.e('pop %s' % rl_text(regs + [15]))
            elif x == 1:
                hi_ = reglist(rng, [8, 9, 10, 11, 12], 1, 2)
                g.e('push.w %s' % rl_text(regs + hi_ + [14]))
                g.e('pop.w %s' % rl_text(regs + hi_ + [15]))
            else:
                span = 4 * (len(regs) + 1)
                t = g.target(span, 4)
                db = rng.random() < 0.5
                wb = rng.random() < 0.5
                g.fix(b, t + span if db else t)
                g.e('%s %s, %s' % ('stmdb' if db else 'stm.w', rname(b), rl_text(regs + [14])))
                g.e('%s %s%s, %s' % ('ldmdb' if db else 'ldm.w', rname(b), '!' if wb else '', rl_text(regs + [15])))
                g.wr(b)
            g.wr(m, 14, *regs)
        elif k == 14:
            # TBB/TBH [PC, Rm] with the table inline
            n = rng.randrange(1, 5)
            m = g.fresh(GP)
            if m is None:
                continue
            g.fix(m, rng.randrange(n))
            g.wr(m)
            h = rng.random() < 0.5
            T = g.lab()
            tgts = [g.lab() for _ in range(n)]
            if h:
                g.e('tbh [pc, %s, lsl #1]' % rname(m))
            else:
                g.e('tbb [pc, %s]' % rname(m))
            g.e('%s:' % T)
            for x in tgts:
                g.e('  %s (%s - %s) / 2' % ('.hword' if h else '.byte', x, T))
            g.e('  .p2align 1')
            for x in tgts:
                g.e('%s:' % x)
                marker(g)
                g.e('b.w %s' % L)
            nmark = 0
        elif k == 15:
            # TBB [Rn, Rm] with the table after the end label
            n = rng.randrange(1, 5)
            m = g.fresh(GP)
            b = g.r(GP, (m,))
            if m is None:
                continue
            g.fix(m, rng.randrange(n))
            g.wr(m, b)
            T = g.lab()
            P = g.lab()
            tgts = [g.lab() for _ in range(n)]
            g.e('ldr %s, =%s' % (rname(b), T))
            g.e('%s: tbb [%s, %s]' % (P, rname(b), rname(m)))
            g.post.append('%s:' % T)
            for x in tgts:
                g.post.append('  .byte (%s - %s - 4) / 2' % (x, P))
            g.post.append('  .p2align 2')
            for x in tgts:
                g.e('%s:' % x)
                marker(g)
                g.e('b.w %s' % L)
            nmark = 0
        else:
            # a taken backward branch: a short counted loop
            m = g.r(LOW)
            n = rng.randrange(1, 5)
            T = g.lab()
            acc = g.r(GP, (m,))
            g.e('movs %s, #%d' % (rname(m), n))
            g.e('%s:' % T)
            g.e('add.w %s, %s, #3' % (rname(acc), rname(acc)))
            g.e('subs %s, #1' % rname(m))
            g.e('bne %s' % T)
            g.e('b %s' % L)
            g.wr(m, acc)
        for _ in range(nmark):
            if rng.random() < 0.5:
                x = g.r(LOW)
                g.e('adds %s, #%d' % (rname(x), rng.randrange(1, 256)))
                g.wr(x)
            else:
                marker(g)
        g.e('%s:' % L)
        # (a register written on any path, taken or skipped, is no longer fresh or tracked: g.wr)


def inv(c):
    return CONDS[CONDS.index(c) ^ 1]


def it_insn(g, cond, last, base):
    """one instruction inside an IT block with condition `cond`"""
    rng = g.rng
    lo = lambda: g.r(LOW, (base,))  # destinations never clobber the base register
    gp = lambda: g.r(GP, (base,))
    k = rng.randrange(18 if last else 16)
    d, n, m = lo(), g.r(LOW), g.r(LOW)
    if k == 0:
        return '%s%s %s, %s, %s' % (rng.choice(['add', 'sub']), cond, rname(d), rname(n), rname(m))  # 16-bit, no flags
    if k == 1:
        return 'mov%s %s, #%d' % (cond, rname(d), rng.randrange(256))
    if k == 2:
        return '%s%s %s, #%d' % (rng.choice(['add', 'sub']), cond, rname(d), rng.randrange(256))
    if k == 3:
        op = rng.choice(['and', 'eor', 'orr', 'bic', 'adc', 'sbc', 'lsl', 'lsr', 'asr', 'ror'])
        return '%s%s %s, %s' % (op, cond, rname(d), rname(m))
    if k == 4:
        return '%s%s %s, %s, #%d' % (rng.choice(['lsl', 'lsr', 'asr']), cond, rname(d), rname(m), rng.randrange(1, 32))
    if k == 5:
        return 'mul%s %s, %s, %s' % (cond, rname(d), rname(n), rname(d))
    if k == 6:
        return '%s%s %s, %s' % (rng.choice(['mvn', 'rev', 'uxtb', 'sxth']), cond, rname(d), rname(m))
    if k == 7:
        return 'rsb%s %s, %s, #0' % (cond, rname(d), rname(n))
    if k == 8:
        return '%s%s %s, %s' % (rng.choice(['cmp', 'cmn', 'tst']), cond, rname(n), rname(m))  # sets flags in IT
    if k == 9:
        return 'cmp%s %s, #%d' % (cond, rname(n), rng.randrange(256))
    if k == 10:
        return '%ss%s.w %s, %s, %s' % (rng.choice(['add', 'sub', 'and', 'orr']), cond, rname(gp()), rname(g.r()), rname(g.r()))
    if k == 11:
        return 'movs%s.w %s, #0x%x' % (cond, rname(gp()), g.mod_imm())
    if k == 12:
        return 'add%s %s, %s' % (cond, rname(gp()), rname(g.r()))  # high-register ADD
    if k == 13:
        return 'mov%s %s, %s' % (cond, rname(gp()), rname(g.r()))
    if k == 14:
        # a store that must not happen when the condition fails
        return 'str%s %s, [%s, #%d]' % (cond, rname(g.r(LOW)), rname(base), rng.randrange(0, 8) * 4)
    if k == 15:
        return 'ldr%s %s, [%s, #%d]' % (cond, rname(lo()), rname(base), rng.randrange(0, 8) * 4)
    # last slot only: a branch out of the block
    return 'b%s %s' % (cond, g.it_target)


def it(g):
    rng = g.rng
    base = g.fresh(LOW)
    g.fix(base, g.target(32, 4))
    for _ in range(rng.randrange(1, 4)):
        flags(g)
        if rng.random() < 0.08:
            first = 'al'
            pat = 't' * rng.randrange(0, 4)
        else:
            first = rng.choice(CONDS)
            pat = ''.join(rng.choice('te') for _ in range(rng.randrange(0, 4)))
        g.it_target = g.lab()
        g.e('it%s %s' % (pat, first))
        conds = [first] + [first if p == 't' else inv(first) for p in pat]
        for i, c in enumerate(conds):
            g.e(it_insn(g, c, i == len(conds) - 1, base))
        for _ in range(rng.randrange(0, 2)):
            g.e('adds %s, #%d' % (rname(g.r(LOW, (base,))), rng.randrange(1, 256)))
        g.e('%s:' % g.it_target)


def sp_family(g):
    rng = g.rng
    for _ in range(rng.randrange(1, 6)):
        k = rng.randrange(22)
        d = g.r()
        if k == 0:
            g.e('%s sp, #%d' % (rng.choice(['add', 'sub']), rng.randrange(0, 17) * 4))
        elif k == 1:
            d = g.r(LOW)
            g.e('add.n %s, sp, #%d' % (rname(d), rng.randrange(0, 256) * 4))
            g.wr(d)
        elif k == 17:
            # LDR SP, [Rn, Rm{, LSL #n}] of a word-aligned value stored there first
            b = g.fresh(GP)
            x = g.fresh(GP, (b,))
            v = g.fresh(GP, (b, x))
            if v is None:
                continue
            sh = rng.randrange(4)
            xv = rng.randrange(-16, 17) & M
            g.fix(x, xv)
            g.fix(b, g.target(4, 4) - ((xv << sh) & M))
            g.fix(v, rng.randrange(SP_LO, SP_HI + 1, 4))
            g.e('str.w %s, [%s, %s, lsl #%d]' % (rname(v), rname(b), rname(x), sh))
            g.e('ldr.w sp, [%s, %s, lsl #%d]' % (rname(b), rname(x), sh))
        elif k == 18:
            # LDR SP with writeback (pre- or post-indexed), the loaded value word aligned
            b = g.fresh(GP)
            v = g.fresh(GP, (b,))
            if v is None:
                continue
            pre = rng.random() < 0.5
            off = rng.randrange(-255, 256)
            t = g.target(4, 4)
            g.fix(b, t - off if pre else t)
            g.fix(v, rng.randrange(SP_LO, SP_HI + 1, 4))
            g.e('str %s, [%s%s]' % (rname(v), rname(b), ', #%d' % off if pre else ''))
            g.e('ldr sp, [%s, #%d]!' % (rname(b), off) if pre else 'ldr sp, [%s], #%d' % (rname(b), off))
            g.wr(b)
        elif k == 19:
            # SP as a written-back base, word-aligned offsets (PUSH/POP of one register in effect)
            off = rng.randrange(-8, 9) * 4
            if rng.random() < 0.5:
                g.e('ldr.w %s, [sp, #%d]!' % (rname(d), off) if rng.random() < 0.5 else 'ldr.w %s, [sp], #%d' % (rname(d), off))
                g.wr(d)
            else:
                g.e('str.w %s, [sp, #%d]!' % (rname(d), off) if rng.random() < 0.5 else 'str.w %s, [sp], #%d' % (rname(d), off))
        elif k == 20:
            t2 = g.r(GP, (d,))
            off = rng.randrange(-6, 7) * 4
            op = rng.choice(['ldrd', 'strd'])
            g.e('%s %s, %s, [sp, #%d]%s' % (op, rname(d), rname(t2), off, rng.choice(['', '!'])))
            if op == 'ldrd':
                g.wr(d, t2)
        elif k == 21:
            # LDR SP, <literal> of an aligned value
            lab = g.lab()
            g.post.extend(['  .p2align 2', '%s:' % lab, '  .word 0x%08x' % rng.randrange(SP_LO, SP_HI + 1, 4)])
            g.e('ldr.w sp, %s' % lab)
        elif k == 2:
            g.e('%s %s, sp, #0x%x' % (rng.choice(['add.w', 'sub.w', 'adds.w', 'subs.w']), rname(d), g.mod_imm()))
            g.wr(d)
        elif k == 3:
            g.e('%s %s, sp, #%d' % (rng.choice(['addw', 'subw']), rname(d), rng.randrange(4096)))
            g.wr(d)
        elif k == 4:
            g.e('%s sp, sp, #%d' % (rng.choice(['add.w', 'sub.w', 'addw', 'subw']), rng.randrange(0, 17) * 4))
        elif k == 5:
            # ADD Rdm, SP, Rdm (T1) / ADD SP, Rm (T2): SP gets an aligned value
            x = g.fresh(GP)
            if x is None:
                continue
            if rng.random() < 0.5:
                g.fix(x, rng.randrange(-16, 17) * 4)
                g.e('add.n sp, %s' % rname(x))
            else:
                g.e('add.n %s, sp, %s' % (rname(x), rname(x)))
                g.wr(x)
        elif k == 6:
            x = g.fresh(GP, (d,))
            if x is None:
                continue
            sh = rng.randrange(4)
            g.fix(x, rng.randrange(-8, 9) * 4 >> sh if rng.random() < 0.3 else g.val())
            g.e('%s %s, sp, %s, lsl #%d' % (rng.choice(['add.w', 'sub.w', 'adds.w', 'subs.w']), rname(d), rname(x), sh))
            g.wr(d)
            continue
        elif k == 7:
            x = g.fresh(GP)
            if x is None:
                continue
            g.fix(x, rng.randrange(-4, 5) * 4)
            g.e('%s sp, sp, %s, lsl #%d' % (rng.choice(['add.w', 'sub.w']), rname(x), 0))
        elif k == 8:
            g.e('%s %s, sp' % (rng.choice(['mov.n', 'mov.w']), rname(d)))
            g.wr(d)
            continue
        elif k == 9:
            x = g.fresh(GP)
            if x is None:
                continue
            g.fix(x, rng.randrange(SP_LO, SP_HI + 1, 4))  # aligned: see QUIRKS sp-low-bits
            g.e('%s sp, %s' % (rng.choice(['mov.n', 'mov.w']), rname(x)))
        elif k == 10:
            g.e('%s %s, [sp, #%d]' % (rng.choice(['ldr.w', 'str.w']), rname(d), rng.randrange(0, 25) * 4))
            g.wr(d)
            continue
        elif k == 11:
            # STR SP, [Rn, #imm]
            r = g.base_for(0, 64, 4, 4, align=4)
            if r is None:
                continue
            b, off = r
            g.e('str sp, [%s, #%d]' % (rname(b), off))
        elif k == 12:
            # LDR SP, [Rn]: store an aligned value first
            r = g.base_for(0, 64, 4, 4, align=4)
            if r is None:
                continue
            b, off = r
            x = g.fresh(GP, (b,))
            if x is None:
                continue
            g.fix(x, rng.randrange(SP_LO, SP_HI + 1, 4))
            g.e('str %s, [%s, #%d]' % (rname(x), rname(b), off))
            g.e('ldr sp, [%s, #%d]' % (rname(b), off))
        elif k == 13:
            g.e('cmp %s, %s' % ('sp', rname(g.r())))
        elif k == 14:
            g.e('cmp.w sp, #0x%x' % g.mod_imm())
        elif k == 15:
            regs = reglist(rng, LOW + [14], 1, 4)
            g.e('push %s' % rl_text(regs))
        else:
            regs = reglist(rng, LOW, 1, 4)
            g.e('pop %s' % rl_text(regs))
            g.wr(*regs)
    g.written.update(range(15))


def pcrel(g):
    rng = g.rng
    if rng.random() < 0.5:
        g.e('nop')  # vary the alignment of what follows
    for _ in range(rng.randrange(1, 6)):
        k = rng.randrange(10)
        d = g.r()
        lab = g.lab()
        words = ['0x%08x' % g.val() for _ in range(4)]
        data = ['  .p2align 2', '%s:' % lab, '  .word ' + ', '.join(words)]
        back = rng.random() < 0.4
        if k == 0:
            g.post.extend(data)
            g.e('adr.n %s, %s' % (rname(g.r(LOW)), lab))
        elif k == 1:
            (g.pre if back else g.post).extend(data)
            g.e('adr.w %s, %s+%d' % (rname(d), lab, rng.randrange(0, 16)))
        elif k == 2:
            g.e('add.n %s, pc' % rname(d))
        elif k == 3:
            g.e('mov.n %s, pc' % rname(d))
        elif k == 4:
            g.post.extend(data)
            g.e('ldr.n %s, %s' % (rname(g.r(LOW)), lab))
        elif k == 5:
            (g.pre if back else g.post).extend(data)
            op, size, _ = rng.choice(LD_OPS)
            g.e('%s.w %s, %s+%d' % (op, rname(d), lab, rng.randrange(0, 16 - size + 1)))
        elif k == 6:
            (g.pre if back else g.post).extend(data)
            t2 = g.r(GP, (d,))
            g.e('ldrd %s, %s, %s+%d' % (rname(d), rname(t2), lab, rng.choice([0, 4, 8])))
        elif k == 7:
            g.e('%s %s, pc, #%d' % (rng.choice(['addw', 'subw']), rname(d), rng.randrange(4096)))
        elif k == 8:
            g.post.extend(data)
            g.e('ldr.w %s, [pc, #%d]' % (rname(d), rng.randrange(0, 64)))  # (into the case's own bytes)
        else:
            n = rng.randrange(1, 4)
            m = g.fresh(GP)
            if m is None:
                continue
            g.fix(m, rng.randrange(n))
            T = g.lab()
            E = g.lab()
            tg = [g.lab() for _ in range(n)]
            g.e('tbb [pc, %s]' % rname(m))
            g.e('%s:' % T)
            for x in tg:
                g.e('  .byte (%s - %s) / 2' % (x, T))
            g.e('  .p2align 1')
            for x in tg:
                g.e('%s:' % x)
                marker(g)
                g.e('b.w %s' % E)
            g.e('%s:' % E)
        g.written.update(range(15))


SYSM = ['apsr', 'iapsr', 'eapsr', 'xpsr', 'ipsr', 'epsr', 'iepsr']


def sysreg(g):
    rng = g.rng
    g.config = {'priorityBits': 8}
    for _ in range(rng.randrange(1, 7)):
        k = rng.randrange(16)
        d, n = g.r(), g.r()
        if k <= 1:
            g.e('mrs %s, %s' % (rname(d), rng.choice(SYSM)))
            g.wr(d)
        elif k == 2:
            g.e('msr apsr_nzcvq, %s' % rname(n))
        elif k == 3:
            g.e('mrs %s, %s' % (rname(d), rng.choice(['primask', 'basepri', 'basepri_max', 'faultmask', 'control'])))
            g.wr(d)
        elif k >= 14:
            # set the masks, drop privilege (CONTROL.nPRIV), read them back unprivileged
            x = g.fresh(GP)
            y = g.fresh(GP, (x,))
            if y is None:
                continue
            g.fix(x, rng.randrange(1, 256))
            g.fix(y, rng.choice([1, 3]))
            g.e('msr %s, %s' % (rng.choice(['basepri', 'basepri_max']), rname(x)))
            g.e('cpsid %s' % rng.choice(['i', 'f']))
            g.e('msr control, %s' % rname(y))
            g.e('isb')
            if rng.random() < 0.5:
                g.e('msr basepri, %s' % rname(y))  # ignored: unprivileged
            for nm in rng.sample(['primask', 'basepri', 'basepri_max', 'faultmask', 'control'], 3):
                d = g.r()
                g.e('mrs %s, %s' % (rname(d), nm))
                g.wr(d)
        elif k == 4:
            x = g.fresh(GP)
            if x is None:
                continue
            g.fix(x, rng.choice([0, 1, rng.getrandbits(32), rng.randrange(256)]))
            g.e('msr %s, %s' % (rng.choice(['primask', 'faultmask']), rname(x)))
        elif k <= 6:
            x = g.fresh(GP)
            if x is None:
                continue
            g.fix(x, rng.choice([0, rng.randrange(256), rng.randrange(16) << 4, rng.getrandbits(32)]))
            g.e('msr %s, %s' % (rng.choice(['basepri', 'basepri_max']), rname(x)))
        elif k == 7:
            g.e('cps%s %s' % (rng.choice(['ie', 'id']), rng.choice(['i', 'f'])))
        elif k == 8:
            # CONTROL: SPSEL switches the Thread-mode stack to PSP; nPRIV drops privilege for good
            x = g.fresh(GP)
            if x is None:
                continue
            g.fix(x, rng.choice([0, 2, 2, 1, 3, rng.getrandbits(32) & ~4]))  # bit 2: QUIRKS control-fpca
            g.e('msr control, %s' % rname(x))
            g.e('isb')
        elif k == 9:
            g.e('mrs %s, %s' % (rname(d), rng.choice(['msp', 'psp'])))
            g.wr(d)
        elif k == 10:
            x = g.fresh(GP)
            if x is None:
                continue
            g.fix(x, rng.randrange(SP_LO, SP_HI + 1, 4))
            g.e('msr %s, %s' % (rng.choice(['msp', 'psp']), rname(x)))
        elif k == 11:
            g.e('mov %s, sp' % rname(d))
            g.wr(d)
        elif k == 12:
            g.e(rng.choice(['nop', 'nop.w', 'dmb', 'dsb', 'isb', 'clrex']))
        else:
            x = g.r(LOW)
            g.e('push {%s}' % rname(g.r(LOW)))
            g.e('pop {%s}' % rname(x))
            g.wr(x)


# name: (generator, cases)
FAMILIES = {
    'alu16': (alu16, 2400),
    'dp_imm': (dp_imm, 2000),
    'dp_plain': (dp_plain, 2000),
    'dp_shift': (dp_shift, 2400),
    'dp_reg': (dp_reg, 1600),
    'mul_div': (mul_div, 1600),
    'ldst_imm': (ldst_imm, 2400),
    'ldst_reg': (ldst_reg, 1600),
    'ldst_multi': (ldst_multi, 2000),
    'excl': (excl, 1200),
    'branch': (branch, 2000),
    'it': (it, 2000),
    'sp': (sp_family, 1400),
    'pcrel': (pcrel, 1400),
    'sysreg': (sysreg, 1400),
    'raw': (None, 6000),  # raw encodings, no assembler (gen_raw)
}


# ================================================================ build & run

def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError('%s failed:\n%s%s' % (os.path.basename(cmd[0]), p.stdout, p.stderr))
    return p.stdout


def assemble(cases, tmp, name):
    """assemble + link every case; drop the cases the assembler rejects. Returns (image, symbols, kept)"""
    for attempt in range(4):
        lines = ['  .syntax unified', '  .thumb', '  .text']
        spans = []
        for c in cases:
            start = len(lines) + 1
            lines += ['  .p2align 2', 'c%d:' % c.idx]
            lines += ['  ' + x if not x.endswith(':') and not x.startswith('  ') else x for x in c.asm()]
            lines += ['c%d_end:' % c.idx, '  .ltorg']
            lines += c.post
            spans.append((start, len(lines), c))
        src = os.path.join(tmp, name + '.s')
        with open(src, 'w') as f:
            f.write('\n'.join(lines) + '\n')
        p = subprocess.run([tool('clang'), '--target=thumbv7m-none-eabi', '-mcpu=cortex-m3', '-mthumb', '-c', src, '-o',
                            os.path.join(tmp, name + '.o')], capture_output=True, text=True)
        if p.returncode == 0:
            break
        bad = set()
        for ln in p.stderr.splitlines():
            parts = ln.split(':')
            # <path>:<line>:<col>: error: ...   (the Windows drive letter adds one field)
            for i in range(len(parts) - 2):
                if parts[i].endswith('.s') and parts[i + 1].isdigit() and 'error' in ln:
                    no = int(parts[i + 1])
                    for s, e, c in spans:
                        if s <= no <= e:
                            bad.add(c.idx)
        if not bad:
            raise RuntimeError(p.stderr[:4000])
        errs = [ln for ln in p.stderr.splitlines() if 'error' in ln]
        srcl = [ln for ln in p.stderr.splitlines() if ln.startswith('  ') and not ln.strip().startswith('^')]
        sys.stderr.write('  %s: assembler rejected %d case(s), e.g. %s | %s\n' % (
            name, len(bad), errs[0].split('error:')[-1][:120], ' / '.join(x.strip() for x in srcl[:6])))
        cases = [c for c in cases if c.idx not in bad]
    else:
        raise RuntimeError('assembler keeps failing')
    elf = os.path.join(tmp, name + '.elf')
    run([tool('ld.lld'), '-Ttext=0x%x' % CODE_BASE, '-e', '0x%x' % CODE_BASE, '-o', elf, os.path.join(tmp, name + '.o')], tmp)
    run([tool('llvm-objcopy'), '-O', 'binary', '-j', '.text', elf, os.path.join(tmp, name + '.bin')], tmp)
    syms = {}
    for ln in run([tool('llvm-nm'), elf], tmp).splitlines():
        p = ln.split()
        if len(p) == 3:
            syms[p[2]] = int(p[0], 16)
    with open(os.path.join(tmp, name + '.bin'), 'rb') as f:
        image = f.read()
    return image, syms, cases


SPEC_REGS = [('primask', A.UC_ARM_REG_PRIMASK), ('basepri', A.UC_ARM_REG_BASEPRI), ('faultmask', A.UC_ARM_REG_FAULTMASK),
             ('control', A.UC_ARM_REG_CONTROL)]
R_IDS = [A.UC_ARM_REG_R0 + i for i in range(13)]


def unicorn_case(image, start, end, init, case):
    """
    run one case twice on fresh Unicorn instances — once without hooks (the recorded result) and
    once with memory hooks checking the window plus a code hook — and keep it only when both runs
    agree (QUIRKS unicorn-hooks); None when rejected
    """
    a, why = unicorn_run(image, start, end, init, case, False)
    if a is None:
        return None, why
    b, why = unicorn_run(image, start, end, init, case, True)
    if b is None:
        return None, why
    if a != b:
        return None, 'Unicorn disagrees with itself (no hooks vs memory+code hooks)'
    return a, None


def unicorn_run(image, start, end, init, case, hooked):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.ctl_set_cpu_model(A.UC_CPU_ARM_CORTEX_M3)
    size = (len(image) + 0xFFF) & ~0xFFF
    mu.mem_map(CODE_BASE, size)
    mu.mem_write(CODE_BASE, image)
    mu.mem_map(RAM_MAP, 0x1000)
    ram0 = ram_fill(init['ramSeed'])
    mu.mem_write(WIN, ram0)
    bad = []

    def on_mem(uc, access, addr, sz, value, ud):
        in_win = WIN <= addr and addr + sz <= WIN + WIN_SIZE
        in_img = CODE_BASE <= addr and addr + sz <= CODE_BASE + len(image)
        if access == unicorn.UC_MEM_WRITE:
            ok = in_win
        else:
            ok = in_win or in_img
        if not ok:
            bad.append('access outside the window at 0x%x' % addr)
            uc.emu_stop()

    def on_intr(uc, intno, ud):
        bad.append('exception %d' % intno)
        uc.emu_stop()

    mu.hook_add(UC_HOOK_INTR, on_intr)
    if hooked:
        # the checking run: window check on every data access, plus a code hook
        mu.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, on_mem)
        mu.hook_add(unicorn.UC_HOOK_CODE, lambda uc, addr, size, ud: None)
    for i in range(13):
        mu.reg_write(R_IDS[i], init['r'][i])
    mu.reg_write(A.UC_ARM_REG_LR, init['r'][13])
    mu.reg_write(A.UC_ARM_REG_PSP, init['psp'])
    mu.reg_write(A.UC_ARM_REG_SP, init['sp'])
    mu.reg_write(A.UC_ARM_REG_APSR_NZCVQ, init['apsr'])
    try:
        mu.emu_start(start | 1, end, count=MAX_INSNS)
    except UcError as e:
        if getattr(case, 'raw', False) and e.errno == unicorn.UC_ERR_INSN_INVALID and mu.reg_read(A.UC_ARM_REG_PC) == case.insn:
            return {'undef': True}, None
        return None, str(e)
    if bad:
        return None, bad[0]
    pc = mu.reg_read(A.UC_ARM_REG_PC)
    if pc != end:
        return None, 'did not reach the end (pc 0x%x)' % pc
    out = {
        'r': [mu.reg_read(R_IDS[i]) & M for i in range(13)] + [mu.reg_read(A.UC_ARM_REG_LR) & M],
        'sp': mu.reg_read(A.UC_ARM_REG_SP) & M,
        # every case ends outside an IT block, so ITSTATE is architecturally 0 there; Unicorn's
        # xPSR readout can carry a stale IT field (QUIRKS it-readout), so the IT bits are recorded as 0
        'xpsr': mu.reg_read(A.UC_ARM_REG_XPSR) & M & ~0x0600FC00,
    }
    ram1 = bytes(mu.mem_read(WIN, WIN_SIZE))
    out['ram'] = [[o, int.from_bytes(ram1[o:o + 4], 'little')] for o in range(0, WIN_SIZE, 4) if ram1[o:o + 4] != ram0[o:o + 4]]
    if case.config is not None:
        ctrl = mu.reg_read(A.UC_ARM_REG_CONTROL)
        spec = {'control': ctrl & 3}
        if ctrl & 1 == 0:  # Unicorn reads the masks through MRS: zero when unprivileged
            for nm, rid in SPEC_REGS[:3]:
                spec[nm] = mu.reg_read(rid) & 0xFF
        out['special'] = spec
    return out, None


class RawCase:
    """one raw encoding (no assembler): `insn` is its address"""

    def __init__(self, idx):
        self.idx = idx
        self.raw = True
        self.config = None
        self.insn = 0


HINTS16 = [0xBF00] + [0xBF00 | (op << 4) for op in range(5, 16)]  # NOP and the unallocated hints (YIELD/WFE/WFI/SEV excluded)


def raw_encoding(rng):
    """
    a random encoding from the register-only parts of the Thumb space (no memory access, no branch
    unless Rd = PC): 16-bit shift/add/sub/mov/cmp, data processing, high-register ops, extends, REV*,
    hints; 32-bit data processing (shifted register, modified and plain immediate, register),
    multiply/divide and the hint space. Includes UNDEFINED (e.g. the DSP forms) and UNPREDICTABLE
    encodings: the test skips what our decoder reports as UNPREDICTABLE.
    """
    if rng.random() < 0.3:
        q = rng.random()
        if q < 0.75:
            return [rng.randrange(0x0000, 0x4700)]
        if q < 0.85:
            return [0xB200 | rng.getrandbits(8)]
        if q < 0.95:
            return [0xBA00 | rng.getrandbits(8)]
        return [rng.choice(HINTS16)]
    q = rng.random()
    if q < 0.3:
        return [0xEA00 | rng.getrandbits(9), rng.getrandbits(16)]
    if q < 0.6:
        return [0xF000 | rng.getrandbits(11), rng.getrandbits(15)]
    if q < 0.8:
        return [0xFA00 | rng.getrandbits(8), rng.getrandbits(16) | (0xF000 if rng.random() < 0.85 else 0)]
    if q < 0.97:
        return [0xFB00 | rng.getrandbits(8), rng.getrandbits(16)]
    op = rng.choice([0, rng.randrange(5, 256)])
    return [0xF3AF, 0x8000 | op | (rng.getrandbits(3) << 8 if rng.random() < 0.2 else 0)]


def is_dsp(enc):
    """
    ARMv7E-M (DSP extension) encodings in the raw spaces (DDI 0403E A5.3.11/A5.3.12/A5.3.16/A5.3.17,
    entries marked ARMv7E-M): UNDEFINED on Cortex-M3, but executed by Unicorn's Cortex-M3 model
    (QUIRKS dsp-on-m3)
    """
    if len(enc) < 2:
        return False
    hw1, hw2 = enc
    if hw1 & 0xFE00 == 0xEA00:
        return (hw1 >> 5) & 15 == 6  # PKHBT/PKHTB
    if hw1 & 0xFF00 == 0xFA00:
        op1, op2, rn = (hw1 >> 4) & 15, (hw2 >> 4) & 15, hw1 & 15
        if op1 < 6 and op2 & 8:
            return rn != 15 or op1 in (2, 3)  # SXTA*/UXTA*, SXTB16/UXTB16
        if op1 & 8 and not op2 & 8:
            return True  # parallel add/subtract
        if op1 & 0xC == 8 and op2 & 0xC == 8:
            return op1 & 3 == 0 or (op1 & 3 == 2 and op2 & 3 == 0)  # QADD/QDADD/QSUB/QDSUB, SEL
        return False
    if hw1 & 0xFF80 == 0xFB00:
        return (hw1 >> 4) & 7 != 0 or (hw2 >> 4) & 3 > 1 or (hw2 >> 6) & 3 != 0  # SMLA<x><y>, SMLAD, SMMUL ...
    if hw1 & 0xFF80 == 0xFB80:
        op1, op2 = (hw1 >> 4) & 7, (hw2 >> 4) & 15
        return (op1 == 4 and op2 & 0xC == 8) or (op1 in (4, 5) and op2 & 0xE == 0xC) or (op1 == 6 and op2 == 6)
    return False


def gen_raw(name, count, tmp):
    rng = random.Random('%s:%d' % (name, SEED))
    img = bytearray()
    cases = []
    reasons = {}
    result = []
    idx = 0
    while len(result) < count and idx < count * 3:
        c = RawCase(idx)
        idx += 1
        enc = raw_encoding(rng)
        start = CODE_BASE + len(img)
        pad = rng.random() < 0.5  # vary the PC alignment for the PC-reading forms
        if pad:
            img += (0xBF00).to_bytes(2, 'little')
        c.insn = CODE_BASE + len(img)
        for h in enc:
            img += h.to_bytes(2, 'little')
        end = CODE_BASE + len(img)
        img += (0xBF00).to_bytes(2, 'little') * (2 if len(img) % 4 else 1)
        while len(img) % 4:
            img += b'\x00'
        cases.append((c, start, end, enc))
    image = bytes(img)
    for c, start, end, enc in cases:
        g = Gen(rng, c.idx)
        init = {'r': g.init_regs(), 'sp': g.sp, 'psp': g.psp, 'apsr': g.apsr, 'ramSeed': rng.getrandbits(32) | 1}
        out, why = unicorn_case(image, start, end, init, c)
        if out is not None and not out.get('undef') and out['sp'] & 3:
            out, why = None, 'SP written with bits [1:0] set (QUIRKS sp-low-bits)'
        if out is not None and not out.get('undef') and is_dsp(enc):
            out, why = None, 'DSP encoding executed (QUIRKS dsp-on-m3)'
        text = ' '.join('%04x' % h for h in enc)
        if out is None:
            key = why.split(' at ')[0].split(' (pc')[0]
            if key not in reasons and os.environ.get('CPU_ORACLE_VERBOSE'):
                sys.stderr.write('  %s rejected (%s): %s\n' % (name, why, text))
            reasons[key] = reasons.get(key, 0) + 1
            continue
        result.append({'id': c.idx, 'start': start, 'end': end, 'insn': c.insn, 'asm': text, 'init': init, 'out': out})
        if len(result) == count:
            break
    return {
        'family': name,
        'oracle': 'Unicorn %s (QEMU ARMv7-M), UC_CPU_ARM_CORTEX_M3' % unicorn.__version__,
        'generator': 'tools/cpu-oracle/gen_vectors.py',
        'seed': SEED,
        'codeBase': CODE_BASE,
        'window': [WIN, WIN_SIZE],
        'config': None,
        'image': image.hex(),
        'rejected': reasons,
        'cases': result,
    }


def gen_family(name, fn, count, tmp):
    if fn is None:
        return gen_raw(name, count, tmp)
    rng = random.Random('%s:%d' % (name, SEED))
    want = count
    cands = []
    idx = 0
    factor = 1.15
    result = []
    reasons = {}
    for _round in range(6):
        need = int((want - len(result)) * factor) + 8
        batch = []
        for _ in range(need):
            g = Gen(rng, idx)
            idx += 1
            fn(g)
            if not g.body:
                continue
            batch.append(g)
        cands += batch
        image, syms, kept = assemble(cands, tmp, name)
        keepset = set(c.idx for c in kept)
        cands = [c for c in cands if c.idx in keepset]
        result = []
        reasons = {}
        for c in cands:
            init = {'r': c.init_regs() if not hasattr(c, '_init') else c._init, 'sp': c.sp, 'psp': c.psp, 'apsr': c.apsr,
                    'ramSeed': 0}
            if not hasattr(c, '_init'):
                c._init = init['r']
                c._seed = rng.getrandbits(32) | 1
            init['r'] = c._init
            init['ramSeed'] = c._seed
            start, end = syms['c%d' % c.idx], syms['c%d_end' % c.idx]
            out, why = unicorn_case(image, start, end, init, c)
            text = '; '.join(x.strip() for x in c.asm() if x.strip())
            if out is None:
                key = why.split(' at ')[0].split(' (pc')[0]
                if key not in reasons and os.environ.get('CPU_ORACLE_VERBOSE'):
                    sys.stderr.write('  %s rejected (%s): %s\n' % (name, why, text[:400]))
                reasons[key] = reasons.get(key, 0) + 1
                continue
            result.append({'id': c.idx, 'start': start, 'end': end, 'asm': text,
                           'init': {'r': init['r'], 'sp': init['sp'], 'psp': init['psp'], 'apsr': init['apsr'], 'ramSeed': init['ramSeed']},
                           'out': out})
            if len(result) == want:
                break
        if len(result) >= want:
            break
        factor *= 1.6
    cfg = next((c.config for c in cands if c.config is not None), None)
    return {
        'family': name,
        'oracle': 'Unicorn %s (QEMU ARMv7-M), UC_CPU_ARM_CORTEX_M3' % unicorn.__version__,
        'generator': 'tools/cpu-oracle/gen_vectors.py',
        'seed': SEED,
        'codeBase': CODE_BASE,
        'window': [WIN, WIN_SIZE],
        'config': cfg,
        'image': image.hex(),
        'rejected': reasons,
        'cases': result,
    }


def write_gz(path, obj):
    raw = json.dumps(obj, separators=(',', ':')).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=buf, mtime=0, compresslevel=9) as f:
        f.write(raw)
    with open(path, 'wb') as f:
        f.write(buf.getvalue())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('families', nargs='*')
    ap.add_argument('--check', action='store_true', help='regenerate in memory and compare with the committed files')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    names = args.families or list(FAMILIES)
    total = 0
    with tempfile.TemporaryDirectory(prefix='cpu-oracle-') as tmp:
        for name in names:
            fn, count = FAMILIES[name]
            data = gen_family(name, fn, count, tmp)
            n = len(data['cases'])
            total += n
            path = os.path.join(args.out, 'vectors-%s.json.gz' % name)
            rej = ', '.join('%s: %d' % kv for kv in sorted(data['rejected'].items()))
            if args.check:
                with gzip.open(path, 'rt') as f:
                    old = json.load(f)
                same = old == json.loads(json.dumps(data))
                print('%-11s %5d cases  %s' % (name, n, 'identical' if same else 'DIFFERENT'))
                if not same:
                    sys.exit(1)
            else:
                write_gz(path, data)
                print('%-11s %5d cases  image %6d B  rejected {%s}' % (name, n, len(data['image']) // 2, rej))
    print('total %d cases' % total)


if __name__ == '__main__':
    main()
