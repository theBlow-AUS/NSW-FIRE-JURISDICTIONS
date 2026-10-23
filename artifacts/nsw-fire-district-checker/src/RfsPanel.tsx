import type { FireContext, RfsSourceStatus } from '@workspace/api-client-react';
import { AlertTriangle, CalendarClock, ExternalLink, Phone, ShieldAlert } from 'lucide-react';
import './rfs-panel.css';

const FRNSW_PERMIT_LINK = 'https://www.fire.nsw.gov.au/page.php?id=200';

function fmt(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
}

function SourceRow({ label, id, s }: { label: string; id: string; s: RfsSourceStatus }) {
  return (
    <div className={`rfs-source${s.error || s.stale ? ' is-warn' : ''}`} data-testid={`status-source-${id}`}>
      <div className="rfs-source-head">
        <a href={s.sourceUrl} target="_blank" rel="noreferrer" data-testid={`link-source-${id}`}>{label} <ExternalLink size={10} /></a>
        <span className={`rfs-tag${s.stale ? ' warn' : ''}`} data-testid={`text-source-fresh-${id}`}>{s.stale ? 'Refresh overdue' : 'Dated snapshot'}</span>
      </div>
      <dl>
        <dt>Last successful snapshot</dt><dd data-testid={`text-source-retrieved-${id}`}>{fmt(s.retrievedAt)}</dd>
        <dt>Last refresh attempt</dt><dd data-testid={`text-source-attempt-${id}`}>{fmt(s.lastAttemptAt)}</dd>
        <dt>Records</dt><dd data-testid={`text-source-count-${id}`}>{s.recordCount}</dd>
      </dl>
      {s.error && <p className="rfs-source-error" role="alert" data-testid={`text-source-error-${id}`}>Refresh failed or source blocked: {s.error}</p>}
      {s.stale && <p className="rfs-source-error" data-testid={`text-source-stale-${id}`}>This snapshot is older than expected and may not reflect current RFS data.</p>}
    </div>
  );
}

export default function RfsPanel({ context, loading, error }: { context: FireContext | null; loading: boolean; error: string }) {
  let body;
  if (loading) {
    body = <div className="result-loading" role="status" data-testid="status-rfs-loading"><span className="skeleton" /> Checking RFS permit and contact data…</div>;
  } else if (error) {
    body = <div className="result-copy result-error" role="alert" data-testid="status-rfs-error"><strong>RFS information unavailable</strong><p>{error}</p></div>;
  } else if (!context) {
    body = <div className="result-copy" data-testid="status-rfs-empty"><strong>No location checked</strong><p>Choose an address, point or coordinates to see permit and Fire Control Centre details.</p></div>;
  } else if (context.kind === 'error' || context.kind === 'outside') {
    body = <div className="result-copy" data-testid="status-rfs-not-applicable"><strong>{context.kind === 'outside' ? 'Outside NSW mapped coverage' : 'Location could not be checked'}</strong><p>{context.message ?? 'No RFS permit or contact information applies to this result.'}</p></div>;
  } else if (context.kind === 'frnsw') {
    body = (
      <div className="rfs-frnsw" data-testid="status-rfs-frnsw">
        <div className="rfs-banner"><ShieldAlert size={15} /><span><strong>FRNSW boundary takes priority.</strong> This point is inside a Fire and Rescue NSW fire district. LGA-based RFS permit data and Fire Control Centre contacts are not used for this result.</span></div>
        {context.lga && <div className="rfs-kv"><span>Local government area</span><strong data-testid="text-rfs-lga">{context.lga}</strong></div>}
        <div className="rfs-kv"><span>Fire permit (source: FRNSW)</span><strong data-testid="text-frnsw-permit">Permits are required all year in FRNSW fire districts</strong></div>
        <a className="rfs-link" href={FRNSW_PERMIT_LINK} target="_blank" rel="noreferrer" data-testid="link-frnsw-permits">Official FRNSW permit information <ExternalLink size={11} /></a>
        {context.message && <p className="rfs-note" data-testid="text-rfs-message">{context.message}</p>}
      </div>
    );
  } else {
    const p = context.permitRequired;
    const permit = p === null ? 'Unavailable' : p ? 'Yes' : 'No';
    body = (
      <div className="rfs-rural" data-testid="status-rfs-rural">
        <div className="rfs-grid">
          <div className="rfs-kv"><span>Local government area</span><strong data-testid="text-rfs-lga">{context.lga ?? 'Unavailable'}</strong></div>
          <div className={`rfs-kv rfs-permit is-${permit.toLowerCase()}`}><span>Fire permit required (source: NSW RFS)</span><strong data-testid="text-rfs-permit-required">{permit}</strong></div>
        </div>
        {context.message && <p className="rfs-note" data-testid="text-rfs-message">{context.message}</p>}
        <div className="rfs-contacts">
          <span className="rfs-sub">Fire Control Centre (source: NSW RFS directory)</span>
          {context.contacts.length === 0 ? (
            <p className="rfs-note" data-testid="text-rfs-contacts-unavailable">Contact details are unavailable for this area in the current snapshot.</p>
          ) : context.contacts.map((c, i) => (
            <div className="rfs-contact" key={i} data-testid={`card-rfs-contact-${i}`}>
              <strong data-testid={`text-rfs-district-${i}`}>{c.district || context.district || 'District unavailable'}</strong>
              {c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} data-testid={`link-rfs-phone-${i}`}><Phone size={11} /> {c.phone}</a> : <span>Telephone unavailable</span>}
              <span data-testid={`text-rfs-address-${i}`}>{c.address || 'Physical address unavailable'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const st = context && context.kind === 'rural' ? context.status : null;
  return (
    <section className="result-card rfs-panel" aria-live="polite" data-testid="panel-rfs">
      <div className="result-head"><span>RFS permits and contacts</span>{context?.checkedAt && <span className="result-status" data-testid="text-rfs-checked">{context.checkedAt}</span>}</div>
      <div className="result-body">
        {body}
        {context && !loading && !error && context.kind !== 'outside' && context.kind !== 'error' && context.warnings.length > 0 && (
          <ul className="rfs-warnings" role="alert" data-testid="list-rfs-warnings">
            {context.warnings.map((w, i) => <li key={i} data-testid={`text-rfs-warning-${i}`}><AlertTriangle size={12} /> {w}</li>)}
          </ul>
        )}
        {st && !loading && !error && (
          <div className="rfs-provenance" data-testid="panel-rfs-provenance">
            {context?.localCopy && <p className="rfs-local" data-testid="text-rfs-local-copy">Dated embedded copy: this data is bundled with the page and is not updated in the background.</p>}
            <SourceRow label="RFS fire-permit requirement table" id="permits" s={st.permits} />
            <SourceRow label="RFS Fire Control Centre directory" id="directory" s={st.directory} />
            <div className="rfs-schedule" data-testid="text-rfs-schedule"><CalendarClock size={12} /><span>{context?.localCopy ? 'Next hosted permit-table refresh due (this file will not change)' : 'Next scheduled permit-table refresh'} <strong data-testid="text-rfs-next-refresh">{fmt(st.nextRefreshAt)}</strong>. Schedule: {st.schedule || 'weekly, plus the first and last day of each month'}. The contact directory is a separately dated reference snapshot.</span></div>
          </div>
        )}
      </div>
    </section>
  );
}
