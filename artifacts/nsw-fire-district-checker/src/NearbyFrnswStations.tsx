import { useEffect, useState } from 'react';
import { ExternalLink, MapPin, Phone } from 'lucide-react';
import type { MapPoint } from './MapPanel';
import {
  FRNSW_STATION_DATA_URL,
  FRNSW_STATION_FINDER_URL,
  getFrnswStationProfileUrl,
  getNearbyFrnswStations,
  type FrnswStation,
} from './frnsw-stations-service';

export default function NearbyFrnswStations({ point }: { point: MapPoint }) {
  const [stations, setStations] = useState<FrnswStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getNearbyFrnswStations(point)
      .then((results) => {
        if (!active) return;
        setStations(results);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'FRNSW station locations are unavailable.');
        setStations([]);
        setLoading(false);
      });
    return () => { active = false; };
  }, [point.latitude, point.longitude]);

  return (
    <section className="frnsw-stations" aria-label="Nearby FRNSW stations" data-testid="panel-frnsw-stations">
      <div className="rfs-sub">Nearby FRNSW stations</div>
      <p className="rfs-note">Closest by direct distance only; this does not identify the station assigned to respond.</p>
      {loading && <p className="rfs-note" role="status" data-testid="status-frnsw-stations-loading">Loading station locations…</p>}
      {error && <p className="rfs-note frnsw-stations-error" role="alert" data-testid="status-frnsw-stations-error">Station locations are unavailable: {error}</p>}
      {!loading && !error && stations.length === 0 && (
        <p className="rfs-note" data-testid="status-frnsw-stations-empty">No station locations were returned for this point.</p>
      )}
      {stations.map((station) => (
        <article className="frnsw-station" key={station.stationNumber} data-testid={`card-frnsw-station-${station.stationNumber}`}>
          <div className="frnsw-station-heading">
            <strong>{station.name}</strong>
            <span>{station.distanceKm.toFixed(1)} km</span>
          </div>
          <div className="frnsw-station-address">
            <MapPin size={12} />
            <span>{[station.address, station.town, station.postcode].filter(Boolean).join(', ') || 'Address unavailable'}</span>
          </div>
          <a href={getFrnswStationProfileUrl(station.stationNumber)} target="_blank" rel="noreferrer"
            data-testid={`link-frnsw-station-profile-${station.stationNumber}`}>
            <Phone size={12} /> View phone number and station details <ExternalLink size={10} />
          </a>
        </article>
      ))}
      <p className="rfs-note frnsw-stations-email-note">Station-specific email addresses are not published.</p>
      <a className="rfs-link" href={FRNSW_STATION_FINDER_URL} target="_blank" rel="noreferrer" data-testid="link-frnsw-station-finder">
        Open official FRNSW station finder <ExternalLink size={11} />
      </a>
      <a className="frnsw-station-source" href={FRNSW_STATION_DATA_URL} target="_blank" rel="noreferrer" data-testid="link-frnsw-stations-source">
        Station locations source: FRNSW Locations <ExternalLink size={10} />
      </a>
    </section>
  );
}
