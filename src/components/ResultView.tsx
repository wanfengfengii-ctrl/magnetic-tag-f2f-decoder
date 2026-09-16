import type { Analysis, TauDecode } from '../lib/decoder';
import { TAU_MAX, TAU_MIN } from '../lib/decoder';
import PulseDiagram from './PulseDiagram';

interface ResultViewProps {
  analysis: Analysis;
}

const FAILURE_TEXT: Record<string, string> = {
  'interval-both-kinds': '间隔兼属长/短型',
  'interval-unclassifiable': '间隔无法分类',
  'isolated-short': '孤立短型',
  'bit-length-mismatch': '位数不对齐',
  'parity-error': '奇校验失败',
  'bad-start': '起始码错误',
  'bad-end': '结束码错误',
  'payload-count': '载荷数量越界',
  'payload-range': '载荷码越界',
  'lrc-mismatch': 'LRC 不符',
};

function TauList({ decodes }: { decodes: TauDecode[] }) {
  return (
    <span className="tau-list">
      {decodes.map((d) => (
        <span key={d.tau} className="tau-chip" title={`τ=${d.tau} 有效`}>
          {d.tau}
        </span>
      ))}
    </span>
  );
}

function DecodedPanel({ analysis }: { analysis: Analysis }) {
  const group = analysis.groups[0];
  const minimal = group.decodes[0]; // 已按 τ 升序
  const max = group.decodes[group.decodes.length - 1];

  return (
    <div className="panel-decoded" data-testid="decoded-panel">
      <p className="digits-line">
        解码数字串：<strong data-testid="digits">{group.digits}</strong>
      </p>
      <p className="tau-line">
        有效 τ 共 <strong>{group.decodes.length}</strong> 个（最小 τ ={' '}
        <strong data-testid="min-tau">{minimal.tau}</strong>，最大 τ = {max.tau}）：
      </p>
      <TauList decodes={group.decodes} />

      <h3>按最小 τ = {minimal.tau} 的分类与成位</h3>
      <PulseDiagram decode={minimal} />
      <ul className="legend">
        <li>
          <span className="swatch" style={{ background: '#0e7490' }} /> 长型间隔 → 位 0
        </li>
        <li>
          <span className="swatch" style={{ background: '#d97706' }} /> 短型间隔，相邻两个 → 位 1
        </li>
        <li>数字标注：间隔时长（μs）；柱上方数字为成位；彩色框为码组</li>
      </ul>

      <h3>码组（5 位一组，低位在前）</h3>
      <div className="table-wrap">
        <table className="code-table">
          <thead>
            <tr>
              <th>#</th>
              <th>角色</th>
              <th>码值</th>
              <th>位流（前 4 位 + 奇校验）</th>
            </tr>
          </thead>
          <tbody>
            {minimal.codewords.map((code) => (
              <tr key={code.index} className={`role-${code.role}`}>
                <td>{code.index + 1}</td>
                <td>{roleZh(code.role)}</td>
                <td>{code.value}</td>
                <td className="mono">{code.bits.join('')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lrc-line">
        LRC 校验码 = {minimal.lrc}，与此前 {minimal.codewords.length - 1} 个码值逐位异或一致。
      </p>
    </div>
  );
}

function AmbiguousPanel({ analysis }: { analysis: Analysis }) {
  return (
    <div className="panel-ambiguous" data-testid="ambiguous-panel">
      <p>共出现 {analysis.groups.length} 种不同数字串，内容不唯一：</p>
      <div className="table-wrap">
        <table className="amb-table">
          <thead>
            <tr>
              <th>数字串（字典序）</th>
              <th>有效 τ</th>
              <th>τ 列表</th>
            </tr>
          </thead>
          <tbody>
            {analysis.groups.map((group) => (
              <tr key={group.digits} data-testid="amb-row">
                <td className="mono digits-cell">{group.digits}</td>
                <td>{group.decodes.length}</td>
                <td>
                  <TauList decodes={group.decodes} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function roleZh(role: string): string {
  return { start: '起始码', payload: '载荷', end: '结束码', lrc: 'LRC' }[role] ?? role;
}

export default function ResultView({ analysis }: ResultViewProps) {
  const badge =
    analysis.outcome === 'decoded'
      ? { cls: 'badge decoded', text: 'decoded · 唯一解' }
      : analysis.outcome === 'ambiguous'
        ? { cls: 'badge ambiguous', text: 'ambiguous · 多解' }
        : { cls: 'badge unreadable', text: 'unreadable · 无解' };

  return (
    <section className="result" data-testid="result" aria-live="polite">
      <div className="result-head">
        <span className={badge.cls} data-testid="outcome">
          {badge.text}
        </span>
        <span className="sweep-meta">
          扫描 τ = {TAU_MIN}..{TAU_MAX}：{analysis.valid.length} 个有效 /{' '}
          {analysis.failures.length} 个淘汰
        </span>
      </div>

      {analysis.outcome === 'decoded' && <DecodedPanel analysis={analysis} />}
      {analysis.outcome === 'ambiguous' && <AmbiguousPanel analysis={analysis} />}
      {analysis.outcome === 'unreadable' && (
        <div className="panel-unreadable" data-testid="unreadable-panel">
          <p>没有任何 τ ∈ [{TAU_MIN}, {TAU_MAX}] 能把该脉冲串解成合法帧。</p>
        </div>
      )}

      <details className="sweep-details">
        <summary>τ 扫描明细（{analysis.failures.length + analysis.valid.length} 项）</summary>
        <div className="table-wrap">
          <table className="sweep-table">
            <thead>
              <tr>
                <th>τ</th>
                <th>结果</th>
                <th>数字串 / 淘汰原因</th>
              </tr>
            </thead>
            <tbody>
              {[...analysis.valid, ...analysis.failures]
                .sort((a, b) => a.tau - b.tau)
                .map((entry) =>
                  'digits' in entry ? (
                    <tr key={entry.tau} className="sweep-ok">
                      <td>{entry.tau}</td>
                      <td>有效</td>
                      <td className="mono">{entry.digits}</td>
                    </tr>
                  ) : (
                    <tr key={entry.tau} className="sweep-bad">
                      <td>{entry.tau}</td>
                      <td>淘汰</td>
                      <td>{FAILURE_TEXT[entry.reason] ?? entry.reason}</td>
                    </tr>
                  ),
                )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
