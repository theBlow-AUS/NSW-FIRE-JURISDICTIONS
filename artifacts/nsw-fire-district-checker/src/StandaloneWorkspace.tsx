import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, Check, ChevronDown, CircleDot, Database,
  Eye, EyeOff, FileArchive, FileText, Folder, FolderPlus, Layers3,
  LoaderCircle, Map, MapPinned, Pencil, Plus, RefreshCw, Save, Search, Shield,
  Trash2, Upload, X,
} from 'lucide-react';
import {
  createGisProject, deleteGisLayer, deleteGisProject, geoJsonDownloadUrl,
  getGisLayer, getGisAttributes, getGisFeature, getStandaloneState, importGisFiles, refreshLiveFeeds,
  renameGisProject, saveGisLayer,
  type FeedSourceStatus, type FireDangerRegion, type GeoJsonFeature, type GeoJsonGeometry,
  type GisLayer, type GisLayerSummary, type GisProject, type StandaloneState, type AttributePage,
} from './standalone-api';
import './standalone-workspace.css';
import { Link } from 'wouter';

type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type Point = [number, number];

function geometryPoints(geometry: GeoJsonGeometry | null): Point[] {
  if (!geometry) return [];
  const points: Point[] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push([value[0], value[1]]);
      return;
    }
    value.forEach(visit);
  };
  if (geometry.type === 'GeometryCollection') geometry.geometries?.forEach((item) => {
    for (const point of geometryPoints(item)) points.push(point);
  });
  else visit(geometry.coordinates);
  return points;
}

function featureLabel(feature: GeoJsonFeature, index: number) {
  const props = feature.properties ?? {};
  const name = props.name ?? props.NAME ?? props.label ?? props.title;
  return String(name ?? (feature.id !== undefined ? `Feature ${feature.id}` : `Feature ${index + 1}`));
}

function dateLabel(value: string | null) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function fileKind(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'gdb') return 'File Geodatabase directory';
  if (ext === 'kml' || ext === 'kmz') return 'KML / KMZ';
  if (ext === 'geojson' || ext === 'json') return 'GeoJSON';
  if (ext === 'lyr' || ext === 'lyrx') return 'Layer reference';
  return 'Other file';
}

