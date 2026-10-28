import { useCallback, useEffect, useState } from 'react';
import type { GeoJsonCollection, GeoJsonFeature, GeoJsonGeometry } from './standalone-api';
import './map-feeds.css';

export type FeedLayer = { id: string; name: string; url: string; enabled: boolean; transparency: number; builtin?: boolean };
type FeedData = {
  collection: GeoJsonCollection; checkedAt: string; sourceUpdatedAt: string | null;
  stale: boolean; error: string | null; warnings: string[];
  geometrySource: { url: string; attribution: string } | null;
};
type FeedState = { data?: FeedData; error?: string; loading?: boolean };
const STORAGE = 'nsw-map-rss-layers-v1';
export const DEFAULT_FEED_LAYERS: FeedLayer[] = [
  { id: 'rfs-danger', name: 'RFS fire danger & total fire bans', url: 'https://www.rfs.nsw.gov.au/feeds/fdrToban.xml', enabled: true, transparency: 30, builtin: true },
  { id: 'rfs-incidents', name: 'RFS major incidents', url: 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.xml', enabled: false, transparency: 0, builtin: true },
];
const valid = (v: unknown): v is FeedLayer => {
  const f = v as FeedLayer;
  return Boolean(f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.url === 'string' &&
    typeof f.enabled === 'boolean' && Number.isFinite(f.transparency) && f.transparency >= 0 && f.transparency <= 100);
};

export function useMapFeeds() {
  const [storageError, setStorageError] = useState('');
  const [layers, setLayers] = useState<FeedLayer[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) { const saved = JSON.parse(raw); if (Array.isArray(saved) && saved.length <= 12 && saved.every(valid)) return saved; }
    } catch { /* The save effect reports unavailable browser storage below. */ }
    return structuredClone(DEFAULT_FEED_LAYERS);
  });
  const [states, setStates] = useState<Record<string, FeedState>>({});
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(layers)); setStorageError(''); }
    catch { setStorageError('Browser storage is unavailable. Layer settings will last only for this session.'); }
  }, [layers]);
  const urls = layers.map(({ id, url }) => `${id}|${url}`).join('\n');
  useEffect(() => {
    if (location.protocol === 'file:') return;
    const abort = new AbortController();
    setStates((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => layers.some((layer) => layer.id === id))));
    const load = async (force = false) => {
      await Promise.all(layers.map(async (layer) => {
        setStates((previous) => ({ ...previous, [layer.id]: { ...previous[layer.id], loading: true } }));
        try {
          const base = import.meta.env.BASE_URL.replace(/\/$/, '');
          const response = await fetch(`${base}/api/map-feeds?${new URLSearchParams({ url: layer.url, ...(force ? { refresh: '1' } : {}) })}`,
            { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `Feed returned HTTP ${response.status}.`);
          if (data.collection?.type !== 'FeatureCollection' || !Array.isArray(data.collection.features)) throw new Error('Invalid feed response.');
          if (!abort.signal.aborted) setStates((previous) => ({ ...previous, [layer.id]: { data, loading: false } }));
        } catch (error) {
          if (!abort.signal.aborted) setStates((previous) => ({ ...previous, [layer.id]: {
            ...previous[layer.id], loading: false, error: error instanceof Error ? error.message : 'Feed unavailable.',
            ...(previous[layer.id]?.data ? { data: { ...previous[layer.id].data!, stale: true, error: error instanceof Error ? error.message : 'Feed unavailable.' } } : {}),
          } }));
        }
      }));
    };
    void load(refresh > 0);
    const timer = setInterval(() => { void load(); }, 5 * 60 * 1000);
    return () => { abort.abort(); clearInterval(timer); };
    // Visibility and transparency changes must not refetch or replace data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, refresh]);
  const update = useCallback((id: string, changes: Partial<FeedLayer>) => setLayers((previous) => previous.map((layer) => layer.id === id ? { ...layer, ...changes } : layer)), []);
  return { layers, states, setLayers, update, storageError, refresh: () => setRefresh((n) => n + 1) };
}
export type MapFeedModel = ReturnType<typeof useMapFeeds>;

function colour(feature: GeoJsonFeature) {
  const rating = String(feature.properties?.today || '').toUpperCase();
  if ('today' in (feature.properties || {})) return ({ MODERATE: '#55a72e', HIGH: '#f5cc2b', EXTREME: '#ed722c', CATASTROPHIC: '#d62525', NONE: '#a0a9ad' } as Record<string, string>)[rating] || '#a0a9ad';
  return '#a13e2a';
}

export function FeedMapOverlay({ model, width, height, position, onSelect }: {
  model: MapFeedModel; width: number; height: number;
  position: (lon: number, lat: number) => [number, number];
  onSelect: (feature: GeoJsonFeature, layer: FeedLayer) => void;
}) {
  const draw = (geometry: GeoJsonGeometry | null, feature: GeoJsonFeature, layer: FeedLayer, key: string): React.ReactNode => {
    if (!geometry) return null;
    const coords = geometry.coordinates as number[] | number[][] | number[][][] | number[][][][];
    // Do not stop pointer events: the map must still pan and drop a coverage pin
    // when a default-visible district polygon covers the viewport.
    const events = { onClick: (event: React.MouseEvent) => { event.stopPropagation(); onSelect(feature, layer); } };
    const ban = String(feature.properties?.banToday).toLowerCase() === 'yes';
    const common = { ...events, fill: colour(feature), stroke: ban ? '#75249a' : colour(feature), strokeWidth: ban ? 3 : 1.4, style: { pointerEvents: 'auto' as const, cursor: 'pointer' } };
    const points = (row: number[][]) => row.filter((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite))
      .map(([x, y], index) => `${index ? 'L' : 'M'} ${position(x, y).join(' ')}`).join(' ');
    if (geometry.type === 'Point') {
      const p = coords as number[];
      if (!p || !p.every(Number.isFinite)) return null;
      const [cx, cy] = position(p[0], p[1]);
      return <circle key={key} {...common} cx={cx} cy={cy} r={6}><title>{String(feature.properties?.title || layer.name)}</title></circle>;
    }
    if (geometry.type === 'Polygon') return <path key={key} {...common} fillRule="evenodd" d={(coords as number[][][]).map((ring) => `${points(ring)} Z`).join(' ')}><title>{String(feature.properties?.title || layer.name)} · {String(feature.properties?.today || '')}</title></path>;
    if (geometry.type === 'LineString') return <path key={key} {...common} fill="none" d={points(coords as number[][])} />;
    const parts = geometry.type === 'GeometryCollection' ? geometry.geometries || [] :
      geometry.type === 'MultiPolygon' ? (coords as number[][][][]).map((coordinates) => ({ type: 'Polygon', coordinates })) :
      geometry.type === 'MultiPoint' ? (coords as number[][]).map((coordinates) => ({ type: 'Point', coordinates })) : [];
    return parts.map((part, index) => draw(part, feature, layer, `${key}-${index}`));
  };
  return <svg className="feed-map-overlay" width={width} height={height} aria-label="RSS feed map layers">
    {model.layers.filter((layer) => layer.enabled).map((layer) => <g key={layer.id} opacity={1 - layer.transparency / 100} data-testid={`feed-map-layer-${layer.id}`}>
      {model.states[layer.id]?.data?.collection.features.slice(0, 5000).map((feature, index) => draw(feature.geometry, feature, layer, `${layer.id}-${index}`))}
    </g>)}
  </svg>;
}

function download(data: FeedData, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...data.collection, _feed: { checkedAt: data.checkedAt, stale: data.stale, error: data.error, geometrySource: data.geometrySource } }, null, 2)], { type: 'application/geo+json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^a-z0-9_-]/gi, '-')}.geojson`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FeedControls({ model, selected, clearSelected, onSelect }: {
  model: MapFeedModel; selected: { feature: GeoJsonFeature; layer: FeedLayer } | null; clearSelected: () => void;
  onSelect: (feature: GeoJsonFeature, layer: FeedLayer) => void;
}) {
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [error, setError] = useState('');
  if (location.protocol === 'file:') return null;
  const add = (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { setError('Enter a valid HTTPS RSS/Atom URL.'); return; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) { setError('Use a public HTTPS feed without embedded credentials.'); return; }
    if (!name.trim()) { setError('Enter a layer name.'); return; }
    if (model.layers.length >= 12) { setError('Up to 12 feeds can be configured. Remove a custom feed first.'); return; }
    if (model.layers.some((layer) => layer.url === parsed.href)) { setError('That feed has already been added.'); return; }
    model.setLayers((previous) => [...previous, { id: crypto.randomUUID(), name: name.trim().slice(0, 100), url: parsed.href, enabled: false, transparency: 0 }]);
    setName(''); setUrl('');
  };
  return <section className="map-feed-controls" aria-label="RSS feed layers" data-testid="feed-controls">
    <div className="map-feed-heading"><h3>RSS &amp; live feed layers</h3><button type="button" onClick={model.refresh}>Refresh feeds</button></div>
    <p>Settings are saved in this browser. New feeds start off. Fire danger starts at 30% transparency (70% opacity).</p>
    {model.storageError && <p role="alert">{model.storageError}</p>}
    {selected && <div className="map-feed-detail" role="region" aria-label="Selected feed feature">
      <button type="button" onClick={clearSelected} aria-label="Close feed details">Close</button>
      <strong>{String(selected.feature.properties?.title || selected.layer.name)}</strong>
      <p>{selected.feature.properties?.today ? `Today: ${selected.feature.properties.today} · Tomorrow: ${selected.feature.properties.tomorrow} · Total fire ban today: ${selected.feature.properties.banToday}` : String(selected.feature.properties?.description || '').slice(0, 3000)}</p>
      {typeof selected.feature.properties?.link === 'string' && /^https?:\/\//i.test(selected.feature.properties.link) && <a href={selected.feature.properties.link} target="_blank" rel="noreferrer">Official entry</a>}
    </div>}
    {model.layers.map((layer) => {
      const state = model.states[layer.id], data = state?.data;
      const spatial = data?.collection.features.filter((feature) => feature.geometry).length || 0;
      return <div className="map-feed-row" key={layer.id}>
        <label className="map-feed-toggle"><input type="checkbox" checked={layer.enabled} onChange={(event) => model.update(layer.id, { enabled: event.target.checked })} data-testid={`feed-toggle-${layer.id}`} />{layer.name}</label>
        <a href={layer.url} target="_blank" rel="noreferrer" className="map-feed-source">Feed source</a>
        <label className="map-feed-slider">Transparency: {layer.transparency}%
          <input type="range" min="0" max="100" step="1" value={layer.transparency} onChange={(event) => model.update(layer.id, { transparency: Number(event.target.value) })} aria-label={`${layer.name} transparency`} data-testid={`feed-transparency-${layer.id}`} />
        </label>
        <p role="status">{state?.loading ? 'Checking feed…' : data ? `${data.collection.features.length} entries · ${spatial} with map geometry` : 'Not loaded yet'}
          {data && ` · Last checked ${new Date(data.checkedAt).toLocaleString()}`}
          {data?.sourceUpdatedAt && ` · Source updated ${data.sourceUpdatedAt}`}
        </p>
        {(state?.error || data?.stale) && <p className="map-feed-warning" role="alert">{state?.error || data?.error} {data && 'Displayed data is a dated snapshot; check the official source.'}</p>}
        {data && spatial === 0 && <p>No supported coordinates in this feed. Entries are available below; no locations have been invented.</p>}
        {data && spatial > 5000 && <p>Map preview limited to 5,000 entries. The download retains all ingested entries.</p>}
        {data?.warnings.map((warning) => <p className="map-feed-warning" key={warning}>{warning}</p>)}
        {data?.geometrySource && <p><a href={data.geometrySource.url} target="_blank" rel="noreferrer">{data.geometrySource.attribution}</a> · generalized display boundaries, joined by exact region number and name.</p>}
        {data && <><button type="button" onClick={() => download(data, layer.name)}>Download GeoJSON</button><details><summary>Feed entries</summary>
          {data.collection.features.slice(0, 50).map((feature, index) => <button className="map-feed-entry" type="button" key={`${feature.id}-${index}`} onClick={() => onSelect(feature, layer)}>{String(feature.properties?.title || `Entry ${index + 1}`)}{!feature.geometry && ' · no map coordinates'}</button>)}
          {data.collection.features.length > 50 && <p>First 50 entries shown. Download GeoJSON for all ingested entries.</p>}
        </details></>}
        {!layer.builtin && <button type="button" onClick={() => { model.setLayers((previous) => previous.filter((row) => row.id !== layer.id)); clearSelected(); }} data-testid={`feed-remove-${layer.id}`}>Remove feed</button>}
      </div>;
    })}
    <form onSubmit={add} className="map-feed-add">
      <h4>Add an RSS / Atom / GeoRSS feed</h4>
      <label>Layer name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required data-testid="feed-name-input" /></label>
      <label>Public HTTPS feed URL<input value={url} onChange={(event) => setUrl(event.target.value)} type="url" required placeholder="https://…" data-testid="feed-url-input" /></label>
      <button type="submit" data-testid="feed-add-button">Add feed</button>
      {error && <p role="alert">{error}</p>}
    </form>
    <p className="map-feed-warning">These overlays do not change FRNSW/RFD coverage or permit requirements. Fire danger colours: grey = no/unknown rating, green = moderate, yellow = high, orange = extreme, red = catastrophic. Purple outlines indicate a Total Fire Ban today.</p>
  </section>;
}
