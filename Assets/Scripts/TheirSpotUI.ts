// TheirSpotUI: every visible string in the Lens.
// Owns: the hint line, the name plaque, the "Rest now" button, the reading card shown
// beside the lifted photo, and the hearts.
// Passive view: the main script positions elements and shows/hides them; this module
// reports the button press through onRest. It holds no memorial state.

import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

type TextRole = "Headline1" | "Subheadline" | "Button" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Headline1: {size: 54, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500},
}
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = TYPE_SCALE[role].size * (distanceCm / 110)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

@component
export class TheirSpotUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">TheirSpotUI – hint, plaque and rest button</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Hint shown above the placement ring")
  hintText: string = "Choose their spot"

  @input
  @hint("Label on the button that lets the pet rest")
  restLabel: string = "Rest now"

  @input("vec4", "{1, 0.93, 0.82, 1}")
  @hint("Warm text color (keep it light: the display is additive)")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(1, 0.93, 0.82, 1)

  @input
  @hint("Approximate viewing distance in cm, used to scale text")
  @widget(new SliderWidget(60, 250, 5))
  viewDistanceCm: number = 140

  @input
  @hint("Extra multiplier on label size")
  @widget(new SliderWidget(1, 5, 0.25))
  textScale: number = 2.5

  @input("vec4", "{1, 0.55, 0.65, 1}")
  @hint("Color of the hearts when the pet is petted")
  @widget(new ColorWidget())
  heartColor: vec4 = new vec4(1, 0.55, 0.65, 1)

  @input
  @hint("Reading card width (cm), shown beside the lifted photo")
  @widget(new SliderWidget(10, 50, 1))
  cardWidthCm: number = 22

  @input
  @hint("Reading card height (cm)")
  @widget(new SliderWidget(8, 40, 1))
  cardHeightCm: number = 17

  @input
  @hint("Text size of the note on the reading card (shrinks to fit the card)")
  @widget(new SliderWidget(40, 400, 5))
  cardTextSize: number = 150
  @ui.group_end

  private _onRest = new Event<void>()
  get onRest(): PublicApi<void> {
    return this._onRest.publicApi()
  }

  private camera: SceneObject | null = null
  private hintRoot!: SceneObject
  private hintLine!: Text
  private plaqueRoot!: SceneObject
  private plaqueName!: Text
  private plaqueYears!: Text
  private restRoot!: SceneObject
  private noteRoot!: SceneObject
  private noteText!: Text
  private noteTitle!: Text
  private hearts: {so: SceneObject; t: Text; start: vec3; age: number}[] = []

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    this.hintRoot = this.makeLabelRoot("Hint")
    this.hintLine = this.addLine(this.hintRoot, this.hintText, "Headline1", 0, 40)
    this.hintLine.depthTest = false
    this.hintLine.renderOrder = 150

    this.plaqueRoot = this.makeLabelRoot("Plaque")
    this.plaqueName = this.addLine(this.plaqueRoot, "Name", "Subheadline", 2.4, 30)
    this.plaqueYears = this.addLine(this.plaqueRoot, "2012 – 2026", "Caption", -1.6, 30)

    this.restRoot = global.scene.createSceneObject("RestButton")
    this.restRoot.setParent(this.sceneObject)
    const btn = this.restRoot.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(22, 8, 1)
    this.addButtonLabel(this.restRoot, this.restLabel, 21)
    btn.onTriggerUp.add(() => this._onRest.invoke())

    // Reading card: a soft BackPlate with the pet's name and the note, shown at eye level
    // beside the lifted photo. It draws over the scene so nothing in the room can cut it.
    this.noteRoot = this.makeLabelRoot("Note")
    const plate = this.noteRoot.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(this.cardWidthCm, this.cardHeightCm)
    const content = global.scene.createSceneObject("NoteContent")
    content.setParent(this.noteRoot)
    content.getTransform().setLocalPosition(new vec3(0, 0, 1.0))
    const w = (this.cardWidthCm - 4) / 2
    const h = (this.cardHeightCm - 3) / 2
    this.noteTitle = this.addLine(content, "", "Headline1", h - 2.6, this.cardWidthCm - 4)
    this.noteTitle.size = this.cardTextSize * 1.35
    this.noteTitle.layoutRect = Rect.create(-w, w, -2.4, 2.4)
    this.noteTitle.verticalOverflow = VerticalOverflow.Shrink
    this.noteText = this.addLine(content, "", "Body", -2.4, this.cardWidthCm - 4)
    this.noteText.size = this.cardTextSize
    this.noteText.horizontalOverflow = HorizontalOverflow.Wrap
    this.noteText.verticalOverflow = VerticalOverflow.Shrink
    this.noteText.layoutRect = Rect.create(-w, w, -(h - 2.4), h - 2.4)
    for (const t of [this.noteTitle, this.noteText]) {
      t.depthTest = false
      t.renderOrder = 200
    }

    this.hintRoot.enabled = false
    this.plaqueRoot.enabled = false
    this.restRoot.enabled = false
    this.noteRoot.enabled = false

    this.createEvent("UpdateEvent").bind(() => {
      this.faceCamera()
      this.updateHearts(getDeltaTime())
    })
  }

  private updateHearts(dt: number): void {
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i]
      h.age += dt
      if (h.age < 0) {
        h.so.enabled = false
        continue
      }
      h.so.enabled = true
      const k = h.age / 1.4
      if (k >= 1) {
        h.so.destroy()
        this.hearts.splice(i, 1)
        continue
      }
      const tr = h.so.getTransform()
      tr.setWorldPosition(h.start.add(new vec3(Math.sin(h.age * 5) * 2, k * 22, 0)))
      if (this.camera) {
        const d = this.camera.getTransform().getWorldPosition().sub(tr.getWorldPosition())
        tr.setWorldRotation(quat.fromEulerAngles(0, Math.atan2(d.x, d.z), 0))
      }
      const c = this.heartColor
      h.t.textFill.color = new vec4(c.x, c.y, c.z, 1 - k)
    }
  }

  /** The camera the labels turn toward. */
  setCamera(camera: SceneObject): void {
    this.camera = camera
  }

  /** Shows the hint at a point; `text` replaces the default "Choose their spot". */
  showHint(worldPos: vec3, text?: string): void {
    this.hintLine.text = text || this.hintText
    this.place(this.hintRoot, worldPos)
  }
  hideHint(): void {
    this.hintRoot.enabled = false
  }

  showPlaque(worldPos: vec3, name: string, years: string): void {
    this.plaqueName.text = name
    this.plaqueYears.text = years
    this.place(this.plaqueRoot, worldPos)
  }

  hidePlaque(): void {
    this.plaqueRoot.enabled = false
  }

  /** The reading card beside the lifted photo. */
  showNote(worldPos: vec3, title: string, text: string): void {
    this.noteTitle.text = title
    this.noteText.text = text
    this.place(this.noteRoot, worldPos)
  }

  /** Keeps the reading card in view as the user moves. */
  moveNote(worldPos: vec3): void {
    this.noteRoot.getTransform().setWorldPosition(worldPos)
  }
  hideNote(): void {
    this.noteRoot.enabled = false
  }

  /** A few small hearts that float up from a point and fade. */
  showHearts(worldPos: vec3): void {
    for (let i = 0; i < 4; i++) {
      const so = global.scene.createSceneObject("Heart")
      so.setParent(this.sceneObject)
      const t = so.createComponent("Component.Text") as Text
      t.text = "\u2665"
      t.depthTest = true
      t.size = 200 + i * 30
      t.horizontalAlignment = HorizontalAlignment.Center
      t.verticalAlignment = VerticalAlignment.Center
      t.horizontalOverflow = HorizontalOverflow.Overflow
      t.verticalOverflow = VerticalOverflow.Overflow
      t.textFill.color = this.heartColor
      const start = worldPos.add(new vec3((i - 1.5) * 5, 0, 0))
      this.hearts.push({so, t, start, age: -i * 0.15})
    }
  }

  showRest(worldPos: vec3): void {
    this.place(this.restRoot, worldPos)
  }
  hideRest(): void {
    this.restRoot.enabled = false
  }

  /** World position of the rest button, for tests and the main script. */
  getRestButtonObject(): SceneObject {
    return this.restRoot
  }

  private place(root: SceneObject, worldPos: vec3): void {
    root.getTransform().setWorldPosition(worldPos)
    root.enabled = true
    this.faceCamera()
  }

  private faceCamera(): void {
    if (!this.camera) return
    const camPos = this.camera.getTransform().getWorldPosition()
    for (const root of [this.hintRoot, this.plaqueRoot, this.restRoot, this.noteRoot]) {
      if (!root.enabled) continue
      const t = root.getTransform()
      const p = t.getWorldPosition()
      const dir = camPos.sub(p)
      // Turn +Z (the text front) toward the camera; the reading card also tilts to face the eyes.
      const yaw = Math.atan2(dir.x, dir.z)
      const pitch = root === this.noteRoot ? -Math.atan2(dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z)) : 0
      t.setWorldRotation(quat.fromEulerAngles(pitch, yaw, 0))
    }
  }

  private makeLabelRoot(name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(this.sceneObject)
    return so
  }

  private addLine(parent: SceneObject, text: string, role: TextRole, y: number, widthCm: number): Text {
    const so = global.scene.createSceneObject("Line")
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(0, y, 0))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role, this.viewDistanceCm)
    t.size = t.size * this.textScale
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -2, 2)
    t.textFill.color = this.textColor
    return t
  }

  private addButtonLabel(parent: SceneObject, text: string, widthCm: number): void {
    const so = global.scene.createSceneObject("ButtonLabel")
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(0, 0, 0.08))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, "Button", this.viewDistanceCm)
    t.size = t.size * this.textScale
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -1.2, 1.2)
    t.textFill.color = new vec4(1, 1, 1, 1)
  }
}
