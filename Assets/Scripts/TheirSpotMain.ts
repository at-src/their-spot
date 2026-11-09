// TheirSpotMain: orchestrates the memorial.
// Owns: the experience flow (place → photo → match and candle → pet → flowers → play → rest),
// building the memorial objects under the authored Memorial anchor, lifting and dropping
// things, and wiring SIK interactions.
// Expects: camera, memorial anchor, UI module, flame/ring/photo/ball materials, sphere mesh,
// pet photo texture. Must not create visible text (that lives in TheirSpotUI).

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {TheirSpotUI} from "./TheirSpotUI"
import {TheirSpotPet} from "./TheirSpotPet"
import {TheirSpotBall} from "./TheirSpotBall"
import {TheirSpotSolids, Solid} from "./TheirSpotSolids"
import {buildBoxMesh, buildQuadMesh, buildRingMesh} from "./TheirSpotMeshes"

const BED = requireAsset("../GeneratedMeshes/PetBed.glb") as ObjectPrefab
const FRAME = requireAsset("../GeneratedMeshes/PhotoFrame.glb") as ObjectPrefab
const CANDLE = requireAsset("../GeneratedMeshes/Candle.glb") as ObjectPrefab
const BASKET = requireAsset("../GeneratedMeshes/FlowerBasket.glb") as ObjectPrefab
const FLOWER = requireAsset("../GeneratedMeshes/Flower.glb") as ObjectPrefab
const DOG = requireAsset("../GeneratedMeshes/Dog.glb") as ObjectPrefab
const DOG_SLEEP = requireAsset("../GeneratedMeshes/DogSleeping.glb") as ObjectPrefab

const SFX_CANDLE = requireAsset("../GeneratedSFX/CandleLight.wav") as AudioTrackAsset
const SFX_FLOWER = requireAsset("../GeneratedSFX/FlowerPlace.wav") as AudioTrackAsset
const BARKS = [
  requireAsset("../Audio/Bark1.wav") as AudioTrackAsset,
  requireAsset("../Audio/Bark2.wav") as AudioTrackAsset,
  requireAsset("../Audio/Bark3.wav") as AudioTrackAsset,
]
const SFX_BOUNCE = requireAsset("../GeneratedSFX/BallBounce.wav") as AudioTrackAsset
const SFX_THROW = requireAsset("../GeneratedSFX/BallThrow.wav") as AudioTrackAsset
const SFX_APPEAR = requireAsset("../GeneratedSFX/PetAppear.wav") as AudioTrackAsset
const SFX_TAP = requireAsset("../GeneratedSFX/SoftTap.wav") as AudioTrackAsset
const MUSIC = requireAsset("../GeneratedSFX/BackgroundMusic.wav") as AudioTrackAsset

// Memorial layout in local cm. Floor is y = 0; +Z points toward the user.
const POS_BED = new vec3(0, 0, 0)
const POS_FRAME = new vec3(33, 0, -24)
const POS_CANDLE = new vec3(42, 0, -3)
const POS_MATCHBOX = new vec3(44, 0, 16)
const POS_BASKET = new vec3(-48, 0, -6)
const POS_DISH = new vec3(-38, 0, 32)
const POS_PET_APPEAR = new vec3(-30, 0, -22)
const POS_PET_WAIT = new vec3(-22, 0, 30)
const POS_BALL_HOME = new vec3(8, 0, 36)
const POS_BONE_HOME = new vec3(26, 0, 38)
const FLOWER_COUNT = 5
const TREAT_COUNT = 2
const BED_CUSHION_CM = 5
const GRAVITY = 980
const PET_STEP_CM = 3 // the pup steps over anything lower than this (the dish)
const PLAY_RADIUS = 150 // cm from the memorial's center that held things may reach
const PLAY_HEIGHT = 140 // cm above the floor

/** Something the user can pick up; it falls onto whatever is below when let go. */
type Liftable = {
  so: SceneObject
  restY: number // local y above the surface when resting (the collider is centered on the object)
  manip: InteractableManipulation
  held: boolean
  falling: boolean
  vy: number
  home: vec3 // where it starts; it comes back here if it ever leaves the play area
  thin?: boolean // held: only kept above the floor (the match must reach into the candle's wick)
  rideable?: boolean // can land on the pup's back and ride along (flowers)
  onPet?: boolean // parented to the pup (or, once she sleeps, to the bed) instead of the memorial root
  onPick?: () => void
  onRelease?: () => boolean // return false when the release is handled elsewhere (no fall)
  onLand?: () => void
}

/** A throwable toy the pet fetches. */
type Toy = {
  name: string
  ball: TheirSpotBall
  inter: Interactable
  manip: InteractableManipulation
  home: vec3
  restSpot: vec3 // where it was last put down; landing anywhere else sends the pet for it
  bounceAudio: AudioComponent
}

/** A biscuit on the dish. */
type Treat = {lift: Liftable; home: vec3; state: "dish" | "held" | "falling" | "floor" | "eaten"}

