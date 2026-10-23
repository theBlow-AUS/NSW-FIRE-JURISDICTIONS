import { load } from 'cheerio';
import { BFDP_SOURCE } from '@workspace/fire-data';
import type { PermitRecord } from '@workspace/api-zod';

export function parsePermitTable(html: string): PermitRecord[] {
  const $ = load(html);
  const rows: PermitRecord[] = [];
  let found = false;
  $('table').each((_i, table) => {
    const header = $(table).find('tr').first().find('th,td').map((_j, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
    const councilColumn = header.findIndex((h) => /^council name$/i.test(h));
    const permitColumn = header.findIndex((h) => /^fire permit required$/i.test(h));
    if (councilColumn < 0 || permitColumn < 0) return;
    if (found) throw new Error('Multiple RFS permit tables found; cached data has not been replaced.');
    found = true;
    $(table).find('tr').slice(1).each((_j, tr) => {
      const cells = $(tr).find('td').map((_k, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
      if (!cells.length) return;
      const lga = cells[councilColumn], answer = cells[permitColumn];
      if (!lga || !/^(Yes|No)$/i.test(answer ?? '')) throw new Error('Unrecognised RFS table row; cached data has not been replaced.');
      rows.push({ lga, required: answer.toLowerCase() === 'yes' });
    });
  });
  if (!found || rows.length < 100 || new Set(rows.map((r) => r.lga.toUpperCase())).size !== rows.length) {
    throw new Error('The RFS permit table is missing, incomplete or duplicated. Cached data has not been replaced.');
  }
  return rows;
}

export async function scrapePermitTable(): Promise<PermitRecord[]> {
  const response = await fetch(BFDP_SOURCE, {
    headers: { 'User-Agent': 'NSW-Fire-District-Checker/1.0 (scheduled public BFDP table reader)', Accept: 'text/html' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(response.status === 403
    ? 'RFS blocked automated access (HTTP 403). The last successful snapshot is retained.'
    : `RFS returned HTTP ${response.status}. The last successful snapshot is retained.`);
  const html = await response.text();
  if (html.length > 2_000_000) throw new Error('RFS page exceeded the permitted size; cached data is retained.');
  return parsePermitTable(html);
}
