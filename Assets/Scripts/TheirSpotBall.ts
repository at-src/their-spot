// TheirSpotBall: a thrown toy's flight, bounce and roll (the ball and the bone).
// Owns: toy velocity and landing. Positions are memorial-local cm, floor at y = 0.
// Surfaces come from `ground` (the floor, or the top of the bed, basket and so on), and
// the toy bounces off the sides of anything taller than it. The grab itself is handled by
// SIK InteractableManipulation in TheirSpotMain.

export type BallState = "resting" | "held" | "flying" | "carried"

export class TheirSpotBall {
  state: BallState = "resting"
  radius = 3.5
  gravity = 980
  bounce = 0.35
  rollDecel = 160
  maxRangeCm = 180
  /** False for toys that slide instead of roll (the bone). */
  rolls = true
  /** Height of the surface under a floor point. */
  ground: (x: number, z: number) => number = () => 0

  private vel = vec3.zero()
  private history: {t: number; p: vec3}[] = []
  private clock = 0
  onLanded: (() => void) | null = null
  onBounce: (() => void) | null = null

  constructor(private readonly node: SceneObject, private readonly visual: SceneObject) {}

  getNode(): SceneObject {
    return this.node
  }

  /** Called every frame while the user holds the toy, with its local position. */
  recordHeld(local: vec3, dt: number): void {
    this.clock += dt
    this.history.push({t: this.clock, p: local})
    while (this.history.length > 2 && this.clock - this.history[0].t > 0.15) this.history.shift()
  }

  beginHold(): void {
    this.state = "held"
    this.history = []
  }

  /**
   * Release: turn the recent hand motion into a toss along the floor.
   * Dragging upward on screen throws the toy away from the user.
   */
  release(awayFromUser: vec3, aimed?: vec3): void {
    if (aimed) {
      // A gentle toss along a set floor velocity (used by the preview demo to keep it in view).
      this.vel = new vec3(aimed.x, 170, aimed.z)
      this.state = "flying"
      return
    }
    let v = vec3.zero()
    if (this.history.length >= 2) {
      const a = this.history[0]
      const b = this.history[this.history.length - 1]
      const dt = Math.max(0.016, b.t - a.t)
      v = b.p.sub(a.p).uniformScale(1 / dt)
    }
    const up = Math.max(v.y, 0)
    let h = new vec3(v.x, 0, v.z).add(awayFromUser.uniformScale(up))
    if (h.length < 40) h = awayFromUser.uniformScale(150)
    const speed = Math.min(Math.max(h.length, 150), 340)
    const dir = h.normalize()
    this.vel = new vec3(dir.x * speed, 170, dir.z * speed)
    this.state = "flying"
  }

  /** Places the toy at rest on whatever surface is under a local position. */
  restAt(pos: vec3): void {
    this.state = "resting"
    this.vel = vec3.zero()
    this.node.getTransform().setLocalPosition(new vec3(pos.x, this.ground(pos.x, pos.z) + this.radius, pos.z))
  }

  update(dt: number): void {
    if (this.state !== "flying") return
    const t = this.node.getTransform()
    const prev = t.getLocalPosition()
    this.vel = new vec3(this.vel.x, this.vel.y - this.gravity * dt, this.vel.z)
    let p = prev.add(this.vel.uniformScale(dt))

    let g = this.ground(p.x, p.z)
    if (p.y - this.radius < g) {
      const gPrev = this.ground(prev.x, prev.z)
      if (prev.y - this.radius < g - 1.5) {
        // Hit the side of something taller (the bed's rim, the basket): bounce back off it.
        p = new vec3(prev.x, Math.max(p.y, gPrev + this.radius), prev.z)
        this.vel = new vec3(-this.vel.x * 0.45, this.vel.y, -this.vel.z * 0.45)
        g = gPrev
        if (this.onBounce) this.onBounce()
      }
      if (p.y - this.radius < g) {
        p = new vec3(p.x, g + this.radius, p.z)
        if (this.vel.y < -60) {
          this.vel = new vec3(this.vel.x * 0.8, -this.vel.y * this.bounce, this.vel.z * 0.8)
          if (this.onBounce) this.onBounce()
        } else {
          // Rolling (or sliding) on the surface.
          const hs = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
          const ns = Math.max(0, hs - this.rollDecel * dt)
          const k = hs > 0 ? ns / hs : 0
          this.vel = new vec3(this.vel.x * k, 0, this.vel.z * k)
          if (ns < 4) {
            this.vel = vec3.zero()
            this.state = "resting"
          }
        }
      }
    }
    // Keep the toy inside the room area around the memorial.
    const r = Math.sqrt(p.x * p.x + p.z * p.z)
    if (r > this.maxRangeCm) {
      p = new vec3((p.x / r) * this.maxRangeCm, p.y, (p.z / r) * this.maxRangeCm)
      this.vel = new vec3(-this.vel.x * 0.3, this.vel.y, -this.vel.z * 0.3)
    }
    t.setLocalPosition(p)

    // Spin the visual in the direction of travel.
    const hs = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
    if (hs > 1) {
      const vt = this.visual.getTransform()
      if (this.rolls) {
        const axis = new vec3(this.vel.z, 0, -this.vel.x).normalize()
        const spin = quat.angleAxis((hs * dt) / this.radius, axis)
        vt.setLocalRotation(spin.multiply(vt.getLocalRotation()))
      } else if (p.y > g + this.radius + 0.5) {
        // Tumble end over end in the air; lie flat once it lands.
        vt.setLocalRotation(quat.angleAxis(dt * 9, vec3.up()).multiply(vt.getLocalRotation()))
      }
    }

    if (this.state === "resting" && this.onLanded) this.onLanded()
  }
}