@component
export class TheirSpotMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">TheirSpotMain – memorial flow</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("The world camera (Camera Object)")
  camera!: SceneObject

  @input
  @hint("Authored anchor the memorial is built under")
  memorialAnchor!: SceneObject

  @input
  @hint("UI module with the hint, plaque, reading card and Rest button")
  ui!: TheirSpotUI

  @input
  @hint("Sphere mesh used for the flames, ball, bone and treats")
  sphereMesh!: RenderMesh

  @input
  @hint("Unlit material for the flame core")
  flameCoreMaterial!: Material

  @input
  @hint("Unlit material for the outer flame")
  flameOuterMaterial!: Material

  @input
  @hint("Unlit material for the placement ring")
  ringMaterial!: Material

  @input
  @hint("Unlit material the pet photo is drawn with")
  photoMaterial!: Material

  @input
  @hint("Lit material for the ball; cloned and recolored for the bone, treats, dish and matches")
  ballMaterial!: Material

  @input
  @hint("Photo shown in the frame")
  petPhoto!: Texture
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Pet name on the plaque")
  petName: string = "Mochi"

  @input
  @hint("Years on the plaque")
  petYears: string = "2012 – 2026"

  @input
  @hint("Note shown when the photo is picked up")
  noteText: string = "Loved the sunny spot by the window, stolen socks, and every ball you ever threw."

  @input
  @hint("Brightness of the candlelight")
  @widget(new SliderWidget(0, 5, 0.1))
  glowIntensity: number = 4

  @input
  @hint("How far ahead of the user the placement ring appears (cm)")
  @widget(new SliderWidget(70, 250, 5))
  ringDistanceCm: number = 130

  @input
  @hint("Floor height below the user's eyes at start (cm)")
  @widget(new SliderWidget(60, 200, 5))
  floorBelowEyesCm: number = 150

  @input
  @hint("Pet walking speed (cm/s)")
  @widget(new SliderWidget(20, 200, 5))
  petSpeedCmPerSec: number = 70

  @input
  @hint("How far in front of the eyes the lifted photo is held (cm)")
  @widget(new SliderWidget(40, 120, 5))
  photoViewDistanceCm: number = 80

  @input
  @hint("Size of the lifted photo relative to the frame on the floor")
  @widget(new SliderWidget(1, 3, 0.05))
  photoViewScale: number = 1.1

  @input
  @hint("Background music volume")
  @widget(new SliderWidget(0, 1, 0.05))
  musicVolume: number = 0.25

  @input
  @hint("Draw collider outlines to check hit zones")
  debugColliders: boolean = false

  @input
  @hint("Preview testing keys (same handlers as the pinches): P place, N photo, C match, H pet, F flower, T ball, B bone, G treat, L lift bed, R rest, D demo")
  testKeys: boolean = true
  @ui.group_end

  private root!: SceneObject
  private solids!: TheirSpotSolids
  private ring!: SceneObject
  private bed!: SceneObject
  private bedSolid!: Solid
  private frame!: SceneObject
  private frameSolid!: Solid
  private candle!: SceneObject
  private flameCore!: SceneObject
  private flameOuter!: SceneObject
  private basket!: SceneObject
  private matchbox!: SceneObject
  private dish!: SceneObject
  private flowers: Liftable[] = []
  private flowerHome: vec3[] = []
  private liftables: Liftable[] = []
  private pet!: TheirSpotPet
  private petRoot!: SceneObject
  private petSleeping!: SceneObject
  private petBob!: SceneObject
  private petBackCm = 20 // height of her back above the floor, for flowers laid on her
  private toys: Toy[] = []
  private treats: Treat[] = []

  // Match.
  private match!: Liftable
  private matchVisual!: SceneObject
  private matchHead!: SceneObject
  private matchFlame!: SceneObject
  private matchLit = false

  // Photo reading view.
  private noteOpen = false
  private readCard = vec3.zero()

  private glow!: LightSource
  private glowTarget = 0
  private placed = false
  private candleLit = false
  private petBusy = false
  private fetchCount = 0
  private petCount = 0
  private resting = false
  private time = 0
  private lastBounceAt = -1
  private scripted = false // a test-key sequence is moving things

  private sfx: {[k: string]: AudioComponent} = {}
  private barkAudio!: AudioComponent

  onAwake() {
    if (!this.camera || !this.memorialAnchor || !this.ui) {
      print("TheirSpotMain: camera, memorialAnchor or ui is not wired.")
      return
    }
    this.createEvent("OnStartEvent").bind(() => this.start())
    this.createEvent("UpdateEvent").bind(() => this.update(getDeltaTime()))
    this.createEvent("LateUpdateEvent").bind(() => this.lateUpdate(getDeltaTime()))
    if (this.testKeys) this.bindTestKeys()
  }

  // ───────────────────────── Setup ─────────────────────────

  private start(): void {
    this.ui.setCamera(this.camera)
    this.root = this.memorialAnchor
    this.solids = new TheirSpotSolids(this.root)
    this.setupAudio()
    this.placeAnchorInFrontOfUser()
    this.buildRing()
    this.buildMemorial()
    this.ui.showHint(this.toWorld(new vec3(0, 38, 0)))
    print("TheirSpot: ready, waiting for placement")
  }

  private placeAnchorInFrontOfUser(): void {
    const cam = this.camera.getTransform()
    const camPos = cam.getWorldPosition()
    const fwd = cam.forward
    let flat = new vec3(-fwd.x, 0, -fwd.z)
    if (flat.length < 0.01) flat = new vec3(0, 0, -1)
    flat = flat.normalize()
    const pos = new vec3(
      camPos.x + flat.x * this.ringDistanceCm,
      camPos.y - this.floorBelowEyesCm,
      camPos.z + flat.z * this.ringDistanceCm,
    )
    const t = this.root.getTransform()
    t.setWorldPosition(pos)
    // Local +Z points back toward the user.
    t.setWorldRotation(quat.fromEulerAngles(0, Math.atan2(-flat.x, -flat.z), 0))
  }

  private buildRing(): void {
    this.ring = this.child(this.root, "PlacementRing", vec3.zero())
    const visual = this.child(this.ring, "RingVisual", new vec3(0, 0.5, 0))
    const rmv = visual.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = buildRingMesh(26, 31)
    rmv.mainMaterial = this.ringMaterial
    const inter = this.makeInteractable(this.ring, new vec3(66, 6, 66), visual)
    inter.onTriggerStart.add(() => this.onPlace())
  }

  private buildMemorial(): void {
    // The bed and basket are solid, and can be lifted and set down somewhere else.
    this.bed = this.liftableProp("Bed", BED, POS_BED)
    this.basket = this.liftableProp("FlowerBasket", BASKET, POS_BASKET)

    this.frame = this.prop("PhotoFrame", FRAME, POS_FRAME)
    this.addPhoto(this.frame)
    // The frame's hit box is a child so the frame itself can lift and turn.
    const frameHit = this.child(this.frame, "PhotoTouch", new vec3(0, 14, 0))
    const photoTouch = this.makeInteractable(frameHit, new vec3(20, 28, 14), frameHit)
    photoTouch.onTriggerStart.add(() => this.toggleNote())

    this.buildCandle()
    this.buildMatchbox()
    this.buildDish()

    // Measure everything solid now, while it is at rest and full size.
    this.bedSolid = this.solids.add("Bed", this.bed, 0.62, BED_CUSHION_CM)
    this.solids.add("FlowerBasket", this.basket, 0.7, 2)
    this.frameSolid = this.solids.add("PhotoFrame", this.frame, 0, -1, 0.8)
    this.solids.add("Candle", this.candle)
    this.solids.add("Matchbox", this.matchbox)
    this.solids.add("Dish", this.dish)
    this.makeLiftable(this.bed, this.bedSolid.baseY)
    this.makeLiftable(this.basket, this.solids.list[1].baseY)
    this.makeLiftable(this.candle, this.solids.list[3].baseY)

    for (let i = 0; i < FLOWER_COUNT; i++) this.buildFlower(i)
    this.buildMatch()
    for (let i = 0; i < TREAT_COUNT; i++) this.buildTreat(i)

    this.buildPet()
    this.buildToys()

    for (const so of [this.bed, this.frame, this.candle, this.basket, this.matchbox, this.dish, this.petRoot]) {
      so.enabled = false
    }
    for (const l of this.liftables) if (l.so !== this.bed && l.so !== this.basket && l.so !== this.candle) l.so.enabled = false
    for (const t of this.toys) t.ball.getNode().enabled = false
  }

  private prop(name: string, prefab: ObjectPrefab, pos: vec3): SceneObject {
    const wrapper = this.child(this.root, name, pos)
    const inst = prefab.instantiate(wrapper)
    // Meshes are baked facing -Z; turn them to face the user (+Z).
    inst.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI, 0))
    return wrapper
  }

  /**
   * A prop that is grabbed by its actual shape: every mesh in it gets a mesh collider, so the
   * empty space inside the bed or under the basket handle never catches a pinch meant for
   * something else.
   */
  private liftableProp(name: string, prefab: ObjectPrefab, pos: vec3): SceneObject {
    const wrapper = this.prop(name, prefab, pos)
    const visit = (o: SceneObject) => {
      const comps = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const v of comps) {
        if (!v.mesh) continue
        const collider = o.createComponent("Physics.ColliderComponent") as ColliderComponent
        const shape = Shape.createMeshShape()
        shape.mesh = v.mesh
        collider.shape = shape
        collider.debugDrawEnabled = this.debugColliders
      }
      for (let i = 0; i < o.getChildrenCount(); i++) visit(o.getChild(i))
    }
    visit(wrapper)
    const inter = wrapper.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3
    // Imported models carry their own scale (the bed is 100x), so the hover grows it relative to that.
    const highlight = wrapper.getChild(0).getTransform()
    const base = highlight.getLocalScale()
    inter.onHoverEnter.add(() => highlight.setLocalScale(base.uniformScale(1.04)))
    inter.onHoverExit.add(() => highlight.setLocalScale(base))
    return wrapper
  }

  private buildCandle(): void {
    // Candle: unit-scale wrapper with collider; visual and flame as children.
    this.candle = this.child(this.root, "Candle", POS_CANDLE)
    const candleVisual = this.child(this.candle, "CandleVisual", vec3.zero())
    const cv = CANDLE.instantiate(candleVisual)
    cv.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI, 0))
    // The collider wrapper is lifted 7 cm to the candle's middle, so flame heights are relative to that.
    this.makeInteractable(this.candle, new vec3(16, 18, 16), candleVisual, new vec3(0, 7, 0))
    this.flameOuter = this.flamePart(this.candle, "FlameOuter", this.flameOuterMaterial, 6.4 - 7)
    this.flameCore = this.flamePart(this.candle, "FlameCore", this.flameCoreMaterial, 6.0 - 7)
    // Warm candlelight that spreads over the bed, photo and pet once the candle is lit.
    const glowSo = this.child(this.candle, "CandleGlow", new vec3(0, 8, 0))
    this.glow = glowSo.createComponent("Component.LightSource") as LightSource
    this.glow.lightType = LightType.Point
    this.glow.color = new vec3(1, 0.68, 0.35)
    this.glow.intensity = 0
    this.glow.falloffRange = 140
  }

  private buildMatchbox(): void {
    // A small red matchbox beside the candle (sleeve over a pale tray).
    this.matchbox = this.child(this.root, "Matchbox", POS_MATCHBOX)
    this.matchbox.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0.4, 0))
    this.box(this.matchbox, "Tray", new vec3(11, 3, 6.6), new vec3(-1.6, 1.5, 0), this.tint(new vec4(0.92, 0.86, 0.7, 1)))
    this.box(this.matchbox, "Sleeve", new vec3(8, 3.6, 7.2), new vec3(1, 1.8, 0), this.tint(new vec4(0.85, 0.18, 0.12, 1)))
  }

  private buildMatch(): void {
    const start = POS_MATCHBOX.add(new vec3(0, 3.6 + 0.5, 0))
    const so = this.child(this.root, "Match", start)
    so.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0.4, 0))
    this.matchVisual = this.child(so, "MatchVisual", vec3.zero())
    this.box(this.matchVisual, "Stick", new vec3(9, 0.6, 0.6), vec3.zero(), this.tint(new vec4(0.93, 0.8, 0.55, 1)))
    this.matchHead = this.child(this.matchVisual, "Head", new vec3(4.8, 0, 0))
    this.sphere(this.matchHead, new vec3(0.8, 0.65, 0.65), this.tint(new vec4(0.6, 0.08, 0.06, 1)))
    this.matchFlame = this.child(this.matchHead, "MatchFlame", new vec3(0, 0.4, 0))
    const outer = this.child(this.matchFlame, "Outer", new vec3(0, 1.2, 0))
    this.sphere(outer, new vec3(0.9, 1.7, 0.9), this.flameOuterMaterial)
    const core = this.child(this.matchFlame, "Core", new vec3(0, 0.9, 0))
    this.sphere(core, new vec3(0.5, 1.0, 0.5), this.flameCoreMaterial)
    this.matchFlame.enabled = false
    // A generous hit box so the thin match is easy to pinch.
    this.makeInteractable(so, new vec3(13, 5, 6), this.matchVisual)
    this.match = this.makeLiftable(so, 0.5, {
      thin: true,
      onPick: () => this.onMatchPicked(),
      onRelease: () => {
        this.tiltMatch(false)
        // A lit match burns a few seconds after it is put down, then goes out.
        if (this.matchLit && !this.candleLit) {
          this.delay(4, () => {
            if (!this.match.held && !this.candleLit) this.putOutMatch()
          })
        }
        return true
      },
    })
  }

  private buildDish(): void {
    this.dish = this.child(this.root, "Dish", POS_DISH)
    const v = this.child(this.dish, "DishVisual", new vec3(0, 1, 0))
    this.sphere(v, new vec3(7.5, 1, 7.5), this.tint(new vec4(0.72, 0.84, 0.95, 1)))
  }

  private buildTreat(i: number): void {
    const home = POS_DISH.add(new vec3(-2.5 + i * 5, 2.8, i * 1.5))
    const so = this.child(this.root, "Treat" + i, home)
    const v = this.child(so, "TreatVisual", vec3.zero())
    v.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0.6 + i, 0))
    this.boneShape(v, 4.6, 1.5, this.tint(new vec4(0.62, 0.38, 0.18, 1)))
    this.makeInteractable(so, new vec3(9, 6, 9), v)
    const treat: Treat = {lift: null as unknown as Liftable, home, state: "dish"}
    treat.lift = this.makeLiftable(so, 0.8, {
      onPick: () => (treat.state = "held"),
      onRelease: () => this.onTreatReleased(treat),
      onLand: () => {
        treat.state = this.flatDist(so.getTransform().getLocalPosition(), POS_DISH) < 8 ? "dish" : "floor"
      },
    })
    this.treats.push(treat)
  }

  /** Pinch the photo: it comes up to eye level, large, with the note beside it. Pinch again to put it back. */
  private toggleNote(): void {
    if (!this.placed) return
    this.noteOpen = !this.noteOpen
    this.play("tap")
    if (this.noteOpen) {
      this.frameSolid.off = true
      this.ui.hideHint()
      const v = this.readingSpots()
      this.readCard = v.card
      this.ui.showNote(v.card, this.petName, this.noteText)
      this.ui.hidePlaque()
    } else {
      this.ui.hideNote()
      const t = this.frame.getTransform()
      const from = t.getLocalPosition()
      const r0 = t.getLocalRotation()
      const s0 = t.getLocalScale().x
      animate({
        duration: 0.5,
        easing: "ease-in-out-quad",
        update: (k: number) => {
          t.setLocalPosition(vec3.lerp(from, POS_FRAME, k))
          t.setLocalRotation(quat.slerp(r0, quat.quatIdentity(), k))
          const s = s0 + (1 - s0) * k
          t.setLocalScale(new vec3(s, s, s))
        },
        ended: () => {
          this.frameSolid.off = false
          if (this.noteOpen) return
          this.ui.showPlaque(this.toWorld(POS_FRAME.add(new vec3(0, 36, 0))), this.petName, this.petYears)
          if (!this.candleLit) this.showMatchHint()
        },
      })
    }
    print("TheirSpot: photo " + (this.noteOpen ? "lifted" : "put back"))
  }

  /** Where the lifted photo and its reading card sit: at eye level, centered in view. */
  private readingSpots(): {photo: vec3; card: vec3} {
    const cam = this.camera.getTransform()
    const eye = cam.getWorldPosition()
    // Follow where the user is looking (they are usually looking down at the memorial).
    const f = cam.forward.uniformScale(-1).normalize()
    let flat = new vec3(f.x, 0, f.z)
    flat = flat.length > 0.01 ? flat.normalize() : new vec3(0, 0, -1)
    const right = new vec3(-flat.z, 0, flat.x)
    const center = eye.add(f.uniformScale(this.photoViewDistanceCm))
    return {
      photo: center.add(right.uniformScale(-10)),
      card: center.add(right.uniformScale(10)),
    }
  }

  private updateReading(dt: number): void {
    const v = this.readingSpots()
    const k = Math.min(1, dt * 5)
    const t = this.frame.getTransform()
    const s = t.getLocalScale().x + (this.photoViewScale - t.getLocalScale().x) * k
    t.setLocalScale(new vec3(s, s, s))
    const eye = this.toLocal(this.camera.getTransform().getWorldPosition())
    const photo = this.toLocal(v.photo)
    const look = eye.sub(photo)
    const pitch = -Math.atan2(look.y, Math.sqrt(look.x * look.x + look.z * look.z))
    const rot = quat.fromEulerAngles(pitch, Math.atan2(look.x, look.z), 0)
    t.setLocalRotation(quat.slerp(t.getLocalRotation(), rot, k))
    // The frame's origin is its base; hold it so the photo's middle sits at the reading spot.
    const target = photo.sub(rot.multiplyVec3(vec3.up()).uniformScale(15.2 * s))
    t.setLocalPosition(vec3.lerp(t.getLocalPosition(), target, k))
    this.readCard = vec3.lerp(this.readCard, v.card, k)
    this.ui.moveNote(this.readCard)
  }

  private addPhoto(frame: SceneObject): void {
    const photo = this.child(frame, "Photo", new vec3(0, 15.2, 2.2))
    photo.getTransform().setLocalRotation(quat.fromEulerAngles(-0.2, 0, 0))
    const rmv = photo.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = buildQuadMesh(11.5, 15.5)
    const mat = this.photoMaterial.clone()
    mat.mainPass.baseTex = this.petPhoto
    rmv.mainMaterial = mat
  }

  private flamePart(parent: SceneObject, name: string, mat: Material, y: number): SceneObject {
    const so = this.child(parent, name, new vec3(0, y, 0))
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.sphereMesh
    rmv.mainMaterial = mat
    so.enabled = false
    return so
  }

  private buildFlower(i: number): void {
    const home = new vec3(POS_BASKET.x - 5 + (i % 3) * 5, 8, POS_BASKET.z - 3 + Math.floor(i / 3) * 6)
    const wrapper = this.child(this.root, "Flower" + i, home)
    const visual = this.child(wrapper, "FlowerVisual", new vec3(0, -6, 0))
    const inst = FLOWER.instantiate(visual)
    inst.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI + (i - 2) * 0.5, 0))
    this.makeInteractable(wrapper, new vec3(9, 14, 9), visual, new vec3(0, 1, 0))
    // Stand the flower on the basket's floor.
    const p = wrapper.getTransform().getLocalPosition()
    const rest = new vec3(p.x, this.solids.surfaceAt(p.x, p.z) + 7, p.z)
    wrapper.getTransform().setLocalPosition(rest)
    this.flowerHome.push(rest)
    const lift: Liftable = this.makeLiftable(wrapper, 7, {
      rideable: true,
      onPick: () => {
        this.unride(lift)
        visual.getTransform().setLocalRotation(quat.quatIdentity())
      },
      onRelease: () => this.onFlowerReleased(i),
      onLand: () => {
        if (this.flatDist(wrapper.getTransform().getLocalPosition(), POS_BASKET) > 12) {
          visual.getTransform().setLocalRotation(quat.fromEulerAngles(0.18, (i - 2) * 0.5, i % 2 ? 0.15 : -0.15))
          this.play("flower")
          print("TheirSpot: flower placed " + i)
        }
      },
    })
    this.flowers.push(lift)
  }

  private buildPet(): void {
    this.petRoot = this.child(this.root, "Pet", POS_PET_APPEAR)
    const yaw = this.child(this.petRoot, "PetYaw", vec3.zero())
    const bob = this.child(yaw, "PetBob", vec3.zero())
    this.petBob = bob
    const awake = this.child(bob, "PetAwake", vec3.zero())
    DOG.instantiate(awake)
    const mouth = this.child(yaw, "PetMouth", new vec3(0, 14, -17))
    // The sleeping pose belongs to the bed, so lifting the bed carries the sleeping pup.
    const b = this.bed.getTransform().getLocalPosition()
    const c = this.solids.center(this.bedSolid)
    this.petSleeping = this.child(this.bed, "PetSleeping", new vec3(c.x - b.x, BED_CUSHION_CM - this.bedSolid.baseY, c.z - b.z))
    const sleepInst = DOG_SLEEP.instantiate(this.petSleeping)
    sleepInst.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI * 0.85, 0))
    this.petSleeping.enabled = false
    this.pet = new TheirSpotPet(this.petRoot, yaw, bob, awake, this.petSleeping, mouth, () =>
      this.toLocal(this.camera.getTransform().getWorldPosition()),
    )
    this.pet.speedCmPerSec = this.petSpeedCmPerSec
    // The pup's size, so she stops at the bed's edge instead of sinking into it.
    this.pet.bodyRadius = Math.max(10, this.measureRadius(awake))
    this.petBackCm = new TheirSpotSolids(this.root).add("measure back", awake).top * 0.78
    this.barkAudio = this.audioOn(this.petRoot, BARKS[0], true)

    // Petting: a hit box that moves with the pet (unit scale, child of the turning node).
    const hit = this.child(yaw, "PetTouch", new vec3(0, 17, 0))
    const petTouch = this.makeInteractable(hit, new vec3(30, 32, 36), bob)
    petTouch.onTriggerStart.add(() => this.onPet())
  }

  private buildToys(): void {
    // The rubber ball rolls; the bone tumbles in the air and slides to a stop.
    this.toys.push(
      this.buildToy("Ball", POS_BALL_HOME, 3.5, true, (v) => this.sphere(v, new vec3(3.5, 3.5, 3.5), this.ballMaterial)),
    )
    this.toys.push(
      this.buildToy("Bone", POS_BONE_HOME, 1.4, false, (v) => this.boneShape(v, 11, 2.4, this.tint(new vec4(0.97, 0.93, 0.84, 1)))),
    )
  }

  private buildToy(name: string, home: vec3, radius: number, rolls: boolean, makeVisual: (v: SceneObject) => void): Toy {
    const node = this.child(this.root, name, new vec3(home.x, radius, home.z))
    const spin = this.child(node, name + "Spin", vec3.zero())
    const visual = this.child(spin, name + "Visual", vec3.zero())
    makeVisual(visual)
    const ball = new TheirSpotBall(node, spin)
    ball.radius = radius
    ball.rolls = rolls
    if (!rolls) ball.rollDecel = 300
    ball.ground = (x, z) => this.solids.surfaceAt(x, z)
    const size = rolls ? 16 : 18
    const inter = this.makeInteractable(node, new vec3(size, 14, size), spin)
    const manip = this.makeManipulation(node)
    const toy: Toy = {name, ball, inter, manip, home, restSpot: home, bounceAudio: this.audioOn(node, SFX_BOUNCE, true)}
    manip.onManipulationStart.add(() => {
      if (ball.state === "carried") return
      ball.beginHold()
    })
    manip.onManipulationEnd.add(() => this.onToyReleased(toy))
    ball.onBounce = () => {
      if (this.time - this.lastBounceAt > 0.15) {
        this.lastBounceAt = this.time
        toy.bounceAudio.play(1)
      }
    }
    ball.onLanded = () => this.onToyLanded(toy)
    return toy
  }

  // ───────────────────────── Flow ─────────────────────────

  private onPlace(): void {
    if (this.placed) return
    this.placed = true
    this.play("tap")
    this.ui.hideHint()
    this.popOut(this.ring, 0.3, () => (this.ring.enabled = false))
    const order = [this.bed, this.frame, this.candle, this.matchbox, this.basket, this.dish]
    order.forEach((so, i) => this.delay(0.15 + i * 0.22, () => this.popIn(so, 0.45)))
    this.delay(0.75, () => {
      if (!this.noteOpen) this.ui.showPlaque(this.toWorld(POS_FRAME.add(new vec3(0, 36, 0))), this.petName, this.petYears)
    })
    this.delay(1.3, () => this.popIn(this.match.so, 0.3))
    this.flowers.forEach((f, i) => this.delay(1.4 + i * 0.08, () => this.popIn(f.so, 0.35)))
    this.treats.forEach((t, i) => this.delay(1.6 + i * 0.1, () => this.popIn(t.lift.so, 0.3)))
    this.delay(2.2, () => {
      if (!this.candleLit && !this.noteOpen) this.showMatchHint()
    })
    this.startMusic()
    print("TheirSpot: placed")
  }

  // ── Match and candle ──

  private showMatchHint(): void {
    this.ui.showHint(this.toWorld(POS_MATCHBOX.add(new vec3(-6, 17, 10))), "Strike a match")
  }

  private onMatchPicked(): void {
    this.tiltMatch(true)
    this.rubCm = 0
    this.lastHead = null
    if (this.candleLit || this.matchLit) return
    this.ui.showHint(this.toWorld(POS_MATCHBOX.add(new vec3(-6, 17, 10))), "Rub it on the box")
  }

  private rubCm = 0
  private lastHead: vec3 | null = null

  /** While the unlit match is held, rubbing its head across the box strikes it. */
  private updateStrike(dt: number): void {
    if (!this.match.held || this.matchLit || this.candleLit) {
      this.lastHead = null
      return
    }
    const head = this.toLocal(this.matchHead.getTransform().getWorldPosition())
    const onBox = this.flatDist(head, POS_MATCHBOX) < 10 && head.y < 3.6 + 5
    if (onBox && this.lastHead) {
      this.rubCm += this.flatDist(head, this.lastHead)
      if (this.rubCm > 6) this.strikeMatch()
    } else {
      this.rubCm = Math.max(0, this.rubCm - dt * 4)
    }
    this.lastHead = head
  }

  private strikeMatch(): void {
    if (this.matchLit) return
    this.matchLit = true
    this.matchFlame.enabled = true
    this.matchFlame.getTransform().setLocalScale(vec3.one())
    this.play("tap")
    this.delay(0.08, () => this.play("candle"))
    this.ui.showHint(this.toWorld(POS_CANDLE.add(new vec3(-8, 20, 10))), "Light the candle")
    print("TheirSpot: match struck")
  }

  /** Held matches tip their head up, the way a match is held. */
  private tiltMatch(up: boolean): void {
    const t = this.matchVisual.getTransform()
    const r0 = t.getLocalRotation()
    const r1 = up ? quat.fromEulerAngles(0, 0, 0.9) : quat.quatIdentity()
    animate({duration: 0.2, easing: "ease-out-quad", update: (k: number) => t.setLocalRotation(quat.slerp(r0, r1, k))})
  }

  private putOutMatch(): void {
    if (!this.matchLit) return
    this.matchLit = false
    const t = this.matchFlame.getTransform()
    animate({
      duration: 0.5,
      easing: "ease-in-quad",
      update: (k: number) => {
        const s = Math.max(0.01, 1 - k)
        t.setLocalScale(new vec3(s, s, s))
      },
      ended: () => (this.matchFlame.enabled = false),
    })
  }

  private wickWorld(): vec3 {
    return this.flameCore.getTransform().getWorldPosition()
  }

  private onLightCandle(): void {
    if (!this.placed || this.candleLit) return
    this.candleLit = true
    this.ui.hideHint()
    this.play("candle")
    this.flameCore.enabled = true
    this.flameOuter.enabled = true
    animate({duration: 1.6, easing: "ease-out-quad", update: (k: number) => (this.glowTarget = k * this.glowIntensity)})
    this.delay(1.2, () => this.putOutMatch())
    print("TheirSpot: candle lit")
    this.delay(0.7, () => {
      this.pet.appearAt(this.petSpot(POS_PET_APPEAR))
      this.play("appear")
      this.popIn(this.petRoot, 1.2)
      print("TheirSpot: pet appeared")
    })
    this.delay(2.2, () => {
      for (const toy of this.toys) {
        toy.ball.restAt(toy.home)
        toy.restSpot = toy.home
        this.popIn(toy.ball.getNode(), 0.4)
      }
    })
  }

  // ── Flowers ──

  private onFlowerReleased(i: number): boolean {
    const so = this.flowers[i].so
    const p = so.getTransform().getLocalPosition()
    if (this.flatDist(p, POS_BED) > 120) {
      // Let go far from the memorial: it goes back to the basket.
      this.tweenLocal(so, this.flowerHome[i], 0.35)
      return false
    }
    // Let go over the pup: it falls onto her back (see lateUpdate) and rides along.
    return true
  }

  /** Whether a floor point is over the pup's back (she is awake and on the floor). */
  private overPet(p: vec3): boolean {
    if (!this.petRoot.enabled || this.resting || this.pet.mood === "hidden") return false
    return this.flatDist(p, this.pet.getPosition()) < this.pet.bodyRadius * 0.6
  }

  /** A flower landed on her back: it now moves, hops and twirls with her. */
  private ride(l: Liftable): void {
    l.so.setParentPreserveWorldTransform(this.petBob)
    l.onPet = true
    print("TheirSpot: flower on pet")
  }

  private unride(l: Liftable): void {
    if (!l.onPet) return
    l.so.setParentPreserveWorldTransform(this.root)
    l.onPet = false
  }

  /** When she curls up in bed, the flowers on her back settle onto the bed with her. */
  private settleRiders(): void {
    for (const l of this.flowers) {
      if (!l.onPet) continue
      // Still off the memorial root (now on the bed), so the floor logic leaves it alone.
      l.so.setParentPreserveWorldTransform(this.bed)
      const t = l.so.getTransform()
      const p = t.getLocalPosition()
      this.tweenLocal(l.so, new vec3(p.x, p.y - Math.max(0, this.petBackCm - 12), p.z), 0.4)
    }
  }

  // ── Pet ──

  private onPet(): boolean {
    if (this.pet.mood !== "idle" || this.petBusy) return false
    this.petCount++
    // Every other pet, a happy twirl instead of a hop.
    if (this.petCount % 2 === 0) this.pet.twirl()
    else this.pet.happyHop()
    this.ui.showHearts(this.petRoot.getTransform().getWorldPosition().add(new vec3(0, 38, 0)))
    this.bark()
    print("TheirSpot: pet petted")
    return true
  }

  /** Walks the pet to a point, hopping up when it is on the bed or basket. */
  private petGoTo(target: vec3, done: () => void): void {
    this.petDown(() => {
      if (this.resting) return
      this.pet.obstacles = this.solids.obstacles(PET_STEP_CM)
      const surf = this.solids.surfaceAt(target.x, target.z)
      const s = surf > 2 ? this.solids.containing(target.x, target.z) : null
      if (!s) {
        this.pet.walkTo(this.petSpot(target), done)
        return
      }
      const edge = this.petSpot(this.solids.edgePoint(s, this.pet.getPosition(), this.pet.bodyRadius + 4))
      this.pet.walkTo(edge, () => {
        if (this.resting) return
        this.pet.hop(new vec3(target.x, surf, target.z), surf + 9, 0.55, done)
      })
    })
  }

  /** Hops the pet down to the floor first if it is up on something. */
  private petDown(then: () => void): void {
    const p = this.pet.getPosition()
    if (p.y < 1) {
      then()
      return
    }
    const s = this.solids.containing(p.x, p.z)
    const out = this.petSpot(s ? this.solids.edgePoint(s, this.toLocal(this.camera.getTransform().getWorldPosition()), this.pet.bodyRadius + 4) : new vec3(p.x, 0, p.z + 20))
    this.pet.hop(out, 10, 0.5, then)
  }

  /** When the pet is free: eat a dropped treat first, then fetch any toy lying away from its spot. */
  private nextChore(): void {
    if (this.petBusy || this.resting || !this.petRoot.enabled || this.pet.mood !== "idle") return
    const treat = this.treats.find((t) => t.state === "floor")
    if (treat) {
      this.goEat(treat)
      return
    }
    const toy = this.toys.find(
      (t) =>
        t.ball.state === "resting" &&
        t.ball.getNode().enabled &&
        this.flatDist(t.ball.getNode().getTransform().getLocalPosition(), t.restSpot) > 12,
    )
    if (toy) this.goFetch(toy)
  }

  private goFetch(toy: Toy): void {
    this.petBusy = true
    const node = toy.ball.getNode()
    this.petGoTo(node.getTransform().getLocalPosition(), () => {
      if (this.resting) return
      // A little pounce onto the toy, then carry it back.
      this.pet.hop(this.pet.getPosition(), 7, 0.35, () => {
        if (this.resting) return
        if (toy.ball.state !== "resting") {
          this.petBusy = false
          return
        }
        toy.ball.state = "carried"
        toy.inter.enabled = false
        node.setParent(this.pet.getMouth())
        node.getTransform().setLocalPosition(vec3.zero())
        node.getTransform().setLocalRotation(quat.quatIdentity())
        this.petDown(() => {
          if (this.resting) return
          this.pet.obstacles = this.solids.obstacles(PET_STEP_CM)
          this.pet.walkTo(this.petSpot(POS_PET_WAIT), () => this.onPetReturned(toy))
        })
      })
    })
  }

  private onPetReturned(toy: Toy): void {
    if (this.resting) return
    const node = toy.ball.getNode()
    const drop = this.toLocal(this.pet.getMouth().getTransform().getWorldPosition())
    node.setParent(this.root)
    node.getTransform().setLocalRotation(quat.quatIdentity())
    toy.ball.restAt(drop)
    toy.restSpot = node.getTransform().getLocalPosition()
    toy.inter.enabled = true
    this.fetchCount++
    this.barkFrom(this.petRoot)
    this.petBusy = false
    print("TheirSpot: fetch complete " + toy.name + " " + this.fetchCount)
    if (this.fetchCount === 1) {
      this.ui.showRest(this.toWorld(new vec3(0, 34, 34)))
      this.ui.onRest.add(() => this.onRest())
    }
  }

  private onToyReleased(toy: Toy): void {
    if (toy.ball.state !== "held") return
    this.play("throw")
    toy.ball.release(this.awayFromUser(toy.ball.getNode()))
    toy.inter.enabled = false
    print("TheirSpot: " + toy.name + " thrown")
  }

  private onToyLanded(toy: Toy): void {
    toy.inter.enabled = true
    if (!this.isInView(toy.ball.getNode().getTransform().getWorldPosition())) {
      // Out of view: a soft bark from where the toy came to rest points the user to it.
      this.barkFrom(toy.ball.getNode())
    }
  }

  // ── Treats ──

  private onTreatReleased(treat: Treat): boolean {
    const so = treat.lift.so
    if (this.petCanEat() && this.nearMouth(so, 24)) {
      // Let go right by the pup's mouth: she takes it from your hand.
      this.eat(treat)
      return false
    }
    treat.state = "falling"
    return true
  }

  private petCanEat(): boolean {
    return this.petRoot.enabled && !this.resting && !this.petBusy && this.pet.mood === "idle"
  }

  private nearMouth(so: SceneObject, cm: number): boolean {
    return so.getTransform().getWorldPosition().distance(this.pet.getMouth().getTransform().getWorldPosition()) < cm
  }

  private goEat(treat: Treat): void {
    this.petBusy = true
    this.petGoTo(treat.lift.so.getTransform().getLocalPosition(), () => {
      this.petBusy = false
      if (this.resting || treat.state !== "floor") return
      this.eat(treat)
    })
  }

  private eat(treat: Treat): void {
    treat.state = "eaten"
    const so = treat.lift.so
    this.pet.setBegging(false)
    this.tweenWorld(so, this.pet.getMouth().getTransform().getWorldPosition(), 0.18)
    this.delay(0.18, () => {
      this.play("tap")
      this.popOut(so, 0.2, () => (so.enabled = false))
      this.delay(0.3, () => {
        this.pet.happyHop()
        this.ui.showHearts(this.petRoot.getTransform().getWorldPosition().add(new vec3(0, 38, 0)))
      })
    })
    print("TheirSpot: treat eaten")
    // A fresh biscuit appears on the dish.
    this.delay(2.5, () => {
      if (this.resting) return
      so.getTransform().setLocalPosition(treat.home)
      treat.state = "dish"
      this.popIn(so, 0.3)
    })
  }

  // ── Rest ──

  private onRest(): void {
    if (this.resting) return
    this.resting = true
    this.play("tap")
    this.ui.hideRest()
    this.pet.setBegging(false)
    // The toys and treats are put away for the night.
    for (const toy of this.toys) {
      const node = toy.ball.getNode()
      const at = node.getTransform().getWorldPosition()
      node.setParent(this.root)
      node.getTransform().setWorldPosition(at)
      this.popOut(node, 0.4, () => (node.enabled = false))
    }
    // Walk to the bed's open front, hop over the rim, then curl up on the cushion.
    const go = () => {
      const c = this.solids.center(this.bedSolid)
      const front = this.petSpot(new vec3(c.x, 0, c.z + this.bedSolid.radius + this.pet.bodyRadius + 2))
      this.pet.obstacles = this.solids.obstacles(PET_STEP_CM)
      this.pet.walkTo(front, () => {
        this.pet.hop(new vec3(c.x, c.y + BED_CUSHION_CM, c.z + 4), 16, 0.6, () => {
          this.pet.sleep()
          this.settleRiders()
          print("TheirSpot: pet resting")
        })
      })
    }
    if (this.pet.mood === "hopping") this.delay(0.7, () => this.petDown(go))
    else this.petDown(go)
  }

  // ───────────────────────── Preview test keys ─────────────────────────

  private nextTestFlower = 0

  private bindTestKeys(): void {
    this.createEvent("KeyPressEvent").bind((e: KeyPressEvent) => {
      const k = e.key
      if (k === Keys.P) this.onPlace()
      else if (k === Keys.C) this.testLightCandle()
      else if (k === Keys.F) this.testPlaceFlower()
      else if (k === Keys.T) this.testThrow(0)
      else if (k === Keys.B) this.testThrow(1)
      else if (k === Keys.G) this.testFeed()
      else if (k === Keys.R && this.fetchCount > 0) this.onRest()
      else if (k === Keys.H) this.onPet()
      else if (k === Keys.N) this.toggleNote()
      else if (k === Keys.D) this.playDemo()
      else if (k === Keys.L) this.testLiftBed()
      else if (k === Keys.K) this.logPositions()
    })
  }

  /** Preview check: where the liftable things are (memorial-local cm). */
  private logPositions(): void {
    for (const l of this.liftables) {
      print("TheirSpot: at " + l.so.name + " " + l.so.getTransform().getLocalPosition().toString() + (l.held ? " held" : "") + (l.falling ? " falling" : "") + (l.so.enabled ? "" : " hidden"))
    }
    print("TheirSpot: at Pet " + this.pet.getPosition().toString() + " " + this.pet.mood)
    const inst = this.bed.getChild(0)
    const rmvs: string[] = []
    const visit = (o: SceneObject) => {
      for (const v of o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]) {
        rmvs.push(o.name + " en=" + v.enabled + " hier=" + o.isEnabledInHierarchy + " ws=" + o.getTransform().getWorldScale().toString())
      }
      for (let i = 0; i < o.getChildrenCount(); i++) visit(o.getChild(i))
    }
    visit(this.bed)
    print("TheirSpot: bed wrapper scale " + this.bed.getTransform().getLocalScale().toString() + " inst " + inst.name + " scale " + inst.getTransform().getLocalScale().toString() + " visuals: " + rmvs.join(" | "))
  }

  /** Same as pinching the bed, carrying it aside, and letting go: it drops back to the floor. */
  private testLiftBed(): void {
    const l = this.liftables.find((x) => x.so === this.bed)
    if (!l || !this.placed || this.scripted) return
    this.scripted = true
    l.held = true
    const t = this.bed.getTransform()
    const p = t.getLocalPosition()
    this.tweenLocal(this.bed, p.add(new vec3(0, 30, 0)), 0.6)
    this.delay(0.7, () => this.tweenLocal(this.bed, p.add(new vec3(-6, 30, -8)), 0.7))
    this.delay(1.6, () => {
      l.held = false
      this.drop(l)
      this.scripted = false
    })
  }

  /** Preview demo: the same handlers as the pinches, on a fixed timeline for recording. */
  private demoStarted = false

  private playDemo(): void {
    if (this.demoStarted) return
    this.demoStarted = true
    print("TheirSpot: demo start")
    // Timed to the narration (video/schedule.py).
    const steps: [number, () => void][] = [
      [2.48, () => this.onPlace()],
      [18.90, () => this.testStrike()],
      [22.82, () => this.testToWick()],
      [28.38, () => this.soon(() => this.onPet())],
      [30.96, () => this.soon(() => this.onPet())],
      [34.68, () => this.testPlaceFlower()],
      [35.98, () => this.testPlaceFlower()],
      [36.92, () => this.testPlaceFlower()],
      [39.32, () => this.soon(() => this.testThrow(0))],
      [49.10, () => this.soon(() => this.testFeed(3.62))],
      [55.26, () => this.soon(() => this.testThrow(1))],
      [69.22, () => this.soon(() => { if (this.fetchCount === 0 || this.petBusy) return false; this.onRest(); return true })],
      [80.48, () => this.ensureNote()],
    ]
    for (const [t, fn] of steps) this.delay(t, fn)
  }

  private matchFrom = vec3.zero()

  /** Same as pinching the match, rubbing it across the box to strike it, then holding it to the wick. */
  private testLightCandle(): void {
    if (!this.testStrike()) return
    this.delay(2.4, () => this.testToWick())
  }

  /** Pinch the match out of the box and rub its head along the top until it strikes. */
  private testStrike(): boolean {
    if (!this.placed || this.candleLit || this.scripted) return false
    this.scripted = true
    const so = this.match.so
    const t = so.getTransform()
    this.matchFrom = t.getLocalPosition()
    this.match.held = true
    this.onMatchPicked()
    // Lay the match flat with only its head on the box top, so the stick stays above the box.
    this.delay(0.05, () => this.tiltMatch(false))
    const headOn = () => {
      const head = this.toLocal(this.matchHead.getTransform().getWorldPosition())
      return t.getLocalPosition().add(POS_MATCHBOX.add(new vec3(0, 3.6 + 1.2, 0)).sub(head))
    }
    this.delay(0.3, () => this.tweenLocal(so, headOn(), 0.4))
    for (let i = 0; i < 4; i++) {
      this.delay(0.75 + i * 0.2, () => {
        const base = headOn()
        this.tweenLocal(so, base.add(new vec3(i % 2 ? -4 : 4, 0, 0)), 0.18)
      })
    }
    this.delay(1.65, () => this.strikeMatch())
    this.delay(1.75, () => this.tweenLocal(so, t.getLocalPosition().add(new vec3(0, 7, 0)), 0.3))
    this.delay(1.95, () => this.tiltMatch(true))
    return true
  }

  /** Bring the lit match's flame to the wick, then lay the match back on the box. */
  private testToWick(): void {
    if (!this.matchLit || this.candleLit) return
    const so = this.match.so
    const t = so.getTransform()
    const head = this.toLocal(this.matchHead.getTransform().getWorldPosition())
    const wick = this.toLocal(this.wickWorld())
    this.tweenLocal(so, t.getLocalPosition().add(wick.sub(head)).add(new vec3(0, 2, 0)), 0.9)
    this.delay(1.6, () => {
      this.tiltMatch(false)
      this.tweenLocal(so, this.matchFrom, 0.6)
      this.delay(0.6, () => {
        this.match.held = false
        this.scripted = false
      })
    })
  }

  /** Opens the photo if it is not open yet. */
  private ensureNote(): void {
    if (!this.noteOpen) this.toggleNote()
  }

  private testPlaceFlower(): void {
    if (!this.placed || this.nextTestFlower >= this.flowers.length) return
    const i = this.nextTestFlower++
    const lift = this.flowers[i]
    // Hold the flower above a spot in front of the photo, then let go as a pinch would.
    const spots = [new vec3(26, 0, -18), new vec3(31, 0, -13), new vec3(37, 0, -12), new vec3(22, 0, -24), new vec3(40, 0, -18)]
    let spot = spots[i].add(new vec3(0, 26, 0))
    if (i === 2 && this.petRoot.enabled && !this.resting) spot = this.pet.getPosition().add(new vec3(0, 50, 0))
    lift.onPick?.()
    lift.so.getTransform().setLocalPosition(spot)
    if (lift.onRelease?.() !== false) {
      lift.falling = true
      lift.vy = 0
    }
  }

  private testThrow(index: number): boolean {
    const toy = this.toys[index]
    if (!this.candleLit || this.resting || this.petBusy || toy.ball.state !== "resting" || !toy.ball.getNode().enabled) return false
    // Picked up into the hand (toward the user), held a moment, then tossed in a gentle arc that stays in view.
    toy.ball.beginHold()
    toy.inter.enabled = false
    this.scripted = true
    const node = toy.ball.getNode()
    const p0 = node.getTransform().getLocalPosition()
    const eye = this.toLocal(this.camera.getTransform().getWorldPosition())
    const hand = new vec3(p0.x + (eye.x - p0.x) * 0.3, 58, p0.z + (eye.z - p0.z) * 0.3)
    this.tweenLocal(node, hand, 0.7)
    this.delay(0.75, () => this.tweenLocal(node, hand.add(new vec3(0, 8, 6)), 0.3))
    this.delay(1.1, () => {
      this.play("throw")
      const aim = index === 0 ? new vec3(-0.6, 0, -0.8).normalize().uniformScale(55) : new vec3(-0.7, 0, -0.7).normalize().uniformScale(65)
      toy.ball.release(this.awayFromUser(node), aim)
      this.scripted = false
      print("TheirSpot: " + toy.name + " thrown")
    })
    return true
  }

  /** Runs a demo step now, or retries every half second until the pup is free. */
  private soon(fn: () => boolean, tries: number = 20): void {
    if (fn() || tries <= 0) return
    this.delay(0.5, () => this.soon(fn, tries - 1))
  }

  /** Same as lifting a biscuit from the dish, holding it over the pup, then giving it. */
  private testFeed(eatAfter: number = 2.4): boolean {
    const treat = this.treats.find((t) => t.state === "dish")
    if (!treat || !this.petCanEat() || this.scripted) return false
    this.scripted = true
    treat.state = "held"
    treat.lift.held = true
    const so = treat.lift.so
    const mouth = this.toLocal(this.pet.getMouth().getTransform().getWorldPosition())
    const eye = this.toLocal(this.camera.getTransform().getWorldPosition())
    const toward = new vec3(eye.x - mouth.x, 0, eye.z - mouth.z).normalize()
    const above = mouth.add(new vec3(0, 14, 0)).add(toward.uniformScale(8))
    this.tweenLocal(so, above, 1.0)
    this.delay(eatAfter, () => {
      treat.lift.held = false
      this.scripted = false
      if (this.petCanEat()) this.eat(treat)
      else {
        treat.state = "falling"
        treat.lift.falling = true
      }
    })
    return true
  }

  // ───────────────────────── Frame loop ─────────────────────────

  private update(dt: number): void {
    if (!this.root) return
    this.time += dt
    if (this.pet) this.pet.update(dt)

    for (const toy of this.toys) {
      if (toy.ball.state === "held") toy.ball.recordHeld(toy.ball.getNode().getTransform().getLocalPosition(), dt)
      toy.ball.update(dt)
    }

    if (this.candleLit) {
      const f = 1 + Math.sin(this.time * 17) * 0.06 + Math.sin(this.time * 31) * 0.04
      this.glow.intensity = this.glowTarget * (0.92 + (f - 1) * 1.2)
      this.flameCore.getTransform().setLocalScale(new vec3(1.0, 2.0 * f, 1.0))
      this.flameOuter.getTransform().setLocalScale(new vec3(1.8 / f, 3.4 * f, 1.8 / f))
    }

    this.updateStrike(dt)

    if (this.matchLit) {
      // The match flame always points up, and lights the candle when it touches the wick.
      this.matchFlame.getTransform().setWorldRotation(this.root.getTransform().getWorldRotation())
      const f = 1 + Math.sin(this.time * 23) * 0.08
      this.matchFlame.getTransform().setLocalScale(new vec3(1 / f, f, 1 / f))
      if (!this.candleLit) {
        const d = this.matchFlame.getTransform().getWorldPosition().distance(this.wickWorld())
        if (d < 13) this.onLightCandle()
      }
    }

    // A biscuit held close makes the pup sit up and beg.
    if (this.petRoot && this.petRoot.enabled && !this.resting) {
      const held = this.treats.find((t) => t.state === "held")
      this.pet.setBegging(!!held && !this.petBusy && this.nearMouth(held.lift.so, 45))
    }

    if (this.noteOpen) this.updateReading(dt)

    if (this.placed && this.candleLit) this.nextChore()

    if (this.ring && this.ring.enabled && !this.placed) {
      const s = 1 + Math.sin(this.time * 2.4) * 0.04
      this.ring.getChild(0).getTransform().setLocalScale(new vec3(s, 1, s))
    }
  }

  /** After SIK has moved held things: keep them out of solids, drop released things, carry riders. */
  private lateUpdate(dt: number): void {
    if (!this.root || !this.solids) return

    // Things resting on a solid ride along when it is lifted.
    for (const s of this.solids.list) {
      const cur = s.so.getTransform().getLocalPosition()
      const delta = cur.sub(s.last)
      if (delta.length > 0.001 && s.so.enabled && !s.off) {
        const c = new vec3(s.last.x + s.offset.x, s.last.y - s.baseY, s.last.z + s.offset.z)
        const riders: SceneObject[] = []
        for (const l of this.liftables) {
          if (l.so === s.so || l.held || l.falling || l.onPet || !l.so.enabled) continue
          riders.push(l.so)
        }
        for (const toy of this.toys) if (toy.ball.state === "resting" && toy.ball.getNode().enabled) riders.push(toy.ball.getNode())
        for (const so of riders) {
          const p = so.getTransform().getLocalPosition()
          const d = Math.sqrt((p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z))
          if (d < s.radius && p.y > c.y + 0.5 && p.y < c.y + s.top + 6) so.getTransform().setLocalPosition(p.add(delta))
        }
      }
      s.last = cur
    }

    // The pup is solid too: on the floor she never stands inside the bed, basket or candle.
    if (this.pet && this.petRoot.enabled && !this.resting) {
      const pp = this.pet.getPosition()
      const m = this.pet.mood
      if (pp.y < 1 && (m === "idle" || m === "walking" || m === "twirling")) {
        const q = this.petSpot(pp)
        if (Math.abs(q.x - pp.x) + Math.abs(q.z - pp.z) > 0.01) this.petRoot.getTransform().setLocalPosition(q)
      }
    }

    for (const l of this.liftables) {
      if (!l.so.enabled || l.onPet) continue
      const t = l.so.getTransform()
      let p = t.getLocalPosition()
      // Keep everything within arm's reach of the memorial.
      if (isNaN(p.x) || isNaN(p.y) || isNaN(p.z)) {
        t.setLocalPosition(l.home)
        continue
      }
      const r = Math.sqrt(p.x * p.x + p.z * p.z)
      if (l.held && (r > PLAY_RADIUS || p.y > PLAY_HEIGHT)) {
        const k = r > PLAY_RADIUS ? PLAY_RADIUS / r : 1
        p = new vec3(p.x * k, Math.min(p.y, PLAY_HEIGHT), p.z * k)
        t.setLocalPosition(p)
      } else if (!l.held && r > PLAY_RADIUS + 20) {
        t.setLocalPosition(l.home)
        l.falling = false
        this.popIn(l.so, 0.4)
        print("TheirSpot: brought back " + l.so.name)
        continue
      }
      let floor = this.solids.surfaceAt(p.x, p.z, [l.so]) + l.restY
      const onBack = !l.held && l.rideable && this.overPet(p)
      if (onBack) floor = Math.max(floor, this.pet.getPosition().y + this.petBackCm + l.restY)
      if (l.held) {
        const min = l.thin ? l.restY : floor
        if (p.y < min) t.setLocalPosition(new vec3(p.x, min, p.z))
      } else if (l.falling) {
        l.vy += GRAVITY * dt
        const y = p.y - l.vy * dt
        if (y <= floor) {
          t.setLocalPosition(new vec3(p.x, floor, p.z))
          l.falling = false
          l.vy = 0
          if (onBack) this.ride(l)
          if (l.onLand) l.onLand()
        } else {
          t.setLocalPosition(new vec3(p.x, y, p.z))
        }
      }
    }

    for (const toy of this.toys) {
      if (toy.ball.state !== "held") continue
      const t = toy.ball.getNode().getTransform()
      const p = t.getLocalPosition()
      const floor = this.solids.surfaceAt(p.x, p.z) + toy.ball.radius
      if (p.y < floor) t.setLocalPosition(new vec3(p.x, floor, p.z))
    }
  }

  // ───────────────────────── Helpers ─────────────────────────

  private makeLiftable(
    so: SceneObject,
    restY: number,
    hooks: {thin?: boolean; rideable?: boolean; onPick?: () => void; onRelease?: () => boolean; onLand?: () => void} = {},
  ): Liftable {
    const manip = this.makeManipulation(so)
    const l: Liftable = {so, restY, manip, held: false, falling: false, vy: 0, home: so.getTransform().getLocalPosition(), ...hooks}
    manip.onManipulationStart.add(() => {
      if (this.scripted) return
      l.held = true
      l.falling = false
      if (l.onPick) l.onPick()
    })
    manip.onManipulationEnd.add(() => {
      if (!l.held) return
      l.held = false
      if (!l.onRelease || l.onRelease()) this.drop(l)
    })
    this.liftables.push(l)
    return l
  }

  /** Lets go of a liftable: big solid things first slide clear of whatever they would land in. */
  private drop(l: Liftable): void {
    const s = this.solids.of(l.so)
    if (s) this.solids.separate(s)
    l.falling = true
    l.vy = 0
  }

  private child(parent: SceneObject, name: string, localPos: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(localPos)
    return so
  }

  /** A box mesh child. */
  private box(parent: SceneObject, name: string, size: vec3, pos: vec3, mat: Material): SceneObject {
    const so = this.child(parent, name, pos)
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = buildBoxMesh(size.x, size.y, size.z)
    rmv.mainMaterial = mat
    return so
  }

  /** A sphere on `so` itself with the given radii in cm (the sphere mesh has radius 0.5). */
  private sphere(so: SceneObject, radii: vec3, mat: Material): void {
    so.getTransform().setLocalScale(radii.uniformScale(2))
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.sphereMesh
    rmv.mainMaterial = mat
  }

  /** A cartoon bone along X: a shaft with two round knobs at each end. */
  private boneShape(parent: SceneObject, length: number, thick: number, mat: Material): void {
    const shaft = this.child(parent, "Shaft", vec3.zero())
    this.sphere(shaft, new vec3(length / 2, thick * 0.32, thick * 0.32), mat)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const knob = this.child(parent, "Knob", new vec3((sx * length) / 2, 0, sz * thick * 0.3))
        this.sphere(knob, new vec3(thick * 0.42, thick * 0.42, thick * 0.42), mat)
      }
    }
  }

  private tintCache: {[k: string]: Material} = {}
  /** The lit ball material in another color. */
  private tint(color: vec4): Material {
    const key = color.toString()
    if (!this.tintCache[key]) {
      const m = this.ballMaterial.clone()
      m.mainPass.baseColor = color
      m.mainPass.roughness = 0.75
      this.tintCache[key] = m
    }
    return this.tintCache[key]
  }

  private makeInteractable(so: SceneObject, size: vec3, highlight: SceneObject, center: vec3 = vec3.zero()): Interactable {
    const collider = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = size
    collider.shape = shape
    collider.debugDrawEnabled = this.debugColliders
    if (center.length > 0) {
      // Collider shapes are centered on the object: lift the object to the middle and lower the visual to match.
      highlight.getTransform().setLocalPosition(highlight.getTransform().getLocalPosition().sub(center))
      so.getTransform().setLocalPosition(so.getTransform().getLocalPosition().add(center))
    }
    const inter = so.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3
    const base = highlight.getTransform().getLocalScale()
    inter.onHoverEnter.add(() => highlight.getTransform().setLocalScale(base.uniformScale(1.08)))
    inter.onHoverExit.add(() => highlight.getTransform().setLocalScale(base))
    return inter
  }

  private makeManipulation(so: SceneObject): InteractableManipulation {
    const m = so.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    m.setCanRotate(false)
    m.setCanScale(false)
    return m
  }

  /** Footprint radius of the meshes under an object (cm). */
  private measureRadius(so: SceneObject): number {
    const tmp = new TheirSpotSolids(this.root)
    return tmp.add("measure " + so.name, so).radius
  }

  /** A floor spot where the pet fits without overlapping the bed, basket or anything else. */
  private petSpot(p: vec3): vec3 {
    const q = this.solids.clearSpot(new vec3(p.x, 0, p.z), this.pet.bodyRadius + 2, PET_STEP_CM)
    return new vec3(q.x, 0, q.z)
  }

  private toWorld(local: vec3): vec3 {
    return this.root.getTransform().getWorldTransform().multiplyPoint(local)
  }

  private toLocal(world: vec3): vec3 {
    return this.root.getTransform().getInvertedWorldTransform().multiplyPoint(world)
  }

  private flatDist(a: vec3, b: vec3): number {
    const dx = a.x - b.x
    const dz = a.z - b.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  /** Horizontal direction pointing away from the user, in memorial-local space. */
  private awayFromUser(node: SceneObject): vec3 {
    const eye = this.toLocal(this.camera.getTransform().getWorldPosition())
    const p = node.getTransform().getLocalPosition()
    const d = new vec3(p.x - eye.x, 0, p.z - eye.z)
    return d.length > 0.01 ? d.normalize() : new vec3(0, 0, -1)
  }

  private isInView(world: vec3): boolean {
    const cam = this.camera.getTransform()
    const toP = world.sub(cam.getWorldPosition()).normalize()
    const fwd = cam.forward.uniformScale(-1).normalize()
    return toP.dot(fwd) > Math.cos((18 * Math.PI) / 180)
  }

  private popIn(so: SceneObject, duration: number): void {
    const t = so.getTransform()
    so.enabled = true
    t.setLocalScale(new vec3(0.01, 0.01, 0.01))
    animate({
      duration,
      easing: "ease-out-back",
      update: (k: number) => {
        const s = Math.max(0.01, k)
        t.setLocalScale(new vec3(s, s, s))
      },
      ended: () => t.setLocalScale(vec3.one()),
    })
  }

  private popOut(so: SceneObject, duration: number, done: () => void): void {
    const t = so.getTransform()
    animate({
      duration,
      easing: "ease-in-quad",
      update: (k: number) => {
        const s = Math.max(0.01, 1 - k)
        t.setLocalScale(new vec3(s, s, s))
      },
      ended: () => {
        t.setLocalScale(vec3.one())
        done()
      },
    })
  }

  private tweenLocal(so: SceneObject, to: vec3, duration: number): void {
    const t = so.getTransform()
    const from = t.getLocalPosition()
    animate({
      duration,
      easing: "ease-out-quad",
      update: (k: number) => t.setLocalPosition(vec3.lerp(from, to, k)),
    })
  }

  private tweenWorld(so: SceneObject, to: vec3, duration: number): void {
    const t = so.getTransform()
    const from = t.getWorldPosition()
    animate({
      duration,
      easing: "ease-in-quad",
      update: (k: number) => t.setWorldPosition(vec3.lerp(from, to, k)),
    })
  }

  private delay(seconds: number, fn: () => void): void {
    const ev = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    ev.bind(fn)
    ev.reset(seconds)
  }

  private setupAudio(): void {
    this.sfx["candle"] = this.audioOn(this.memorialAnchor, SFX_CANDLE, false)
    this.sfx["flower"] = this.audioOn(this.memorialAnchor, SFX_FLOWER, false)
    this.sfx["throw"] = this.audioOn(this.memorialAnchor, SFX_THROW, false)
    this.sfx["appear"] = this.audioOn(this.memorialAnchor, SFX_APPEAR, false)
    this.sfx["tap"] = this.audioOn(this.memorialAnchor, SFX_TAP, false)
    try {
      if (!this.camera.getComponent("Component.AudioListenerComponent")) {
        this.camera.createComponent("Component.AudioListenerComponent")
      }
    } catch (e) {
      print("TheirSpot: no audio listener: " + e)
    }
  }

  private audioOn(so: SceneObject, track: AudioTrackAsset, spatial: boolean): AudioComponent {
    const a = so.createComponent("Component.AudioComponent") as AudioComponent
    a.audioTrack = track
    a.playbackMode = Audio.PlaybackMode.LowLatency
    if (spatial) {
      try {
        a.spatialAudio.enabled = true
      } catch (e) {
        print("TheirSpot: spatial audio unavailable: " + e)
      }
    }
    return a
  }

  private play(key: string): void {
    const a = this.sfx[key]
    if (a) a.play(1)
  }

  private barkIndex = 0

  /** A different bark each time, so she never sounds like a loop. */
  private nextBark(): AudioTrackAsset {
    this.barkIndex = (this.barkIndex + 1 + Math.floor(Math.random() * (BARKS.length - 1))) % BARKS.length
    return BARKS[this.barkIndex]
  }

  private bark(): void {
    this.barkAudio.audioTrack = this.nextBark()
    this.barkAudio.play(1)
  }

  private barkFrom(so: SceneObject): void {
    if (so === this.petRoot) {
      this.bark()
      return
    }
    // Play the bark from the object's spot: borrow its bounce source for this call.
    const a = so.getComponent("Component.AudioComponent") as AudioComponent
    if (a) {
      a.audioTrack = this.nextBark()
      a.play(1)
      this.delay(1.3, () => (a.audioTrack = SFX_BOUNCE))
    }
  }

  private startMusic(): void {
    const a = this.memorialAnchor.createComponent("Component.AudioComponent") as AudioComponent
    a.audioTrack = MUSIC
    a.playbackMode = Audio.PlaybackMode.LowPower
    a.volume = this.musicVolume
    a.fadeInTime = 2
    a.play(-1)
  }
}
