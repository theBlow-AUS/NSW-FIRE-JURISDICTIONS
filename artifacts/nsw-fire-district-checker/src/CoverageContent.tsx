import { AlertCircle, Check, Info, LoaderCircle, MapPin, ShieldCheck } from 'lucide-react';
import type { CoverageResult } from './fire-service';

type Props = {
  coverage: CoverageResult | null;
  loading: boolean;
  compact?: boolean;
};

export default function CoverageContent({ coverage, loading, compact = false }: Props) {
  const prefix = compact ? 'popup' : 'status';
  if (loading) {
    return <div className="result-loading" role="status" data-testid={`${prefix}-coverage-loading`}><LoaderCircle size={16} /> Checking location…</div>;
  }
  if (!coverage) {
    return <div className="result-empty" data-testid="status-awaiting-location"><span className="result-emblem"><ShieldCheck size={18} /></span><span className="result-copy"><strong>Select a location</strong><p>Search for an address or drop a pin on the map.</p></span></div>;
  }
  const details = {
    frnsw: {
      title: 'Within an FRNSW fire district',
      description: coverage.district ? `Mapped district: ${coverage.district}.` : 'This point intersects a mapped Fire and Rescue NSW district.',
      icon: <Check size={18} />,
    },
    rural: {
      title: 'Rural Fire District',
      description: compact
        ? 'Outside mapped FRNSW districts. RFD coverage is inferred.'
        : 'This NSW point is outside the mapped FRNSW Fire Districts, so RFD coverage is inferred. A separate RFD boundary has not been verified. Confirm with the relevant fire service if certainty is needed.',
      icon: <Info size={18} />,
    },
    outside: {
      title: 'Outside New South Wales',
      description: 'This tool only checks NSW fire district data. Choose a location in NSW.',
      icon: <MapPin size={18} />,
    },
    error: {
      title: 'Coverage check unavailable',
      description: coverage.message,
      icon: <AlertCircle size={18} />,
    },
  }[coverage.kind];
  return (
    <div className={`result-empty ${coverage.kind === 'error' ? 'result-error' : coverage.kind !== 'frnsw' ? 'result-unknown' : ''}`} data-testid={`${prefix}-coverage-${coverage.kind}`}>
      <span className="result-emblem">{details.icon}</span>
      <span className="result-copy"><strong>{details.title}</strong><p>{details.description}</p></span>
    </div>
  );
}
