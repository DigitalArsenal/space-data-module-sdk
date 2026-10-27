// One actual binary ingest/query/reopen flow through the SDK and released engine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { FlatcRunner } from 'flatc-wasm/runner';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-flatsql-e2e-'));
const candidate = process.env.FLATSQL_CANDIDATE;
const engineEntry = candidate ? path.join(candidate, 'wasm/index.js') : new URL(import.meta.resolve('flatsql')).pathname;
let rows;
try {
  await build({ stdin: { contents: 'export * from "./src/runtime-host/index.js";', resolveDir: process.env.SDK_PACKAGE_ROOT ?? process.cwd() }, bundle:true, format:'esm', platform:'node', outfile:path.join(temp,'sdk.mjs'),
    plugins:[{name:'release-engine',setup(b){b.onResolve({filter:/^flatsql$/},()=>({path:engineEntry,external:true}));}}] });
  const { createFlatSqlRuntimeStore, createFlatBufferStreamIngestor } = await import(pathToFileURL(path.join(temp,'sdk.mjs')));
  const converter = await FlatcRunner.init();
  const source = await fs.readFile(new URL('../node_modules/spacedatastandards.org/schema/GJN/main.fbs',import.meta.url),'utf8');
  converter.mountFile('/GJN.fbs',source);converter.mountFile('/out/.keep','');
  const result=converter.runCommand(['--binary','--schema','-o','/out','/GJN.fbs']);assert.equal(result.code,0,result.stderr);
  const schema={name:'GJN',fileIdentifier:'$GJN',bfbs:converter.readFile('/out/GJN.bfbs')};
  const frame=converter.generateBinary({entry:'GJN.fbs',files:{'GJN.fbs':source}},JSON.stringify({FEATURES:[{ID:'sdk-customer-point',HAS_GEOMETRY:true,GEOMETRY:{TYPE:'POINT',POINT:{LONGITUDE:2,LATITUDE:3,ALTITUDE:420,HAS_ALTITUDE:true}}}]}),{sizePrefix:true,strictJson:true});
  const options={engine:{root:path.join(temp,'store')},schemas:[schema]};
  rows=createFlatSqlRuntimeStore(options);
  const ingestor=createFlatBufferStreamIngestor({rows});
  for(let at=0;at<frame.length;at+=7)await ingestor.pushBytes(frame.subarray(at,at+7));
  await ingestor.finish();assert.equal(ingestor.stats.framesAppended,1);
  const listed=await rows.listRows('$GJN');assert.equal(listed.length,1);assert.deepEqual(listed[0].payload,frame.slice(4));
  const handle=listed[0].handle;
  assert.deepEqual(await rows.appendRow({schemaFileId:'$GJN',payload:frame.slice(4)}),handle);
  const projected=await rows.query('SELECT geo_contains(_data,3,2),?1,?2,?3,?4,?5,?6 FROM GJN',[9223372036854775807n,1.25,'typed',frame,null,true]);
  assert.deepEqual(projected.rows,[[1,9223372036854775807n,1.25,'typed',frame,null,1]]);
  await rows.close();rows=createFlatSqlRuntimeStore(options);
  assert.deepEqual(await rows.resolveRow(handle),listed[0]);
  assert.equal((await rows.listRows()).length,1);
  const broken=createFlatBufferStreamIngestor({rows});await broken.pushBytes(frame.slice(0,5));await assert.rejects(broken.finish(),/partial frame/);
  const routed=createFlatBufferStreamIngestor({rows,frameRouter:async()=>{throw Error('route failed');}});
  await assert.rejects(routed.pushBytes(frame),/route failed/);await assert.rejects(routed.finish(),/route failed/);
  assert.equal((await rows.listRows('$GJN')).length,1);
  console.log('SDK FLATSQL E2E PASS: binary chunks, durable row identity, dedupe, typed QRP, GJN, failure propagation and reopen');
} finally { await rows?.close(); await fs.rm(temp,{recursive:true,force:true}); }
