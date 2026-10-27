import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each import runs in a short-lived process: engine memory is reclaimed afterwards.
// No user-supplied command line or executable is run.
const [source, output, strict] = process.argv.slice(2);
const engine = process.env.NSW_GDAL_DIRECTORY || join(dirname(fileURLToPath(import.meta.url)), 'vendor/gdal');
const require = createRequire(import.meta.url);

async function convert() {
  await mkdir(output, { recursive: true });
  const init = require(join(engine, 'gdal3.node.js'));
  const messages = [];
  const Gdal = await init({
    path: relative(process.cwd(), engine).replaceAll('\\', '/'), dest: output, useWorker: false,
    env: { PROJ_NETWORK: 'OFF', GDAL_HTTP_TIMEOUT: '1', CPL_VSIL_CURL_ALLOWED_EXTENSIONS: '__disabled__' },
    logHandler: () => {}, errorHandler: (message) => messages.push(message),
  });
  const open = await Gdal.open(source.replaceAll('\\', '/'), [], /\.(?:kmz|zip)$/i.test(source) ? ['vsizip'] : []);
  if (!open.datasets.length) throw new Error(`GDAL could not open this dataset. ${JSON.stringify(open.errors).slice(0, 800)}`);
  const layers = [];
  for (const dataset of open.datasets) {
    const info = await Gdal.getInfo(dataset);
    if (info.type !== 'vector') { messages.push('Raster datasets are not imported into this vector workspace.'); continue; }
    let details = {};
    try { details = await Gdal.ogrinfo(dataset, ['-al', '-so', '-json']); } catch {}
    for (const layer of info.layers) {
      const name = `layer-${layers.length}`;
      if (strict === '--validate') {
        const validity = await Gdal.ogr2ogr(dataset, ['-f', 'GeoJSON', '-dialect', 'SQLITE',
          '-sql', `SELECT COUNT(*) AS invalid_count FROM "${layer.name.replaceAll('"', '""')}" WHERE ST_IsValid(geometry)=0`], `validity-${layers.length}`);
        const result = JSON.parse(await readFile(validity.real, 'utf8'));
        const invalid = result.features[0]?.properties?.invalid_count;
        if (!Number.isInteger(invalid)) throw new Error('The engine could not confirm geometry validity.');
        if (invalid > 0) throw new Error(`${invalid} invalid geometries were found. Correct the working copy before exporting; sources were not modified.`);
      }
      const options = ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-lco', 'RFC7946=YES', '-preserve_fid',
        '-sql', `SELECT * FROM "${layer.name.replaceAll('"', '""')}"`];
      const converted = await Gdal.ogr2ogr(dataset, options, name);
      // ogr2ogr writes through a local NODEFS mount, not a network service.
      const geojson = JSON.parse(await readFile(converted.real, 'utf8'));
      if (geojson.type !== 'FeatureCollection') throw new Error('The conversion did not produce a FeatureCollection.');
      delete geojson.crs;
      await writeFile(converted.real, JSON.stringify(geojson));
      const detail = details.layers?.find((entry) => entry.name === layer.name);
      const wkt = detail?.geometryFields?.[0]?.coordinateSystem?.wkt || detail?.srs?.wkt || null;
      const epsg = wkt?.match(/(?:ID|AUTHORITY)\["EPSG",\s*"?(\d+)"?\]\s*\]?\s*$/)?.[1];
      layers.push({
        file: `${name}.geojson`, name: layer.name, sourceFormat: info.driverName,
        crs: epsg ? `EPSG:${epsg}` : wkt ? 'Source CRS (see provenance WKT)' : null,
        sourceCrsWkt: wkt,
      });
    }
    await Gdal.close(dataset);
  }
  if (!layers.length) throw new Error('No supported vector layers were found.');
  await writeFile(join(output, 'result.json'), JSON.stringify({ layers, warnings: [...new Set(messages)].slice(0, 20) }));
}

convert().catch((error) => { console.error(error.message); process.exitCode = 1; });
