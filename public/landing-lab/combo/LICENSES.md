# Third-party assets: combo (the `/welcome` frames)

STATUS: PARTIAL. The frames below were rendered offline in Blender in a worktree outside git
(`F:/worktrees/AppFront/homepage-v6`, since deleted; commit `9290d1c6`, 24-10-2026) and the commit message does not
list the source files. The per-asset list could not be recovered from the repository or from `F:/App/docs`.
Entries marked UNCONFIRMED must be checked against the render sources by whoever made the renders.
This file is a record of what is known, not a clearance.

The shipped files are renders (webp), not the source models or textures.

## What each part is

| Path | Content | Known source / licence |
| --- | --- | --- |
| `a/{1280,1920}/` (335 frames each) | intro: the printed plan turning into the maquette; last pose is pixel-aligned with maquette frame `f_199` | maquette assets: CC0 1.0, see `../maquette/LICENSES.md`. UNCONFIRMED for anything added after that file was written |
| `b/{1280,1920}/bridge2_*` (42), `ext_*` (103) | camera bridge and exterior of the house; `bridge_0024` shares its pose with cinema frame `b_045` | cinema assets: CC0 1.0 (Poly Haven), see `../cinema/LICENSES.md`. UNCONFIRMED whether the exterior uses other models |
| `b/{1280,1920}/int4_*` (542) | interior walkthrough (hall, rooms); `int_0000` shares its pose with cinema frame `b_119` | UNCONFIRMED. Furniture is likely from the Pascal item set (GLB licence UNCONFIRMED, see `vendor/pascal/NGUON.md`), Poly Haven CC0 and/or Sketchfab CC BY 4.0 items listed in `assets/appfront-items/LICENSES.md` |
| `c/a-registration.json`, `b/b-sequence.json`, `motion.json` | frame registration and pacing data | made for this project (project code) |

Known upstream pools used by sibling landing prototypes (all CC0 1.0, https://polyhaven.com/license): Poly Haven
textures and HDRIs (`public/landing/LICENSES.md`, `../cinema/LICENSES.md`, `../maquette/LICENSES.md`,
`vendor-extra/materials/LICENSE.md`).

## To close this file

1. Find the Blender scenes for `a`, `b` and the interior; list every imported model, texture and HDRI.
2. For each, fill a row (Asset / Kind / URL / Licence) in the format of `../cinema/LICENSES.md`.
3. If any is CC BY (for example Sketchfab), add the credit line to the `/welcome` footer.
4. If a source cannot be traced or is not licensed for commercial use, replace the frames or drop `combo/` from
   `/welcome` before any commercial release.
