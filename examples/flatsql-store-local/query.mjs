// Canonical SDS GJN records in, SDS QRP query result out.
import fs from 'node:fs/promises';
import { FlatSQL } from 'flatsql';
import { encodeFlatSqlQuery } from 'space-data-module-sdk/runtime-host';
const [schemaPath, recordsPath, sql = 'SELECT geo_envelope(_data) FROM GJN'] = process.argv.slice(2);
if (!schemaPath || !recordsPath) throw new Error('Usage: node query.mjs GJN.bfbs records.gjn [SQL] > result.qrp');
const db = await FlatSQL.open();
try {
  await db.registerSchema({name:'GJN', fileIdentifier:'$GJN', bfbs:new Uint8Array(await fs.readFile(schemaPath))});
  await db.ingest('GJN', new Uint8Array(await fs.readFile(recordsPath)));
  for await (const chunk of db.query(encodeFlatSqlQuery(sql))) {
    if (!process.stdout.write(chunk)) await new Promise(resolve => process.stdout.once('drain', resolve));
  }
} finally { await db.close(); }
