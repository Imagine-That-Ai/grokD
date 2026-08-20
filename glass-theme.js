// Light/dark theming for the surfaces this project adds to Grok D.
//
// Two problems this solves. Our own panels were written dark-only, so in light
// mode they kept white text on a shell that had turned white. And the picker
// comes out of the packed preload with hardcoded dark colours we cannot edit
// without repacking the asar, so those are overridden here with !important.
//
// Light glass needs different cues than dark glass. Dark glass reads through a
// bright rim and a glow; on a white page that rim disappears. Light glass reads
// through saturation of what sits behind it, a crisp hairline bevel, and real
// cast shadow for elevation — so the light tokens lean on those instead.
"use strict";

const STYLE_ID = "gd-glass-theme";

const CSS = `
:root {
  --gdg-shell: radial-gradient(135% 135% at 30% 8%,
    rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.024) 36%,
    rgba(10,10,18,0.62) 76%, rgba(4,4,8,0.84) 100%);
  --gdg-blur: blur(34px) saturate(185%) contrast(112%);
  --gdg-border: rgba(255,255,255,0.16);
  --gdg-bevel: inset 0 1px 0 rgba(255,255,255,0.22);
  --gdg-lift: 0 28px 70px rgba(0,0,0,0.82);
  --gdg-sink: inset 0 -8px 22px rgba(0,0,0,0.46);

  --gdg-tile: radial-gradient(circle at 45% 42%,
    rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.02) 42%,
    rgba(14,14,26,0.62) 82%, rgba(4,4,10,0.88) 100%);
  --gdg-chip: radial-gradient(150% 170% at 28% 8%,
    rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.07) 36%, rgba(16,16,28,0.72) 100%);

  --gdg-text: rgba(255,255,255,0.94);
  --gdg-text-dim: rgba(255,255,255,0.56);
  --gdg-field: #111117;
  --gdg-field-border: rgba(255,255,255,0.14);
  --gdg-candy: #ff3448;
  --gdg-candy-deep: #b00c22;
}

@media (prefers-color-scheme: light) {
  :root {
    /* saturation + a real bevel is what makes glass legible on white */
    --gdg-shell: linear-gradient(168deg,
      rgba(255,255,255,0.90) 0%, rgba(252,252,255,0.74) 42%, rgba(240,240,248,0.66) 100%);
    --gdg-blur: blur(26px) saturate(215%) brightness(1.05);
    --gdg-border: rgba(18,18,32,0.16);
    --gdg-bevel: inset 0 1px 0 rgba(255,255,255,0.98), inset 0 0 0 1px rgba(255,255,255,0.55);
    --gdg-lift: 0 22px 48px -14px rgba(16,16,30,0.40), 0 3px 10px rgba(16,16,30,0.14);
    --gdg-sink: inset 0 -10px 20px rgba(16,16,30,0.07);

    --gdg-tile: radial-gradient(circle at 45% 40%,
      rgba(255,255,255,0.99) 0%, rgba(250,250,254,0.9) 44%, rgba(231,231,241,0.86) 100%);
    --gdg-chip: linear-gradient(165deg,
      rgba(255,255,255,0.97) 0%, rgba(247,247,251,0.88) 48%, rgba(233,233,242,0.84) 100%);

    --gdg-text: #17171c;
    --gdg-text-dim: rgba(20,20,30,0.55);
    --gdg-field: rgba(255,255,255,0.92);
    --gdg-field-border: rgba(18,18,32,0.18);
    --gdg-candy: #d10f26;
    --gdg-candy-deep: #8d0517;
  }
}

/* ---------------------------------------------------------------- shells */

.ghostly-liquid-glass-bubble,
#grok-seat-action-menu,
#grok-profile-sheet,
#grok-icon-picker-modal {
  background: var(--gdg-shell) !important;
  backdrop-filter: var(--gdg-blur) !important;
  -webkit-backdrop-filter: var(--gdg-blur) !important;
  border: 1px solid var(--gdg-border) !important;
  color: var(--gdg-text) !important;
}
.ghostly-liquid-glass-bubble,
#grok-profile-sheet,
#grok-icon-picker-modal {
  box-shadow: var(--gdg-lift), var(--gdg-sink), var(--gdg-bevel) !important;
}

/* The picker's labels are inline color:#fff from the packed preload. Inherit
   instead so they follow the scheme; accents are restored below. */
.ghostly-liquid-glass-bubble *:not(svg):not(path):not(circle):not(rect) {
  color: var(--gdg-text) !important;
}
.ghostly-liquid-glass-bubble [style*="opacity"] { color: var(--gdg-text) !important; }

/* ----------------------------------------------------------------- parts */

.liquid-glass-orb {
  background: var(--gdg-tile) !important;
  border: 1px solid var(--gdg-border) !important;
}
.liquid-orb-name-pill {
  background: var(--gdg-chip) !important;
  border: 1px solid var(--gdg-border) !important;
  color: var(--gdg-text) !important;
  box-shadow: var(--gdg-bevel), 0 3px 10px rgba(0,0,0,0.22) !important;
}
.whimsical-model-item {
  background: var(--gdg-chip) !important;
  border: 1px solid var(--gdg-border) !important;
  box-shadow: var(--gdg-bevel), var(--gdg-sink), 0 4px 12px rgba(0,0,0,0.28) !important;
}
.whimsical-model-item,
.whimsical-model-item * { color: var(--gdg-text) !important; }

.whimsical-model-item.is-active-model {
  border-color: color-mix(in srgb, var(--gdg-candy) 62%, transparent) !important;
  box-shadow:
    var(--gdg-bevel),
    0 0 16px color-mix(in srgb, var(--gdg-candy) 34%, transparent) !important;
}
.whimsical-model-item.is-active-model,
.whimsical-model-item.is-active-model * {
  color: var(--gdg-candy-deep) !important;
}

/* fields inside our own sheets */
#grok-profile-sheet input,
#grok-profile-sheet select,
#grok-icon-picker-modal input {
  background: var(--gdg-field) !important;
  border: 1px solid var(--gdg-field-border) !important;
  color: var(--gdg-text) !important;
}
#grok-profile-sheet label,
#grok-profile-sheet .gp-kind { color: var(--gdg-text) !important; }

#grok-d-toast {
  background: var(--gdg-shell) !important;
  backdrop-filter: var(--gdg-blur) !important;
  -webkit-backdrop-filter: var(--gdg-blur) !important;
  border: 1px solid var(--gdg-border) !important;
  color: var(--gdg-text) !important;
  box-shadow: var(--gdg-lift), var(--gdg-bevel) !important;
}
`;

function start() {
  if (!document.head && !document.documentElement) return;
  let n = document.getElementById(STYLE_ID);
  if (!n) {
    n = document.createElement("style");
    n.id = STYLE_ID;
    n.textContent = CSS;
    (document.head || document.documentElement).appendChild(n);
    return;
  }
  // keep ours last so it wins ties against the sheets injected before it
  if (n.parentNode && n.parentNode.lastChild !== n) n.parentNode.appendChild(n);
}

module.exports = { start, STYLE_ID };
