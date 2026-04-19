#!/usr/bin/env node
// read-summary-field.js <summary-path> <field>
//
// Prints the named numeric/string field from a JSON file to stdout,
// or "null" if the file is missing/broken or the field is absent.
// Used by run-comparison.sh to avoid shell-quoting issues when
// paths contain spaces (e.g. Google Drive paths on Windows).

const fs = require('fs');

function main() {
  const [filePath, field] = process.argv.slice(2);
  if (!filePath || !field) { console.log('null'); return; }
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const val = doc[field];
    if (val === undefined || val === null) { console.log('null'); return; }
    console.log(val);
  } catch (e) {
    console.log('null');
  }
}

if (require.main === module) main();
