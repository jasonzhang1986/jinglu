import {avoidPolygons} from './geo.js?v=20261104-amap';

export const MAX_SNAP_METERS=300;
const meters=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos(a[1]*Math.PI/180),a[1]-b[1])*111320;
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const label=(i,count)=>i===0?'起点':i===count-1?'终点':'途经点 '+i;
export class RouteServiceError extends Error{
  constructor(kind,message,details={}){super(message);this.name='RouteServiceError';this.kind=kind;Object.assign(this,details);}
}
export function routeError(data,status,provider,count){
  const code=data?.code||'',raw=String(data?.message||data?.error||'');
  if(code==='NoSegment'||/no suitable edges|failed to correlate|matching segment/i.test(raw)){
    const match=raw.match(/coordinate\s+(\d+)/i),pointIndex=match?+match[1]:null;
    return new RouteServiceError('no-road',(pointIndex===null?'选点':label(pointIndex,count))+'附近未匹配到可驾车道路，请改选停车场或道路出入口。',{provider,pointIndex,code});
  }
  if(code==='NoRoute'||/no path|no route|unconnected/i.test(raw))return new RouteServiceError('no-route','未找到连接起终点的可驾车道路，请确认小区或园区出入口。',{provider,code});
  if(status===429)return new RouteServiceError('rate-limit','路线服务请求较多，请稍后重试。',{provider,code});
  return new RouteServiceError('service','路线服务暂时未能返回有效路线，请稍后重试。',{provider,code,httpStatus:status});
}
export function normalizeRoutes(data,points,provider,matchingRadius){
  const result=[],errors=[];
  for(const route of data.routes||[]){
    try{
      const coords=route.geometry?.coordinates;
      if(route.geometry?.type!=='LineString'||!Array.isArray(coords)||coords.length<2||!coords.every(validPoint)||!Array.isArray(route.legs)||!Number.isFinite(route.distance)||!Number.isFinite(route.duration))throw new RouteServiceError('service','路线服务返回的数据不完整，请重新尝试。',{provider});
      const snappedPoints=points.map((point,i)=>{
        if(i===0)return coords[0];if(i===points.length-1)return coords.at(-1);
        const waypoint=data.waypoints?.[i]?.location;if(validPoint(waypoint))return waypoint;
        return coords.reduce((best,p)=>meters(point,p)<meters(point,best)?p:best,coords[0]);
      });
      const snapDistances=points.map((p,i)=>meters(p,snappedPoints[i]));
      const far=snapDistances.findIndex(d=>d>MAX_SNAP_METERS);
      if(far>=0)throw new RouteServiceError('no-road',label(far,points.length)+'距离匹配道路超过 '+MAX_SNAP_METERS+' 米，请改选实际停车场或道路出入口。',{provider,pointIndex:far});
      result.push({...route,via:points.slice(1,-1),provider,matchingRadius,snappedPoints,snapDistances});
    }catch(error){errors.push(error);}
  }
  if(!result.length)throw errors[0]||new RouteServiceError('no-route','未找到可通行道路，请调整起终点。',{provider});
  return result;
}
export function routeSnapNotice(route){
  if(!route?.snapDistances)return '';
  const parts=route.snapDistances.map((d,i)=>d>=30?label(i,route.snapDistances.length)+'距匹配道路约 '+Math.round(d)+' 米':'').filter(Boolean);
  return parts.length?parts.join('；')+'。请确认实际出入口。地图虚线仅为偏移示意，不表示可通行道路。':'';
}
export function createRoutingClient({request=globalThis.fetch.bind(globalThis),timeoutMs=12000,onProgress=()=>{}}={}){
  let preferred='osrm';
  function cancelled(signal){if(signal?.aborted)throw new DOMException('路线搜索已停止','AbortError');}
  async function json(url,options,signal,provider,count){
    cancelled(signal);const active=new AbortController();let timedOut=false;
    const abort=()=>active.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;active.abort();},timeoutMs);
    try{
      const response=await request(url,{...options,signal:active.signal});let data;
      try{data=await response.json();}catch{cancelled(signal);if(timedOut)throw new RouteServiceError('timeout','路线服务响应超时，请稍后重试。',{provider});throw routeError(null,response.status,provider,count);}
      cancelled(signal);
      // OSRM returns NoSegment / NoRoute as HTTP 400. Parse the body before classifying HTTP failures.
      if(!response.ok||data.code!=='Ok'||!data.routes?.length)throw routeError(data,response.status,provider,count);
      return data;
    }catch(error){
      cancelled(signal);if(error instanceof RouteServiceError)throw error;
      if(timedOut)throw new RouteServiceError('timeout','路线服务响应超时，请稍后重试。',{provider});
      throw new RouteServiceError('network','未能连接路线服务，请检查网络后重试。',{provider});
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function osrm(points,signal,radius){
    const url='https://router.project-osrm.org/route/v1/driving/'+points.map(p=>p.map(n=>n.toFixed(6)).join(',')).join(';')+'?alternatives=true&overview=full&geometries=geojson&steps=true&continue_straight=false&radiuses='+points.map(()=>radius).join(';');
    const data=await json(url,{},signal,'osrm',points.length);return normalizeRoutes(data,points,'osrm',radius);
  }
  async function valhalla(points,signal,excluded,radius){
    const payload={locations:points.map(p=>({lon:p[0],lat:p[1],radius:MAX_SNAP_METERS})),costing:'auto',format:'osrm',shape_format:'geojson',alternates:points.length===2?2:0};
    if(excluded){payload.exclude_locations=excluded.slice(0,50).map(c=>({lon:c.point[0],lat:c.point[1]}));payload.exclude_polygons=avoidPolygons(excluded,radius);}
    const data=await json('https://valhalla1.openstreetmap.de/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},signal,'valhalla',points.length);
    return normalizeRoutes(data,points,'valhalla',MAX_SNAP_METERS);
  }
  return {
    async routes(points,signal){
      if(!Array.isArray(points)||points.length<2||!points.every(validPoint))throw new RouteServiceError('invalid','起终点坐标无效，请重新选择地点。');
      const errors=[],providers=preferred==='osrm'?['osrm','valhalla']:['valhalla','osrm'];
      for(const provider of providers){
        cancelled(signal);
        try{
          let result;
          if(provider==='osrm'){
            try{result=await osrm(points,signal,100);}
            catch(error){cancelled(signal);if(error.kind!=='no-road')throw error;onProgress('选点附近 100 米内未匹配到道路，正在 300 米范围内重试…');result=await osrm(points,signal,MAX_SNAP_METERS);}
          }else result=await valhalla(points,signal);
          preferred=provider;return result;
        }catch(error){cancelled(signal);errors.push(error);if(errors.length===1)onProgress('正在尝试备用算路服务…');}
      }
      const specific=errors.find(e=>e.kind==='no-road')||errors.find(e=>e.kind==='no-route');
      if(specific)throw specific;
      throw new RouteServiceError('unavailable','主、备用算路服务均未成功响应，请稍后重试或检查网络。',{attempts:errors.map(e=>e.kind)});
    },
    avoid(points,excluded,radius,signal){return valhalla(points,signal,excluded,radius);}
  };
}
