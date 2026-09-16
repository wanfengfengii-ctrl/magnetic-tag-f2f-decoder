/**
 * 磁标脉冲串解码器核心（纯计算，可在浏览器 / Node 任意一侧运行）。
 *
 * 输入：相邻脉冲边沿之间的间隔时长 d（微秒，整数，20..150）。
 * 枚举整数时钟 τ = 80..120：
 *   - 长型：|d - τ| ≤ 6，成位 0（一个长型间隔一位）
 *   - 短型：|2d - τ| ≤ 6，相邻两个短型成位 1
 *   - 同一间隔不得兼属长型与短型；无法归类则该 τ 淘汰
 *   - 孤立短型（未与另一短型相邻）淘汰该 τ
 * 位流每 5 位一组：前 4 位低位在前组成码值，第 5 位使本组 1 的总数为奇数。
 * 帧 = 起始码 11 + 1..12 个载荷码(0..9) + 结束码 15 + LRC。
 * LRC 低四位 = 此前所有码值逐位异或；帧外不得有位。
 */

export const TAU_MIN = 80;
export const TAU_MAX = 120;
export const TOLERANCE = 6;

export const MIN_INTERVALS = 6;
export const MAX_INTERVALS = 200;
export const MIN_DURATION = 20;
export const MAX_DURATION = 150;

export const START_CODE = 11;
export const END_CODE = 15;
export const MIN_PAYLOAD = 1;
export const MAX_PAYLOAD = 12;
export const BITS_PER_GROUP = 5;

export type IntervalKind = 'long' | 'short';

export interface ClassifiedInterval {
  /** 间隔序号（从 0 开始） */
  index: number;
  duration: number;
  kind: IntervalKind;
}

export interface BitCell {
  /** 位序号（从 0 开始） */
  index: number;
  bit: 0 | 1;
  /** 该位占用的间隔序号；位 0 占 1 个长型，位 1 占 2 个相邻短型 */
  intervalIndices: number[];
}

export type CodewordRole = 'start' | 'payload' | 'end' | 'lrc';

export interface Codeword {
  /** 组序号（从 0 开始） */
  index: number;
  /** 前四位低位在前组成的码值 0..15 */
  value: number;
  /** 第五位（奇校验位） */
  parityBit: 0 | 1;
  bits: (0 | 1)[];
  bitIndices: number[];
  role: CodewordRole;
}

export type FailureReason =
  | 'interval-both-kinds'
  | 'interval-unclassifiable'
  | 'isolated-short'
  | 'bit-length-mismatch'
  | 'parity-error'
  | 'bad-start'
  | 'bad-end'
  | 'payload-count'
  | 'payload-range'
  | 'lrc-mismatch';

export interface TauFailure {
  tau: number;
  reason: FailureReason;
  /** 相关间隔序号（若适用） */
  intervalIndex?: number;
  /** 相关码组序号（若适用） */
  groupIndex?: number;
  /** 供界面直接展示的稳定中文说明 */
  message: string;
}

export interface TauDecode {
  tau: number;
  intervals: ClassifiedInterval[];
  bits: BitCell[];
  codewords: Codeword[];
  /** 载荷码值（0..9） */
  payload: number[];
  /** 载荷拼成的数字串（保留前导零） */
  digits: string;
  lrc: number;
}

export interface InputError {
  /** 类 JSONPath 位置：'$' 或 '$[i]' */
  path: string;
  /** 字符偏移（仅 JSON 解析错误可得时提供） */
  position?: number;
  message: string;
}

export interface DigitGroup {
  digits: string;
  /** 产生该数字串的全部解码，按 τ 升序 */
  decodes: TauDecode[];
}

export type Outcome = 'unreadable' | 'decoded' | 'ambiguous';

export interface Analysis {
  outcome: Outcome;
  /** unreadable 为空；decoded 恰一组；ambiguous 按数字串字典序 */
  groups: DigitGroup[];
  /** 全部有效 τ 的解码，按 τ 升序 */
  valid: TauDecode[];
  /** 全部无效 τ 的失败原因（τ 升序） */
  failures: TauFailure[];
}

// ---------------------------------------------------------------------------
// 输入校验：错误按位置稳定汇总（根错误在前，元素错误按序号升序）
// ---------------------------------------------------------------------------

