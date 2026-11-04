export const DAY_MS=24*60*60*1000;
export function validateSnapshot(data){
  if(data?.coordinateSystem!=='GCJ-02'||!/^\d{4}-\d{2}-\d{2}$/.test(data.updated)||!Array.isArray(data.cameras)||!data.cameras.length)throw new Error('摄像头数据格式不完整');
  for(const c of data.cameras)if(typeof c.name!=='string'||!c.name||!Array.isArray(c.gcj)||c.gcj.length!==2||!c.gcj.every(Number.isFinite)||c.gcj[0]<70||c.gcj[0]>140||c.gcj[1]<0||c.gcj[1]>60||!/^https:\/\/www\.jinjing365\.com\/wap\/content\/\?\d+\.html$/.test(c.url))throw new Error('摄像头点位格式不正确');
  return data;
}
export function checkDue(checkedAt,now){return !Number.isFinite(checkedAt)||checkedAt<=0||now<checkedAt||now-checkedAt>=DAY_MS;}
export function snapshotRevision(data){return data.revision||data.updated+':'+data.cameras.length;}

export function browserSnapshotCache(){
  let database;
  function open(){
    if(!globalThis.indexedDB)return Promise.reject(new Error('缓存不可用'));
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open('jinglu-public-camera-cache',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('缓存暂不可用'));
    });
    return database;
  }
  return {
    async read(){const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction('snapshots').objectStore('snapshots').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});},
    async write(value){const db=await open();return new Promise((resolve,reject)=>{const transaction=db.transaction('snapshots','readwrite');transaction.objectStore('snapshots').put(value,'current');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}
  };
}
export function createCameraData({cache=browserSnapshotCache(),request=globalThis.fetch.bind(globalThis),now=Date.now,onData=()=>{},onState=()=>{}}={}){
  let stored,loaded=false,pending;
  async function load(force){
    if(!loaded){try{const value=await cache.read();if(value?.data){validateSnapshot(value.data);stored=value;}}catch{}loaded=true;}
    if(stored&&!force&&!checkDue(stored.checkedAt,now())){
      onData(stored.data,{checkedAt:stored.checkedAt,cached:true});onState({kind:'ready',checkedAt:stored.checkedAt,cached:true});return stored.data;
    }
    if(stored)onData(stored.data,{checkedAt:stored.checkedAt,cached:true,checking:true});
    onState({kind:'checking'});
    try{
      const response=await request('cameras.json?checked='+now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=validateSnapshot(await response.json()),value={data,checkedAt:now()};
      // Never replace a newer local snapshot with an older CDN response.
      if(stored&&data.updated<stored.data.updated)throw new Error('服务器快照早于本地快照');
      stored=value;try{await cache.write(value);}catch{}
      onData(data,{checkedAt:value.checkedAt,cached:false});onState({kind:'ready',checkedAt:value.checkedAt});return data;
    }catch(error){
      onState({kind:'error',error,checkedAt:stored?.checkedAt,hasCache:!!stored});
      if(stored)return stored.data;
      throw error;
    }
  }
  return {check({force=false}={}){if(!pending)pending=load(force).finally(()=>{pending=null;});return pending;}};
}
