// TheirSpotMeshes: small procedural meshes for the memorial (placement ring, photo quad).
// Owns: geometry only. Does not create SceneObjects or materials.

/** Flat ring lying on the XZ plane, centered at the origin, facing up. */
export function buildRingMesh(innerRadius: number, outerRadius: number, segments: number = 64): RenderMesh {
  const mb = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3},
    {name: "texture0", components: 2},
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const verts: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    verts.push(c * innerRadius, 0, s * innerRadius, 0, 1, 0, i / segments, 0)
    verts.push(c * outerRadius, 0, s * outerRadius, 0, 1, 0, i / segments, 1)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  mb.updateMesh()
  return mb.getMesh()
}

/** Upright quad in the XY plane, centered at the origin, facing +Z. */
export function buildQuadMesh(width: number, height: number): RenderMesh {
  const mb = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3},
    {name: "texture0", components: 2},
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const w = width / 2
  const h = height / 2
  mb.appendVerticesInterleaved([
    -w, -h, 0, 0, 0, 1, 0, 0,
    w, -h, 0, 0, 0, 1, 1, 0,
    w, h, 0, 0, 0, 1, 1, 1,
    -w, h, 0, 0, 0, 1, 0, 1,
  ])
  mb.appendIndices([0, 1, 2, 0, 2, 3])
  mb.updateMesh()
  return mb.getMesh()
}

/** Axis-aligned box centered at the origin, with flat-shaded faces. */
export function buildBoxMesh(width: number, height: number, depth: number): RenderMesh {
  const mb = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3},
    {name: "texture0", components: 2},
  ])
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  const x = width / 2
  const y = height / 2
  const z = depth / 2
  // Each face: normal, then four corners counter-clockwise seen from outside.
  const faces: number[][] = [
    [0, 0, 1, -x, -y, z, x, -y, z, x, y, z, -x, y, z],
    [0, 0, -1, x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z],
    [1, 0, 0, x, -y, z, x, -y, -z, x, y, -z, x, y, z],
    [-1, 0, 0, -x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z],
    [0, 1, 0, -x, y, z, x, y, z, x, y, -z, -x, y, -z],
    [0, -1, 0, -x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z],
  ]
  const verts: number[] = []
  const idx: number[] = []
  const uv = [0, 0, 1, 0, 1, 1, 0, 1]
  faces.forEach((f, i) => {
    for (let c = 0; c < 4; c++) {
      verts.push(f[3 + c * 3], f[4 + c * 3], f[5 + c * 3], f[0], f[1], f[2], uv[c * 2], uv[c * 2 + 1])
    }
    const b = i * 4
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  })
  mb.appendVerticesInterleaved(verts)
  mb.appendIndices(idx)
  mb.updateMesh()
  return mb.getMesh()
}
