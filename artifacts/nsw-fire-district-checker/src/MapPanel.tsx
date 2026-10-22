import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { LocateFixed, MapPin, Minus, Plus } from 'lucide-react';

export type MapPoint = { latitude: number; longitude: number };

type Props = {
  point: MapPoint | null;
  onPointChange: (point: MapPoint) => void;
};

const TILE_SIZE = 256;
const DEFAULT_CENTER = { latitude: -33.8688, longitude: 151.2093 };

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

export default function MapPanel({ point, onPointChange }: Props) {
  const [center, setCenter] = useState<MapPoint>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(10);
  const [dragging, setDragging] = useState(false);
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
          url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
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
            <div className="map-pin" aria-hidden="true" data-testid="map-location-pin"
              style={{ left: pinPosition.left, top: pinPosition.top }}>
              <MapPin />
            </div>
          )}
          {!displayedPoint && <div className="map-crosshair" aria-hidden="true" />}
        </div>
        <div className="map-topline"><LocateFixed size={13} /> NEW SOUTH WALES <span>·</span> OSM</div>
        <div className="map-controls">
          <button type="button" aria-label="Zoom in" onClick={() => setZoomBounded(1)} data-testid="button-zoom-in"><Plus size={16} /></button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoomBounded(-1)} data-testid="button-zoom-out"><Minus size={16} /></button>
          <button type="button" aria-label="Center map on location" onClick={goToPoint} data-testid="button-center-map"><LocateFixed size={15} /></button>
        </div>
        <div className="map-hint">{displayedPoint ? 'Click anywhere to move the location pin' : 'Click the map to choose a location'}</div>
        {displayedPoint && (
          <div className="coord-pill" data-testid="text-map-coordinates">
            {displayedPoint.latitude.toFixed(4)}° {displayedPoint.latitude < 0 ? 'S' : 'N'} · {displayedPoint.longitude.toFixed(4)}° {displayedPoint.longitude < 0 ? 'W' : 'E'}
          </div>
        )}
        <div className="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
      </div>
      <div className="map-caption">
        <span><LocateFixed size={12} /> {displayedPoint ? 'Location selected' : 'Map centered on Sydney'}</span>
        <span>Map data © OpenStreetMap</span>
      </div>
    </div>
  );
}
