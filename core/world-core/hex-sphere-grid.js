export function createHexSphereGrid(subdivisions = 3) {
  const { vertices, faces } = createIcosphere(Math.max(0, Math.min(5, subdivisions)));
  const neighbors = Array.from({ length: vertices.length }, () => new Set());
  for (const [a, b, c] of faces) {
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }
  const cells = vertices.map((position, id) => ({
    id,
    position,
    neighbors: [...neighbors[id]],
    sides: neighbors[id].size,
    kind: neighbors[id].size === 5 ? 'pentagon' : 'hexagon',
    elevation: 0,
    moisture: 0,
    biome: 'unknown',
  }));
  return {
    cells,
    faces,
    pentagons: cells.filter(cell => cell.sides === 5),
    hexagons: cells.filter(cell => cell.sides === 6),
  };
}

function createIcosphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  let vertices = [
    [-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],
    [0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],
    [t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1],
  ].map(normalize);
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  for (let level = 0; level < subdivisions; level++) {
    const midpointCache = new Map();
    const nextFaces = [];
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (midpointCache.has(key)) return midpointCache.get(key);
      const point = normalize([
        (vertices[a][0] + vertices[b][0]) / 2,
        (vertices[a][1] + vertices[b][1]) / 2,
        (vertices[a][2] + vertices[b][2]) / 2,
      ]);
      const index = vertices.length;
      vertices.push(point);
      midpointCache.set(key, index);
      return index;
    };
    for (const [a,b,c] of faces) {
      const ab = midpoint(a,b), bc = midpoint(b,c), ca = midpoint(c,a);
      nextFaces.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);
    }
    faces = nextFaces;
  }
  return { vertices, faces };
}

function normalize([x,y,z]) {
  const length = Math.hypot(x,y,z) || 1;
  return [x/length,y/length,z/length];
}
