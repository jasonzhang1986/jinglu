import {wgsToGcj,inBeijing} from './geo.js?v=20261104-amap';

const distance=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos(a[1]*Math.PI/180),a[1]-b[1])*111320;
const cleanName=(name,fallback)=>String(name||fallback).replace(/[,|\r\n]/g,' ').trim().slice(0,80)||fallback;
function format(point){return wgsToGcj(point).map(n=>n.toFixed(6));}
function webUrl(from,to,via){
  const named=p=>[...format(p.point),p.name].join(',');
  const params=new URLSearchParams({from:named(from),to:named(to),mode:'car',policy:'0',src:'jinglu',callnative:'1'});
  if(via)params.set('via',named(via));
  return 'https://uri.amap.com/navigation?'+params;
}
function nativeUrl(from,to,via,platform){
  const s=format(from.point),d=format(to.point),v=via.map(p=>({point:format(p.point),name:p.name}));
  const params=new URLSearchParams({sourceApplication:'京路',slon:s[0],slat:s[1],sname:from.name,dlon:d[0],dlat:d[1],dname:to.name,dev:'0',t:'0',m:'0'});
  if(v.length){params.set('vian',String(v.length));params.set('vialons',v.map(x=>x.point[0]).join('|'));params.set('vialats',v.map(x=>x.point[1]).join('|'));params.set('vianames',v.map(x=>x.name).join('|'));}
  return (platform==='ios'?'iosamap://path?':'amapuri://route/plan/?')+params;
}
export function buildAmapHandoff({route,origin,destination,originName,destinationName}){
  if(!route?.geometry?.coordinates?.length||!inBeijing(origin)||!inBeijing(destination))throw new Error('请先完成路线规划，再分享到高德。');
  const coords=route.geometry.coordinates;
  if(!coords.every(inBeijing))throw new Error('当前路线有坐标超出覆盖范围，暂时无法分享到高德。');
  const from={point:origin,name:cleanName(originName,'起点')},to={point:destination,name:cleanName(destinationName,'终点')};
  const waypoints=[];
  // Prefer the routing engine's road positions rather than off-road detour request positions.
  for(const point of route.via||[]){
    if(!inBeijing(point))throw new Error('当前路线含无效途经点，请重新规划。');
    let closest=0;for(let i=1;i<coords.length;i++)if(distance(point,coords[i])<distance(point,coords[closest]))closest=i;
    waypoints.push({point:coords[closest],index:closest});
  }
  // With no explicit detour, retain an on-road midpoint to help keep the chosen route's shape.
  if(!waypoints.length&&coords.length>2){
    let total=0;const lengths=[0];for(let i=1;i<coords.length;i++){total+=distance(coords[i-1],coords[i]);lengths.push(total);}
    if(total>300){const i=lengths.findIndex(n=>n>=total/2);waypoints.push({point:coords[i],index:i});}
  }
  waypoints.sort((a,b)=>a.index-b.index);const via=[];
  for(const p of waypoints)if(distance(p.point,origin)>50&&distance(p.point,destination)>50&&!via.some(x=>distance(x.point,p.point)<50))via.push({...p,name:'路线途经点 '+(via.length+1)});
  const chain=[from,...via,to],segments=[];
  // Official web URI supports exactly one intermediate point. Retain every point across segments.
  for(let i=0;i<chain.length-1;i+=2){const end=Math.min(i+2,chain.length-1),segmentVia=end-i===2?chain[i+1]:null;segments.push({from:chain[i],to:chain[end],via:segmentVia,url:webUrl(chain[i],chain[end],segmentVia)});}
  return {from,to,via,segments,androidUrl:nativeUrl(from,to,via,'android'),iosUrl:nativeUrl(from,to,via,'ios'),nearbyCameraCount:route.hits?.length||0};
}
export function shareText(handoff){
  return ['京路 → 高德地图',handoff.from.name+' → '+handoff.to.name,'高德将重新算路，无法继承摄像头避让规则，请核对路线。',...handoff.segments.map((s,i)=>(handoff.segments.length>1?'第 '+(i+1)+' 段：'+s.from.name+' → '+s.to.name+'\n':'')+s.url)].join('\n\n');
}
export function createAmapShare({getRoute,onStatus}){
  const dialog=document.getElementById('amapShare'),list=document.getElementById('amapSegments'),native=document.getElementById('amapNative'),manual=document.getElementById('amapManualCopy');
  let handoff=null;
  const ua=navigator.userAgent,platform=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)?'ios':/Android/.test(ua)?'android':null;
  function showMessage(text){document.getElementById('amapMessage').textContent=text;}
  function open(){
    try{handoff=buildAmapHandoff(getRoute());}catch(e){onStatus(e.message,'warning');return;}
    manual.hidden=true;showMessage('');list.replaceChildren();
    document.getElementById('amapJourney').textContent=handoff.from.name+' → '+handoff.to.name;
    document.getElementById('amapSummary').textContent='携带起终点及 '+handoff.via.length+' 个路线途经点。'+(handoff.nearbyCameraCount?'当前方案仍临近 '+handoff.nearbyCameraCount+' 个已收录点位。':'');
    document.getElementById('amapWebHint').textContent=handoff.segments.length>1?'兼容网页链接已拆为 '+handoff.segments.length+' 段，请依次打开，保留所有途经点。':'手机浏览器打开链接时，会尝试调起高德 App；未安装可使用网页。';
    native.hidden=!platform;if(platform)native.href=platform==='ios'?handoff.iosUrl:handoff.androidUrl;
    for(const [i,s] of handoff.segments.entries()){
      const a=document.createElement('a');a.className='amap-web-link';a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=handoff.segments.length>1?'打开第 '+(i+1)+' 段：'+s.from.name+' → '+s.to.name:'在高德打开路线 ↗';list.append(a);
    }
    document.getElementById('amapCopy').textContent=handoff.segments.length>1?'复制全部分段链接':'复制高德路线链接';
    document.getElementById('amapSystemShare').hidden=typeof navigator.share!=='function';dialog.showModal();
  }
  document.getElementById('closeAmapShare').onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.getElementById('amapCopy').onclick=async()=>{
    if(!handoff)return;const text=shareText(handoff);
    try{if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');await navigator.clipboard.writeText(text);showMessage('已复制，可粘贴到手机或发送给自己。');}
    catch{manual.hidden=false;manual.value=text;manual.focus();manual.select();showMessage('浏览器未允许自动复制，请复制下方已选中的内容。');}
  };
  document.getElementById('amapSystemShare').onclick=async()=>{
    if(!handoff)return;
    try{await navigator.share({title:'京路 · 高德路线',text:shareText(handoff)});showMessage('已调用系统分享。');}catch(e){if(e.name!=='AbortError')showMessage('暂时无法调用系统分享，可使用复制链接。');}
  };
  return {open,close(){if(dialog.open)dialog.close();handoff=null;manual.value='';}};
}
