---
# gstack: design-md-format=spec
name: Beyond Green
description: A quiet evidence workspace for investigating passing tests.
colors:
  primary: "#1d5647"
  on-primary: "#ffffff"
  background: "#f5f7f6"
  surface: "#ffffff"
  text: "#24372f"
  text-muted: "#66746d"
  border: "#dee5e0"
  success: "#1d5647"
  success-surface: "#e8f2ed"
  error: "#a83a34"
  error-surface: "#fcf0ee"
  warning: "#80590e"
  warning-surface: "#faf3e3"
typography:
  display:
    fontFamily: Source Sans 3
    fontWeight: 650
    fontSize: 2rem
  body:
    fontFamily: Source Sans 3
    fontSize: 1rem
    lineHeight: 1.5
  label:
    fontFamily: Source Sans 3
    fontSize: 0.8125rem
  mono:
    fontFamily: ui-monospace
    fontFeature: tnum
rounded:
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  evidence:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
---

# Beyond Green viewer

## Purpose and direction

An **Operate** surface for engineers checking a saved investigation. The memorable
moment is the original passing test beside the investigator's contradictory result,
followed immediately by inspectable state. Light surfaces support reading long
evidence alongside code and documents during a working session.

The left rail selects a run; the main workspace answers what happened, what changed,
and what the contract required. Evidence, agent trace, and comparison are the three
views of the selected investigation. State lives in the URL; file contents live only
in browser memory.

## Typography and layout

Source Sans 3 provides a legible technical-document voice for headings and UI.
The variable font is self-hosted with its SIL Open Font License in `ui/fonts`.
Native monospace is deliberately confined to raw evidence and field paths, preserving
the familiar code-reading environment without another downloaded face.

Use open sections and aligned rows. Reserve framed surfaces for the two outcomes,
state tables, and expandable evidence. The outcome comparison is the visual anchor;
metadata stays quieter. At narrow widths, run selection becomes a horizontal strip
and outcomes stack. Full field paths wrap; raw JSON scrolls within its disclosure.

## Meaning and behavior

- Every verdict carries a text label as well as a semantic color and symbol.
- A computed state difference is an observation, not a model explanation or defect
  judgment. Show the recorded verdict independently.
- Keep abstentions visible; unknown original test outcomes are explicitly unrecorded.
- Provider scores are not comparable accuracy measures. Billed cost stays unavailable.
- Show clean runs beside affected runs without treating a clean model verdict as
  independent proof that the control is correct.
- Use native buttons, labels, selects, disclosures, and keyboard tabs. Focus remains
  visible. Errors preserve the current recording and offer recovery.
- Transitions only acknowledge panel changes; respect reduced motion. Avoid decorative
  charts, invented activity, and placeholder controls.

## Provenance and verification

Applied gstack's [design-consultation](https://github.com/garrytan/gstack/blob/main/design-consultation/SKILL.md)
and [design-review](https://github.com/garrytan/gstack/blob/main/design-review/SKILL.md)
guidance on hierarchy, Operate surfaces, progressive disclosure, accessible states,
and responsive QA. Direction chosen from the existing product brief on 2026-09-13.
The standalone gstack runtime and its telemetry are not dependencies of this app.

The tested interfaces are receipt import, identity-based snapshot comparison, and
the user's browser workflows. Verify UI changes at desktop, tablet, and mobile
widths with the recorded demo, an abstention, an invalid import, and an empty search.
