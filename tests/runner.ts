import { unzipSync, zipSync } from 'fflate';
import UTIF from 'utif';
import type { ConversionResult, Format, ImageInfo, Settings } from '../src/types';

const base: Settings = { format: 'jpeg', quality: .85, resize: 'original', width: 1920, height: 1080, percentage: 50, upscale: false, maxBytes: null, autoResize: true, background: '#ffffff', suffix: '-resz' };
const worker = new Worker(new URL('../src/image.worker.ts', import.meta.url), { type: 'module' });
let id = 0, passed = 0, failed = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
worker.onmessage = ({ data }) => { const handler = pending.get(data.id)!; pending.delete(data.id); data.ok ? handler.resolve(data.result) : handler.reject(new Error(data.error.code)); };
const request = (file: File, settings?: Partial<Settings>) => new Promise<ImageInfo | ConversionResult>((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); worker.postMessage({ id: next, action: settings ? 'convert' : 'inspect', file, settings: settings ? { ...base, ...settings } : undefined }); });
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function test(name: string, action: () => Promise<void>) {
  const item = document.createElement('li'); item.textContent = `Running: ${name}`; document.querySelector('#results')!.append(item);
  try { await action(); item.textContent = `PASS — ${name}`; passed++; }
  catch(error) { item.textContent = `FAIL — ${name}: ${error}`; item.className='fail'; failed++; }
  document.querySelector('#summary')!.textContent = `${passed} passed, ${failed} failed (running)`;
}
const canvas = new OffscreenCanvas(480,320), ctx=canvas.getContext('2d')!;
const rgba=ctx.createImageData(480,320);let seed=7;
for(let i=0;i<rgba.data.length;i+=4){seed=(seed*16807)%2147483647;rgba.data[i]=seed%256;rgba.data[i+1]=(seed>>>8)%256;rgba.data[i+2]=(seed>>>16)%256;rgba.data[i+3]=i%480<240?255:0;}ctx.putImageData(rgba,0,0);
const original = new File([await canvas.convertToBlob({type:'image/png'})],'test.png',{type:'image/png'});
const heic = new File([await (await fetch('./fixtures/example.heic')).blob()],'example.heic',{type:'image/heic'});
const tiff = new File([await (await fetch('./fixtures/transparency.tiff')).blob()],'transparency.tiff',{type:'image/tiff'});
const results: Record<string, Uint8Array> = Object.create(null);

await test('PNG import: correct dimensions and thumbnail',async()=>{const info=await request(original);assert(info.width===480&&info.height===320,'incorrect dimensions');assert(info.thumbnail.size>0,'missing thumbnail');});
await test('Real HEIC import and JPEG conversion',async()=>{const result=await request(heic,{format:'jpeg',resize:'fit',width:400,height:400}) as ConversionResult;assert(result.width===400&&result.height===267,`unexpected HEIC dimensions ${result.width}x${result.height}`);assert(result.blob.type==='image/jpeg','not JPEG');});
await test('TIFF import with RGBA transparency',async()=>{const info=await request(tiff);assert(info.width===320&&info.height===240,'incorrect TIFF dimensions');});
for(const format of ['jpeg','png','webp','gif','bmp','tiff'] as Format[]) await test(`${format.toUpperCase()} exports correct bytes, dimensions, and transparency`,async()=>{
  const result=await request(original,{format,resize:'fit',width:120,height:120}) as ConversionResult;
  assert(result.width===120&&result.height===80,'bad resize');
  const buffer=await result.blob.arrayBuffer(),bytes=new Uint8Array(buffer);results[`test.${format}`]=bytes;
  const signatures: Record<Format,boolean>={jpeg:bytes[0]===255&&bytes[1]===216,png:bytes[0]===137&&bytes[1]===80,webp:String.fromCharCode(...bytes.slice(8,12))==='WEBP',gif:String.fromCharCode(...bytes.slice(0,3))==='GIF',bmp:bytes[0]===66&&bytes[1]===77,tiff:(bytes[0]===77&&bytes[1]===77)||(bytes[0]===73&&bytes[1]===73)};
  assert(signatures[format],`wrong ${format} file signature`);
  let pixels: Uint8ClampedArray|Uint8Array;
  if(format==='tiff'){const page=UTIF.decode(buffer)[0];UTIF.decodeImage(buffer,page);assert(page.width===120&&page.height===80,'bad TIFF dimensions');pixels=UTIF.toRGBA8(page);}
  else{const bitmap=await createImageBitmap(result.blob);assert(bitmap.width===120&&bitmap.height===80,'bad decoded dimensions');const decoded=new OffscreenCanvas(120,80);decoded.getContext('2d')!.drawImage(bitmap,0,0);pixels=decoded.getContext('2d')!.getImageData(0,0,120,80).data;bitmap.close();}
  // Original's right half of each 120-pixel-wide strip is fully transparent.
  assert(['jpeg','bmp'].includes(format)?pixels[29*4+3]===255:pixels[29*4+3]===0,'unexpected alpha');
});
await test('Hard byte cap checks actual JPG bytes and reduces quality',async()=>{const result=await request(original,{maxBytes:6000,autoResize:false}) as ConversionResult;assert(result.blob.size<=6000,'over byte cap');assert(result.width===480&&result.height===320,'unexpected resize');assert(result.quality<.85,'quality not adjusted');});
await test('PNG byte cap automatically reduces dimensions',async()=>{const result=await request(original,{format:'png',maxBytes:3000}) as ConversionResult;assert(result.blob.size<=3000,'over byte cap');assert(result.reduced,'not reduced');});
await test('Impossible cap fails instead of exporting oversized file',async()=>{let error='';try{await request(original,{maxBytes:1});}catch(e){error=(e as Error).message;}assert(error === 'errorLimitTiny','missing size failure');});
await test('Cap with automatic resize disabled preserves dimensions or fails',async()=>{let error='';try{await request(original,{format:'png',maxBytes:100,autoResize:false});}catch(e){error=(e as Error).message;}assert(error === 'errorLimitFixed','unexpected cap behavior');});
await test('Fit never upscales by default',async()=>{const result=await request(original,{resize:'fit',width:1200,height:1200});assert(result.width===480&&result.height===320,'upscaled');});
await test('Percentage and exact resize',async()=>{const percent=await request(original,{resize:'percentage',percentage:25});assert(percent.width===120&&percent.height===80,'wrong percent');const exact=await request(original,{resize:'exact',width:100,height:100});assert(exact.width===100&&exact.height===100,'wrong exact dimensions');});
await test('Corrupt input fails and worker recovers for the next file',async()=>{let errored=false;try{await request(new File(['broken'],'bad.heic'));}catch{errored=true;}assert(errored,'accepted corrupt image');assert((await request(original)).width===480,'worker did not recover');});
await test('ZIP round trip preserves every output byte',async()=>{const zip=zipSync(results,{level:0}),entries=unzipSync(zip);assert(Object.keys(entries).length===6,'missing ZIP entries');for(const name of Object.keys(results))assert(entries[name].every((value,i)=>value===results[name][i]),`ZIP bytes differ for ${name}`);});
worker.terminate();document.querySelector('#summary')!.textContent=`Finished: ${passed} passed, ${failed} failed.`;document.title=`resz.im tests: ${passed} passed, ${failed} failed`;
