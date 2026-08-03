export function createOctree(bounds = { x: 0, y: 0, z: 0, half: 1.2 }, options = {}) {
  const capacity = options.capacity ?? 12;
  const maxDepth = options.maxDepth ?? 8;
  const root = createNode(bounds, 0);

  function insert(item) {
    if (!contains(root.bounds, item.position)) return false;
    insertInto(root, item);
    return true;
  }

  function insertInto(node, item) {
    if (!node.children && (node.items.length < capacity || node.depth >= maxDepth)) {
      node.items.push(item);
      return;
    }
    if (!node.children) subdivide(node);
    const child = node.children.find(candidate => contains(candidate.bounds, item.position));
    if (child) insertInto(child, item);
    else node.items.push(item);
  }

  function querySphere(center, radius) {
    const results = [];
    visitSphere(root, center, radius, results);
    return results;
  }

  function nearest(center, maxDistance = Infinity) {
    let best = null;
    let bestDistance = maxDistance;
    const candidates = querySphere(center, Number.isFinite(maxDistance) ? maxDistance : 3);
    for (const item of candidates) {
      const distance = dist(center, item.position);
      if (distance < bestDistance) { best = item; bestDistance = distance; }
    }
    return best ? { item: best, distance: bestDistance } : null;
  }

  function stats() {
    let nodes = 0;
    let leaves = 0;
    let items = 0;
    let deepest = 0;
    const walk = node => {
      nodes++; items += node.items.length; deepest = Math.max(deepest, node.depth);
      if (!node.children) leaves++;
      else node.children.forEach(walk);
    };
    walk(root);
    return { nodes, leaves, items, deepest };
  }

  return { insert, querySphere, nearest, stats, root };
}

function createNode(bounds, depth) {
  return { bounds: { ...bounds }, depth, items: [], children: null };
}
function subdivide(node) {
  const half = node.bounds.half / 2;
  node.children = [];
  for (const dx of [-1,1]) for (const dy of [-1,1]) for (const dz of [-1,1]) {
    node.children.push(createNode({
      x: node.bounds.x + dx * half,
      y: node.bounds.y + dy * half,
      z: node.bounds.z + dz * half,
      half,
    }, node.depth + 1));
  }
  const existing = node.items.splice(0);
  for (const item of existing) {
    const child = node.children.find(candidate => contains(candidate.bounds, item.position));
    if (child) child.items.push(item);
    else node.items.push(item);
  }
}
function visitSphere(node, center, radius, results) {
  if (!intersectsSphere(node.bounds, center, radius)) return;
  for (const item of node.items) if (dist(center, item.position) <= radius) results.push(item);
  node.children?.forEach(child => visitSphere(child, center, radius, results));
}
function contains(bounds, [x,y,z]) {
  return x >= bounds.x - bounds.half && x <= bounds.x + bounds.half && y >= bounds.y - bounds.half && y <= bounds.y + bounds.half && z >= bounds.z - bounds.half && z <= bounds.z + bounds.half;
}
function intersectsSphere(bounds, [x,y,z], radius) {
  const dx = Math.max(Math.abs(x - bounds.x) - bounds.half, 0);
  const dy = Math.max(Math.abs(y - bounds.y) - bounds.half, 0);
  const dz = Math.max(Math.abs(z - bounds.z) - bounds.half, 0);
  return dx*dx + dy*dy + dz*dz <= radius*radius;
}
function dist(a,b) { return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]); }
