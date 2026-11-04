const PI = Math.PI;
function offset([lng, lat]) {
  const x=lng-105,y=lat-35;
  let a=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  let b=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  a+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
  b+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
  a+=(20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3;
  b+=(20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3;
  a+=(160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3;
  b+=(150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3;
  const rad=lat*PI/180,magic=1-.006693421622965943*Math.sin(rad)**2;
  return [b*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*PI),a*180/((6378245*(1-.006693421622965943))/(magic*Math.sqrt(magic))*PI)];
}
export function gcjToWgs(gcj) {
  let p=[...gcj];
  for(let i=0;i<5;i++){const d=offset(p);p=[p[0]+gcj[0]-(p[0]+d[0]),p[1]+gcj[1]-(p[1]+d[1])];}
  return p;
}
export function wgsToGcj(point) {
  if(point[0]<72.004||point[0]>137.8347||point[1]<.8293||point[1]>55.8271)return [...point];
  const delta=offset(point);return [point[0]+delta[0],point[1]+delta[1]];
}
export const inBeijing = p => Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=115.4&&p[0]<=117.6&&p[1]>=39.4&&p[1]<=41.1;
export function segmentDistance(p,a,b) {
  const kx=111320*Math.cos(p[1]*PI/180),ky=111320;
  const ax=(a[0]-p[0])*kx,ay=(a[1]-p[1])*ky,bx=(b[0]-p[0])*kx,by=(b[1]-p[1])*ky;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
  return Math.hypot(ax+t*dx,ay+t*dy);
}
export function makeIndex(cameras) {
  const cells=new Map();
  cameras.forEach((c,id)=>{const [x,y]=c.point.map(n=>Math.floor(n*100)),key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);});
  return {cameras,cells};
}
export function checkRoute(coords,index,radius) {
  const hits=new Map(),latpad=radius/110000,lonpad=radius/82000;
  for(let i=0;i<coords.length-1;i++){
    const a=coords[i],b=coords[i+1];
    const x0=Math.floor((Math.min(a[0],b[0])-lonpad)*100),x1=Math.floor((Math.max(a[0],b[0])+lonpad)*100);
    const y0=Math.floor((Math.min(a[1],b[1])-latpad)*100),y1=Math.floor((Math.max(a[1],b[1])+latpad)*100);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const id of index.cells.get(x+','+y)||[]){
      const distance=segmentDistance(index.cameras[id].point,a,b);
      if(distance<=radius&&(!hits.has(id)||distance<hits.get(id).distance))hits.set(id,{id,distance,segment:i,camera:index.cameras[id]});
    }
  }
  return [...hits.values()].sort((a,b)=>a.segment-b.segment);
}
export function detourPoint(coords,fraction,meters,side) {
  const i=Math.max(1,Math.min(coords.length-2,Math.floor((coords.length-1)*fraction)));
  const a=coords[Math.max(0,i-4)],b=coords[Math.min(coords.length-1,i+4)],p=coords[i];
  const dx=(b[0]-a[0])*Math.cos(p[1]*PI/180),dy=b[1]-a[1],n=Math.hypot(dx,dy)||1;
  return [p[0]+side*(-dy/n)*meters/(111320*Math.cos(p[1]*PI/180)),p[1]+side*(dx/n)*meters/111320];
}
export function avoidPolygons(cameras,radius) {
  // Public routing service limits total polygon perimeter. Keep a conservative 9 km budget.
  const pad=radius*1.15+5,count=Math.max(1,Math.floor(9000/(8*pad)));
  return cameras.slice(0,count).map(c=>{
    const [x,y]=c.point,dx=pad/(111320*Math.cos(y*PI/180)),dy=pad/111320;
    return [[x-dx,y-dy],[x+dx,y-dy],[x+dx,y+dy],[x-dx,y+dy],[x-dx,y-dy]].map(p=>p.map(n=>+n.toFixed(6)));
  });
}
