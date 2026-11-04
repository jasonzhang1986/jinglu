import assert from 'node:assert/strict';
import test from 'node:test';
import {DAY_MS,checkDue,createCameraData} from './camera-data.js';
const sample=(revision='a',updated='2026-11-04')=>({coordinateSystem:'GCJ-02',revision,updated,cameras:[{name:'测试公开点位',gcj:[116.4,39.9],url:'https://www.jinjing365.com/wap/content/?1.html'}]});
function harness(initial){
  let time=10*DAY_MS,value=initial,calls=0,response=sample(),failure=false,writes=0;
  const states=[],applied=[];
  const cache={read:async()=>value,write:async v=>{value=v;writes++;}};
  const request=async(url,options)=>{calls++;assert.equal(options.cache,'no-store');assert(url.includes('?checked='));if(failure)throw new Error('offline');return {ok:true,json:async()=>response};};
  const manager=createCameraData({cache,request,now:()=>time,onData:d=>applied.push(d),onState:s=>states.push(s)});
  return {manager,states,applied,get calls(){return calls;},get value(){return value;},get writes(){return writes;},setTime:t=>time=t,setResponse:r=>response=r,fail:()=>failure=true};
}
test('first visit fetches and caches; return before 24 hours makes no request',async()=>{
  const h=harness();await h.manager.check();assert.equal(h.calls,1);assert.equal(h.value.checkedAt,10*DAY_MS);
  h.setTime(11*DAY_MS-1);await h.manager.check();assert.equal(h.calls,1);
  // A separate page load reads the same persistent cache.
  const next=harness(h.value);next.setTime(11*DAY_MS-1);await next.manager.check();assert.equal(next.calls,0);
});
test('exactly 24 hours triggers a cache-bypassing fetch and applies updated points',async()=>{
  const h=harness({data:sample('old'),checkedAt:9*DAY_MS});h.setResponse(sample('new'));await h.manager.check();assert.equal(h.calls,1);assert.deepEqual(h.applied.map(d=>d.revision),['old','new']);assert.equal(h.value.data.revision,'new');
});
test('failed updates retain data and last successful check time, permitting retry',async()=>{
  const old={data:sample('old'),checkedAt:9*DAY_MS};const h=harness(old);h.fail();const result=await h.manager.check();assert.equal(result.revision,'old');assert.equal(h.value.checkedAt,old.checkedAt);assert.equal(h.writes,0);assert.equal(h.states.at(-1).hasCache,true);await h.manager.check();assert.equal(h.calls,2);
});
test('malformed or older responses never replace a usable snapshot',async()=>{
  for(const invalid of [{cameras:[]},sample('regressed','2026-10-29')]){const h=harness({data:sample('old'),checkedAt:9*DAY_MS});h.setResponse(invalid);await h.manager.check();assert.equal(h.value.data.revision,'old');assert.equal(h.writes,0);}
});
test('manual update forces a check; concurrent checks share one request',async()=>{
  const h=harness({data:sample(),checkedAt:10*DAY_MS});await Promise.all([h.manager.check({force:true}),h.manager.check({force:true})]);assert.equal(h.calls,1);
});
test('storage failure still permits online operation',async()=>{
  let calls=0;const manager=createCameraData({cache:{read:async()=>{throw new Error('denied');},write:async()=>{throw new Error('denied');}},request:async()=>{calls++;return {ok:true,json:async()=>sample()};}});assert.equal((await manager.check()).revision,'a');assert.equal(calls,1);
});
test('new page without cache cannot pretend to have loaded after a network failure',async()=>{const h=harness();h.fail();await assert.rejects(h.manager.check());assert.equal(h.states.at(-1).hasCache,false);});
test('future or invalid clock timestamps trigger revalidation',()=>{assert(checkDue(100,99));assert(checkDue(NaN,100));assert(!checkDue(100,101));});
