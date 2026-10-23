# PFlow

**A free easing-curve editor for [EffectCraft](https://github.com/storytold/effectcraft).** Draw a Bezier curve, save it as a preset, and apply it to your selected keyframes in one click.

![PFlow panel](docs/screenshot.png)

> Independent, unofficial community script by Puuncture. Not affiliated with or endorsed by the EffectCraft authors or any other panel or company. Written from scratch against After Effects' documented scripting API, so it should also run in After Effects.

## Features
- **Visual curve editor.** Drag the two handles; hold **Shift** to snap to 0.05. Double-click the graph to reset to Linear.
- **Type or paste values.** Click the coordinate readout to enter `x1, y1, x2, y2` or paste a CSS `cubic-bezier(0.4, 0, 0.2, 1)`. The readout uses two decimal places; opening the editor preserves the curve's full precision.
- **Apply to keyframes.** Eases every pair of neighbouring selected keyframes, on any property (position, scale, opacity, shapes...), in one undo step. Speeds are scaled to each segment, so one curve fits any distance and duration.
- **Apply to both sides, only the out side (first key), or only the in side (second key).**
- **Live mode.** Re-applies the curve whenever you release a handle or pick a preset.
- **From Keys.** Reads the curve of the selected keyframes back into the editor.
- **Flip.** Reverses the curve.
- **Thumbnail preset library.** Preview each easing curve; the selected preset is highlighted in blue. Choose **default** (25 reference curves), **custom** (saved curves), or **all** (all built-ins and saved curves). The extra Sine, CSS Ease, and Material presets remain available under **all**.
- **30 built-in presets:** Sine, Quad, Cubic, Quart, Quint, Expo, Circ and Back (In / Out / In-Out), plus Linear, Ease In, Ease Out, Ease In-Out, CSS Ease and Material Standard.
- **Your own presets.** Press **+** or the **star** to name and save a curve. The pencil and delete icons manage the selected custom preset. Presets are stored in EffectCraft's script settings and survive restarts.
- **Dark two-column layout.** Host-aware colors match EffectCraft's dark panels without bright gray canvas backgrounds. Vector toolbar icons have hover and pressed feedback.
- **Preset scrolling.** Drag vertically within the gallery, drag the slim scroll thumb, or click its up/down arrows. Wheel scrolling is also supported on hosts that forward wheel events to scripts. The current EffectCraft ScriptUI bridge does not forward them.
- **Host sizing.** EffectCraft uses a compact 480 × 340 layout to avoid the previous oversized outer scroll area. Its current ScriptUI bridge does not notify scripts when a dock is resized, so automatic graph resizing there is limited by the host. Hosts that deliver resize callbacks reflow the panel normally.

## Requirements
EffectCraft with ScriptUI panel support (any recent version). No other dependencies.

## Install
**Option A: from the menu (easiest)**
1. Download `PFlow.jsx` from the [latest release](../../releases/latest) (or from the `ScriptUI Panels` folder).
2. In EffectCraft choose **File > Scripts > Install ScriptUI Panel...** and select `PFlow.jsx`.
3. Open it from the bottom of the **Window** menu: **Window > PFlow.jsx**. Dock it wherever you like; EffectCraft reopens it on the next launch.

**Option B: copy the file**
Put `PFlow.jsx` into the `Scripts/ScriptUI Panels/` folder inside EffectCraft's settings folder, then restart EffectCraft:

| OS | Settings folder |
|---|---|
| Windows | `%APPDATA%\EffectCraft` |
| macOS | `~/Library/Application Support/EffectCraft` |
| Linux | `~/.config/effectcraft` (or `$XDG_CONFIG_HOME/effectcraft`) |

## How to use
1. Select two or more neighbouring keyframes on a property in the timeline.
2. Click a curve thumbnail or shape the curve with the yellow handles, then press **APPLY**. Double-clicking a thumbnail loads and applies it immediately.
3. Use the three buttons to the left of **APPLY** to choose outgoing, both (the default), or incoming easing.
4. Press the capture icon to the left of the coordinates to read the selected keyframes into the editor. Click the coordinates to edit or paste a curve.
5. The library toolbar provides **+** (save), pencil (rename), reverse arrows (flip), power (toggle Live), and trash (delete). Hover over a control for its tooltip.

To save a preset, set the curve, click **+** or the **star**, and enter a name. To rename or delete it, select its thumbnail in the **custom** library first. Saving over an existing custom preset or deleting one asks for confirmation.

## Notes
- Select **neighbouring** keyframes (for example keys 1 and 2, or 2 and 3). Keys that aren't next to each other are skipped.
- Keyframes on locked layers are skipped.
- EffectCraft can't yet bind keyboard shortcuts to individual scripts, so PFlow opens from the Window menu.

## License
MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Puuncture.
