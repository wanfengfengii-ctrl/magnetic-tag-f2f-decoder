/**
 * 测试 / 演示用脉冲串编码器：把数字串按给定时钟 τ 编成间隔序列，
 * 与 decoder.ts 的规则严格互逆。仅运行在浏览器本地，不涉及任何网络。
 */

import {
  BITS_PER_GROUP,
  END_CODE,
  START_CODE,
  TAU_MAX,
  TAU_MIN,
} from './decoder';

export interface EncodeOptions {
  /** 每个间隔叠加的最大整数抖动（微秒），0..4 */
  jitter?: number;
  /** 整串首尾之间局部时钟的线性漂移幅度（微秒），实际 τ 在 baseTau±drift 间滑动 */
  drift?: number;
  /** 确定性伪随机种子 */
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function codewordBits(code: number): (0 | 1)[] {
  const nibble: (0 | 1)[] = [0, 1, 2, 3].map((k) => ((code >> k) & 1) as 0 | 1);
  const ones = nibble.reduce<number>((acc, b) => acc + b, 0);
  const parity: 0 | 1 = ones % 2 === 0 ? 1 : 0; // 第五位令 1 总数为奇数
  return [...nibble, parity];
}

export function encodePulseTrain(
  digitsInput: string,
  baseTau: number,
  options: EncodeOptions = {},
): number[] {
  const digits = digitsInput.trim();
  if (!/^\d+$/.test(digits)) throw new Error('digits 必须全部由 0..9 组成');
  if (digits.length < 1 || digits.length > 12) throw new Error('digits 长度须为 1..12');
  if (!Number.isInteger(baseTau) || baseTau < TAU_MIN || baseTau > TAU_MAX) {
    throw new Error(`baseTau 须为 ${TAU_MIN}..${TAU_MAX} 的整数`);
  }
  const jitter = Math.max(0, Math.min(4, options.jitter ?? 0));
  const drift = Math.max(0, Math.min(20, options.drift ?? 0));
  const rand = mulberry32(options.seed ?? 1);
  const randInt = (max: number) => Math.floor(rand() * (2 * max + 1)) - max;

  const payload = [...digits].map((ch) => Number(ch));
  const codewords = [START_CODE, ...payload, END_CODE];
  let lrc = 0;
  for (const c of codewords) lrc ^= c;
  codewords.push(lrc);

  const bits: (0 | 1)[] = codewords.flatMap(codewordBits);

  const durations: number[] = [];
  bits.forEach((bit, i) => {
    const localTau =
      bits.length <= 1
        ? baseTau
        : baseTau - drift + Math.round((2 * drift * i) / (bits.length - 1));
    if (bit === 0) {
      // 长型：|d - τ| ≤ 6
      durations.push(localTau + (jitter ? randInt(jitter) : 0));
    } else {
      // 短型：|2d - τ| ≤ 6；round 误差至多 1，再加 ≤2 抖动总偏差 ≤5
      const half = Math.round(localTau / 2);
      const j = jitter ? Math.min(2, jitter) : 0;
      durations.push(half + (j ? randInt(j) : 0));
      durations.push(half + (j ? randInt(j) : 0));
    }
  });

  if (bits.length % BITS_PER_GROUP !== 0) throw new Error('内部错误：组数不对齐');
  return durations;
}
