import { describe, expect, it } from 'vitest';
import {
  analyze,
  classifyIntervals,
  decodeForTau,
  enumerateTau,
  groupByDigits,
  outcomeFromGroups,
  parseAndValidate,
  validateArray,
  type TauDecode,
} from './decoder';
import { encodePulseTrain } from './encoder';

describe('parseAndValidate / validateArray', () => {
  it('接受合法数组', () => {
    const r = parseAndValidate('[100, 50, 50, 100, 100, 100]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.durations).toEqual([100, 50, 50, 100, 100, 100]);
  });

  it('拒绝非数组顶层', () => {
    const r = parseAndValidate('"100"');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].path).toBe('$');
    }
  });

  it('对非法 JSON 给出位置', () => {
    const r = parseAndValidate('[100, 50');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].path).toBe('$');
      expect(r.errors[0].message).toContain('JSON');
    }
  });

  it('空输入报错', () => {
    const r = parseAndValidate('   ');
    expect(r.ok).toBe(false);
  });

  it('错误按位置稳定汇总：根错误在前，元素错误按索引升序', () => {
    const errors = validateArray([100, 'x', 151, 19, true, null]);
    // 长度 6 合法，故只有 4 个元素错误
    expect(errors.map((e) => e.path)).toEqual(['$[1]', '$[2]', '$[3]', '$[4]', '$[5]']);
    // 重复调用顺序一致
    expect(validateArray([100, 'x', 151]).map((e) => e.path)).toEqual(
      validateArray([100, 'x', 151]).map((e) => e.path),
    );
  });

  it('长度越界与元素错误同时汇总，根错误排在最前', () => {
    const errors = validateArray([100, 999]);
    expect(errors[0].path).toBe('$');
    expect(errors[1].path).toBe('$[1]');
  });

  it('拒绝浮点、布尔、null、字符串', () => {
    const errors = validateArray([100, 100.5, true, null, '50', 100]);
    expect(errors.map((e) => e.path)).toEqual(['$[1]', '$[2]', '$[3]', '$[4]']);
    expect(errors.every((e) => /整数/.test(e.message))).toBe(true);
  });

  it('长度边界 6 与 200', () => {
    expect(validateArray(Array(6).fill(100))).toHaveLength(0);
    expect(validateArray(Array(200).fill(100))).toHaveLength(0);
    expect(validateArray(Array(5).fill(100))[0].message).toContain('6..200');
    expect(validateArray(Array(201).fill(100))[0].message).toContain('6..200');
  });
});

describe('classifyIntervals', () => {
  it('长型/短型在 τ=100 下的边界 ±6', () => {
    expect(classifyIntervals([106], 100)).toMatchObject({ ok: true, kinds: ['long'] });
    expect(classifyIntervals([94], 100)).toMatchObject({ ok: true, kinds: ['long'] });
    expect(classifyIntervals([53], 100)).toMatchObject({ ok: true, kinds: ['short'] });
    expect(classifyIntervals([47], 100)).toMatchObject({ ok: true, kinds: ['short'] });
    expect(classifyIntervals([107], 100).ok).toBe(false);
    expect(classifyIntervals([46], 100).ok).toBe(false);
  });

  it('全 τ 域内长型与短型窗口互斥（不存在兼属）', () => {
    for (const tau of enumerateTau()) {
      for (let d = 20; d <= 150; d++) {
        const isLong = Math.abs(d - tau) <= 6;
        const isShort = Math.abs(2 * d - tau) <= 6;
        expect(isLong && isShort).toBe(false);
      }
    }
  });
});

