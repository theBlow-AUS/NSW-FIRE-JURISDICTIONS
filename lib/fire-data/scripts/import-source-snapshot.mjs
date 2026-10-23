import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Import page-reader exports of the official RFS pages, never an FDR/Total Fire Ban feed.
const [permitPath, directoryPath] = process.argv.slice(2);
if (!permitPath || !directoryPath) throw new Error('Supply the BFDP and FCC page-reader Markdown exports.');
const permitsText = await readFile(permitPath, 'utf8');
const directoryText = await readFile(directoryPath, 'utf8');
const permitRows = [...permitsText.matchAll(/^\|\s*([^|]+?)\s*\|\s*(Yes|No)\s*\|$/gmi)]
  .map((m) => ({ lga: m[1].trim(), required: m[2].toLowerCase() === 'yes' }));
const headings = [...directoryText.matchAll(/^(.+?) Local Government Area \((.+?)\)\s*$/gm)];
const contacts = [];
for (let i = 0; i < headings.length; i += 1) {
  const heading = headings[i];
  const block = directoryText.slice(heading.index + heading[0].length, headings[i + 1]?.index ?? directoryText.length);
  const addresses = [...block.matchAll(/^\*\*Street Address:\*\*[ \t]*([^\n]*)/gm)].map((m) => m[1].trim()).filter(Boolean);
  const phones = [...block.matchAll(/^\*\*Phone Number:\*\*[ \t]*([^\n]*)/gm)].map((m) => m[1].trim()).filter(Boolean);
  if (!addresses.length || !phones.length) throw new Error(`Incomplete directory entry: ${heading[1]}`);
  if (addresses.length !== phones.length && phones.length !== 1) throw new Error(`Ambiguous directory entry: ${heading[1]}`);
  for (let j = 0; j < addresses.length; j += 1) {
    contacts.push({
      lga: heading[1].trim(),
      district: heading[2].replace(/\s+office$/i, '').trim(),
      phone: phones[j] ?? phones[0],
      address: addresses[j],
    });
  }
}
if (permitRows.length < 100 || headings.length < 100) throw new Error('Source exports appear incomplete.');
if (new Set(permitRows.map((r) => r.lga)).size !== permitRows.length) throw new Error('Duplicate permit rows.');
const retrievedAt = new Date().toISOString();
const snapshot = { permitRows, contacts, permitRetrievedAt: retrievedAt, contactsRetrievedAt: retrievedAt };
await writeFile(fileURLToPath(new URL('../src/snapshot.ts', import.meta.url)),
  `// Generated from the official NSW RFS BFDP and FCC pages on ${retrievedAt}.\n// This is a dated page snapshot, not an independent BFDP declaration.\nimport type { RfsSnapshot } from '@workspace/api-zod';\nexport const seedSnapshot: RfsSnapshot = ${JSON.stringify(snapshot, null, 2)};\n`);
console.log(`Imported ${permitRows.length} permit rows and ${contacts.length} contacts across ${headings.length} directory LGAs.`);
