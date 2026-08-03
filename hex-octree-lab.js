import { createHexSphereGrid } from './core/world-core/hex-sphere-grid.js';
import { createOctree } from './core/world-core/octree.js';

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const ui = Object.fromEntries(['cells','hexes','pentagons','nodes','selected','neighbors','nearby','depth'].map(id=>[id,document.getElementById(id)]));
const grid = createHexSphereGrid(3);
const octree = createOctree({x:0,y:0,z:0,half:1.1},{capacity:10,maxDepth:7});
for (const cell of grid.cells) octree.insert({ id: cell.id, position: cell.position, cell });

let rx=-0.18, ry=0.5, pointer=null, lx=0, ly=0, selected=null;
canvas.addEventListener('pointerdown',e=>{pointer=e.pointerId;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture?.(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;ry+=(e.clientX-lx)*.01;rx+=(e.clientY-ly)*.01;rx=Math.max(-1.35,Math.min(1.35,rx));lx=e.clientX;ly=e.clientY});
canvas.addEventListener('pointerup',e=>{if(e.pointerId!==pointer)return;pointer=null;selectAt(e)});
canvas.addEventListener('pointercancel',()=>pointer=null);

function selectAt(e){
 const rect=canvas.getBoundingClientRect(), dpr=canvas.width/rect.width;
 const px=(e.clientX-rect.left)*dpr, py=(e.clientY-rect.top)*dpr;
 let best=null,bestD=18*dpr;
 for(const cell of grid.cells){const p=project(cell.position);if(!p||p.z<=0)continue;const d=Math.hypot(px-p.x,py-p.y);if(d<bestD){best=cell;bestD=d}}
 selected=best;
 if(best){const near=octree.querySphere(best.position,.22);ui.selected.textContent=`#${best.id} ${best.kind}`;ui.neighbors.textContent=best.neighbors.length;ui.nearby.textContent=near.length}
}

function project([x0,y0,z0]){
 const cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx);
 let x=x0*cy-z0*sy, z=x0*sy+z0*cy, y=y0;
 const y2=y*cx-z*sx, z2=y*sx+z*cx; y=y2; z=z2;
 const r=Math.min(canvas.width,canvas.height)*.42;
 return {x:canvas.width/2+x*r,y:canvas.height/2-y*r,z};
}

function frame(){
 requestAnimationFrame(frame);
 const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 ctx.fillStyle='#071018';ctx.fillRect(0,0,w,h);
 const visible=[];
 for(const cell of grid.cells){const p=project(cell.position);if(p.z>0)visible.push({cell,p})}
 visible.sort((a,b)=>a.p.z-b.p.z);
 for(const {cell,p} of visible){
   const size=2.2+3.8*p.z;
   ctx.fillStyle=cell===selected?'#ffd27a':cell.kind==='pentagon'?'#d77a7a':`rgba(92,165,190,${.28+.62*p.z})`;
   ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.fill();
   if(cell===selected){ctx.strokeStyle='#fff1bd';ctx.lineWidth=2;ctx.stroke()}
 }
 const r=Math.min(w,h)*.42;ctx.strokeStyle='rgba(110,175,215,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(w/2,h/2,r,0,Math.PI*2);ctx.stroke();
}

const s=octree.stats();ui.cells.textContent=grid.cells.length;ui.hexes.textContent=grid.hexagons.length;ui.pentagons.textContent=grid.pentagons.length;ui.nodes.textContent=s.nodes;ui.depth.textContent=s.deepest;
requestAnimationFrame(frame);