describe('decodeForTau 帧解码', () => {
  it('往返：编码后解码得到原数字串', () => {
    for (const digits of ['0', '7', '123', '0042', '999999999999']) {
      const train = encodePulseTrain(digits, 100);
      const r = decodeForTau(train, 100);
      expect(r.ok, digits).toBe(true);
      if (r.ok) {
        expect(r.decode.digits).toBe(digits);
        expect(r.decode.payload.map(String).join('')).toBe(digits);
        expect(r.decode.codewords[0].value).toBe(11);
        expect(r.decode.codewords.at(-2)!.value).toBe(15);
      }
    }
  });

  it('保留前导零', () => {
    const train = encodePulseTrain('007', 90);
    const r = decodeForTau(train, 90);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decode.digits).toBe('007');
  });

  it('无抖动的理想串在 τ±6 内全部解出同一数字串', () => {
    const train = encodePulseTrain('42', 100);
    const oks = enumerateTau().filter((t) => decodeForTau(train, t).ok);
    expect(oks).toEqual(Array.from({ length: 13 }, (_, i) => 94 + i));
    for (const t of oks) {
      const r = decodeForTau(train, t);
      if (r.ok) expect(r.decode.digits).toBe('42');
    }
  });

  it('最小 τ 为窗口下界', () => {
    const train = encodePulseTrain('8', 80);
    const r = decodeForTau(train, 80);
    expect(r.ok).toBe(true);
  });

  it('孤立短型淘汰该 τ', () => {
    // 短、短、长 可以；改为 短、长、短、短：开头短型后紧跟长型 => 孤立
    const train: number[] = [];
    const long = 100;
    const short = 50;
    train.push(short, long, short, short, long, long, long, long, long, long);
    const r = decodeForTau(train, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('isolated-short');
  });

  it('位数不是 5 的倍数淘汰', () => {
    // 6 个长型 => 6 bit
    const r = decodeForTau([100, 100, 100, 100, 100, 100], 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('bit-length-mismatch');
  });

  it('错误起始码 / 结束码 / LRC / 载荷越界 分别被识别', () => {
    // 手工构造组：码值序列 [11, payload..., 15, lrc]
    const build = (values: number[], tau = 100): number[] => {
      const out: number[] = [];
      for (const v of values) {
        for (let k = 0; k < 4; k++) out.push(((v >> k) & 1) === 1 ? 50 : 100);
        // 奇校验
        const ones = (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
        out.push(ones % 2 === 0 ? 50 : 100); // 第五位补成奇数个 1
      }
      void tau;
      return out.flatMap((d) => (d === 50 ? [50, 50] : [100]));
    };

    let r = decodeForTau(build([10, 5, 15, 10 ^ 5 ^ 15]), 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('bad-start');

    r = decodeForTau(build([11, 5, 14, 11 ^ 5 ^ 14]), 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('bad-end');

    r = decodeForTau(build([11, 10, 15, 11 ^ 10 ^ 15]), 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('payload-range');

    r = decodeForTau(build([11, 5, 15, 0]), 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('lrc-mismatch');
  });

  it('奇校验失败被识别（翻第五位）', () => {
    const values = [11, 3, 15, 11 ^ 3 ^ 15];
    const out: number[] = [];
    values.forEach((v, gi) => {
      for (let k = 0; k < 4; k++) out.push(((v >> k) & 1) === 1 ? 50 : 100);
      const ones = [0, 1, 2, 3].reduce((a, k) => a + ((v >> k) & 1), 0);
      // 第一组故意写错误校验方向
      out.push((gi === 0 ? ones % 2 !== 0 : ones % 2 === 0) ? 50 : 100);
    });
    const train2 = out.flatMap((d) => (d === 50 ? [50, 50] : [100]));
    const r = decodeForTau(train2, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('parity-error');
  });
});

describe('analyze 端到端枚举', () => {
  it('decoded：理想串多 τ 同串，最小 τ 用于展示', () => {
    const train = encodePulseTrain('1234', 100);
    const a = analyze(train);
    expect(a.outcome).toBe('decoded');
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0].digits).toBe('1234');
    expect(a.groups[0].decodes[0].tau).toBe(94);
    expect(a.groups[0].decodes.at(-1)!.tau).toBe(106);
  });

  it('decoded：漂移串仍可能被若干 τ 解出', () => {
    const train = encodePulseTrain('56', 100, { drift: 4, seed: 3 });
    const a = analyze(train);
    expect(a.outcome).toBe('decoded');
    expect(a.groups[0].digits).toBe('56');
    expect(a.valid.length).toBeGreaterThan(0);
  });

  it('unreadable：所有 τ 均失败', () => {
    const a = analyze(new Array(10).fill(100)); // 10 位、且起始码不对
    expect(a.outcome).toBe('unreadable');
    expect(a.groups).toEqual([]);
    expect(a.failures).toHaveLength(41);
  });

  it('unreadable：间隔时长落在任何 τ 都无法分类', () => {
    const a = analyze([20, 20, 20, 20, 20, 20]);
    expect(a.outcome).toBe('unreadable');
    expect(a.failures.every((f) => f.reason === 'interval-unclassifiable')).toBe(true);
  });
});

describe('groupByDigits / 多解归并', () => {
  function fakeDecode(tau: number, digits: string): TauDecode {
    return {
      tau,
      intervals: [],
      bits: [],
      codewords: [],
      payload: [...digits].map(Number),
      digits,
      lrc: 0,
    };
  }

  it('按数字串字典序排列，组内 τ 升序', () => {
    const groups = groupByDigits([
      fakeDecode(102, '9'),
      fakeDecode(95, '10'),
      fakeDecode(100, '9'),
      fakeDecode(90, '10'),
    ]);
    expect(groups.map((g) => g.digits)).toEqual(['10', '9']);
    expect(groups[0].decodes.map((d) => d.tau)).toEqual([90, 95]);
    expect(groups[1].decodes.map((d) => d.tau)).toEqual([100, 102]);
  });

  it('outcomeFromGroups：0 组 unreadable / 1 组 decoded / 多组 ambiguous', () => {
    expect(outcomeFromGroups([])).toBe('unreadable');
    expect(outcomeFromGroups([{ digits: '1', decodes: [] }])).toBe('decoded');
    expect(
      outcomeFromGroups([
        { digits: '1', decodes: [] },
        { digits: '2', decodes: [] },
      ]),
    ).toBe('ambiguous');
  });
});
