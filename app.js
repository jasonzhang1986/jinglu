import {gcjToWgs,inBeijing,makeIndex,checkRoute,detourPoint,avoidPolygons} from './geo.js?v=20261104-amap';
import {createAutocomplete} from './autocomplete.js?v=20261104-amap';
import {createAmapShare} from './amap.js?v=20261104-amap';
import {createCameraData,snapshotRevision} from './camera-data.js?v=20261104-camera-refresh';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pois=[
  {name:'北京南站',point:[116.3727,39.8652],detail:'丰台区 · 铁路车站'},
  {name:'首都国际机场',point:[116.5975,40.0799],detail:'顺义区 · 机场区域，请确认具体航站楼'},
  {name:'奥林匹克森林公园',point:[116.3842,40.0104],detail:'朝阳区 · 南园南门附近'},
  {name:'北京西站',point:[116.3156,39.8956],detail:'丰台区 · 铁路车站'},
  {name:'中关村',point:[116.3104,39.9789],detail:'海淀区 · 中关村区域'},
  {name:'天安门',point:[116.3913,39.9074],detail:'东城区 · 请另行确认通行及停车规定'},
  {name:'望京SOHO',point:[116.4748,39.9969],detail:'朝阳区 · 望京区域'},
  {name:'北京站',point:[116.4273,39.9026],detail:'东城区 · 铁路车站'}
];
let map,cameraLayer,routeLayer,endLayer,index,cameras=[],origin=null,destination=null,pick='destination',routes=[],selected=0,controller=null,busy=false,showCameras=true,planningVersion=0;
const autocomplete={};
let amapShare;
let cameraSnapshot,cameraData,cameraRenderer;
const endpointMarkers={};
function status(message,kind=''){ $('status').hidden=false;$('status').className='status '+kind;$('status').textContent=message; }
function invalidate(){planningVersion++;if(controller)controller.abort();routes=[];amapShare?.close();$('routes').hidden=true;$('status').hidden=true;$('welcome').hidden=false;routeLayer?.clearLayers();if(busy)setBusy(false);}
function setBusy(value){busy=value;$('plan').disabled=value||!index;$('plan').firstElementChild.textContent=value?'正在寻找合适路线…':'开始规划路线';$('cancel').hidden=!value;}
function setPoint(which,point,name,pan=true){
  invalidate();if(which==='origin')origin=point;else destination=point;
  $(which).value=name;$(which).dataset.selected=name;
  if(map){if(endpointMarkers[which])endLayer.removeLayer(endpointMarkers[which]);endpointMarkers[which]=L.marker([point[1],point[0]],{icon:L.divIcon({className:'endpoint-marker '+(which==='destination'?'end':''),html:which==='origin'?'起':'终',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(endLayer).bindTooltip(esc(name),{direction:'top'});if(pan)map.setView([point[1],point[0]],Math.max(map.getZoom(),13));}
  Object.values(autocomplete).forEach(control=>control.close());autocomplete[which]?.setSelected(name);
}
function setPick(which){pick=which;$('pickOrigin').classList.toggle('active',which==='origin');$('pickDestination').classList.toggle('active',which==='destination');document.querySelector('.map-hint').textContent='点击地图选取'+(which==='origin'?'起点':'终点');}
function parseCoords(text){const parts=text.trim().split(/[,，\s]+/);if(parts.length!==2)return null;const p=parts.map(Number);return inBeijing(p)?p:null;}
function search(which){autocomplete[which]?.search();}
async function locate(){
  if(!navigator.geolocation){status('浏览器不支持定位，请输入起点或在地图上选点。','error');setPick('origin');return;}
  $('locate').disabled=true;status('正在获取当前位置，请在浏览器提示中允许定位…','loading');
  navigator.geolocation.getCurrentPosition(p=>{
    $('locate').disabled=false;const point=[p.coords.longitude,p.coords.latitude];
    if(!inBeijing(point)){status('当前位置不在本工具的北京覆盖范围内，请在地图上设置北京范围内的起点。','warning');setPick('origin');return;}
    setPoint('origin',point,'当前位置');status('当前位置已获取，定位精度约 '+Math.round(p.coords.accuracy)+' 米。请选择目的地。'+(p.coords.accuracy>100?'定位误差较大，建议在地图上确认起点。':''));
  },e=>{$('locate').disabled=false;const msg=e.code===1?'定位权限未开启':e.code===3?'定位超时':'暂时无法获取位置';status(msg+'。可输入起点并选择下拉地点，或在地图上选取起点。','warning');setPick('origin');},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
const routeSignature=r=>r.geometry.coordinates.filter((_,i)=>i%20===0).map(p=>p.map(n=>n.toFixed(4)).join(',')).join(';');
function checkCandidate(r,radius){
  // Include the short connectors to the engine's snapped road positions conservatively.
  return checkRoute([origin,...r.geometry.coordinates,destination],index,radius).map(h=>({...h,segment:Math.max(0,h.segment-1)}));
}
async function fetchRoutes(points,signal){
  const url='https://router.project-osrm.org/route/v1/driving/'+points.map(p=>p.map(n=>n.toFixed(6)).join(',')).join(';')+'?alternatives=true&overview=full&geometries=geojson&steps=true&continue_straight=false&radiuses='+points.map(()=>100).join(';');
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(22000)])});if(!response.ok)throw new Error('路线服务暂不可用，请稍后重试。');const data=await response.json();
  if(data.code!=='Ok'||!data.routes?.length)throw new Error(data.code==='NoSegment'?'选点附近 100 米内未找到可通行道路，请调整到道路上。':'未找到可通行的道路路线，请调整起终点。');return data.routes.map(r=>({...r,via:points.slice(1,-1)}));
}
async function fetchAvoidRoute(points,excluded,radius,signal){
  const payload={locations:points.map(p=>({lon:p[0],lat:p[1],radius:100})),costing:'auto',format:'osrm',shape_format:'geojson',alternates:2,exclude_locations:excluded.slice(0,50).map(c=>({lon:c.point[0],lat:c.point[1]})),exclude_polygons:avoidPolygons(excluded,radius)};
  const response=await fetch('https://valhalla1.openstreetmap.de/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([signal,AbortSignal.timeout(22000)])});
  const data=await response.json();if(!response.ok||data.code!=='Ok'||!data.routes?.length)throw new Error('区域避让服务未返回可通行路线。');return data.routes.map(r=>({...r,via:[]}));
}
function fit(){if(!map)return;const p=routes[selected]?.geometry.coordinates;if(p?.length)map.fitBounds(L.latLngBounds(p.map(x=>[x[1],x[0]])),{padding:[40,120]});else if(origin&&destination)map.fitBounds([[origin[1],origin[0]],[destination[1],destination[0]]],{padding:[50,80],maxZoom:15});else if(origin||destination){const a=origin||destination;map.setView([a[1],a[0]],14);}}
async function plan(event){
  event?.preventDefault();if(busy)return;if(!index){status('点位数据尚未就绪，请稍后重试。','error');return;}
  if(!origin){const p=parseCoords($('origin').value);if(p)setPoint('origin',p,$('origin').value,false);else{status('请先设置起点：点击 ◎ 定位、输入起点并选择下拉地点，或在地图上选点。','warning');setPick('origin');return;}}
  if(!destination){const p=parseCoords($('destination').value);if(p)setPoint('destination',p,$('destination').value,false);else{await search('destination');return;}}
  if(Math.hypot((origin[0]-destination[0])*.77,origin[1]-destination[1])*111320<100){status('起点与终点过近，请选择相距至少 100 米的地点。','warning');return;}
  const radius=+$('radius').value,token=++planningVersion;controller=new AbortController();const active=controller;setBusy(true);routes=[];$('routes').hidden=true;routeLayer?.clearLayers();$('welcome').hidden=true;
  Object.values(autocomplete).forEach(control=>control.close());const seen=new Set();let requests=0,partialError='';
  const add=list=>{for(const r of list){const s=routeSignature(r);if(seen.has(s))continue;seen.add(s);r.hits=checkCandidate(r,radius);routes.push(r);}routes.sort((a,b)=>a.hits.length-b.hits.length||a.duration-b.duration);};
  try{
    status('正在获取真实道路路线，并检查沿线点位…','loading');add(await fetchRoutes([origin,destination],active.signal));requests++;
    const initial=routes[0],baselineDistance=initial.distance,excluded=new Map();let avoidCandidate=initial,previousExclusions='';
    // Ask a routing engine to exclude road edges and buffered polygons, then validate against every camera again.
    for(let round=0;round<3&&routes[0].hits.length;round++){
      const current=avoidCandidate.hits.map(h=>h.camera),prior=[...excluded.values()];excluded.clear();
      for(const c of [...current,...prior])if(!excluded.has(c.url))excluded.set(c.url,c);
      const exclusionSignature=[...excluded.keys()].slice(0,50).join('|');if(exclusionSignature===previousExclusions)break;previousExclusions=exclusionSignature;
      status('正在按摄像头区域重新寻路，第 '+(round+1)+' 轮；已检查 '+routes.length+' 条候选…','loading');
      try{requests++;const more=(await fetchAvoidRoute([origin,destination],[...excluded.values()],radius,active.signal)).filter(r=>r.distance<Math.max(baselineDistance*2.5,baselineDistance+12000));for(const r of more)r.hits=checkCandidate(r,radius);if(!more.length)break;avoidCandidate=more.sort((a,b)=>a.hits.length-b.hits.length||a.duration-b.duration)[0];add(more);}catch(e){if(active.signal.aborted)throw e;partialError=e.message;break;}
    }
    const trials=[{f:.5,d:1400,s:1},{f:.5,d:1400,s:-1}];
    for(const trial of trials){
      if(routes[0].hits.length===0)break;
      if(active.signal.aborted)throw new DOMException('Stopped','AbortError');
      status('已检查 '+routes.length+' 条候选路线，正在尝试途经点绕行…','loading');
      const best=routes[0],coords=best.geometry.coordinates;
      const hit=best.hits[Math.floor(best.hits.length/2)],f=hit?Math.max(.12,Math.min(.88,hit.segment/(coords.length-1))):trial.f;
      const via=detourPoint(coords,requests<3?f:trial.f,trial.d,trial.s);
      if(!inBeijing(via))continue;
      // Retain earlier useful detours, in route order, to avoid undoing previous improvements.
      const existing=best.via||[];const chain=[...existing,via].slice(-3).map(p=>({p,i:coords.reduce((best,q,i)=>Math.hypot(q[0]-p[0],q[1]-p[1])<best.d?{i,d:Math.hypot(q[0]-p[0],q[1]-p[1])}:best,{i:0,d:Infinity}).i})).sort((a,b)=>a.i-b.i).map(x=>x.p);
      try{requests++;const more=await fetchRoutes([origin,...chain,destination],active.signal);add(more.filter(r=>r.distance<Math.max(baselineDistance*2.5,baselineDistance+12000)));}catch(e){if(active.signal.aborted)throw e;partialError=e.message;}
    }
    if(token!==planningVersion)return;
    routes=routes.slice(0,5);selected=0;renderRoutes();fit();
    const hitCount=routes[0].hits.length;
    status(hitCount===0?'找到避开当前已收录点位的路线（'+radius+' 米缓冲区）。请结合路况与通行规定判断。':'已检查 '+seen.size+' 条候选路线，未找到完全避让方案。最少仍接近 '+hitCount+' 个点位；下方路线仅供比较。'+(partialError?' 部分绕行请求未成功，可稍后重试。':''),hitCount?'warning':'');
  }catch(e){if(token!==planningVersion)return;if(active.signal.aborted){status('路线搜索已停止。','warning');}else{status(e.name==='TimeoutError'?'路线服务响应超时，请稍后重试。':e.message,'error');}$('welcome').hidden=false;}
  finally{if(token===planningVersion)setBusy(false);}
}
function renderRoutes(){
  $('routes').hidden=false;$('routeCount').textContent=routes.length+' 个候选';$('routeCards').replaceChildren();
  routes.forEach((r,i)=>{const b=document.createElement('button');b.type='button';b.className='route-card'+(selected===i?' active':'');b.setAttribute('aria-pressed',String(selected===i));b.innerHTML='<div class="route-top"><span class="route-title">'+(i===0?(r.hits.length?'点位较少方案':'推荐避让方案'):'备选方案 '+(i+1))+'</span><span class="route-chip '+(!r.hits.length?'clear':'')+'">'+(r.hits.length?r.hits.length+' 个临近点位':'已避开收录点位')+'</span></div><div class="route-main"><strong>'+Math.ceil(r.duration/60)+'</strong><small>分钟</small><span class="sep">/</span><strong>'+(r.distance/1000).toFixed(1)+'</strong><small>公里</small></div><p class="route-meta">'+(r.hits.length?'仍有点位进入 '+$('radius').value+' 米缓冲区':'全线未进入 '+$('radius').value+' 米点位缓冲区')+' · 无实时路况</p>';b.onclick=()=>{selected=i;renderRoutes();fit();};$('routeCards').appendChild(b);});
  if(map){routeLayer.clearLayers();routes.forEach((r,i)=>{if(i===selected)return;L.polyline(r.geometry.coordinates.map(p=>[p[1],p[0]]),{color:'#91a595',weight:3,opacity:.55}).addTo(routeLayer);});const r=routes[selected];L.polyline(r.geometry.coordinates.map(p=>[p[1],p[0]]),{color:'white',weight:9,opacity:.95}).addTo(routeLayer);L.polyline(r.geometry.coordinates.map(p=>[p[1],p[0]]),{color:r.hits.length?'#b47f45':'#2d7963',weight:5,opacity:1}).addTo(routeLayer);r.hits.forEach(h=>L.circle([h.camera.point[1],h.camera.point[0]],{radius:+$('radius').value,weight:1,color:'#bc7352',fillOpacity:.14}).addTo(routeLayer).bindPopup(cameraPopup(h.camera)));}
  $('steps').replaceChildren();const verbs={'turn':'转弯','new name':'继续行驶','depart':'从起点出发','arrive':'到达终点','merge':'汇入','on ramp':'驶入匝道','off ramp':'驶出匝道','fork':'在岔路口行驶','roundabout':'驶入环岛','rotary':'驶入环岛','continue':'继续行驶','end of road':'在道路尽头转弯','notification':'注意道路变化','use lane':'按车道指示行驶','exit roundabout':'驶离环岛'};const modifiers={'left':'左转','right':'右转','slight left':'向左前方','slight right':'向右前方','sharp left':'向左急转','sharp right':'向右急转','straight':'直行','uturn':'掉头'};
  for(const step of routes[selected].legs.flatMap(l=>l.steps)){const li=document.createElement('li');li.textContent=(verbs[step.maneuver.type]||'沿道路行驶')+(step.maneuver.modifier?' · '+(modifiers[step.maneuver.modifier]||step.maneuver.modifier):'')+(step.name?'，'+step.name:'')+'（'+(step.distance>=1000?(step.distance/1000).toFixed(1)+' 公里':Math.round(step.distance)+' 米')+'）';$('steps').appendChild(li);}
}
function cameraPopup(c){return '<div class="camera-popup"><strong>'+esc(c.name)+'</strong><small>来源更新：'+esc(c.updated)+'<br>所有方向保守纳入检查</small><a href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer">查看原站详情 ↗</a></div>';}
function exportRoute(){const r=routes[selected];if(!r)return;const data={type:'FeatureCollection',metadata:{generated:new Date().toISOString(),source:'https://www.jinjing365.com/wap/',snapshot:cameraSnapshot?.updated,snapshotRevision:cameraSnapshot?.revision,bufferMeters:+$('radius').value,nearbyCameraCount:r.hits.length,note:r.hits.length?'未完全避开已收录点位':'仅通过当前快照的几何检查，不保证实际无摄像头'},features:[{type:'Feature',properties:{name:'京路路线',distanceMeters:r.distance,durationSeconds:r.duration},geometry:r.geometry},...r.hits.map(h=>({type:'Feature',properties:{name:h.camera.name,url:h.camera.url,distanceMeters:Math.round(h.distance)},geometry:{type:'Point',coordinates:h.camera.point}}))]};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/geo+json'})),a=document.createElement('a');a.href=url;a.download='京路-路线.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function applyCameraData(data){
  const changed=!cameraSnapshot||snapshotRevision(cameraSnapshot)!==snapshotRevision(data),hadData=!!index;cameraSnapshot=data;
  if(changed){
    if(hadData)invalidate();
    cameras=data.cameras.map(c=>({...c,point:gcjToWgs(c.gcj)}));index=makeIndex(cameras);
    if(cameraLayer){cameraLayer.clearLayers();cameraRenderer??=L.canvas({padding:.3});for(const c of cameras)L.circleMarker([c.point[1],c.point[0]],{renderer:cameraRenderer,radius:3,weight:1,color:'#fff',fillColor:'#be785b',fillOpacity:.8,bubblingMouseEvents:false}).addTo(cameraLayer).bindPopup(()=>cameraPopup(c));}
    if(hadData)status('摄像头点位已更新，请重新规划路线，以使用最新数据。','warning');
  }
  $('cameraCount').textContent=cameras.length.toLocaleString('en-US');$('sourceUpdated').textContent=data.updated.slice(5).replace('-','.');
  $('dataSummary').textContent=cameras.length.toLocaleString('en-US')+' 点位 · '+data.updated.replaceAll('-','.')+' 更新';
  $('aboutSourceUpdated').textContent=data.updated;$('aboutSourceFetched').textContent=data.fetched||'未知';
  if(!busy)$('plan').disabled=false;
}
function cameraDataState(state){
  const button=$('refreshCameras');button.disabled=state.kind==='checking';button.textContent=state.kind==='checking'?'检查中…':'更新';
  const note=$('cameraRefreshState');
  if(state.kind==='checking'){note.textContent='正在检查摄像头更新…';note.classList.remove('is-error');return;}
  const checked=state.checkedAt?new Date(state.checkedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'尚未成功检查';
  button.title='上次成功检查：'+checked+'；点击立即检查，自动检查间隔 24 小时。';
  if(state.kind==='error'){
    note.textContent=state.hasCache?'更新检查失败，继续使用已缓存点位；下次打开会重试。':'点位加载失败，请联网后点击“更新”重试。';note.classList.add('is-error');
    if(!state.hasCache){$('dataSummary').textContent='点位数据不可用';$('plan').disabled=true;status('摄像头数据加载失败，已暂停路线规划。请联网后重试。','error');}
  }else{note.textContent='上次检查 '+checked+' · 满 24 小时后再次打开将自动检查';note.classList.remove('is-error');}
}
function initMap(){
  if(!window.L){status('地图库未能加载，请刷新页面；仍可通过地点输入进行路线计算。','warning');return;}
  map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([39.943,116.39],11);L.control.zoom({position:'bottomright'}).addTo(map);
  let tileFailures=0,notice;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).on('tileerror',()=>{if(++tileFailures===5){notice=document.createElement('div');notice.className='map-error';notice.textContent='底图暂时加载失败，点位与路线计算仍可使用。';document.querySelector('.map-area').appendChild(notice);}}).on('tileload',()=>{notice?.remove();tileFailures=0;}).addTo(map);
  cameraLayer=L.layerGroup().addTo(map);routeLayer=L.layerGroup().addTo(map);endLayer=L.layerGroup().addTo(map);
  map.on('click',e=>{const p=[e.latlng.lng,e.latlng.lat];if(!inBeijing(p)){status('请在北京覆盖范围内选点。','warning');return;}setPoint(pick,p,(pick==='origin'?'地图起点':'地图终点')+' '+p.map(n=>n.toFixed(5)).join(', '),false);status((pick==='origin'?'起点':'终点')+'已设置。');if(pick==='origin')setPick('destination');});
}
async function init(){
  $('plan').disabled=true;initMap();
  amapShare=createAmapShare({getRoute:()=>({route:routes[selected],origin,destination,originName:$('origin').value,destinationName:$('destination').value}),onStatus:status});$('shareAmap').onclick=()=>amapShare.open();
  $('aboutBtn').onclick=()=>$('about').showModal();$('closeAbout').onclick=()=>$('about').close();$('about').onclick=e=>{if(e.target===$('about')){const r=$('about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('about').close();}};
  $('locate').onclick=locate;$('search').onclick=()=>search('destination');$('routeForm').onsubmit=plan;$('pickOrigin').onclick=()=>setPick('origin');$('pickDestination').onclick=()=>setPick('destination');$('fit').onclick=fit;$('export').onclick=exportRoute;
  $('cancel').onclick=()=>controller?.abort();$('radius').onchange=()=>{invalidate();status('避让半径已调整，请重新规划。','warning');};
  $('layers').onclick=()=>{showCameras=!showCameras;$('layers').setAttribute('aria-pressed',String(showCameras));if(map&&cameraLayer){if(showCameras)cameraLayer.addTo(map);else map.removeLayer(cameraLayer);}};
  for(const which of ['origin','destination'])autocomplete[which]=createAutocomplete({input:$(which),list:$(which+'Suggestions'),clear:$(which+'Clear'),localPlaces:query=>{
    const q=query.toLocaleLowerCase();const known=pois.filter(p=>p.name.toLocaleLowerCase().includes(q)).map(p=>({...p,kind:'常用地点'}));
    const nearby=q.length>=2?cameras.filter(c=>c.name.toLocaleLowerCase().includes(q)).slice(0,3).map(c=>({name:c.name,point:c.point,detail:'摄像头附近的道路位置 · 进京网',kind:'道路位置'})):[];
    return [...known,...nearby].slice(0,6);
  },onSelect:place=>{setPoint(which,place.point,place.name);status((which==='origin'?'起点':'目的地')+'已选定：'+place.name+(!origin?'。请设置起点或点击 ◎ 定位。':''));},onEdit:()=>{
    invalidate();if(which==='origin')origin=null;else destination=null;
    if(endpointMarkers[which]){endLayer?.removeLayer(endpointMarkers[which]);delete endpointMarkers[which];}
  }});
  for(const button of document.querySelectorAll('[data-place]'))button.onclick=()=>{const p=pois.find(x=>x.name===button.dataset.place);setPoint('destination',p.point,p.name);status('目的地已设置。'+(!origin?'请获取当前位置或设置起点。':''));};
  cameraData=createCameraData({onData:applyCameraData,onState:cameraDataState});
  const checkCameras=(force=false)=>cameraData.check({force}).catch(()=>{});
  $('refreshCameras').onclick=()=>checkCameras(true);
  window.addEventListener('pageshow',()=>checkCameras());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkCameras();});
  await checkCameras();
}
init();