export function validateArray(value: unknown): InputError[] {
  if (!Array.isArray(value)) {
    return [{ path: '$', message: `顶层必须是 JSON 数组，实际得到 ${typeName(value)}` }];
  }

  const errors: InputError[] = [];
  const count = value.length;
  if (count < MIN_INTERVALS || count > MAX_INTERVALS) {
    errors.push({
      path: '$',
      message: `数组长度须为 ${MIN_INTERVALS}..${MAX_INTERVALS}，实际为 ${count}`,
    });
  }

  value.forEach((element, i) => {
    const path = `$[${i}]`;
    if (typeof element !== 'number' || !Number.isFinite(element) || !Number.isInteger(element)) {
      errors.push({
        path,
        message: `第 ${i + 1} 项必须是 ${MIN_DURATION}..${MAX_DURATION} 微秒整数，得到 ${formatValue(element)}`,
      });
    } else if (element < MIN_DURATION || element > MAX_DURATION) {
      errors.push({
        path,
        message: `第 ${i + 1} 项超出范围：须为 ${MIN_DURATION}..${MAX_DURATION} 微秒，得到 ${element}`,
      });
    }
  });

  return errors;
}

export function parseAndValidate(text: string):
  | { ok: true; durations: number[] }
  | { ok: false; errors: InputError[] } {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, errors: [{ path: '$', message: '输入为空：需要一个 JSON 数字数组' }] };
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const error: InputError = { path: '$', message: `不是合法的 JSON：${raw}` };
    const position = extractJsonPosition(raw);
    if (position !== undefined) error.position = position;
    return { ok: false, errors: [error] };
  }

  const errors = validateArray(value);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, durations: value as number[] };
}

function extractJsonPosition(message: string): number | undefined {
  const pos = /position\s+(\d+)/i.exec(message);
  if (pos) return Number(pos[1]);
  const col = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (col) {
    // 列号从 1 开始；仅有单行输入时列号即字符偏移的 1-based 版本
    const line = Number(col[1]);
    const column = Number(col[2]);
    return line === 1 ? Math.max(0, column - 1) : column - 1;
  }
  return undefined;
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  return String(value);
}

// ---------------------------------------------------------------------------
// 单个 τ 的解码
// ---------------------------------------------------------------------------

export type ClassifyResult =
  | { ok: true; kinds: IntervalKind[] }
  | { ok: false; reason: 'interval-both-kinds' | 'interval-unclassifiable'; intervalIndex: number };

export function classifyIntervals(
  durations: readonly number[],
  tau: number,
): ClassifyResult {
  const kinds: IntervalKind[] = [];
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i];
    const isLong = Math.abs(d - tau) <= TOLERANCE;
    const isShort = Math.abs(2 * d - tau) <= TOLERANCE;
    if (isLong && isShort) {
      return { ok: false, reason: 'interval-both-kinds', intervalIndex: i };
    }
    if (!isLong && !isShort) {
      return { ok: false, reason: 'interval-unclassifiable', intervalIndex: i };
    }
    kinds.push(isLong ? 'long' : 'short');
  }
  return { ok: true, kinds };
}

export type TauResult =
  | { ok: true; decode: TauDecode }
  | { ok: false; failure: TauFailure };

