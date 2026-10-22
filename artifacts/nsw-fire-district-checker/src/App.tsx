import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AlertCircle, AlertTriangle, Check, ChevronRight, Flame, Info, LoaderCircle, MapPin, Search, ShieldCheck, X } from 'lucide-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import MapPanel, { type MapPoint } from './MapPanel';
import {
  ARCGIS_SOURCE_LINK,
  confirmNsw,
  lookupCoverage,
  searchAddresses,
  reverseAddress,
  type AddressSuggestion,
  type CoverageResult,
  type NswConfirmation,
} from './fire-service';

const queryClient = new QueryClient();
type ChosenLocation = {
  address: string;
  point: MapPoint;
  nsw: NswConfirmation;
};

function Home() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [noMatches, setNoMatches] = useState(false);
  const [selected, setSelected] = useState<ChosenLocation | null>(null);
  const [pin, setPin] = useState<MapPoint | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const lookupSequence = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressSearch = useRef(false);

  useEffect(() => {
    const term = query.trim();
    if (suppressSearch.current) {
      suppressSearch.current = false;
      setSuggestions([]);
      setNoMatches(false);
      setSearching(false);
      return;
    }
    if (term.length < 3) {
      setSuggestions([]);
      setNoMatches(false);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      setNoMatches(false);
      try {
        const results = await searchAddresses(term, controller.signal);
        setSuggestions(results);
        setNoMatches(results.length === 0);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(error instanceof Error ? error.message : 'Address search is unavailable. Please try again.');
        setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected?.address]);

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
    };
    suppressSearch.current = true;
    setSelected(chosen);
    setPin(point);
    setQuery(place.shortName);
    setSuggestions([]);
    setNoMatches(false);
    setSearchError('');
    runLookup(chosen);
  };

  const movePin = useCallback(async (point: MapPoint) => {
    const requestId = ++lookupSequence.current;
    setPin(point);
    setCoverage({ kind: 'error', checkedAt: '', message: 'Confirming the address and checking coverage…' });
    try {
      const reverse = await reverseAddress(point.latitude, point.longitude);
      if (requestId !== lookupSequence.current) return;
      const chosen: ChosenLocation = {
        address: reverse.displayName,
        point,
        nsw: confirmNsw(reverse.displayName, reverse.address),
      };
      suppressSearch.current = true;
      setSelected(chosen);
      const result = await lookupCoverage(point.latitude, point.longitude, chosen.nsw);
      if (requestId === lookupSequence.current) setCoverage(result);
    } catch (error) {
      if (requestId !== lookupSequence.current) return;
      suppressSearch.current = true;
      setSelected({
        address: 'Address could not be resolved at this point',
        point,
        nsw: 'unknown',
      });
      setCoverage({
        kind: 'error',
        checkedAt: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
        message: error instanceof Error ? error.message : 'Reverse address lookup is unavailable.',
      });
    }
  }, []);

  const clearSelection = () => {
    lookupSequence.current += 1;
    setSelected(null);
    setPin(null);
    setCoverage(null);
    setQuery('');
    setSuggestions([]);
    inputRef.current?.focus();
  };
  const isLoadingResult = coverage?.message?.includes('Looking up') || coverage?.message?.includes('Confirming');

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" data-testid="link-home">
          <span className="brand-mark"><Flame size={20} strokeWidth={2.1} /></span>
          <span><span className="brand-name">NSW Fire Coverage</span><span className="brand-kicker">Location checker</span></span>
        </a>
        <div className="topbar-tag"><span className="online-dot" /> NSW RESIDENT TOOL</div>
      </header>
      <main className="page">
        <section className="intro">
          <div>
            <div className="eyebrow">Know who covers your street</div>
            <h1>Fire coverage, <span style={{ color: '#a8442d' }}>at a glance.</span></h1>
            <p className="intro-copy">Find the indicative fire service coverage for an address anywhere in New South Wales.</p>
          </div>
          <div className="coverage-chip"><ShieldCheck size={15} /> FRNSW districts · NSW-wide location search</div>
        </section>

        <section className="workspace" aria-label="Fire coverage location checker">
          <aside className="control-panel">
            <div className="section-label">
              <strong>Find a location</strong><span className="step-number">01 / ADDRESS</span>
            </div>
            <div className="search-wrap">
              <Search className="search-icon" size={16} />
              <input
                ref={inputRef}
                className="search-input"
                type="search"
                autoComplete="off"
                placeholder="Try 1 Martin Place, Sydney"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSearchError(''); }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSuggestions([]);
                  if (event.key === 'Enter' && suggestions[0]) chooseAddress(suggestions[0]);
                }}
                aria-label="Search a NSW address"
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
                      <span><span className="suggestion-title">{suggestion.shortName}</span><span className="suggestion-sub">{suggestion.displayName}</span></span>
                      <ChevronRight size={14} style={{ marginLeft: 'auto', color: '#8c9186' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="helper"><Info size={12} /> Type an address or place name in NSW, then choose a match. You can also click the map to drop a pin.</p>
            {searching && <div className="result-loading" role="status" data-testid="status-searching"><span className="skeleton" /> Finding NSW addresses…</div>}
            {noMatches && !searching && <div className="result-copy" role="status" data-testid="status-no-matches"><strong>No matching addresses</strong><p>Try a street address, suburb or NSW town. You can also select a point directly on the map.</p></div>}
            {searchError && <div className="result-copy result-error" role="alert" data-testid="status-search-error"><strong>Address search unavailable</strong><p>{searchError}</p></div>}

            <hr className="rule" />
            <div className="section-label"><strong>Selected location</strong><span className="step-number">02 / CONFIRM</span></div>
            <div className="selection-card" data-testid="panel-selected-location">
              {selected ? (
                <div className="selected-address">
                  <MapPin size={16} />
                  <div><strong data-testid="text-selected-address">{selected.address}</strong><small>{selected.point.latitude.toFixed(5)}, {selected.point.longitude.toFixed(5)}</small></div>
                </div>
              ) : (
                <div className="selection-empty">
                  <span className="pin-icon"><MapPin size={16} /></span>
                  <span><strong>Nothing pinned yet</strong>Search for an address or click the map to begin.</span>
                </div>
              )}
            </div>

            <div className="result-card" aria-live="polite" data-testid="panel-coverage-result">
              <div className="result-head">
                <span>Coverage result</span>
                {coverage?.checkedAt && <span className="result-status"><span className="online-dot" /> {coverage.checkedAt}</span>}
              </div>
              <div className="result-body">
                {!selected && !coverage && (
                  <div className="result-empty" data-testid="status-awaiting-location">
                    <span className="result-emblem"><ShieldCheck size={18} /></span>
                    <span className="result-copy"><strong>Ready when you are</strong><p>Your indicative coverage result will appear here after you choose a location.</p></span>
                  </div>
                )}
                {selected && isLoadingResult && (
                  <div className="result-loading" role="status" data-testid="status-coverage-loading"><LoaderCircle size={16} /><span className="skeleton" /> Checking location…</div>
                )}
                {coverage && !isLoadingResult && coverage.kind === 'frnsw' && (
                  <div className="result-empty" data-testid="status-coverage-frnsw">
                    <span className="result-emblem"><Check size={18} /></span>
                    <span className="result-copy"><strong>Within an FRNSW fire district</strong><p>{coverage.district ? `Mapped district: ${coverage.district}.` : 'This point intersects a mapped Fire and Rescue NSW district.'} This is an indicative map result, not an operational response guarantee.</p></span>
                  </div>
                )}
                {coverage && !isLoadingResult && coverage.kind === 'rural' && (
                  <div className="result-empty result-unknown" data-testid="status-coverage-rural">
                    <span className="result-emblem"><Info size={18} /></span>
                    <span className="result-copy"><strong>Outside mapped FRNSW districts</strong><p>This NSW point does not intersect a mapped FRNSW Fire District. It may be within a Rural Fire District; this map does not define RFD boundaries.</p></span>
                  </div>
                )}
                {coverage && !isLoadingResult && coverage.kind === 'outside' && (
                  <div className="result-empty result-unknown" data-testid="status-coverage-outside">
                    <span className="result-emblem"><MapPin size={18} /></span>
                    <span className="result-copy"><strong>Outside New South Wales</strong><p>This tool only checks NSW fire district data. Choose a location in NSW to see an indicative result.</p></span>
                  </div>
                )}
                {coverage && !isLoadingResult && coverage.kind === 'error' && (
                  <div className="result-empty result-error" data-testid="status-coverage-error">
                    <span className="result-emblem"><AlertCircle size={18} /></span>
                    <span className="result-copy"><strong>Coverage check unavailable</strong><p>{coverage.message}</p></span>
                  </div>
                )}
              </div>
            </div>
            <div className="disclaimer" data-testid="text-indicative-disclaimer"><AlertTriangle size={14} /><span><strong>Indicative only.</strong> This result uses mapped FRNSW Fire Districts and does not confirm an emergency response area or define Rural Fire District boundaries. In an emergency, call 000.</span></div>
            <div className="panel-links">
              <a href={ARCGIS_SOURCE_LINK} target="_blank" rel="noreferrer" data-testid="link-fire-data-source">FRNSW Fire Districts source</a>
              <a href="https://nominatim.org/" target="_blank" rel="noreferrer" data-testid="link-geocoder-source">Geocoding by Nominatim</a>
            </div>
          </aside>
          <MapPanel point={pin} onPointChange={movePin} />
        </section>
      </main>
      <footer className="footer">
        <span>Public reference tool · Coverage is indicative and may not reflect current operational arrangements.</span>
        <span>Data: <a href={ARCGIS_SOURCE_LINK} target="_blank" rel="noreferrer">NSW Spatial Services</a> · Geocoder: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></span>
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