function FeatureMap({ layer, selectedIndex, onSelect, viewport, onViewport }: {
  layer: GisLayer; selectedIndex: number; onSelect: (index: number) => void;
  viewport?: number[]; onViewport?: (bbox: number[]) => void;
}) {
  const [bounds, setBounds] = useState({ minX: 150.4, minY: -34.2, maxX: 152.2, maxY: -33.4 });
  const preview = useMemo(() => layer.collection.features.slice(0, 10000), [layer.collection.features]);
  const allPoints = useMemo(() => preview.flatMap((feature) => geometryPoints(feature.geometry)), [preview]);
  useEffect(() => {
    if (viewport) {
      setBounds({ minX: viewport[0], minY: viewport[1], maxX: viewport[2], maxY: viewport[3] }); return;
    }
    if (!allPoints.length) return;
    const extent = allPoints.reduce((result, point) => ({
      minX: Math.min(result.minX, point[0]), maxX: Math.max(result.maxX, point[0]),
      minY: Math.min(result.minY, point[1]), maxY: Math.max(result.maxY, point[1]),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    let { minX, maxX, minY, maxY } = extent;
    if (minX === maxX) { minX -= 0.01; maxX += 0.01; }
    if (minY === maxY) { minY -= 0.01; maxY += 0.01; }
    const padX = (maxX - minX) * 0.08, padY = (maxY - minY) * 0.08;
    setBounds({ minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY });
  }, [allPoints, viewport]);
  const project = (point: Point): Point => [
    25 + ((point[0] - bounds.minX) / (bounds.maxX - bounds.minX)) * 750,
    25 + ((bounds.maxY - point[1]) / (bounds.maxY - bounds.minY)) * 430,
  ];
  const drawGeometry = (geometry: GeoJsonGeometry | null, index: number) => {
    if (!geometry) return null;
    const coords = geometry.coordinates as unknown;
    const selected = index === selectedIndex;
    const color = selected ? '#bc593c' : String(layer.collection.features[index]?.properties?._viewColor || layer.style.color || '#39796b');
    const opacity = Number(layer.collection.features[index]?.properties?._viewOpacity ?? layer.style.fillOpacity);
    const pointMark = (p: unknown, key: string) => {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
      const [x, y] = project([p[0], p[1]]);
      return <g key={key} onClick={(event) => { event.stopPropagation(); onSelect(index); }} className="sw-map-feature">
        <circle cx={x} cy={y} r={selected ? 9 : 6} fill={color} stroke="#fffdf7" strokeWidth="2" />
        <circle cx={x} cy={y} r="13" fill="transparent" />
      </g>;
    };
    const line = (arr: unknown, key: string, polygon = false) => {
      if (!Array.isArray(arr)) return null;
      const path = arr.map((p, i) => {
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return '';
        const [x, y] = project([p[0], p[1]]);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      }).filter(Boolean).join(' ');
      if (!path) return null;
      return <path key={key} d={polygon ? `${path} Z` : path} fill={polygon ? color : 'none'} fillOpacity={opacity}
        stroke={color} strokeWidth={selected ? 4 : 2.5} strokeLinejoin="round" strokeLinecap="round"
        onClick={(event) => { event.stopPropagation(); onSelect(index); }} className="sw-map-feature" />;
    };
    const polygonShape = (rings: unknown, key: string) => {
      if (!Array.isArray(rings)) return null;
      const path = rings.map((ring) => Array.isArray(ring) ? ring.map((position, i) => {
        if (!Array.isArray(position)) return '';
        const [x, y] = project(position as Point);
        return `${i ? 'L' : 'M'} ${x} ${y}`;
      }).join(' ') + ' Z' : '').join(' ');
      return <path key={key} d={path} fill={color} fillRule="evenodd" fillOpacity={opacity} stroke={color}
        strokeWidth={selected ? 4 : 2.5} className="sw-map-feature" onClick={(event) => { event.stopPropagation(); onSelect(index); }} />;
    };
    switch (geometry.type) {
      case 'Point': return pointMark(coords, 'point');
      case 'MultiPoint': return Array.isArray(coords) ? coords.map((p, i) => pointMark(p, `point-${i}`)) : null;
      case 'LineString': return line(coords, 'line');
      case 'MultiLineString': return Array.isArray(coords) ? coords.map((p, i) => line(p, `line-${i}`)) : null;
      case 'Polygon': return polygonShape(coords, 'polygon');
      case 'MultiPolygon': return Array.isArray(coords) ? coords.map((polygon, i) => polygonShape(polygon, `multi-${i}`)) : null;
      case 'GeometryCollection': return geometry.geometries?.map((item, i) => <g key={i}>{drawGeometry(item, index)}</g>);
      default: return null;
    }
  };
  return <div className="sw-map" data-testid="map-feature-view">
    {onViewport && viewport && <div className="sw-map-controls">
      {['Zoom in', 'Zoom out', 'West', 'East', 'North', 'South', 'Fit layer'].map((label) => <button type="button" key={label} className="sw-secondary-button" onClick={() => {
        const [a, b, c, d] = viewport, w = c - a, h = d - b;
        const x = (a + c) / 2, y = (b + d) / 2;
        const fit = layer.bounds;
        const next = label === 'Fit layer' && fit ? [fit[0] - 0.01, fit[1] - 0.01, fit[2] + 0.01, fit[3] + 0.01] :
          label === 'West' ? [a - w / 2, b, c - w / 2, d] : label === 'East' ? [a + w / 2, b, c + w / 2, d] :
          label === 'North' ? [a, b + h / 2, c, d + h / 2] : label === 'South' ? [a, b - h / 2, c, d - h / 2] :
          [x - w * (label === 'Zoom in' ? 0.25 : 1), y - h * (label === 'Zoom in' ? 0.25 : 1), x + w * (label === 'Zoom in' ? 0.25 : 1), y + h * (label === 'Zoom in' ? 0.25 : 1)];
        onViewport(next);
      }}>{label}</button>)}
    </div>}
    {allPoints.length ? <svg viewBox="0 0 800 480" role="img" aria-label="Loaded GeoJSON features in WGS84 coordinates">
      <defs><pattern id="sw-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dce4dc" strokeWidth="1" /></pattern></defs>
      <rect width="800" height="480" fill="url(#sw-grid)" />
      {layer.visible && preview.map((feature, index) => <g key={`${index}-${feature.id ?? ''}`}>{drawGeometry(feature.geometry, index)}</g>)}
      <text x="18" y="464" className="sw-map-coord">{bounds.minY.toFixed(4)}° · {bounds.minX.toFixed(4)}°</text>
      <text x="782" y="464" textAnchor="end" className="sw-map-coord">WGS84 · EPSG:4326</text>
    </svg> : <div className="sw-map-empty"><Map size={24} /><span>No drawable geometry in this layer.</span><small>Features with points, lines or polygons will appear here.</small></div>}
    {!layer.visible && <div className="sw-map-hidden" data-testid="status-layer-hidden"><EyeOff size={14} /> Layer hidden</div>}
    <div className="sw-map-legend"><span style={{ background: layer.style.color }} />{layer.name}</div>
    {layer.truncated && <p role="status" className="sw-feed-note">Preview limited to 1,000 features / 2 MiB per layer. Zoom in to see more. Large geometries may be omitted; attribute pages and exports retain all records.</p>}
  </div>;
}

export default function StandaloneWorkspace() {
  const [state, setState] = useState<StandaloneState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [projectId, setProjectId] = useState('');
  const [activeLayerId, setActiveLayerId] = useState('');
  const [layer, setLayer] = useState<GisLayer | null>(null);
  const [draft, setDraft] = useState<GisLayer | null>(null);
  const [selectedFeature, setSelectedFeature] = useState(0);
  const [featureSearch, setFeatureSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [projectDialog, setProjectDialog] = useState<'create' | 'rename' | null>(null);
  const [projectName, setProjectName] = useState('');
  const [showFeeds, setShowFeeds] = useState(true);
  const [importFiles, setImportFiles] = useState<FileList | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [geometryText, setGeometryText] = useState('');
  const [propertiesText, setPropertiesText] = useState('');
  const [editError, setEditError] = useState('');
  const [overlayLayers, setOverlayLayers] = useState<GisLayer[]>([]);
  const [showIncidents, setShowIncidents] = useState(false);
  const [councilField, setCouncilField] = useState('');
  const [viewport, setViewport] = useState<number[] | undefined>();
  const [page, setPage] = useState<AttributePage | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<GeoJsonFeature | null>(null);
  const [edits, setEdits] = useState<Record<number, GeoJsonFeature>>({});
  const loadSequence = useRef(0);
  const selectionSequence = useRef(0);
  const [pageVersion, setPageVersion] = useState(0);

  const refreshState = useCallback(async (keepNotice = true) => {
    setLoading(true); setError('');
    try {
      const next = await getStandaloneState();
      setState(next);
      setProjectId((current) => current && next.projects.some((p) => p.id === current) ? current : next.projects[0]?.id ?? '');
      if (!keepNotice) setNotice(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load local GIS workspace.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refreshState(); }, [refreshState]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void getStandaloneState().then(setState).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const project = state?.projects.find((item) => item.id === projectId) ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!project) { setOverlayLayers([]); return; }
    void Promise.all(project.layers.filter((item) => item.id !== activeLayerId && item.visible)
      .slice(0, 8).map((item) => getGisLayer(project.id, item.id, viewport)))
      .then((items) => { if (!cancelled) setOverlayLayers(items); })
      .catch((err) => { if (!cancelled) setNotice({ kind: 'error', text: `Map overlays could not be loaded: ${err.message}` }); });
    return () => { cancelled = true; };
  // Metadata timestamps change whenever a working layer is saved or removed.
  }, [project?.id, project?.updatedAt, activeLayerId, viewport]);
  useEffect(() => {
    let cancelled = false;
    if (!projectId || !activeLayerId) { setPage(null); return; }
    setPageLoading(true);
    const timer = window.setTimeout(() => {
      void getGisAttributes(projectId, activeLayerId, pageOffset, featureSearch).then((data) => {
        if (!cancelled) setPage(data);
      }).catch((err) => { if (!cancelled) setNotice({ kind: 'error', text: err.message }); })
        .finally(() => { if (!cancelled) setPageLoading(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, activeLayerId, pageOffset, featureSearch, pageVersion]);
  useEffect(() => { setPageOffset(0); }, [featureSearch]);
  useEffect(() => {
    let cancelled = false;
    if (!viewport || !projectId || !activeLayerId) return;
    void getGisLayer(projectId, activeLayerId, viewport).then((data) => {
      if (!cancelled) {
        setLayer((previous) => previous?.id === data.id ? { ...previous, collection: data.collection, ordinals: data.ordinals, truncated: data.truncated } : previous);
        setDraft((previous) => previous?.id === data.id ? { ...previous, collection: data.collection, ordinals: data.ordinals, truncated: data.truncated } : previous);
      }
    }).catch((err) => { if (!cancelled) setNotice({ kind: 'error', text: err.message }); });
    return () => { cancelled = true; };
  }, [viewport, projectId, activeLayerId]);
  const loadLayer = useCallback(async (projectKey: string, layerKey: string) => {
    const sequence = ++loadSequence.current;
    ++selectionSequence.current;
    if (!projectKey || !layerKey) { setLayer(null); setDraft(null); return; }
    setLayer(null); setDraft(null); setSelectedRecord(null); setEdits({}); setPage(null);
    setBusy('layer'); setEditError('');
    try {
      const data = await getGisLayer(projectKey, layerKey);
      const first = data.featureCount ? (await getGisFeature(projectKey, layerKey, 0)).feature : null;
      if (sequence !== loadSequence.current) return;
      setLayer(data); setDraft(data); setActiveLayerId(layerKey); setSelectedFeature(0); setSelectedRecord(first);
      setEdits({}); setPageOffset(0); setFeatureSearch(''); setCouncilField('');
      const b = data.bounds;
      setViewport(b ? [b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01] : [-180, -90, 180, 90]);
      setPropertiesText(JSON.stringify(first ? first.properties : {}, null, 2));
      setGeometryText(JSON.stringify(first?.geometry ?? null, null, 2));
    } catch (err) { if (sequence === loadSequence.current) setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Layer could not be opened.' }); }
    finally { if (sequence === loadSequence.current) setBusy(''); }
  }, []);
  useEffect(() => {
    if (!project) { setActiveLayerId(''); setLayer(null); setDraft(null); return; }
    const chosen = project.layers.some((item) => item.id === activeLayerId) ? activeLayerId : project.layers[0]?.id ?? '';
    setActiveLayerId(chosen);
    if (chosen) void loadLayer(project.id, chosen);
    else { setLayer(null); setDraft(null); }
  // Explicitly load on project switch; loadLayer is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const currentFeature = edits[selectedFeature] ?? selectedRecord;
  const mapLayer = useMemo(() => {
    if (!draft) return null;
    const features: GeoJsonFeature[] = draft.visible ? draft.collection.features.map((feature, i) => edits[draft.ordinals?.[i] ?? i] ?? feature) : [];
    const extra = overlayLayers.flatMap((item) => item.collection.features.map((feature) => ({
      ...feature, properties: { ...feature.properties, _viewColor: item.style.color, _viewOpacity: item.style.fillOpacity, _viewLayer: item.name },
    })));
    const incidents = showIncidents ? (state?.feeds.incidents.features || []).map((feature) => ({
      ...feature, properties: { ...feature.properties, _viewColor: '#c43e2d', _viewLayer: 'RFS live incidents' },
    })) : [];
    return { ...draft, truncated: draft.truncated || overlayLayers.some((item) => item.truncated), visible: true, name: `${draft.name} · visible layers${showIncidents ? ' + RFS incidents' : ''}`,
      collection: { type: 'FeatureCollection' as const, features: [...features, ...extra, ...incidents] } };
  }, [draft, edits, overlayLayers, showIncidents, state?.feeds.incidents]);
  useEffect(() => {
    setPropertiesText(JSON.stringify(currentFeature ? currentFeature.properties : {}, null, 2));
    setGeometryText(JSON.stringify(currentFeature?.geometry ?? null, null, 2));
    setEditError('');
  }, [selectedFeature, selectedRecord, draft?.id]);
  const textDirty = Boolean(currentFeature && (propertiesText !== JSON.stringify(currentFeature.properties, null, 2) || geometryText !== JSON.stringify(currentFeature.geometry, null, 2)));
  const dirty = Boolean(Object.keys(edits).length || textDirty || (layer && draft && (layer.name !== draft.name || layer.visible !== draft.visible || JSON.stringify(layer.style) !== JSON.stringify(draft.style))));
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const visibleFeatures = (page?.items ?? []).map((item) => ({ ...item, index: item.ordinal }));
  const updateDraft = (updater: (previous: GisLayer) => GisLayer) => setDraft((previous) => previous ? updater(previous) : previous);

  const submitProject = async () => {
    const name = projectName.trim();
    if (!name) return;
    setBusy('project'); setNotice(null);
    try {
      if (projectDialog === 'create') {
        const created = await createGisProject(name);
        await refreshState(); setProjectId(created.id); setNotice({ kind: 'success', text: `Project “${created.name}” created.` });
      } else if (project) {
        await renameGisProject(project.id, name); await refreshState();
        setNotice({ kind: 'success', text: `Project renamed to “${name}”.` });
      }
      setProjectDialog(null); setProjectName('');
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Project action failed.' }); }
    finally { setBusy(''); }
  };
  const removeProject = async () => {
    if (!project || !window.confirm(`Remove project “${project.name}” and all its local layers? The local administrator can recover the archived project from gis-trash.`)) return;
    setBusy('delete'); setNotice(null);
    try {
      await deleteGisProject(project.id); setProjectId(''); setActiveLayerId(''); setLayer(null); setDraft(null);
      await refreshState(); setNotice({ kind: 'success', text: `Project “${project.name}” deleted.` });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Project could not be deleted.' }); }
    finally { setBusy(''); }
  };
  const doImport = async () => {
    if (!project || !importFiles?.length) return;
    if (dirty && !window.confirm('Discard unsaved draft edits and import new layers?')) return;
    setBusy('import'); setImportWarnings([]); setNotice(null);
    try {
      const result = await importGisFiles(project.id, importFiles);
      setImportWarnings(result.warnings);
      await refreshState();
      const first = result.layers[0];
      if (first) { setActiveLayerId(first.id); await loadLayer(project.id, first.id); }
      setNotice({ kind: result.warnings.length ? 'info' : 'success', text: `${result.layers.length} layer${result.layers.length === 1 ? '' : 's'} imported${result.warnings.length ? ` · ${result.warnings.length} import note${result.warnings.length === 1 ? '' : 's'}` : ''}.` });
      setImportFiles(null);
      const input = document.querySelector<HTMLInputElement>('[data-testid="input-import-files"]'); if (input) input.value = '';
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed.' }); }
    finally { setBusy(''); }
  };
  const removeLayer = async (item: GisLayerSummary) => {
    if (!project || !window.confirm(`Remove “${item.name}” from this project? The original source file is not changed.`)) return;
    setBusy('delete-layer'); setNotice(null);
    try {
      await deleteGisLayer(project.id, item.id);
      setLayer(null); setDraft(null); setActiveLayerId('');
      await refreshState(); setNotice({ kind: 'success', text: `Layer “${item.name}” removed from the working project.` });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Layer could not be removed.' }); }
    finally { setBusy(''); }
  };
  const saveDraft = async () => {
    if (!project || !draft) return;
    setBusy('save'); setNotice(null);
    try {
      const pending = { ...edits };
      if (currentFeature) {
        const feature = parseFeatureText();
        if (JSON.stringify(feature) !== JSON.stringify(currentFeature)) pending[selectedFeature] = feature;
      }
      const saved = await saveGisLayer(project.id, draft.id, draft, Object.entries(pending).map(([ordinal, feature]) => ({ ordinal: Number(ordinal), feature })));
      const next = { ...draft, ...saved };
      setLayer(next); setDraft(next); setSelectedRecord(pending[selectedFeature] ?? currentFeature); setEdits({});
      setPageVersion((n) => n + 1); await refreshState();
      const preview = await getGisLayer(project.id, draft.id, viewport);
      setLayer(preview); setDraft(preview);
      setNotice({ kind: 'success', text: `Working copy saved · ${saved.featureCount} features in “${saved.name}”.` });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Working copy was not saved.' }); }
    finally { setBusy(''); }
  };
  const parseFeatureText = (): GeoJsonFeature => {
      if (!currentFeature) throw new Error('Select a feature first.');
      const properties = JSON.parse(propertiesText);
      const geometry = JSON.parse(geometryText);
      if (Array.isArray(properties) || (properties !== null && typeof properties !== 'object')) throw new Error('Properties must be a JSON object or null.');
      if (geometry !== null && (typeof geometry !== 'object' || typeof geometry.type !== 'string')) throw new Error('Geometry must be a GeoJSON geometry object or null.');
      return { ...currentFeature, properties, geometry };
  };
  const commitFeatureText = () => {
    if (!currentFeature) return true;
    try {
      const feature = parseFeatureText();
      if (JSON.stringify(feature) !== JSON.stringify(currentFeature)) setEdits((previous) => ({ ...previous, [selectedFeature]: feature }));
      setEditError('');
      return true;
    } catch (err) { setEditError(err instanceof Error ? err.message : 'Feature JSON is invalid.'); return false; }
  };
  const toggleLayer = async (item: GisLayerSummary) => {
    if (!project || busy) return;
    setBusy('visibility');
    try {
      const full = await getGisLayer(project.id, item.id);
      const next = { ...full, visible: !item.visible };
      const saved = await saveGisLayer(project.id, item.id, next);
      if (item.id === activeLayerId) {
        setLayer({ ...next, ...saved });
        setDraft((previous) => previous ? { ...previous, visible: next.visible, revision: saved.revision } : previous);
      }
      await refreshState();
      setNotice({ kind: 'success', text: `Layer ${next.visible ? 'shown' : 'hidden'} in the project.` });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Visibility could not be saved.' }); }
    finally { setBusy(''); }
  };
  const refreshFeeds = async () => {
    setBusy('feeds'); setNotice(null);
    try {
      await refreshLiveFeeds(); await refreshState();
      setNotice({ kind: 'success', text: 'Live-feed refresh requested. Displayed records reflect the latest local service state.' });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Feed refresh could not be requested.' }); }
    finally { setBusy(''); }
  };
  const chooseFeature = async (index: number) => {
    if (!project || !draft || busy || !commitFeatureText()) return;
    const sequence = ++selectionSequence.current;
    try {
      const record = await getGisFeature(project.id, draft.id, index);
      if (sequence !== selectionSequence.current) return;
      if (record.revision !== draft.revision) throw new Error('This layer changed. Save or discard your draft, then reopen it.');
      setSelectedRecord(record.feature); setSelectedFeature(index);
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Feature could not be loaded.' }); }
  };

  if (loading && !state) return <main className="sw-shell" data-testid="standalone-workspace"><div className="sw-loading"><span className="sw-skeleton sw-skeleton-title" /><span className="sw-skeleton" /><span className="sw-skeleton sw-skeleton-wide" /><span className="sw-skeleton sw-skeleton-wide" /></div></main>;
  if (error && !state) return <main className="sw-shell" data-testid="standalone-workspace"><div className="sw-fatal"><AlertTriangle size={25} /><h1>Local workspace unavailable</h1><p>{error}</p><button type="button" onClick={() => void refreshState()} data-testid="button-retry-load"><RefreshCw size={15} /> Retry</button></div></main>;
  const feeds = state?.feeds;

  return <main className="sw-shell" data-testid="standalone-workspace">
    <Link href="/" className="sw-secondary-button" data-testid="link-back-to-checker" onClick={(event) => {
      if (dirty && !window.confirm('Discard unsaved working-copy edits and return to the checker?')) event.preventDefault();
    }}>Back to fire coverage checker</Link>
    <header className="sw-topbar">
      <div className="sw-brand"><span className="sw-brand-mark"><Shield size={19} /></span><div><strong>Fire District Checker</strong><small>STANDALONE GIS WORKSPACE</small></div></div>
      <div className="sw-top-meta"><span className="sw-local-indicator"><span /> LOCAL DATA STORE</span><span className="sw-divider" /><span>NSW EMERGENCY SERVICES</span></div>
    </header>
    <div className="sw-page">
      <div className="sw-heading">
        <div><div className="sw-eyebrow"><MapPinned size={13} /> OPERATIONAL GIS / NSW</div><h1>Workspace</h1><p>Manage local working layers alongside official Rural Fire Service updates.</p></div>
        <div className="sw-local-note"><Database size={16} /><span><strong>Local working copies</strong><small>Edits are saved locally, never to your source files.</small></span></div>
      </div>
      {notice && <div className={`sw-notice sw-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="status-workspace-notice">
        {notice.kind === 'success' ? <Check size={16} /> : notice.kind === 'error' ? <AlertTriangle size={16} /> : <Activity size={16} />}
        <span>{notice.text}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)} data-testid="button-dismiss-notice"><X size={14} /></button>
      </div>}
      {error && <div className="sw-inline-error" role="alert" data-testid="status-refresh-error"><AlertTriangle size={15} />{error}<button onClick={() => void refreshState()} type="button" data-testid="button-retry-refresh">Retry</button></div>}
      <div className="sw-columns">
        <aside className="sw-sidebar">
          <section className="sw-panel sw-project-panel">
            <div className="sw-panel-head"><div><span className="sw-overline">PROJECTS</span><h2>Local GIS projects</h2></div><button className="sw-icon-button" type="button" aria-label="Create project" onClick={() => { setProjectDialog('create'); setProjectName(''); }} data-testid="button-create-project"><Plus size={17} /></button></div>
            {projectDialog === 'create' && <div className="sw-inline-form"><label htmlFor="sw-project-name">New project name</label><input id="sw-project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} autoFocus data-testid="input-project-name" onKeyDown={(e) => { if (e.key === 'Enter') void submitProject(); }} /><div><button type="button" onClick={() => setProjectDialog(null)} data-testid="button-cancel-project">Cancel</button><button type="button" className="sw-primary-button" disabled={!projectName.trim() || busy === 'project'} onClick={() => void submitProject()} data-testid="button-save-project">{busy === 'project' ? 'Working…' : 'Create project'}</button></div></div>}
            {state?.projects.length ? <div className="sw-project-list">{state.projects.map((item) => <button type="button" key={item.id} className={`sw-project-row ${projectId === item.id ? 'is-active' : ''}`} disabled={!!busy} onClick={() => { if (item.id !== projectId && dirty && !window.confirm('Discard unsaved draft edits and open another project?')) return; setProjectId(item.id); }} data-testid={`button-project-${item.id}`}>
              <Folder size={16} /><span><strong>{item.name}</strong><small>{item.layers.length} layer{item.layers.length === 1 ? '' : 's'} · updated {dateLabel(item.updatedAt)}</small></span><ChevronDown size={15} className="sw-row-chevron" />
            </button>)}</div> : <div className="sw-empty sw-empty-project"><FolderPlus size={22} /><strong>No local projects yet</strong><span>Create a project to start importing GIS data.</span></div>}
            {project && <div className="sw-project-tools">
              <button type="button" onClick={() => { setProjectDialog('rename'); setProjectName(project.name); }} data-testid="button-rename-project"><Pencil size={14} /> Rename</button>
              <button type="button" className="sw-danger-link" onClick={() => void removeProject()} disabled={busy === 'delete'} data-testid="button-delete-project"><Trash2 size={14} /> Remove</button>
            </div>}
            {projectDialog === 'rename' && <div className="sw-inline-form"><label htmlFor="sw-project-name">Rename project</label><input id="sw-project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} autoFocus data-testid="input-project-name" onKeyDown={(e) => { if (e.key === 'Enter') void submitProject(); }} /><div><button type="button" onClick={() => setProjectDialog(null)} data-testid="button-cancel-project">Cancel</button><button type="button" className="sw-primary-button" disabled={!projectName.trim() || busy === 'project'} onClick={() => void submitProject()} data-testid="button-save-project">Save name</button></div></div>}
          </section>
          <section className="sw-panel sw-layer-panel">
            <div className="sw-panel-head"><div><span className="sw-overline">PROJECT CONTENTS</span><h2>Layers <span className="sw-count">{project?.layers.length ?? 0}</span></h2></div><Layers3 size={18} className="sw-head-icon" /></div>
            {!project ? <div className="sw-empty sw-empty-small"><span>Select or create a project to manage layers.</span></div> : project.layers.length ? <div className="sw-layer-list">{project.layers.map((item) => <div key={item.id} className={`sw-layer-row ${activeLayerId === item.id ? 'is-active' : ''}`} data-testid={`row-layer-${item.id}`}>
              <button type="button" className="sw-layer-select" disabled={!!busy} onClick={() => { if (dirty && !window.confirm('Discard unsaved draft edits and reload this layer?')) return; setActiveLayerId(item.id); void loadLayer(project.id, item.id); }} data-testid={`button-select-layer-${item.id}`}>
              <span className="sw-layer-symbol" style={{ '--layer-color': item.style.color } as CSSProperties}><Layers3 size={15} /></span>
                <span className="sw-layer-copy"><strong>{item.name}</strong><small>{item.geometryType} · {item.featureCount.toLocaleString()} features</small>{item.warning && <small className="sw-layer-warning"><AlertTriangle size={11} />{item.warning}</small>}</span>
              </button>
              <button type="button" className={`sw-visibility ${item.visible ? 'is-visible' : ''}`} aria-label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`} onClick={() => void toggleLayer(item)} data-testid={`button-toggle-layer-${item.id}`}>{item.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
              <button type="button" className="sw-visibility sw-remove-layer" aria-label={`Remove ${item.name}`} onClick={() => void removeLayer(item)} data-testid={`button-delete-layer-${item.id}`}><Trash2 size={14} /></button>
            </div>)}</div> : <div className="sw-empty sw-empty-small"><Layers3 size={21} /><strong>No layers in this project</strong><span>Import a supported file or directory below.</span></div>}
            <div className={`sw-import-box ${!project ? 'is-disabled' : ''}`}>
              <div className="sw-import-title"><Upload size={15} /><strong>Import local data</strong></div>
              <p>GeoJSON, KML / KMZ, FileGDB directories and best-effort .lyr references.</p>
              <label className="sw-file-picker" htmlFor="sw-import-files"><FileArchive size={15} /><span>{importFiles?.length ? `${importFiles.length} files selected` : 'Choose GIS files'}</span><input id="sw-import-files" type="file" multiple accept=".geojson,.json,.kml,.kmz,.lyr,.zip" disabled={!project || busy === 'import'} onChange={(e) => setImportFiles(e.target.files)} data-testid="input-import-files" /></label>
              <label className="sw-file-picker" htmlFor="sw-import-directory"><Folder size={15} /><span>Choose a .gdb directory</span><input id="sw-import-directory" type="file" multiple disabled={!project || busy === 'import'} {...({ webkitdirectory: '', directory: '' } as object)} onChange={(e) => setImportFiles(e.target.files)} data-testid="input-import-directory" /></label>
              {importFiles?.length ? <div className="sw-selected-files" data-testid="list-import-files">{Array.from(importFiles).slice(0, 4).map((file, i) => <span key={`${file.name}-${i}`}><FileText size={12} />{file.webkitRelativePath || file.name}<small>{fileKind(file.name)}</small></span>)}{importFiles.length > 4 && <small>and {importFiles.length - 4} more files</small>}</div> : null}
              <button type="button" className="sw-primary-button sw-import-button" disabled={!project || !importFiles?.length || busy === 'import'} onClick={() => void doImport()} data-testid="button-import-files">{busy === 'import' ? <><LoaderCircle size={14} className="sw-spin" /> Importing…</> : <><Upload size={14} /> Import selected</>}</button>
              <small className="sw-import-footnote">Sources stay unchanged. Upload a .gdb folder or .gdb.zip. ArcMap .lyr files are retained as references; upload their linked feature data separately. Exact Esri styles are not reproduced.</small>
              {importWarnings.length > 0 && <ul className="sw-import-warnings" data-testid="list-import-warnings">{importWarnings.map((warning, i) => <li key={i}><AlertTriangle size={12} />{warning}</li>)}</ul>}
            </div>
          </section>
        </aside>

        <section className="sw-main">
          <section className="sw-panel sw-data-panel">
            <div className="sw-data-header">
              <div className="sw-data-title"><span className="sw-overline">LAYER INSPECTOR</span><h2>{draft?.name ?? (project ? 'Choose a layer' : 'Select a project')}</h2><p>{draft ? <>{draft.sourceName} <span>·</span> {draft.sourceFormat} <span>·</span> {draft.crs ?? 'CRS not reported'}</> : 'Import local GIS files to inspect features and their geometries.'}</p></div>
              {draft && <div className="sw-data-actions">
                <a className="sw-secondary-button" href={geoJsonDownloadUrl(project!.id, draft.id)} onClick={(event) => {
                  if (dirty) { event.preventDefault(); setNotice({ kind: 'info', text: 'Save the working copy before exporting. Unsaved drafts are not included in server exports.' }); }
                }} download={`${draft.name.replace(/[^a-z0-9-_]+/gi, '-')}.geojson`} data-testid="link-export-geojson"><ArrowDownToLine size={15} /> Export GeoJSON</a>
                <a className="sw-secondary-button" href={`${geoJsonDownloadUrl(project!.id, draft.id)}?manifest=1`} download data-testid="link-export-manifest">Provenance</a>
                <button type="button" className="sw-primary-button" disabled={!dirty || busy === 'save'} onClick={() => void saveDraft()} data-testid="button-save-layer">{busy === 'save' ? <><LoaderCircle size={14} className="sw-spin" /> Saving…</> : <><Save size={14} /> Save working copy</>}</button>
              </div>}
            </div>
            {draft && <div className="sw-layer-meta"><span><CircleDot size={13} /> {draft.featureCount.toLocaleString()} features</span><span><Database size={13} /> {draft.fields.length} fields</span><span><Activity size={13} /> imported {dateLabel(draft.importedAt)}</span>{dirty && <span className="sw-dirty"><span /> Unsaved draft edits</span>}</div>}
            {!draft ? <div className="sw-inspector-empty"><div><Map size={28} /><strong>{project ? 'Select a layer to begin' : 'Your workspace is ready'}</strong><span>{project ? 'Choose a layer in the project panel, or import new data.' : 'Create a project on the left, then bring in local GIS data.'}</span></div></div> :
              <div className="sw-inspector-content">
                <label className="sw-layer-meta"><input type="checkbox" checked={showIncidents} onChange={(event) => setShowIncidents(event.target.checked)} data-testid="input-show-live-incidents" /> Show cached/live RFS incidents on this map</label>
                {project && project.layers.filter((item) => item.visible && item.id !== activeLayerId).length > 8 && <p role="status">Showing the first eight other visible layers. Select a layer to inspect it directly.</p>}
                {mapLayer && <FeatureMap layer={mapLayer} viewport={viewport} onViewport={setViewport} selectedIndex={draft.visible ? (draft.ordinals?.indexOf(selectedFeature) ?? selectedFeature) : -1} onSelect={(index) => {
                  if (draft.visible && index < draft.collection.features.length) void chooseFeature(draft.ordinals?.[index] ?? index);
                  else {
                    const feature = mapLayer.collection.features[index];
                    setNotice({ kind: 'info', text: `${feature.properties?._viewLayer || 'Overlay'}: ${featureLabel(feature, index)}. Select its source layer to edit; live feed features are read-only.` });
                  }
                }} />}
                <div className="sw-layer-meta"><label>Optional confirmed council-name field for danger/ban enrichment: <select value={councilField} onChange={(event) => setCouncilField(event.target.value)} data-testid="select-council-join-field"><option value="">No regional join</option>{draft.fields.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
                  {councilField && <><a href={`${geoJsonDownloadUrl(project!.id, draft.id)}?councilField=${encodeURIComponent(councilField)}`} onClick={(event) => { if (dirty) { event.preventDefault(); setNotice({ kind: 'info', text: 'Save your draft before exporting.' }); } }} download data-testid="link-export-enriched-geojson">Export exact council matches</a><a href={`${geoJsonDownloadUrl(project!.id, draft.id)}?manifest=1&councilField=${encodeURIComponent(councilField)}`} download data-testid="link-export-enriched-provenance">Join provenance</a></>}</div>
                <div className="sw-feature-workbench">
                  <section className="sw-feature-list">
                    <div className="sw-subhead"><div><span className="sw-overline">FEATURES</span><strong>{draft.featureCount.toLocaleString()} records</strong></div><div className="sw-feature-search"><Search size={14} /><input value={featureSearch} onChange={(e) => setFeatureSearch(e.target.value)} placeholder="Find a feature" aria-label="Find a feature" data-testid="input-feature-search" /></div></div>
                    {pageLoading ? <div role="status">Loading attribute page…</div> : visibleFeatures.length ? <div className="sw-feature-rows" data-testid="list-features">{visibleFeatures.map(({ feature, index, geometryType }) => <button type="button" key={index} aria-pressed={selectedFeature === index} onClick={() => void chooseFeature(index)} className={`sw-feature-row ${selectedFeature === index ? 'is-active' : ''}`} data-testid={`button-feature-${index}`}><span className="sw-feature-index">{String(index + 1).padStart(3, '0')}</span><span><strong>{featureLabel(edits[index] ?? feature, index)}</strong><small>{geometryType}{feature.id ? ` · ID ${feature.id}` : ''}</small></span><ChevronDown size={13} /></button>)}</div> : <div className="sw-feature-empty">No matching features.</div>}
                    <div className="sw-pagination"><button type="button" disabled={pageLoading || pageOffset === 0} onClick={() => setPageOffset(Math.max(0, pageOffset - 100))}>Previous</button>
                      <span>{page ? `${page.total ? page.offset + 1 : 0}–${page.offset + page.items.length} of ${page.total.toLocaleString()} matches` : ''}</span>
                      <button type="button" disabled={pageLoading || page?.nextOffset == null} onClick={() => setPageOffset(page?.nextOffset ?? 0)}>Next</button></div>
                  </section>
                  <section className="sw-editor">
                    <div className="sw-subhead sw-editor-head"><div><span className="sw-overline">FEATURE EDITOR</span><strong>{currentFeature ? featureLabel(currentFeature, selectedFeature) : 'Select a feature'}</strong></div>{currentFeature && <span className="sw-draft-tag"><Pencil size={11} /> DRAFT</span>}</div>
                    {currentFeature ? <>
                      <label className="sw-json-label" htmlFor="sw-properties-json">Properties <span>JSON object</span></label>
                      <textarea id="sw-properties-json" className="sw-json-editor" value={propertiesText} disabled={!!busy} onChange={(e) => setPropertiesText(e.target.value)} onBlur={commitFeatureText} spellCheck={false} data-testid="input-feature-properties" />
                      <label className="sw-json-label" htmlFor="sw-geometry-json">Geometry <span>GeoJSON · WGS84 coordinates</span></label>
                      <textarea id="sw-geometry-json" className="sw-json-editor sw-geometry-editor" value={geometryText} disabled={!!busy} onChange={(e) => setGeometryText(e.target.value)} onBlur={commitFeatureText} spellCheck={false} data-testid="input-feature-geometry" />
                      {editError && <div className="sw-edit-error" role="alert" data-testid="status-feature-edit-error"><AlertTriangle size={13} />{editError}</div>}
                      <div className="sw-editor-foot"><span>Change JSON, then save to apply it to this local working copy.</span><button type="button" onClick={commitFeatureText} data-testid="button-apply-feature-edit"><Check size={13} /> Apply draft</button></div>
                    </> : <div className="sw-editor-placeholder">Choose a feature to inspect or edit its attributes and WGS84 geometry.</div>}
                  </section>
                </div>
                <div className="sw-working-copy-banner"><Shield size={15} /><span><strong>Working copy only.</strong> Your edits remain a draft until saved, and never modify the imported source file.</span>{dirty && <button type="button" onClick={() => { if (layer) { setDraft(layer); setEdits({}); setPropertiesText(JSON.stringify(selectedRecord?.properties ?? null, null, 2)); setGeometryText(JSON.stringify(selectedRecord?.geometry ?? null, null, 2)); setEditError(''); } }} data-testid="button-discard-edits"><X size={13} /> Discard draft</button>}</div>
              </div>}
          </section>

          <section className="sw-panel sw-feed-panel">
            <div className="sw-feed-header"><div className="sw-panel-head"><div><span className="sw-overline"><Activity size={12} /> OFFICIAL LIVE DATA</span><h2>NSW Rural Fire Service feeds</h2></div><button type="button" className="sw-secondary-button" disabled={busy === 'feeds'} onClick={() => void refreshFeeds()} data-testid="button-refresh-feeds">{busy === 'feeds' ? <LoaderCircle size={14} className="sw-spin" /> : <RefreshCw size={14} />} Refresh feeds</button></div>
              <button type="button" className="sw-feed-collapse" onClick={() => setShowFeeds((value) => !value)} aria-expanded={showFeeds} data-testid="button-toggle-feed-details">{showFeeds ? 'Hide feed details' : 'View feed details'} <ChevronDown size={14} className={showFeeds ? 'is-open' : ''} /></button>
            </div>
            {!feeds ? <div className="sw-feed-empty" data-testid="status-feeds-empty">Live-feed state is not available from the local service.</div> : <>
              <div className="sw-feed-summary">
                <div><span className="sw-feed-number">{feeds.incidents.features.length.toLocaleString()}</span><span>Current incidents</span></div>
                <div><span className="sw-feed-number">{feeds.majorFireUpdates.features.length.toLocaleString()}</span><span>Major fire updates</span></div>
                <div><span className="sw-feed-number">{feeds.dangerRegions.length.toLocaleString()}</span><span>Fire danger regions</span></div>
                <div className={`sw-feed-health ${feeds.sources.some((source) => source.error) ? 'is-error' : feeds.sources.some((source) => source.stale) ? 'is-stale' : 'is-current'}`}><span className="sw-health-dot" /><span>{feeds.sources.some((source) => source.error) ? 'Source error' : feeds.sources.some((source) => source.stale) ? 'Feed data may be stale' : 'Sources responding'}</span></div>
              </div>
              {showFeeds && <div className="sw-feed-details">
                <div className="sw-data-actions">
                  <a className="sw-secondary-button" href="/api/feeds/export?kind=incidents" download data-testid="link-export-incidents">Incident GeoJSON</a>
                  <a className="sw-secondary-button" href="/api/feeds/export?kind=advisories" download data-testid="link-export-major-updates">Advisories JSON</a>
                  <a className="sw-secondary-button" href="/api/feeds/export?kind=advisories&format=csv" download data-testid="link-export-major-updates-csv">Advisories CSV</a>
                  <a className="sw-secondary-button" href="/api/feeds/export?kind=danger" download data-testid="link-export-danger">Regional ratings JSON</a>
                  <a className="sw-secondary-button" href="/api/feeds/export?kind=danger&format=csv" download data-testid="link-export-danger-csv">Regional ratings CSV</a>
                  <a className="sw-secondary-button" href="/api/feeds/export?kind=manifest" download data-testid="link-export-feed-manifest">Feed provenance</a>
                </div>
                {feeds.incidents.features.length > 0 && !draft && <FeatureMap layer={{ id: 'live', name: 'RFS current incidents · read-only', sourceName: '', sourceFormat: 'GeoJSON', crs: 'EPSG:4326', geometryType: 'Mixed', featureCount: feeds.incidents.features.length, fields: [], visible: true, style: { color: '#c43e2d', fillOpacity: 0.25 }, sourceUpdatedAt: null, importedAt: '', warning: null, collection: feeds.incidents }} selectedIndex={-1} onSelect={(index) => setNotice({ kind: 'info', text: String(feeds.incidents.features[index].properties?.description || featureLabel(feeds.incidents.features[index], index)) })} />}
                <div className="sw-source-list"><h3>Major fire advisories</h3>{feeds.majorFireUpdates.features.map((feature, index) => <article className="sw-source-card" key={String(feature.id || index)} data-testid={`card-major-update-${index}`}><strong>{String(feature.properties?.title || 'RFS update')}</strong><p>{String(feature.properties?.description || '')}</p></article>)}</div>
                <div className="sw-source-list"><h3>Source status</h3>{feeds.sources.length ? feeds.sources.map((source) => <FeedSource key={source.id} source={source} />) : <p className="sw-feed-empty">No source status returned by the service.</p>}</div>
                <div className="sw-region-list"><h3>Fire danger regions</h3>{feeds.dangerRegions.length ? <div className="sw-region-table-wrap"><table className="sw-region-table"><thead><tr><th>Region</th><th>Today</th><th>Tomorrow</th><th>Fire ban today</th></tr></thead><tbody>{feeds.dangerRegions.map((region) => <RegionRow key={region.id} region={region} />)}</tbody></table></div> : <p className="sw-feed-empty">No fire danger region records returned.</p>}</div>
                <p className="sw-feed-note"><Shield size={13} /> Fire danger ratings and Total Fire Bans are regional advisories, not a permit determination. FRNSW boundaries remain authoritative and FRNSW permits are required year-round. Verify current operational information at the linked agency source.</p>
              </div>}
            </>}
          </section>
          <footer className="sw-footer"><span>NSW Fire District Checker · Local GIS workspace</span><span>Imported layers are local working copies · Live-feed availability varies</span></footer>
        </section>
      </div>
    </div>
    {busy === 'layer' && <div className="sw-busy-strip" role="status" data-testid="status-layer-loading"><LoaderCircle size={14} className="sw-spin" /> Loading layer data…</div>}
  </main>;
}

function FeedSource({ source }: { source: FeedSourceStatus }) {
  const status = source.error ? 'error' : source.stale ? 'stale' : source.lastSuccessAt ? 'current' : 'pending';
  return <article className={`sw-source-card status-${status}`} data-testid={`card-feed-source-${source.id}`}>
    <div className="sw-source-head"><span className="sw-source-dot" /><strong>{source.name}</strong><span className="sw-source-state">{source.error ? 'ERROR' : source.stale ? 'STALE' : source.lastSuccessAt ? 'CURRENT' : 'PENDING'}</span></div>
    {source.error && <p className="sw-source-error" data-testid={`text-feed-error-${source.id}`}>{source.error}</p>}
    <dl><div><dt>Last success</dt><dd>{dateLabel(source.lastSuccessAt)}</dd></div><div><dt>Source updated</dt><dd>{dateLabel(source.sourceUpdatedAt)}</dd></div><div><dt>Features</dt><dd>{source.featureCount.toLocaleString()}</dd></div><div><dt>Next fetch</dt><dd>{dateLabel(source.nextFetchAt)}</dd></div></dl>
    <a href={source.url} target="_blank" rel="noreferrer" data-testid={`link-feed-source-${source.id}`}>Official source <ArrowDownToLine size={11} /></a>
  </article>;
}

function RegionRow({ region }: { region: FireDangerRegion }) {
  return <tr data-testid={`row-danger-region-${region.id}`}><td><strong>{region.name}</strong>{region.regionNumber && <small>Region {region.regionNumber}</small>}{region.councils.length > 0 && <small>{region.councils.join(', ')}</small>}</td><td>{region.dangerToday ?? '—'}</td><td>{region.dangerTomorrow ?? '—'}</td><td>{region.fireBanToday ?? '—'}</td></tr>;
}
