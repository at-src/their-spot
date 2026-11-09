// TheirSpotPet: the pet's movement and moods.
// Owns: the pet's position, heading, walking around obstacles, hops, twirls, begging, and
// idle/sleep animation.
// Driven every frame by TheirSpotMain.update(). Positions are in memorial-local cm
// (floor is y = 0, +Z points toward the user). Does not read input or show text.

export type PetMood = "hidden" | "idle" | "walking" | "hopping" | "twirling" | "resting"

/** Yaw (radians) that turns a mesh baked to face -Z toward a horizontal direction. */
export function yawToFace(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/** A round thing on the floor the pet walks around instead of through. */
export type Obstacle = {center: vec3; radius: number}

export class TheirSpotPet {
  mood: PetMood = "hidden"
  speedCmPerSec = 70
  obstacles: Obstacle[] = []
  /** Half the pet's body length (cm): how close its center may come to an obstacle's edge. */
  bodyRadius = 14

  private path: vec3[] = []
  private heading = 0
  private time = 0
  private onArrive: (() => void) | null = null

  // Hop state.
  private hopFrom = vec3.zero()
  private hopTo = vec3.zero()
  private hopHeight = 0
  private hopDuration = 0
  private hopT = 0
  private onLand: (() => void) | null = null

  // Twirl and begging state.
  private twirlT = 0
  private twirlFrom = 0
  private onTwirl: (() => void) | null = null
  private begging = false
  private beg = 0

  // Progress toward the current waypoint, to notice being stuck.
  private bestDist = 1e9
  private stuckFor = 0

  constructor(
    private readonly root: SceneObject, // moves on the floor
    private readonly yawNode: SceneObject, // turns toward travel direction
    private readonly bobNode: SceneObject, // walk bob / breathing / hop squash
    private readonly awakeVisual: SceneObject,
    private readonly sleepingVisual: SceneObject,
    private readonly mouth: SceneObject, // carry point for the ball
    private readonly userPosition: () => vec3, // the user's eye, memorial-local
  ) {}

  getMouth(): SceneObject {
    return this.mouth
  }

  getPosition(): vec3 {
    return this.root.getTransform().getLocalPosition()
  }

  /** Show the pet at a spot, facing the user. */
  appearAt(pos: vec3): void {
    this.root.getTransform().setLocalPosition(pos)
    const u = this.userPosition().sub(pos)
    this.heading = yawToFace(u.x, u.z)
    this.applyHeading()
    this.root.enabled = true
    this.awakeVisual.enabled = true
    this.sleepingVisual.enabled = false
    this.mood = "idle"
  }

  /** Walk to a floor spot, going around obstacles. */
  walkTo(pos: vec3, onArrive: () => void): void {
    const goal = new vec3(pos.x, 0, pos.z)
    this.path = this.planPath(this.getPosition(), goal)
    this.bestDist = 1e9
    this.stuckFor = 0
    this.mood = "walking"
    this.onArrive = onArrive
  }

  /** A short arc jump; `to` may be raised (e.g. into the bed). */
  hop(to: vec3, height: number, duration: number, onLand: () => void): void {
    this.hopFrom = this.getPosition()
    this.hopTo = to
    this.hopHeight = height
    this.hopDuration = duration
    this.hopT = 0
    this.onLand = onLand
    this.mood = "hopping"
    const d = to.sub(this.hopFrom)
    if (Math.abs(d.x) + Math.abs(d.z) > 1) this.heading = yawToFace(d.x, d.z)
    this.applyHeading()
  }

  /** A happy hop in place. */
  happyHop(onLand?: () => void): void {
    if (this.mood !== "idle") return
    this.hop(this.getPosition(), 9, 0.45, () => {
      this.mood = "idle"
      if (onLand) onLand()
    })
  }

  /** A happy spin in place with a little hop. */
  twirl(onDone?: () => void): void {
    if (this.mood !== "idle") return
    this.twirlT = 0
    this.twirlFrom = this.heading
    this.onTwirl = onDone || null
    this.mood = "twirling"
  }

  /** Sit up on the back legs while a treat is held close, or settle back down. */
  setBegging(on: boolean): void {
    this.begging = on
  }

  /** Swap to the curled-up pose on the bed. */
  sleep(): void {
    this.mood = "resting"
    this.awakeVisual.enabled = false
    this.sleepingVisual.enabled = true
  }

  update(dt: number): void {
    if (this.mood === "hidden") return
    this.time += dt
    const bob = this.bobNode.getTransform()

    if (this.mood === "hopping") {
      this.hopT = Math.min(1, this.hopT + dt / this.hopDuration)
      const k = this.hopT
      const p = vec3.lerp(this.hopFrom, this.hopTo, k)
      const lift = Math.sin(k * Math.PI) * this.hopHeight
      this.root.getTransform().setLocalPosition(new vec3(p.x, p.y + lift, p.z))
      // Stretch in the air, squash on take-off and landing.
      const s = 1 + Math.sin(k * Math.PI) * 0.08 - (k < 0.12 || k > 0.88 ? 0.06 : 0)
      bob.setLocalScale(new vec3(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)))
      bob.setLocalPosition(vec3.zero())
      bob.setLocalRotation(quat.quatIdentity())
      if (k >= 1) {
        bob.setLocalScale(vec3.one())
        this.mood = "idle"
        const done = this.onLand
        this.onLand = null
        if (done) done()
      }
      return
    }

    if (this.mood === "twirling") {
      this.twirlT = Math.min(1, this.twirlT + dt / 0.9)
      const k = this.twirlT
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      this.heading = this.twirlFrom + e * Math.PI * 2
      this.applyHeading()
      bob.setLocalPosition(new vec3(0, Math.sin(k * Math.PI) * 6, 0))
      bob.setLocalRotation(quat.quatIdentity())
      if (k >= 1) {
        this.heading = this.twirlFrom
        bob.setLocalPosition(vec3.zero())
        this.mood = "idle"
        const done = this.onTwirl
        this.onTwirl = null
        if (done) done()
      }
      return
    }

    if (this.mood === "walking") {
      const t = this.root.getTransform()
      const p = t.getLocalPosition()
      const target = this.path[0]
      const to = target.sub(p)
      const dist = Math.sqrt(to.x * to.x + to.z * to.z)
      // Not getting closer (pressed against something): skip this waypoint, or call it arrived.
      if (dist < this.bestDist - 1) {
        this.bestDist = dist
        this.stuckFor = 0
      } else {
        this.stuckFor += dt
      }
      const stuck = this.stuckFor > 1.2
      if (stuck) {
        this.stuckFor = 0
        this.bestDist = 1e9
      }
      if (dist < 3 || stuck) {
        if (!stuck) t.setLocalPosition(new vec3(target.x, p.y, target.z))
        this.path.shift()
        this.bestDist = 1e9
        this.stuckFor = 0
        if (this.path.length === 0) {
          bob.setLocalPosition(vec3.zero())
          bob.setLocalRotation(quat.quatIdentity())
          this.mood = "idle"
          const done = this.onArrive
          this.onArrive = null
          if (done) done()
        }
        return
      }
      const step = Math.min(dist, this.speedCmPerSec * dt)
      t.setLocalPosition(new vec3(p.x + (to.x / dist) * step, 0, p.z + (to.z / dist) * step))
      this.turnToward(yawToFace(to.x, to.z), dt, 8)
      const phase = this.time * 14
      bob.setLocalPosition(new vec3(0, Math.abs(Math.sin(phase)) * 2.2, 0))
      bob.setLocalRotation(quat.fromEulerAngles(0, 0, Math.sin(phase) * 0.07))
      return
    }

    // Idle and resting: slow breathing. Idle also keeps watching the user.
    const breathe = 1 + Math.sin(this.time * (this.mood === "resting" ? 1.6 : 2.4)) * 0.02
    bob.setLocalScale(new vec3(1, breathe, 1))
    // Begging: rear up on the back legs (nose up), with a small eager bounce.
    const goal = this.begging && this.mood === "idle" ? 1 : 0
    this.beg += (goal - this.beg) * Math.min(1, dt * 7)
    const lift = this.beg * (5 + Math.abs(Math.sin(this.time * 9)) * 1.5)
    bob.setLocalPosition(new vec3(0, lift, -this.beg * 3))
    const sway = this.mood === "idle" ? Math.sin(this.time * 1.3) * 0.03 : 0
    bob.setLocalRotation(quat.fromEulerAngles(this.beg * 0.45, 0, sway))
    if (this.mood === "idle") {
      const u = this.userPosition().sub(this.getPosition())
      this.turnToward(yawToFace(u.x, u.z), dt, 3)
    }
  }

  /**
   * Waypoints to the goal. A straight line when nothing is in the way; otherwise a shortest
   * route over a 5 cm floor grid that keeps her body clear of every obstacle (the bed, basket,
   * frame, candle and matchbox together), smoothed into a few straight legs.
   */
  private planPath(from: vec3, goal: vec3): vec3[] {
    const start = new vec3(from.x, 0, from.z)
    if (!this.firstBlocker(start, goal) && !this.blockedAt(goal.x, goal.z)) return [goal]
    const CELL = 5
    const HALF = 210
    const N = Math.round((2 * HALF) / CELL) + 1
    const free = new Uint8Array(N * N)
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) free[i * N + j] = this.blockedAt(i * CELL - HALF, j * CELL - HALF) ? 0 : 1
    }
    const toCell = (v: vec3): number => {
      const i = Math.max(0, Math.min(N - 1, Math.round((v.x + HALF) / CELL)))
      const j = Math.max(0, Math.min(N - 1, Math.round((v.z + HALF) / CELL)))
      return i * N + j
    }
    const pos = (c: number): vec3 => new vec3(Math.floor(c / N) * CELL - HALF, 0, (c % N) * CELL - HALF)
    // Nearest free cell (for a start or goal that sits right against something).
    const nearestFree = (c: number): number => {
      if (free[c]) return c
      const ci = Math.floor(c / N)
      const cj = c % N
      for (let r = 1; r < 12; r++) {
        let best = -1
        let bestD = 1e9
        for (let di = -r; di <= r; di++) {
          for (let dj = -r; dj <= r; dj++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
            const i = ci + di
            const j = cj + dj
            if (i < 0 || j < 0 || i >= N || j >= N || !free[i * N + j]) continue
            const d = di * di + dj * dj
            if (d < bestD) {
              bestD = d
              best = i * N + j
            }
          }
        }
        if (best >= 0) return best
      }
      return c
    }
    const s = nearestFree(toCell(start))
    const g = nearestFree(toCell(goal))
    const goalFree = !this.blockedAt(goal.x, goal.z)
    const end = goalFree ? goal : pos(g)

    // A* over 8 neighbours.
    const cost = new Float32Array(N * N).fill(1e9)
    const prev = new Int32Array(N * N).fill(-1)
    const closed = new Uint8Array(N * N)
    const heap: number[] = []
    const hf = new Float32Array(N * N)
    const push = (c: number) => {
      heap.push(c)
      let k = heap.length - 1
      while (k > 0) {
        const p = (k - 1) >> 1
        if (hf[heap[p]] <= hf[heap[k]]) break
        const t = heap[p]
        heap[p] = heap[k]
        heap[k] = t
        k = p
      }
    }
    const pop = (): number => {
      const top = heap[0]
      const last = heap.pop() as number
      if (heap.length > 0) {
        heap[0] = last
        let k = 0
        for (;;) {
          const l = 2 * k + 1
          const r = l + 1
          let m = k
          if (l < heap.length && hf[heap[l]] < hf[heap[m]]) m = l
          if (r < heap.length && hf[heap[r]] < hf[heap[m]]) m = r
          if (m === k) break
          const t = heap[m]
          heap[m] = heap[k]
          heap[k] = t
          k = m
        }
      }
      return top
    }
    const gi = Math.floor(g / N)
    const gj = g % N
    const h = (c: number) => Math.hypot(Math.floor(c / N) - gi, (c % N) - gj)
    cost[s] = 0
    hf[s] = h(s)
    push(s)
    let found = false
    while (heap.length > 0) {
      const c = pop()
      if (closed[c]) continue
      closed[c] = 1
      if (c === g) {
        found = true
        break
      }
      const ci = Math.floor(c / N)
      const cj = c % N
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= N || j >= N) continue
          const nc = i * N + j
          if (!free[nc] || closed[nc]) continue
          // No cutting corners past an obstacle.
          if (di && dj && (!free[ci * N + j] || !free[i * N + cj])) continue
          const nCost = cost[c] + (di && dj ? 1.4142 : 1)
          if (nCost < cost[nc]) {
            cost[nc] = nCost
            prev[nc] = c
            hf[nc] = nCost + h(nc)
            push(nc)
          }
        }
      }
    }
    if (!found) return [end]

    const cells: vec3[] = []
    for (let c = g; c !== -1 && c !== s; c = prev[c]) cells.push(pos(c))
    cells.reverse()
    cells[cells.length - 1] = end
    // Smooth: from each point, jump to the farthest later point in clear sight.
    const path: vec3[] = []
    let at = start
    let k = 0
    while (k < cells.length) {
      let far = k
      for (let m = cells.length - 1; m > k; m--) {
        if (this.clearLine(at, cells[m])) {
          far = m
          break
        }
      }
      path.push(cells[far])
      at = cells[far]
      k = far + 1
    }
    return path
  }

  /** True when the pet's body would overlap an obstacle with its center at (x, z). */
  private blockedAt(x: number, z: number): boolean {
    for (const o of this.obstacles) {
      const r = o.radius + this.bodyRadius + 3
      const dx = x - o.center.x
      const dz = z - o.center.z
      if (dx * dx + dz * dz < r * r) return true
    }
    return false
  }

  /** True when the pet can walk straight from a to b without touching an obstacle. */
  private clearLine(a: vec3, b: vec3): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const steps = Math.max(1, Math.ceil(d / 2.5))
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      if (this.blockedAt(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) return false
    }
    return true
  }

  /** The nearest obstacle the straight line from `a` to `b` passes through, if any. */
  private firstBlocker(a: vec3, b: vec3): Obstacle | null {
    const seg = b.sub(a)
    const len2 = seg.x * seg.x + seg.z * seg.z
    if (len2 < 1) return null
    let best: Obstacle | null = null
    let bestK = 2
    for (const o of this.obstacles) {
      const k = this.crossing(o, a, b)
      if (k >= 0 && k < bestK) {
        best = o
        bestK = k
      }
    }
    return best
  }

  /** Where along a→b (0..1) the line comes too close to an obstacle, or -1 if it stays clear. */
  private crossing(o: Obstacle, a: vec3, b: vec3): number {
    const seg = b.sub(a)
    const len2 = seg.x * seg.x + seg.z * seg.z
    if (len2 < 1) return -1
    const c = o.center
    let k = ((c.x - a.x) * seg.x + (c.z - a.z) * seg.z) / len2
    k = Math.max(0, Math.min(1, k))
    const dx = a.x + seg.x * k - c.x
    const dz = a.z + seg.z * k - c.z
    const clearance = o.radius + this.bodyRadius + 1
    if (dx * dx + dz * dz >= clearance * clearance || k >= 0.999) return -1
    return k
  }

  private turnToward(goal: number, dt: number, rate: number): void {
    let d = goal - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.heading += d * Math.min(1, dt * rate)
    this.applyHeading()
  }

  private applyHeading(): void {
    this.yawNode.getTransform().setLocalRotation(quat.fromEulerAngles(0, this.heading, 0))
  }
}
