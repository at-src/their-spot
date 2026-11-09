// TheirSpotSolids: the solid things on the memorial floor.
// Owns: round footprints for the bed, frame, candle, basket and matchbox, read from their
// meshes when they are built and following them when they are lifted. Answers "what surface
// is under this point" so dropped, thrown and held things rest on top, never inside.
// Positions are memorial-local cm, floor at y = 0. Holds no flow state.

export type Solid = {
  name: string
  so: SceneObject
  offset: vec3 // footprint center relative to the object's local position (xz only)
  radius: number
  top: number // rim height above the object's bottom
  seat: number // inner surface height (bed cushion, basket floor); equals top when flat
  seatRadius: number
  baseY: number // object's local y when its bottom is on the floor
  off: boolean // true while the object is out of play (e.g. the photo being viewed)
  last: vec3 // local position last frame, used to carry things resting on top
}

export class TheirSpotSolids {
  readonly list: Solid[] = []

  constructor(private readonly root: SceneObject) {}

  /**
   * Registers an object as solid, measuring its meshes. `seatFrac` is the inner part of the
   * footprint that uses `seatHeight` instead of the rim (for the bed cushion or basket floor).
   */
  add(name: string, so: SceneObject, seatFrac: number = 0, seatHeight: number = -1, radiusScale: number = 1): Solid {
    const b = this.boundsOf(so)
    const pos = so.getTransform().getLocalPosition()
    const radius = (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2) * radiusScale
    const top = b.max.y - b.min.y
    const s: Solid = {
      name,
      so,
      offset: new vec3((b.min.x + b.max.x) / 2 - pos.x, 0, (b.min.z + b.max.z) / 2 - pos.z),
      radius,
      top,
      seat: seatHeight >= 0 ? seatHeight : top,
      seatRadius: radius * seatFrac,
      baseY: pos.y - b.min.y,
      off: false,
      last: pos,
    }
    this.list.push(s)
    print("TheirSpot: solid " + name + " r=" + radius.toFixed(1) + " top=" + top.toFixed(1) + " seat=" + s.seat.toFixed(1))
    return s
  }

  center(s: Solid): vec3 {
    const p = s.so.getTransform().getLocalPosition()
    return new vec3(p.x + s.offset.x, p.y - s.baseY, p.z + s.offset.z)
  }

  private active(s: Solid, ignore: SceneObject[]): boolean {
    return !s.off && s.so.isEnabledInHierarchy && ignore.indexOf(s.so) < 0
  }

  /** Height of the highest surface under (x, z): the floor, a rim, or an inner seat. */
  surfaceAt(x: number, z: number, ignore: SceneObject[] = []): number {
    let best = 0
    for (const s of this.list) {
      if (!this.active(s, ignore)) continue
      const c = this.center(s)
      const d = Math.sqrt((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z))
      if (d >= s.radius) continue
      const h = c.y + (d < s.seatRadius ? s.seat : s.top)
      if (h > best) best = h
    }
    return best
  }

  /** Highest surface anywhere under a round footprint (its center and a ring near its edge). */
  surfaceUnder(x: number, z: number, radius: number, ignore: SceneObject[] = []): number {
    let best = this.surfaceAt(x, z, ignore)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      best = Math.max(best, this.surfaceAt(x + Math.cos(a) * radius * 0.85, z + Math.sin(a) * radius * 0.85, ignore))
    }
    return best
  }

  /** A floor point moved just outside every solid it is inside, for something `bodyRadius` wide. */
  clearSpot(p: vec3, bodyRadius: number, minTop: number = 0): vec3 {
    let q = p
    for (let pass = 0; pass < 3; pass++) {
      for (const s of this.list) {
        if (!this.active(s, []) || s.top < minTop) continue
        const c = this.center(s)
        if (c.y > 5) continue
        const d = new vec3(q.x - c.x, 0, q.z - c.z)
        const dist = d.length
        const min = s.radius + bodyRadius
        if (dist >= min) continue
        const n = dist > 0.1 ? d.uniformScale(1 / dist) : new vec3(0, 0, 1)
        q = new vec3(c.x + n.x * min, q.y, c.z + n.z * min)
      }
    }
    return q
  }

  /** Slides a solid sideways until it no longer overlaps the things standing on the floor. */
  separate(s: Solid): void {
    const t = s.so.getTransform()
    for (let pass = 0; pass < 3; pass++) {
      for (const o of this.list) {
        if (o === s || !this.active(o, [])) continue
        const c = this.center(s)
        const oc = this.center(o)
        if (oc.y > 5) continue
        const d = new vec3(c.x - oc.x, 0, c.z - oc.z)
        const dist = d.length
        const min = s.radius + o.radius * 0.9
        if (dist >= min) continue
        const n = dist > 0.1 ? d.uniformScale(1 / dist) : new vec3(1, 0, 0)
        t.setLocalPosition(t.getLocalPosition().add(n.uniformScale(min - dist)))
      }
    }
  }

  /** The solid registered for an object, if any. */
  of(so: SceneObject): Solid | null {
    for (const s of this.list) if (s.so === so) return s
    return null
  }

  /** The solid whose footprint holds (x, z), if any. */
  containing(x: number, z: number, ignore: SceneObject[] = []): Solid | null {
    let found: Solid | null = null
    let bestTop = -1
    for (const s of this.list) {
      if (!this.active(s, ignore)) continue
      const c = this.center(s)
      const d = Math.sqrt((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z))
      if (d < s.radius && c.y + s.top > bestTop) {
        found = s
        bestTop = c.y + s.top
      }
    }
    return found
  }

  /** Round obstacles standing on the floor, for the pet's path planning. */
  obstacles(minTop: number = 0): {center: vec3; radius: number}[] {
    const out: {center: vec3; radius: number}[] = []
    for (const s of this.list) {
      if (!this.active(s, []) || s.top < minTop) continue
      const c = this.center(s)
      if (c.y > 5) continue
      out.push({center: new vec3(c.x, 0, c.z), radius: s.radius})
    }
    return out
  }

  /** A floor point just outside a solid, on the side facing `toward`. */
  edgePoint(s: Solid, toward: vec3, margin: number): vec3 {
    const c = this.center(s)
    let d = new vec3(toward.x - c.x, 0, toward.z - c.z)
    d = d.length > 0.1 ? d.normalize() : new vec3(0, 0, 1)
    return new vec3(c.x + d.x * (s.radius + margin), 0, c.z + d.z * (s.radius + margin))
  }

  /** Bounds of every mesh under `so`, in memorial-local space. */
  private boundsOf(so: SceneObject): {min: vec3; max: vec3} {
    const inv = this.root.getTransform().getInvertedWorldTransform()
    let min = new vec3(1e9, 1e9, 1e9)
    let max = new vec3(-1e9, -1e9, -1e9)
    const visit = (o: SceneObject) => {
      const comps = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const v of comps) {
        if (!v.mesh) continue
        const a = v.localAabbMin()
        const b = v.localAabbMax()
        const m = o.getTransform().getWorldTransform()
        for (let i = 0; i < 8; i++) {
          const c = new vec3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z)
          const p = inv.multiplyPoint(m.multiplyPoint(c))
          min = new vec3(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z))
          max = new vec3(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z))
        }
      }
      for (let i = 0; i < o.getChildrenCount(); i++) visit(o.getChild(i))
    }
    visit(so)
    if (min.x > max.x) {
      const p = so.getTransform().getLocalPosition()
      return {min: p.sub(new vec3(5, 0, 5)), max: p.add(new vec3(5, 10, 5))}
    }
    return {min, max}
  }
}
