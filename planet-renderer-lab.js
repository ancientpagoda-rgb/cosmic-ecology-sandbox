import { createWorldState } from './core/world-core/world-state.js';
import { createHexSphereGrid } from './core/world-core/hex-sphere-grid.js';
import { createOctree } from './core/world-core/octree.js';
import { createHexPlanetModule } from './core/world-core/modules/hex-planet.js';

const canvas=document.getElementById('planet'),ctx=canvas.getContext('2d');
const ui=Object.fromEntries(['zoom','relief','speed','debug','lod','faces','age','rivers','cities','forest','snow','desert','hexes','nodes'].map(id=>[id,document.getElementById(id)]));
const simGrid=createHexSphereGrid(3);
const octree=createOctree({x:0,y:0,z:0,half:1.2},{capacity:10,maxDepth:7});
for(const cell of simGrid.cells)octree.insert({id:cell.id,position:cell.position,cell});
const world=createWorldState({seed:'planet-renderer-2'});
const planet=createHexPlanetModule(simGrid,octree);
world.registerModule(planet);
const meshes=new Map([[2,createHexSphereGrid(2)],[3,createHexSphereGrid(3)],[4,createHexSphereGrid(4)]]);
const sampleCache=new WeakMap();
let rx=-.18,ry=.5,pointer=null,lx=0,ly=0,debug=false,last=performance.now(),acc=0;

ui.debug.addEventListener('click',()=>{debug=!debug;ui.debug.textContent=debug?'Hide hex grid':'Show hex grid'});
canvas.addEventListener('pointerdown',e=>{pointer=e.pointerId;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture?.(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;ry+=(e.clientX-lx)*.009;rx+=(e.clientY-ly)*.009;rx=Math.max(-1.35,Math.min(1.35,rx));lx=e.clientX;ly=e.clientY});
canvas.addEventListener('pointerup',e=>{if(e.pointerId===pointer)pointer=null});
canvas.addEventListener('pointercancel',()=>pointer=null);

function chooseLod(){const z=Number(ui.zoom.value);return z>.68?4:z>.3?3:2}
function sampleCell(mesh,vertexIndex){let cache=sampleCache.get(mesh);if(!cache){cache=new Map();sampleCache.set(mesh,cache)}if(cache.has(vertexIndex))return cache.get(vertexIndex);const hit=octree.nearest(mesh.cells[vertexIndex].position,.35)?.item?.cell||simGrid.cells[0];cache.set(vertexIndex,hit);return hit}
function transform([x0,y0,z0],radius){const cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx);let x=x0*cy-z0*sy,z=x0*sy+z0*cy,y=y0;const y2=y*cx-z*sx,z2=y*sx+z*cx;return [x*radius,y2*radius,z2*radius]}
function project(v,w,h,scale){return{x:w/2+v[0]*scale,y:h/2-v[1]*scale,z:v[2]}}
function cellColor(c){if(c.elevation<planet.getSeaLevel())return[22,67,100];if(c.fire>.1)return[188,75,39];if(c.temperature<.18||c.elevation>.82)return[224,229,232];if(c.flow>.055)return[35,119,164];if(c.settlementId)return[222,176,92];if(c.moisture<.22)return[169,139,76];if(c.vegetation>.58)return[44,105,59];if(c.vegetation>.24)return[79,121,68];return[105,103,77]}
function mix3(a,b,c){return a.map((v,i)=>(v+b[i]+c[i])/3)}

