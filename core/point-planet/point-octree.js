export function createPointOctree(points, options = {}) {
  const capacity = options.capacity ?? 96;
  const maxDepth = options.maxDepth ?? 7;
  const root = createNode({ x: 0, y: 0, z: 0, half: 1.25 }, 0);
  for (const point of points) insert(root, point, capacity, maxDepth);

  return {
    root,
    visibleNodes(camera) {
      const nodes = [];
      visitLeaves(root, camera, nodes);
      if (!nodes.length) collectPopulatedLeaves(root, nodes);
      return nodes;
    },
    stats() {
      let nodes = 0, leaves = 0, deepest = 0;
      walk(root, node => {
        nodes++;
        deepest = Math.max(deepest, node.depth);
        if (!node.children) leaves++;
      });
      return { nodes, leaves, deepest, points: points.length };
    },
  };
}

function createNode(bounds, depth) {
  return {
    bounds,
    depth,
    points: [],
    children: null,
    center: [bounds.x, bounds.y, bounds.z],
    radius: Math.sqrt(3) * bounds.half,
  };
}

function insert(node, point, capacity, maxDepth) {
  if (!contains(node.bounds, point)) return false;
  if (!node.children && (node.points.length < capacity || node.depth >= maxDepth)) {
    node.points.push(point);
    return true;
  }
  if (!node.children) subdivide(node, capacity, maxDepth);
  for (const child of node.children) {
    if (insert(child, point, capacity, maxDepth)) return true;
  }
  node.points.push(point);
  return true;
}

function subdivide(node, capacity, maxDepth) {
  const h = node.bounds.half / 2;
  node.children = [];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) {
    node.children.push(createNode({
      x: node.bounds.x + dx * h,
      y: node.bounds.y + dy * h,
      z: node.bounds.z + dz * h,
      half: h,
    }, node.depth + 1));
  }
  const old = node.points.splice(0);
  for (const point of old) insert(node, point, capacity, maxDepth);
}

function visitLeaves(node, camera, out) {
  if (!nodeVisible(node, camera)) return;
  if (!node.children) {
    if (node.points.length) out.push(node);
    return;
  }
  for (const child of node.children) visitLeaves(child, camera, out);
  if (node.points.length) out.push(node);
}

function collectPopulatedLeaves(node, out) {
  if (!node.children) {
    if (node.points.length) out.push(node);
    return;
  }
  for (const child of node.children) collectPopulatedLeaves(child, out);
  if (node.points.length) out.push(node);
}

function nodeVisible(node, camera) {
  const transformed = rotate(node.center[0], node.center[1], node.center[2], camera.rx, camera.ry);
  return transformed[2] + node.radius > -0.08;
}

function rotate(x0, y0, z0, rx, ry) {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  const x = x0 * cy - z0 * sy;
  const z = x0 * sy + z0 * cy;
  return [x, y0 * cx - z * sx, y0 * sx + z * cx];
}

function contains(bounds, point) {
  return point.x >= bounds.x - bounds.half && point.x <= bounds.x + bounds.half &&
    point.y >= bounds.y - bounds.half && point.y <= bounds.y + bounds.half &&
    point.z >= bounds.z - bounds.half && point.z <= bounds.z + bounds.half;
}

function walk(node, callback) {
  callback(node);
  node.children?.forEach(child => walk(child, callback));
}
