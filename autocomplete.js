import {inBeijing} from './geo.js?v=20261104-amap';

// Photon explicitly supports search-as-you-type. Keep requests sparse and cache within this page only.
const cache=new Map();let lastRequestAt=0;
const types={station:'车站',stop:'交通站点',subway_entrance:'地铁出入口',bus_stop:'公交站',aerodrome:'机场',terminal:'航站楼',hospital:'医院',school:'学校',university:'大学',park:'公园',mall:'商场',hotel:'酒店',restaurant:'餐厅',residential:'住宅',office:'办公楼',museum:'博物馆',attraction:'景点',supermarket:'超市',parking:'停车场',town:'地区',suburb:'地区',neighbourhood:'社区'};
export function photonPlaces(data){
  return (data.features||[]).filter(f=>f.geometry?.type==='Point'&&inBeijing(f.geometry.coordinates)).map(f=>{
    const p=f.properties||{},name=p.name||[p.street,p.housenumber].filter(Boolean).join(' ')||'地图地点';
    const parts=[p.city,p.county,p.district,p.locality,p.street,p.housenumber].filter(Boolean);
    return {name,point:f.geometry.coordinates,detail:[...new Set(parts)].join(' · ')||'北京市',kind:types[p.osm_value]||(p.osm_key==='highway'?'道路':'地点'),source:'Photon / OpenStreetMap'};
  });
}
export function mergePlaces(query,local,remote){
  const result=[],q=query.trim().toLocaleLowerCase();
  const sorted=[...local.filter(p=>p.name.toLocaleLowerCase()===q),...remote,...local.filter(p=>p.name.toLocaleLowerCase()!==q)];
  for(const p of sorted){if(!inBeijing(p.point))continue;if(result.some(x=>x.name===p.name&&Math.hypot((x.point[0]-p.point[0])*.77,x.point[1]-p.point[1])*111320<160))continue;result.push(p);if(result.length===8)break;}
  return result;
}
function highlighted(name,query){
  const text=document.createElement('span'),i=name.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if(i<0||!query){text.textContent=name;return text;}
  text.append(document.createTextNode(name.slice(0,i)));const mark=document.createElement('mark');mark.textContent=name.slice(i,i+query.length);text.append(mark,document.createTextNode(name.slice(i+query.length)));return text;
}
export function createAutocomplete({input,list,clear,localPlaces,onSelect,onEdit,onStatus}){
  let timer,request,version=0,composing=false,items=[],active=-1,selectedName='',footer='';
  const row=input.closest('.field-row');
  function stop(){clearTimeout(timer);request?.abort();request=null;version++;}
  function close(){stop();list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');row.classList.remove('search-active');active=-1;}
  function current(query,token){return token===version&&input.value.trim()===query&&document.activeElement===input;}
  function highlight(index){
    active=index;const options=list.querySelectorAll('[role="option"]');
    options.forEach((option,i)=>{option.setAttribute('aria-selected',String(i===index));option.classList.toggle('is-active',i===index);});
    if(index>=0&&options[index]){input.setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
  }
  function choose(place){close();input.value=place.name;selectedName=place.name;clear.hidden=false;onSelect(place);}
  function render(next,message=''){
    const previous=items[active];items=next;footer=message;active=-1;input.removeAttribute('aria-activedescendant');list.replaceChildren();
    const query=input.value.trim();
    for(const [i,place] of items.entries()){
      const button=document.createElement('button');button.type='button';button.className='place-option';button.id=input.id+'-option-'+i;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.tabIndex=-1;
      const pin=document.createElement('span');pin.className='place-pin';pin.textContent='⌖';pin.setAttribute('aria-hidden','true');
      const content=document.createElement('span');content.className='place-text';const name=document.createElement('span');name.className='place-name';name.append(highlighted(place.name,query));
      if(place.kind){const tag=document.createElement('small');tag.className='place-kind';tag.textContent=place.kind;name.append(tag);}
      const address=document.createElement('span');address.className='place-address';address.textContent=place.detail||'北京市';content.append(name,address);
      const arrow=document.createElement('span');arrow.className='place-choose';arrow.textContent='↖';arrow.setAttribute('aria-hidden','true');button.append(pin,content,arrow);
      button.addEventListener('pointerdown',e=>e.preventDefault());button.addEventListener('click',()=>choose(place));list.append(button);
    }
    if(footer){const note=document.createElement('p');note.className='place-search-note';note.setAttribute('role','status');note.textContent=footer;list.append(note);}
    list.hidden=false;input.setAttribute('aria-expanded','true');row.classList.add('search-active');
    if(previous){const i=items.findIndex(p=>p.name===previous.name&&p.point[0]===previous.point[0]&&p.point[1]===previous.point[1]);if(i>=0)highlight(i);}
  }
  async function remote(query,token){
    const wait=800-(Date.now()-lastRequestAt);if(wait>0){timer=setTimeout(()=>remote(query,token),wait);return;}
    if(!current(query,token))return;
    lastRequestAt=Date.now();request=new AbortController();const controller=request;
    try{
      const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:query,bbox:'115.4,39.4,117.6,41.1',limit:'8',lon:'116.4',lat:'39.92'});
      const response=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
      if(!response.ok)throw new Error('地点服务暂时不可用');
      const results=photonPlaces(await response.json());cache.set(query,results);if(cache.size>60)cache.delete(cache.keys().next().value);
      if(!current(query,token))return;
      const combined=mergePlaces(query,localPlaces(query),results);render(combined,combined.length?'北京范围 · 地点数据 © OpenStreetMap':'未找到地点，试试完整名称或更具体的地址');
    }catch(e){if(controller.signal.aborted||!current(query,token))return;const local=localPlaces(query);render(local,local.length?'在线联想暂不可用，可选择以上地点或在地图上选点':'在线联想暂不可用，请重试或在地图上选点');}
  }
  function search({immediate=false}={}){
    stop();const query=input.value.trim();clear.hidden=!input.value;
    if(!query){if(immediate)render(localPlaces(''),'输入地点名称，自动显示北京范围内的建议');else close();return;}
    const coords=query.split(/[,，\s]+/).map(Number);
    if(coords.length===2&&inBeijing(coords)){const place={name:'地图坐标 '+coords.map(n=>n.toFixed(5)).join(', '),point:coords,detail:'WGS-84 经纬度',kind:'坐标'};if(immediate)choose(place);else render([place],'点击选择此坐标');return;}
    if(query.length<2){render(localPlaces(query),'继续输入至少 2 个字，搜索更多地点');return;}
    const saved=cache.get(query),local=localPlaces(query);
    if(saved){const combined=mergePlaces(query,local,saved);render(combined,combined.length?'北京范围 · 地点数据 © OpenStreetMap':'未找到地点，试试更具体的地址');return;}
    render(local,'正在搜索北京范围内的地点…');const token=version;timer=setTimeout(()=>remote(query,token),immediate?0:450);
  }
  function edited(){stop();selectedName='';clear.hidden=!input.value;onEdit();if(composing){close();return;}search();}
  input.addEventListener('input',edited);
  input.addEventListener('compositionstart',()=>{composing=true;stop();});
  input.addEventListener('compositionend',()=>{composing=false;search();});
  input.addEventListener('focus',()=>{if(input.value!==selectedName||!input.value)search();});
  input.addEventListener('keydown',e=>{
    if(composing||e.isComposing||e.keyCode===229)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(list.hidden)search();if(items.length)highlight(active<0?(e.key==='ArrowDown'?0:items.length-1):(active+(e.key==='ArrowDown'?1:-1)+items.length)%items.length);}
    else if(e.key==='Enter'){e.preventDefault();if(!list.hidden&&items.length)choose(items[active>=0?active:0]);else search({immediate:true});}
    else if(e.key==='Escape'){e.preventDefault();close();}
    else if(e.key==='Tab')close();
  });
  input.addEventListener('blur',()=>setTimeout(()=>{if(!row.contains(document.activeElement))close();},0));
  clear.addEventListener('pointerdown',e=>e.preventDefault());clear.addEventListener('click',()=>{input.value='';input.focus();edited();});
  document.addEventListener('pointerdown',e=>{if(!row.contains(e.target))close();});
  return {search:()=>{input.focus();search({immediate:true});},close,setSelected(name){close();selectedName=name;clear.hidden=!input.value;}};
}
