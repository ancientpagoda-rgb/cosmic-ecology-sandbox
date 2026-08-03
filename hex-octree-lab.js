import { createWorldState } from './core/world-core/world-state.js';
import { createHexSphereGrid } from './core/world-core/hex-sphere-grid.js';
import { createOctree } from './core/world-core/octree.js';
import { createHexPlanetModule } from './core/world-core/modules/hex-planet.js';

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const ui = Object.fromEntries(['cells','hexes','pentagons','nodes','selected','neighbors','nearby','depth','age','rivers','forest','cities','population','roads'].map(id=>[id,document.getElementById(id)]));
const grid = createHexSphereGrid(3);
const octree = createOctree({x:0,y:0,z:0,half:1.1},{capacity:10,maxDepth:7});
for (const cell of grid.cells) octree.insert({ id: cell.id, position: cell.position, cell });
const world = createWorldState({ seed: 'hex-world-1' });
const planet = createHexPlanetModule(grid, octree);
world.registerModule(planet);

let rx=-0.18, ry=0.5, pointer=null, lx=0, ly=0, selected=null, moved=false;
let last=performance.now(), accumulator=0;
canvas.addEventListener('pointerdown',e=>{pointer=e.pointerId;lx=e.clientX;ly=e.clientY;moved=false;canvas.setPointerCapture?.(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;const dx=e.clientX-lx,dy=e.clientY-ly;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;ry+=dx*.01;rx+=dy*.01;rx=Math.max(-1.35,Math.min(1.35,rx));lx=e.clientX;ly=e.clientY});
canvas.addEventListener('pointerup',e=>{if(e.pointerId!==pointer)return;pointer=null;if(!moved)selectAt(e)});
canvas.addEventListener('pointercancel',()=>pointer=null);

document.getElementById('step')?.addEventListener('click',()=>{for(let i=0;i<5;i++)world.step(20);updateStats()});

function selectAt(e){
 const rect=canvas.getBoundingClientRect(), dpr=canvas.width/rect.width;
 const px=(e.clientX-rect.left)*dpr, py=(e.clientY-rect.top)*dpr;
 let best=null,bestD=18*dpr;
 for(const cell of grid.cells){const p=project(cell.position);if(p.z<=0)continue;const d=Math.hypot(px-p.x,py-p.y);if(d<bestD){best=cell;bestD=d}}
 selected=best;
 if(best){const inspection=planet.inspectCell(best.id);ui.selected.textContent=`#${best.id} ${best.kind} · ${biome(best)}`;ui.neighbors.textContent=best.neighbors.length;ui.nearby.textContent=inspection.nearbyCount}
}

function project([x0,y0,z0]){
 const cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx);
 let x=x0*cy-z0*sy, z=x0*sy+z0*cy, y=y0;
 const y2=y*cx-z*sx, z2=y*sx+z*cx; y=y2; z=z2;
 const r=Math.min(canvas.width,canvas.height)*.42;
 return {x:canvas.width/2+x*r,y:canvas.height/2-y*r,z};
}

function cellColor(cell){
 if(cell.elevation < planet.getSeaLevel()) return [24,74,108];
 if(cell.fire > .1) return [195,82,40];
 if(cell.flow > .06) return [36,125,169];
 if(cell.settlementId) return [225,184,105];
 if(cell.elevation > .78) return [172,170,159];
 const dry=1-cell.moisture, green=cell.vegetation;
 return [70+dry*70-green*30,82+green*95-dry*18,52+green*35];
}
function biome(cell){
 if(cell.elevation < planet.getSeaLevel()) return 'ocean';
 if(cell.elevation > .78) return 'alpine';
 if(cell.moisture < .22) return 'desert';
 if(cell.vegetation > .62) return 'forest';
 if(cell.vegetation > .25) return 'grassland';
 return 'barren';
}

function drawRoads(){
 const settlements=new Map(planet.getSettlements().map(s=>[s.id,s]));
 ctx.strokeStyle='rgba(205,205,190,.45)';ctx.lineWidth=1;
 for(const road of planet.getRoads()){
   const a=settlements.get(road.aId),b=settlements.get(road.bId);if(!a?.alive||!b?.alive)continue;
   const points=road.path.map(id=>project(grid.cells[id].position)).filter(p=>p.z>0);
   if(points.length<2)continue;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();
 }
}

function frame(now){
 requestAnimationFrame(frame);
 const dt=Math.min(.1,(now-last)/1000);last=now;accumulator+=dt*2;
 while(accumulator>=.2){world.step(20);accumulator-=.2}
 const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 ctx.fillStyle='#071018';ctx.fillRect(0,0,w,h);
 const visible=[];
 for(const cell of grid.cells){const p=project(cell.position);if(p.z>0)visible.push({cell,p})}
 visible.sort((a,b)=>a.p.z-b.p.z);
 for(const {cell,p} of visible){
   const color=cellColor(cell), light=.38+.62*p.z, size=2.2+3.8*p.z;
   ctx.fillStyle=`rgb(${Math.round(color[0]*light)},${Math.round(color[1]*light)},${Math.round(color[2]*light)})`;
   ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.fill();
   if(cell.kind==='pentagon'){ctx.strokeStyle='rgba(240,135,135,.75)';ctx.lineWidth=1;ctx.stroke()}
   if(cell===selected){ctx.strokeStyle='#fff1bd';ctx.lineWidth=2.5;ctx.stroke()}
 }
 drawRoads();
 const r=Math.min(w,h)*.42;ctx.strokeStyle='rgba(110,175,215,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(w/2,h/2,r,0,Math.PI*2);ctx.stroke();
 updateStats();
}

function updateStats(){
 const settlements=planet.getSettlements().filter(s=>s.alive);
 ui.age.textContent=`${Math.round(world.getTimeYears()).toLocaleString()} yr`;
 ui.rivers.textContent=grid.cells.filter(c=>c.flow>.06).length;
 ui.forest.textContent=`${Math.round(grid.cells.reduce((s,c)=>s+c.vegetation,0)/grid.cells.length*100)}%`;
 ui.cities.textContent=settlements.length;
 ui.population.textContent=Math.round(settlements.reduce((s,c)=>s+c.population,0)).toLocaleString();
 ui.roads.textContent=planet.getRoads().length;
}

const s=octree.stats();ui.cells.textContent=grid.cells.length;ui.hexes.textContent=grid.hexagons.length;ui.pentagons.textContent=grid.pentagons.length;ui.nodes.textContent=s.nodes;ui.depth.textContent=s.deepest;
window.realitySandboxHexWorld={world,grid,octree,planet};
updateStats();
requestAnimationFrame(frame);
