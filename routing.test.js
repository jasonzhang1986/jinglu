import assert from 'node:assert/strict';
import test from 'node:test';
import {createRoutingClient,normalizeRoutes,routeError,routeSnapNotice,MAX_SNAP_METERS} from './routing.js';
const points=[[116.39,39.9],[116.4,39.92]];
const payload=(offset=0)=>({code:'Ok',routes:[{distance:3200,duration:600,geometry:{type:'LineString',coordinates:[[116.39+offset,39.9],[116.395,39.91],[116.4,39.92]]},legs:[{steps:[]}]}],waypoints:[{location:[116.39+offset,39.9]},{location:[116.4,39.92]}]});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const noSegment=response({code:'NoSegment',message:'Could not find a matching segment for coordinate 0'},400);
test('HTTP 400 NoSegment is a location error, not service unavailable',()=>{
  const error=routeError({code:'NoSegment',message:'Could not find a matching segment for coordinate 0'},400,'osrm',2);assert.equal(error.kind,'no-road');assert.equal(error.pointIndex,0);assert.match(error.message,/起点/);
});
test('NoSegment retries with bounded 300 m matching and discloses endpoint offsets',async()=>{
  const calls=[],progress=[];const client=createRoutingClient({request:async url=>{calls.push(url);return calls.length===1?noSegment:response(payload(.00125));},onProgress:text=>progress.push(text)});
  const [route]=await client.routes(points,new AbortController().signal);assert.equal(calls.length,2);assert.match(calls[0],/radiuses=100;100/);assert.match(calls[1],/radiuses=300;300/);assert(route.snapDistances[0]>100&&route.snapDistances[0]<110);assert.match(routeSnapNotice(route),/起点距匹配道路约/);assert.equal(route.provider,'osrm');assert(progress.some(t=>t.includes('300 米')));
});
test('network failure switches to Valhalla and reuses the working provider',async()=>{
  const calls=[];const client=createRoutingClient({request:async(url,options)=>{calls.push({url,options});if(url.includes('project-osrm'))throw new TypeError('Failed to fetch');return response(payload());}});
  assert.equal((await client.routes(points))[0].provider,'valhalla');assert.equal(calls.length,2);await client.routes(points);assert.equal(calls.length,3);assert(calls[2].url.includes('valhalla'));
});
test('after both OSRM match attempts fail the backup can still produce routes',async()=>{
  let calls=0;const client=createRoutingClient({request:async url=>{calls++;return url.includes('project-osrm')?noSegment:response(payload(.00125));}});const routes=await client.routes(points);assert.equal(calls,3);assert.equal(routes[0].provider,'valhalla');
});
test('NoRoute is parsed on HTTP 400 and retained when both engines cannot connect roads',async()=>{
  const client=createRoutingClient({request:async()=>response({code:'NoRoute',message:'Impossible route between points'},400)});await assert.rejects(client.routes(points),error=>error.kind==='no-route'&&/出入口/.test(error.message));
});
test('snaps beyond the maximum are rejected rather than silently moving the origin',()=>{
  assert.equal(MAX_SNAP_METERS,300);assert.throws(()=>normalizeRoutes(payload(.02),points,'valhalla',300),error=>error.kind==='no-road'&&/超过 300 米/.test(error.message));
});
test('invalid route geometry falls back instead of returning a broken route',async()=>{
  let calls=0;const client=createRoutingClient({request:async()=>{calls++;return response(calls===1?{code:'Ok',routes:[{geometry:{coordinates:[]}}]}:payload());}});assert.equal((await client.routes(points))[0].provider,'valhalla');assert.equal(calls,2);
});
test('rate limit and server errors trigger fallback and a truthful final error',async()=>{
  let calls=0;const client=createRoutingClient({request:async()=>response({},++calls===1?429:503)});await assert.rejects(client.routes(points),error=>error.kind==='unavailable'&&error.attempts.includes('rate-limit'));assert.equal(calls,2);
});
test('cancelling a request never starts another provider',async()=>{
  let calls=0;const controller=new AbortController();const client=createRoutingClient({request:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});}});const pending=client.routes(points,controller.signal);controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,1);
});
test('a timeout can fall back to a responding provider',async()=>{
  let calls=0;const client=createRoutingClient({timeoutMs:10,request:async(url,{signal})=>{calls++;if(calls>1)return response(payload());return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}});assert.equal((await client.routes(points))[0].provider,'valhalla');assert.equal(calls,2);
});
test('small snap distances do not display unnecessary offset warnings',()=>{assert.equal(routeSnapNotice(normalizeRoutes(payload(),points,'osrm',100)[0]),'');});