function render(){
 const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.4),w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 ctx.fillStyle='#050b12';ctx.fillRect(0,0,w,h);
 const lod=chooseLod(),mesh=meshes.get(lod),zoom=Number(ui.zoom.value),relief=Number(ui.relief.value),scale=Math.min(w,h)*(.34+zoom*.13);
 const verts=mesh.cells.map((cell,i)=>{const s=sampleCell(mesh,i);const radius=1+(s.elevation-planet.getSeaLevel())*.16*relief;return{p:project(transform(cell.position,radius),w,h,scale),cell:s}});
 const faces=[];
 for(const f of mesh.faces){const a=verts[f[0]],b=verts[f[1]],c=verts[f[2]],z=(a.p.z+b.p.z+c.p.z)/3;if(z<=-.18)continue;faces.push({a,b,c,z})}
 faces.sort((a,b)=>a.z-b.z);
 for(const f of faces){const base=mix3(cellColor(f.a.cell),cellColor(f.b.cell),cellColor(f.c.cell));const light=Math.max(.28,Math.min(1.15,.42+f.z*.7));ctx.fillStyle=`rgb(${Math.round(base[0]*light)},${Math.round(base[1]*light)},${Math.round(base[2]*light)})`;ctx.beginPath();ctx.moveTo(f.a.p.x,f.a.p.y);ctx.lineTo(f.b.p.x,f.b.p.y);ctx.lineTo(f.c.p.x,f.c.p.y);ctx.closePath();ctx.fill()}
 drawRivers(w,h,scale,relief);drawCities(w,h,scale,relief);if(debug)drawHexOverlay(w,h,scale);
 const r=scale*1.02;const glow=ctx.createRadialGradient(w/2-r*.28,h/2-r*.32,r*.2,w/2,h/2,r*1.08);glow.addColorStop(0,'rgba(255,255,255,0)');glow.addColorStop(.86,'rgba(50,115,165,.02)');glow.addColorStop(1,'rgba(70,145,205,.3)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(w/2,h/2,r*1.04,0,Math.PI*2);ctx.fill();
 ui.lod.textContent=`Level ${lod}`;ui.faces.textContent=faces.length.toLocaleString();
}
function drawRivers(w,h,scale,relief){ctx.strokeStyle='rgba(55,145,195,.85)';ctx.lineWidth=Math.max(1,scale/260);for(const c of simGrid.cells){if(c.flow<.055||c.elevation<planet.getSeaLevel())continue;let target=null;for(const id of c.neighbors){const n=simGrid.cells[id];if(!target||n.elevation<target.elevation)target=n}if(!target)continue;const ra=1+(c.elevation-planet.getSeaLevel())*.16*relief,rb=1+(target.elevation-planet.getSeaLevel())*.16*relief,a=project(transform(c.position,ra),w,h,scale),b=project(transform(target.position,rb),w,h,scale);if(a.z<=0||b.z<=0)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}
function drawCities(w,h,scale,relief){for(const s of planet.getSettlements()){if(!s.alive)continue;const c=simGrid.cells[s.cellId],r=1+(c.elevation-planet.getSeaLevel())*.16*relief,p=project(transform(c.position,r*1.01),w,h,scale);if(p.z<=0)continue;const size=2+Math.log10(s.population+1)*1.5;ctx.fillStyle='#f3c879';ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.fill()}}
function drawHexOverlay(w,h,scale){ctx.strokeStyle='rgba(205,225,240,.22)';ctx.lineWidth=.7;const seen=new Set();for(const c of simGrid.cells){const a=project(transform(c.position,1.01),w,h,scale);if(a.z<=0)continue;for(const id of c.neighbors){const key=c.id<id?`${c.id}:${id}`:`${id}:${c.id}`;if(seen.has(key))continue;seen.add(key);const b=project(transform(simGrid.cells[id].position,1.01),w,h,scale);if(b.z<=0)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}}
function updateStats(){const cells=simGrid.cells,cities=planet.getSettlements().filter(s=>s.alive);ui.age.textContent=`${Math.round(world.getTimeYears()).toLocaleString()} yr`;ui.rivers.textContent=cells.filter(c=>c.flow>.055).length;ui.cities.textContent=cities.length;ui.forest.textContent=`${Math.round(cells.reduce((s,c)=>s+c.vegetation,0)/cells.length*100)}%`;ui.snow.textContent=cells.filter(c=>c.temperature<.18||c.elevation>.82).length;ui.desert.textContent=cells.filter(c=>c.elevation>=planet.getSeaLevel()&&c.moisture<.22).length;ui.hexes.textContent=cells.length;ui.nodes.textContent=octree.stats().nodes}
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.1,(now-last)/1000);last=now;acc+=dt*Number(ui.speed.value);while(acc>=.22){world.step(20);acc-=.22}render();updateStats()}
window.realitySandboxPlanetRenderer={world,planet,simGrid,octree};requestAnimationFrame(frame);
