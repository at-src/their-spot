---
status: approved
---

# Design brief: Their Spot

## The one spatial moment
I'm at home, and my pet is back in the place they used to love, in their full glory, as if they were still alive. I light a candle for them, lay a few flowers, and then play with them.

Who it's for: anyone who has lost a pet they loved and still wants to see them again.

## Why it belongs on glasses
- Uses: draws in the world, leaves your body free.
- Why it's better than the phone or laptop version: on glasses the pet feels real. They are in 3D, at their real size, in my own room, in the spot that was theirs. On a phone they would be a picture behind glass. My hands are free to throw the ball and lay the flowers, and I'm looking at my pet, not at a screen.

## Product or overlay
- Type: product. The memorial and the pet are the experience, placed in my real room.
- What the real version would sense: only the floor where I choose to put it. Nothing is recognized.
- Stand-in for the preview: the preview room's floor stands in for my floor. A sample pet and a sample photo stand in for the user's own pet (default).

## Where things live
- Where the user is looking during the main task: down at the pet's spot on the floor, about 1 m in front of me (default), and across the floor when I throw the ball.
- The pet's spot: on the floor, about 1 to 1.5 m in front of me (default), chosen by me.
- Pet bed: on the floor at the spot, about 60 cm across (default).
- Photo and memory note: a framed photo of the pet by the bed, with their name and a short note about them (default).
- Candle: on the floor next to the photo (default).
- Flowers: a few flowers next to the bed that I can pick up (default).
- Food bowl: on the floor next to the bed (default).
- The pet: a dog at real size, about 35 cm long (default), near the bed.
- Ball: on the floor between me and the bed (default).
- The space around the spot: warm and calm, with gentle light from the candle. No dark content.

## Hands and input
Mouse = one hand pinching.
- Choose the spot: pinch the floor where the memorial should go (default).
- Candle: light it with a pinch (default).
- Flowers: grab a flower and put it by the photo or on the pet.
- Pet: pinch them and they react happily (default).
- Ball: grab it and throw it; the pet runs after it and brings it back.
- Photo: pinch it to bring it close and read the memory note (default).
- Targets are big and highlight when aimed at.
- No voice. No two-hand or custom gestures.

## When things show
- Start: only a hint to choose their spot (default).
- After choosing the spot: the bed, photo, candle, flowers and food bowl appear there.
- After lighting the candle: the pet appears (default).
- While playing: nothing else on screen, no text.
- Memory note: shows when I pinch the photo, hides when I pinch it again (default).
- If the ball goes out of view: the pet barks from where it is, so I can turn toward it (spatial sound) (default).

## Done criteria
Each one can be checked in Lens Studio's preview.
1. Choosing a spot on the floor places the memorial there: bed, photo, candle, flowers and food bowl.
2. Lighting the candle makes the pet appear.
3. Throwing the ball sends it across the floor, and the pet runs to it and brings it back.
4. Grabbing a flower and letting go by the photo or over the pet leaves it there.
5. Pinching the photo brings it close enough to read the memory note.

## Out of scope
- More than one pet in a memorial. Each memorial holds one pet and their memory note, because it is their own spot.
- Remembering the memorial between sessions.

## Risks and open questions
- The memorial and the play should feel like one gentle experience.
- How it feels to see the pet in a real room is feel unproven until real glasses.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