export function decodeForTau(durations: readonly number[], tau: number): TauResult {
  const fail = (
    reason: FailureReason,
    message: string,
    extra?: { intervalIndex?: number; groupIndex?: number },
  ): TauResult => ({ ok: false, failure: { tau, reason, message, ...extra } });

  // 1) 逐间隔分类
  const classified = classifyIntervals(durations, tau);
  if (!classified.ok) {
    const d = durations[classified.intervalIndex];
    if (classified.reason === 'interval-both-kinds') {
      return fail(
        'interval-both-kinds',
        `第 ${classified.intervalIndex + 1} 个间隔 d=${d} 同时满足长型与短型条件`,
        { intervalIndex: classified.intervalIndex },
      );
    }
    return fail(
      'interval-unclassifiable',
      `第 ${classified.intervalIndex + 1} 个间隔 d=${d} 对 τ=${tau} 既非长型也非短型`,
      { intervalIndex: classified.intervalIndex },
    );
  }

  // 2) 长型成位 0，相邻两个短型成位 1，孤立短型淘汰
  const bits: BitCell[] = [];
  for (let i = 0; i < classified.kinds.length; ) {
    if (classified.kinds[i] === 'long') {
      bits.push({ index: bits.length, bit: 0, intervalIndices: [i] });
      i += 1;
    } else {
      if (i + 1 >= classified.kinds.length || classified.kinds[i + 1] !== 'short') {
        return fail('isolated-short', `第 ${i + 1} 个短型间隔没有相邻短型配对`, {
          intervalIndex: i,
        });
      }
      bits.push({ index: bits.length, bit: 1, intervalIndices: [i, i + 1] });
      i += 2;
    }
  }

  // 3) 每 5 位一组
  if (bits.length === 0 || bits.length % BITS_PER_GROUP !== 0) {
    return fail('bit-length-mismatch', `位流长度 ${bits.length} 不是 5 的整数倍`);
  }

  const groupCount = bits.length / BITS_PER_GROUP;
  const groups: { value: number; parityBit: 0 | 1; bits: (0 | 1)[]; bitIndices: number[] }[] = [];
  for (let g = 0; g < groupCount; g++) {
    const slice = bits.slice(g * BITS_PER_GROUP, (g + 1) * BITS_PER_GROUP);
    const groupBits = slice.map((b) => b.bit);
    let value = 0;
    for (let k = 0; k < 4; k++) value |= groupBits[k] << k; // 低位在前
    const parityBit = groupBits[4];
    groups.push({
      value,
      parityBit,
      bits: groupBits,
      bitIndices: slice.map((b) => b.index),
    });
  }

  // 4) 奇校验：第五位须令本组 1 的总数为奇数
  for (let g = 0; g < groups.length; g++) {
    const ones = groups[g].bits.reduce<number>((acc, b) => acc + b, 0);
    if (ones % 2 !== 1) {
      return fail(
        'parity-error',
        `第 ${g + 1} 组码值 ${groups[g].value} 的 1 总数为 ${ones}（应为奇数）`,
        { groupIndex: g },
      );
    }
  }

  // 5) 帧结构：起始码 11 + 1..12 载荷 + 结束码 15 + LRC
  if (groups[0].value !== START_CODE) {
    return fail('bad-start', `第一组码值为 ${groups[0].value}，不是起始码 11`, {
      groupIndex: 0,
    });
  }

  const payloadCount = groups.length - 3;
  if (payloadCount < MIN_PAYLOAD || payloadCount > MAX_PAYLOAD) {
    return fail(
      'payload-count',
      `载荷码数量为 ${payloadCount}，超出 ${MIN_PAYLOAD}..${MAX_PAYLOAD}`,
    );
  }

  const payload = groups.slice(1, 1 + payloadCount).map((g) => g.value);
  for (let p = 0; p < payload.length; p++) {
    if (payload[p] > 9) {
      return fail(
        'payload-range',
        `第 ${p + 1} 个载荷码为 ${payload[p]}，超出 0..9`,
        { groupIndex: p + 1 },
      );
    }
  }

  if (groups[groups.length - 2].value !== END_CODE) {
    return fail(
      'bad-end',
      `倒数第二组码值为 ${groups[groups.length - 2].value}，不是结束码 15`,
      { groupIndex: groups.length - 2 },
    );
  }

  let expectedLrc = 0;
  for (let g = 0; g < groups.length - 1; g++) expectedLrc ^= groups[g].value;
  const actualLrc = groups[groups.length - 1].value;
  if (actualLrc !== expectedLrc) {
    return fail(
      'lrc-mismatch',
      `LRC 为 ${actualLrc}，按此前码值逐位异或应为 ${expectedLrc}`,
      { groupIndex: groups.length - 1 },
    );
  }

  const roleOf = (g: number): CodewordRole => {
    if (g === 0) return 'start';
    if (g === groups.length - 1) return 'lrc';
    if (g === groups.length - 2) return 'end';
    return 'payload';
  };

  const decode: TauDecode = {
    tau,
    intervals: durations.map((d, i) => ({
      index: i,
      duration: d,
      kind: classified.kinds[i],
    })),
    bits,
    codewords: groups.map((g, i) => ({ index: i, ...g, role: roleOf(i) })),
    payload,
    digits: payload.map((v) => String(v)).join(''),
    lrc: actualLrc,
  };
  return { ok: true, decode };
}

// ---------------------------------------------------------------------------
// 枚举 τ 并按数字串归并
// ---------------------------------------------------------------------------

export function enumerateTau(): number[] {
  const taus: number[] = [];
  for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) taus.push(tau);
  return taus;
}

/** 按数字串归并有效解码；组内按 τ 升序，组间按数字串字典序 */
export function groupByDigits(decodes: readonly TauDecode[]): DigitGroup[] {
  const map = new Map<string, TauDecode[]>();
  for (const decode of decodes) {
    const list = map.get(decode.digits);
    if (list) list.push(decode);
    else map.set(decode.digits, [decode]);
  }
  const groups = [...map.entries()].map(([digits, list]) => ({
    digits,
    decodes: list.sort((a, b) => a.tau - b.tau),
  }));
  return groups.sort((a, b) => (a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0));
}

export function outcomeFromGroups(groups: readonly DigitGroup[]): Outcome {
  if (groups.length === 0) return 'unreadable';
  if (groups.length === 1) return 'decoded';
  return 'ambiguous';
}

export function analyze(durations: readonly number[]): Analysis {
  const valid: TauDecode[] = [];
  const failures: TauFailure[] = [];

  for (const tau of enumerateTau()) {
    const result = decodeForTau(durations, tau);
    if (result.ok) valid.push(result.decode);
    else failures.push(result.failure);
  }

  valid.sort((a, b) => a.tau - b.tau);
  const groups = groupByDigits(valid);
  return { outcome: outcomeFromGroups(groups), groups, valid, failures };
}
