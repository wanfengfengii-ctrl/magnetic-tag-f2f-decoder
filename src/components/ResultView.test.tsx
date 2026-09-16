import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResultView from './ResultView';
import type { Analysis, TauDecode } from '../lib/decoder';
import { encodePulseTrain } from '../lib/encoder';
import { analyze } from '../lib/decoder';

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

describe('ResultView', () => {
  it('decoded：展示数字串、τ 与最小 τ', () => {
    const analysis = analyze(encodePulseTrain('0042', 100));
    render(<ResultView analysis={analysis} />);
    expect(screen.getByTestId('outcome')).toHaveTextContent('decoded');
    expect(screen.getByTestId('digits')).toHaveTextContent('0042');
    expect(screen.getByTestId('min-tau')).toHaveTextContent('94');
    expect(screen.getByTestId('diagram')).toBeInTheDocument();
  });

  it('unreadable：无数字串', () => {
    const analysis: Analysis = { outcome: 'unreadable', groups: [], valid: [], failures: [] };
    render(<ResultView analysis={analysis} />);
    expect(screen.getByTestId('outcome')).toHaveTextContent('unreadable');
    expect(screen.getByTestId('unreadable-panel')).toBeInTheDocument();
  });

  it('ambiguous：按数字串字典序列出 τ', () => {
    const analysis: Analysis = {
      outcome: 'ambiguous',
      groups: [
        { digits: '10', decodes: [fakeDecode(90, '10'), fakeDecode(91, '10')] },
        { digits: '9', decodes: [fakeDecode(100, '9')] },
      ],
      valid: [fakeDecode(90, '10'), fakeDecode(91, '10'), fakeDecode(100, '9')],
      failures: [],
    };
    render(<ResultView analysis={analysis} />);
    expect(screen.getByTestId('outcome')).toHaveTextContent('ambiguous');
    const rows = screen.getAllByTestId('amb-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('10');
    expect(rows[0]).toHaveTextContent('90');
    expect(rows[0]).toHaveTextContent('91');
    expect(rows[1]).toHaveTextContent('9');
    expect(rows[1]).toHaveTextContent('100');
  });
});
