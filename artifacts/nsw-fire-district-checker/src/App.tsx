import { useCallback, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AlertTriangle, ChevronRight, Flame, Info, MapPin, Search, X } from 'lucide-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import MapPanel, { type MapPoint } from './MapPanel';
import CoverageContent from './CoverageContent';
import {
  ARCGIS_SOURCE_LINK,
  confirmNsw,
  lookupCoverage,
  type CoverageResult,
  type NswConfirmation,
} from './fire-service';
import { ADDRESS_SOURCE_LINK, searchAddresses, reverseAddress, type AddressSuggestion } from './address-service';

const queryClient = new QueryClient();
const isLocalFile = window.location.protocol === 'file:';
type ChosenLocation = {
  address: string;
  point: MapPoint;
  nsw: NswConfirmation;
  matchNote?: string;
};

function Home() {
  const [query, setQuery] = useState('');
  const [locality, setLocality] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [noMatches, setNoMatches] = useState(false);
  const [selected, setSelected] = useState<ChosenLocation | null>(null);
  const [pin, setPin] = useState<MapPoint | null>(null);
  const [focusPoint, setFocusPoint] = useState<MapPoint | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const lookupSequence = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchController = useRef<AbortController | null>(null);
  const lastSearchTime = useRef(0);
  const performSearch = async () => {
    const term = query.trim();
    if (term.length < 3 || searching || Date.now() - lastSearchTime.current < 1100) return;
    lastSearchTime.current = Date.now();
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
      setSearching(true);
      setSearchError('');
      setNoMatches(false);
      try {
        const results = await searchAddresses(term, locality, controller.signal);
        if (controller.signal.aborted) return;
        setSuggestions(results);
        setNoMatches(results.length === 0);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(error instanceof Error ? error.message : 'Address search is unavailable. Please try again.');
        setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
  };

  const runLookup = useCallback(async (location: ChosenLocation) => {
    const requestId = ++lookupSequence.current;
    setCoverage({ kind: 'error', checkedAt: '', message: 'Looking up mapped fire coverage…' });
    const result = await lookupCoverage(location.point.latitude, location.point.longitude, location.nsw);
    if (requestId === lookupSequence.current) setCoverage(result);
  }, []);

  const chooseAddress = (place: AddressSuggestion) => {
    const point = { latitude: place.latitude, longitude: place.longitude };
    const chosen: ChosenLocation = {
      address: place.displayName,
      point,
      nsw: confirmNsw(place.displayName, place.address),
      matchNote: place.matchNote,
    };
    setSelected(chosen);
    setPin(point);
    setFocusPoint(point);
    setQuery(place.shortName);
    setLocality([place.address.suburb, place.address.postcode].filter(Boolean).join(' '));
    setSuggestions([]);
    setNoMatches(false);
    setSearchError('');
    runLookup(chosen);
  };

  const movePin = useCallback(async (point: MapPoint) => {
    const requestId = ++lookupSequence.current;
    setPin(point);
    setSelected(null);
    setCoverage({ kind: 'error', checkedAt: '', message: 'Confirming the address and checking coverage…' });
    try {
      const reverse = await reverseAddress(point.latitude, point.longitude);
      if (requestId !== lookupSequence.current) return;
      const chosen: ChosenLocation = {
        address: reverse.displayName,
        point,
        nsw: confirmNsw(reverse.displayName, reverse.address),
        matchNote: reverse.matchNote,
      };
      setSelected(chosen);
      const result = await lookupCoverage(point.latitude, point.longitude, chosen.nsw);
      if (requestId === lookupSequence.current) setCoverage(result);
    } catch (error) {
      if (requestId !== lookupSequence.current) return;
      setSelected({
        address: 'Address could not be resolved at this point',
        point,
        nsw: 'unknown',
      });
      const result = await lookupCoverage(point.latitude, point.longitude, 'unknown');
      if (requestId === lookupSequence.current) {
        setCoverage(result.kind === 'error' ? {
          ...result,
          message: `${result.message ?? ''} Address lookup: ${error instanceof Error ? error.message : 'unavailable'}`,
        } : result);
      }
    }
  }, []);

  const clearSelection = () => {
    searchController.current?.abort();
    setSearching(false);
    setSearchError('');
    setNoMatches(false);
    lookupSequence.current += 1;
    setSelected(null);
    setPin(null);
    setCoverage(null);
    setQuery('');
    setLocality('');
    setSuggestions([]);
    inputRef.current?.focus();
  };
  const isLoadingResult = coverage?.message?.includes('Looking up') || coverage?.message?.includes('Confirming');

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={isLocalFile ? '#' : import.meta.env.BASE_URL} data-testid="link-home">
          <span className="brand-mark"><Flame size={20} strokeWidth={2.1} /></span>
          <span><span className="brand-name">NSW Fire Coverage</span><span className="brand-kicker">Location checker</span></span>
        </a>
      </header>
      <main className="page">
        <section className="workspace" aria-label="Fire coverage location checker">
          <section className="search-panel" aria-label="Address search">
            <div className="section-label">
              <strong>Search a NSW address</strong>
            </div>
            <div className="search-row">
            <div className="search-wrap">
              <Search className="search-icon" size={16} />
              <input
                ref={inputRef}
                className="search-input"
                type="search"
                autoComplete="off"
                placeholder="346 Panorama Avenue"
                value={query}
                 onChange={(event) => { searchController.current?.abort(); setSearching(false); setQuery(event.target.value); setSearchError(''); setSuggestions([]); setNoMatches(false); }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSuggestions([]);
                   if (event.key === 'Enter') {
                     event.preventDefault();
                     void performSearch();
                   }
                }}
                aria-label="House number and street"
                aria-expanded={suggestions.length > 0}
                data-testid="input-address-search"
              />
              {query && <button className="clear-search" type="button" aria-label="Clear address" onClick={clearSelection} data-testid="button-clear-address"><X size={15} /></button>}
              {suggestions.length > 0 && (
                <div className="suggestions" role="listbox" aria-label="Address suggestions" data-testid="list-address-suggestions">
                  {suggestions.map((suggestion) => (
                    <button type="button" className="suggestion" key={suggestion.id} role="option"
                      onClick={() => chooseAddress(suggestion)} data-testid={`suggestion-address-${suggestion.id}`}>
                      <MapPin size={14} />
                      <span><span className="suggestion-title">{suggestion.shortName}</span><span className="suggestion-sub">{suggestion.displayName}</span>{suggestion.matchNote && <span className="suggestion-note">{suggestion.matchNote}</span>}</span>
                      <ChevronRight size={14} style={{ marginLeft: 'auto', color: '#8c9186' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input className="search-input locality-input" type="text" value={locality}
              placeholder="Suburb or postcode" aria-label="Suburb or postcode" autoComplete="off"
              data-testid="input-address-locality"
              onChange={(event) => { searchController.current?.abort(); setSearching(false); setLocality(event.target.value); setSearchError(''); setSuggestions([]); setNoMatches(false); }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void performSearch(); } }} />
            <button className="search-button" type="button" onClick={() => void performSearch()} disabled={searching || query.trim().length < 3} data-testid="button-search-address">
              {searching ? 'Searching…' : 'Search address'}
            </button>
            </div>
            <p className="helper"><Info size={12} /> GURAS property addresses: enter the house number, street and suburb/postcode, or tap the map.</p>
            {searching && <div className="result-loading" role="status" data-testid="status-searching"><span className="skeleton" /> Finding NSW addresses…</div>}
            {noMatches && !searching && <div className="result-copy" role="status" data-testid="status-no-matches"><strong>No matching property address</strong><p>No GURAS address was returned for that house number. Check the number, street and suburb/postcode, or drop a pin. Nearby house numbers are not substituted.</p></div>}
            {searchError && <div className="result-copy result-error" role="alert" data-testid="status-search-error"><strong>Address search unavailable</strong><p>{searchError}</p></div>}

          </section>
          <MapPanel point={pin} focusPoint={focusPoint} onPointChange={movePin}
            popup={<CoverageContent coverage={coverage} loading={Boolean(isLoadingResult)} compact />} />
          <section className="control-panel" aria-label="Selected location and coverage result">
            <div className="section-label"><strong>Selected location</strong></div>
            <div className="selection-card" data-testid="panel-selected-location">
              {selected ? (
                <div className="selected-address">
                  <MapPin size={16} />
                  <div><strong data-testid="text-selected-address">{selected.address}</strong><small>{selected.point.latitude.toFixed(5)}, {selected.point.longitude.toFixed(5)}</small>{selected.matchNote && <p className="address-match-note" data-testid="text-address-match-note">{selected.matchNote}</p>}</div>
                </div>
              ) : (
                <div className="selection-empty">
                  <span className="pin-icon"><MapPin size={16} /></span>
                  <span><strong>{pin ? 'Dropped pin' : 'Nothing pinned yet'}</strong>{pin ? 'Finding the nearby GURAS address…' : 'Search for an address or click the map to begin.'}</span>
                </div>
              )}
            </div>

            <div className="result-card" aria-live="polite" data-testid="panel-coverage-result">
              <div className="result-head">
                <span>Coverage result</span>
                {coverage?.checkedAt && <span className="result-status"><span className="online-dot" /> {coverage.checkedAt}</span>}
              </div>
              <div className="result-body">
                <CoverageContent coverage={coverage} loading={Boolean(isLoadingResult)} />
              </div>
            </div>
            <div className="disclaimer" data-testid="text-indicative-disclaimer"><AlertTriangle size={14} /><span><strong>Indicative only.</strong> Boundaries can change and the mapped data may not be current or entirely accurate. GURAS address points locate properties and may not coincide with a dwelling. This does not confirm an emergency response area or define Rural Fire District boundaries. In an emergency, call 000.</span></div>
            <div className="panel-links">
              <a href={ARCGIS_SOURCE_LINK} target="_blank" rel="noreferrer" data-testid="link-fire-data-source">FRNSW Fire Districts source</a>
              <a href={ADDRESS_SOURCE_LINK} target="_blank" rel="noreferrer" data-testid="link-geocoder-source">NSW GURAS addressing source</a>
            </div>
          </section>
        </section>
      </main>
      <footer className="footer">
        <span>Public reference tool · Coverage is indicative and may not reflect current operational arrangements.</span>
        <span>Boundaries: <a href={ARCGIS_SOURCE_LINK} target="_blank" rel="noreferrer">NSW Spatial Services</a> · Addressing: <a href={ADDRESS_SOURCE_LINK} target="_blank" rel="noreferrer">NSW GURAS</a> · Map: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></span>
      </footer>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isLocalFile ? (
          <ErrorBoundary resetKey="local-file"><Home /></ErrorBoundary>
        ) : (
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
