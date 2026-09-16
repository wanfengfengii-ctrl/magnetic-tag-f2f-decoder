import { useMemo, useState } from 'react';
import {
  analyze,
  parseAndValidate,
  type Analysis,
  type InputError,
} from './lib/decoder';
import { encodePulseTrain } from './lib/encoder';
import ResultView from './components/ResultView';

interface Sample {
  label: string;
  build: () => string;
}

function makeSamples(): Sample[] {
  return [
    {
      label: '示例：唯一解（τ=100 理想串，数字 0042）',
      build: () => JSON.stringify(encodePulseTrain('0042', 100)),
    },
    {
      label: '示例：读头漂移 + 抖动（数字 789，τ≈100）',
      build: () => JSON.stringify(encodePulseTrain('789', 100, { drift: 3, jitter: 1, seed: 7 })),
    },
    {
      label: '示例：unreadable（间隔全部无法分类）',
      build: () => JSON.stringify([20, 21, 22, 20, 21, 20]),
    },
    {
      label: '示例：孤立短型串',
      build: () =>
        JSON.stringify([
          50, 100, 50, 50, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
        ]),
    },
  ];
}

export default function App() {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<InputError[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const samples = useMemo(makeSamples, []);

  const decode = () => {
    const parsed = parseAndValidate(text);
    if (!parsed.ok) {
      // 整份拒绝并清除旧结果
      setErrors(parsed.errors);
      setAnalysis(null);
      return;
    }
    setErrors([]);
    setAnalysis(analyze(parsed.durations));
  };

  const loadSample = (build: () => string) => {
    const value = build();
    setText(value);
    setErrors([]);
    const parsed = parseAndValidate(value);
    setAnalysis(parsed.ok ? analyze(parsed.durations) : null);
  };

  return (
    <main className="page">
      <header>
        <h1>磁标脉冲串解码器</h1>
        <p className="subtitle">
          纯前端、纯本地计算：枚举整数时钟 τ = 80..120μs，判定脉冲串解码内容是否唯一。
        </p>
      </header>

      <section className="input-panel">
        <label htmlFor="pulse-input" className="input-label">
          输入：6..200 个间隔时长（20..150μs 整数）的 JSON 数组
        </label>
        <textarea
          id="pulse-input"
          data-testid="pulse-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') decode();
          }}
          spellCheck={false}
          placeholder='例如：[100, 50, 50, 98, 103, 49, 51, 100, 100, 100, 100, 100, 100, 100, 100]'
          rows={5}
        />
        <div className="actions">
          <button type="button" className="primary" onClick={decode} data-testid="decode-btn">
            解码（Ctrl/⌘+Enter）
          </button>
          {samples.map((s) => (
            <button key={s.label} type="button" className="sample" onClick={() => loadSample(s.build)}>
              {s.label}
            </button>
          ))}
        </div>

        {errors.length > 0 && (
          <div className="errors" data-testid="errors" role="alert">
            <strong>输入被整份拒绝（{errors.length} 处错误，按位置排列）：</strong>
            <ol>
              {errors.map((error, i) => (
                <li key={`${error.path}-${i}`}>
                  <code>{error.path}</code>
                  {error.position !== undefined && <code> @{error.position}</code>}：{error.message}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {analysis && <ResultView analysis={analysis} />}
    </main>
  );
}
