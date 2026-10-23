import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type CSSProperties } from 'react';
import { LocateFixed, MapPin, Minus, Plus, X } from 'lucide-react';

export type MapPoint = { latitude: number; longitude: number };

type Props = {
  point: MapPoint | null;
  focusPoint: MapPoint | null;
  onPointChange: (point: MapPoint) => void;
  popup: ReactNode;
};

const TILE_SIZE = 256;
const DEFAULT_CENTER = { latitude: -33.8688, longitude: 151.2093 };
const NSW_BASE_MAP_TILE_URL =
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile';

function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, latitude));
  return {
    x: ((longitude + 180) / 360) * scale,
    y: ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * scale,
  };
}

function unproject(x: number, y: number, zoom: number): MapPoint {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude };
}

export default function MapPanel({ point, focusPoint, onPointChange, popup }: Props) {
  const [center, setCenter] = useState<MapPoint>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(10);
  const [dragging, setDragging] = useState(false);
  const [popupOpen, setPopupOpen] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 800, height: 560 });
  const pointer = useRef<{ x: number; y: number; center: MapPoint; moved: boolean } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const displayedPoint = point;

  const tiles = useMemo(() => {
    const world = project(center.latitude, center.longitude, zoom);
    const left = world.x - dimensions.width / 2;
    const top = world.y - dimensions.height / 2;
    const minX = Math.floor(left / TILE_SIZE);
    const maxX = Math.floor((left + dimensions.width) / TILE_SIZE);
    const minY = Math.floor(top / TILE_SIZE);
    const maxY = Math.floor((top + dimensions.height) / TILE_SIZE);
    const count = 2 ** zoom;
    const result: Array<{ key: string; url: string; x: number; y: number }> = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (y < 0 || y >= count) continue;
        const wrappedX = ((x % count) + count) % count;
        result.push({
          key: `${zoom}-${x}-${y}`,
          url: `${NSW_BASE_MAP_TILE_URL}/${zoom}/${y}/${wrappedX}`,
          x: x * TILE_SIZE - left,
          y: y * TILE_SIZE - top,
        });
      }
    }
    return result;
  }, [center, dimensions, zoom]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointer.current = { x: event.clientX, y: event.clientY, center, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, [center]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
    if (!start.moved) return;
    const world = project(start.center.latitude, start.center.longitude, zoom);
    setCenter(unproject(world.x - dx, world.y - dy, zoom));
  }, [zoom]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    pointer.current = null;
    setDragging(false);
    if (!start || start.moved || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    const world = project(center.latitude, center.longitude, zoom);
    const x = world.x + event.clientX - bounds.left - bounds.width / 2;
    const y = world.y + event.clientY - bounds.top - bounds.height / 2;
    onPointChange(unproject(x, y, zoom));
  }, [center, onPointChange, zoom]);

  const setZoomBounded = (change: number) => setZoom((value) => Math.min(17, Math.max(5, value + change)));
  const goToPoint = () => {
    if (displayedPoint) setCenter(displayedPoint);
    else {
      const coords = navigator.geolocation;
      if (coords) coords.getCurrentPosition(({ coords: current }) => {
        const newPoint = { latitude: current.latitude, longitude: current.longitude };
        setCenter(newPoint);
        onPointChange(newPoint);
      });
    }
  };
  const pin = displayedPoint ? project(displayedPoint.latitude, displayedPoint.longitude, zoom) : null;
  const mapCenter = project(center.latitude, center.longitude, zoom);
  const pinPosition = pin ? {
    left: pin.x - mapCenter.x + dimensions.width / 2,
    top: pin.y - mapCenter.y + dimensions.height / 2,
  } : null;
  const popupWidth = Math.min(300, dimensions.width - 32);
  const popupLeft = pinPosition ? Math.max(popupWidth / 2 + 16, Math.min(dimensions.width - popupWidth / 2 - 16, pinPosition.left)) : 0;
  const popupBelow = Boolean(pinPosition && pinPosition.top < 210);
  const pinVisible = pinPosition && pinPosition.left >= 0 && pinPosition.left <= dimensions.width
    && pinPosition.top >= 0 && pinPosition.top <= dimensions.height;

  useEffect(() => {
    setPopupOpen(true);
  }, [point]);

  useEffect(() => {
    if (!focusPoint) return;
    setCenter(focusPoint);
    setZoom(16);
  }, [focusPoint]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="map-column">
      <div className={`map-frame ${dragging ? 'is-dragging' : ''}`} data-testid="map-container">
        <div
          className={`map-viewport ${dragging ? 'dragging' : ''}`}
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { pointer.current = null; setDragging(false); }}
          role="application"
          aria-label="Interactive map of New South Wales. Click to check a location or drag to pan."
          data-testid="map-interactive"
        >
          <div className="map-tiles">
            {tiles.map((tile) => (
              <img className="map-tile" key={tile.key} src={tile.url} alt="" draggable="false"
                style={{ left: tile.x, top: tile.y }} />
            ))}
          </div>
          <div className="map-wash" />
          {pinPosition && (
            <button type="button" className="map-pin" aria-label="Show coverage result" data-testid="map-location-pin"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => setPopupOpen(true)}
              style={{ left: pinPosition.left, top: pinPosition.top }}>
              <MapPin />
            </button>
          )}
          {!displayedPoint && <div className="map-crosshair" aria-hidden="true" />}
        </div>
        {pinPosition && pinVisible && popupOpen && (
          <div className={`pin-popup ${popupBelow ? 'pin-popup-below' : ''}`} role="region" aria-label="Coverage at selected pin"
            data-testid="map-coverage-popup" style={{
              left: popupLeft,
              top: popupBelow ? pinPosition.top + 14 : pinPosition.top - 52,
              width: popupWidth,
              '--popup-tail-left': `${pinPosition.left - popupLeft + popupWidth / 2}px`,
            } as CSSProperties}>
            <button className="popup-close" type="button" aria-label="Close map result" data-testid="button-close-map-result" onClick={() => setPopupOpen(false)}><X size={14} /></button>
            <div aria-live="polite">{popup}</div>
          </div>
        )}
        <div className="map-topline"><LocateFixed size={13} /> NSW SPATIAL SERVICES</div>
        <div className="map-controls">
          <button type="button" aria-label="Zoom in" onClick={() => setZoomBounded(1)} data-testid="button-zoom-in"><Plus size={16} /></button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoomBounded(-1)} data-testid="button-zoom-out"><Minus size={16} /></button>
          <button type="button" aria-label="Center map on location" onClick={goToPoint} data-testid="button-center-map"><LocateFixed size={15} /></button>
        </div>
        <div className="map-hint">{displayedPoint ? 'Click anywhere to move the location pin' : 'Click the map to choose a location'}</div>
        {displayedPoint && (
          <div className="coord-pill" data-testid="text-map-coordinates">
            {Math.abs(displayedPoint.latitude).toFixed(4)}° {displayedPoint.latitude < 0 ? 'S' : 'N'} · {Math.abs(displayedPoint.longitude).toFixed(4)}° {displayedPoint.longitude < 0 ? 'W' : 'E'}
          </div>
        )}
        <div className="map-attribution"><a href="https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer" target="_blank" rel="noreferrer">© NSW Department of Customer Service 2020</a></div>
      </div>
      <div className="map-caption">
        <span><LocateFixed size={12} /> {displayedPoint ? 'Location selected' : 'Map centered on Sydney'}</span>
        <span>Map data © NSW Department of Customer Service</span>
      </div>
    </div>
  );
}
