import { useMemo } from 'react';
import type { TauDecode } from '../lib/decoder';

interface PulseDiagramProps {
  decode: TauDecode;
}

const ROLE_COLOR: Record<string, string> = {
  start: '#2563eb',
  payload: '#16a34a',
  end: '#ea580c',
  lrc: '#9333ea',
};

const ROLE_LABEL: Record<string, string> = {
  start: '起始',
  payload: '载荷',
  end: '结束',
  lrc: 'LRC',
};

const PAD_X = 8;
const BASE_Y = 226;
const LONG_H = 78;
const SHORT_H = 44;

/** 按最小 τ 的分类和成位绘制脉冲时序图（纯 SVG） */
export default function PulseDiagram({ decode }: PulseDiagramProps) {
  const model = useMemo(() => {
    const durations = decode.intervals.map((i) => i.duration);
    const cumulative: number[] = [0];
    for (const d of durations) cumulative.push(cumulative[cumulative.length - 1] + d);
    const total = cumulative[cumulative.length - 1];
    const scale = Math.min(3, Math.max(0.11, 1080 / total));
    const width = Math.ceil(total * scale) + PAD_X * 2;

    const intervalSpan = (indices: number[]) => ({
      x0: cumulative[indices[0]] * scale + PAD_X,
      x1: cumulative[indices[indices.length - 1] + 1] * scale + PAD_X,
    });

    return { cumulative, scale, width, total, intervalSpan };
  }, [decode]);

  const { scale, width, intervalSpan } = model;
  const height = 268;

  return (
    <div className="diagram-scroll" data-testid="diagram">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`τ=${decode.tau} 的脉冲分类与成位图`}
      >
        {/* 码组框（每 5 位） */}
        {decode.codewords.map((code) => {
          const firstBit = decode.bits[code.bitIndices[0]];
          const lastBit = decode.bits[code.bitIndices[code.bitIndices.length - 1]];
          const { x0, x1 } = intervalSpan([
            ...firstBit.intervalIndices,
            ...lastBit.intervalIndices,
          ]);
          const color = ROLE_COLOR[code.role];
          return (
            <g key={`g-${code.index}`}>
              <rect
                x={x0 - 3}
                y={26}
                width={Math.max(10, x1 - x0 + 6)}
                height={92}
                rx={8}
                fill={color}
                fillOpacity={0.08}
                stroke={color}
                strokeWidth={1.5}
              />
              <text x={x0 + 2} y={18} fontSize={11} fill={color} fontWeight={700}>
                {code.value}
                <tspan fill="#64748b" fontWeight={400}>
                  {' '}
                  {ROLE_LABEL[code.role]}
                </tspan>
              </text>
            </g>
          );
        })}

        {/* 成位标记：位 0 = 单个长型，位 1 = 相邻两个短型 */}
        {decode.bits.map((bit) => {
          const { x0, x1 } = intervalSpan(bit.intervalIndices);
          const cx = (x0 + x1) / 2;
          return (
            <g key={`b-${bit.index}`}>
              <line x1={x0 + 1} y1={106} x2={x1 - 1} y2={106} stroke="#94a3b8" strokeWidth={1} />
              <text
                x={cx}
                y={120}
                textAnchor="middle"
                fontSize={x1 - x0 >= 12 ? 13 : 9}
                fontWeight={700}
                fill={bit.bit === 1 ? '#b45309' : '#0f766e'}
              >
                {bit.bit}
              </text>
            </g>
          );
        })}

        {/* 间隔柱：长型高、短型矮 */}
        {decode.intervals.map((interval) => {
          const x = model.cumulative[interval.index] * scale + PAD_X;
          const w = Math.max(1.2, interval.duration * scale - 1);
          const h = interval.kind === 'long' ? LONG_H : SHORT_H;
          const y = BASE_Y - h;
          const fill = interval.kind === 'long' ? '#0e7490' : '#d97706';
          return (
            <g key={`i-${interval.index}`}>
              <rect x={x} y={y} width={w} height={h} fill={fill} rx={1.5}>
                <title>
                  间隔 {interval.index + 1}：d={interval.duration}μs，
                  {interval.kind === 'long' ? '长型→位0' : '短型（成对→位1）'}
                </title>
              </rect>
              {w >= 20 && (
                <text
                  x={x + w / 2}
                  y={BASE_Y + 14}
                  textAnchor="middle"
                  fontSize={9.5}
                  fill="#475569"
                >
                  {interval.duration}
                </text>
              )}
            </g>
          );
        })}

        {/* 基线 */}
        <line x1={0} y1={BASE_Y} x2={width} y2={BASE_Y} stroke="#cbd5e1" strokeWidth={1} />
      </svg>
    </div>
  );
}
