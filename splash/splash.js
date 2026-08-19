/**
 * grokD Splash Controller & Animation Engine
 * Coordinates timeline, iPhone Send with Echo swarm, Hero Mascot,
 * Eye Choreography, Diagonal Grok Slam, Tweaking & Hanging D, and Audio.
 */

(function () {
  class GrokDSplash {
    constructor(options = {}) {
      this.options = Object.assign({
        autoStart: true,
        speedMultiplier: 1.0,
        enableAudio: true,
        onComplete: null,
        standalone: true, // true shows interactive control bar
      }, options);

      this.audio = typeof SplashAudio !== "undefined" ? new SplashAudio() : null;
      this.timeouts = [];
      this.animFrameId = null;
      this.isDraggingD = false;
      this.dragAngle = 15;
      this.dragVelocity = 0;

      // Particle system state
      this.canvas = null;
      this.ctx = null;
      this.particles = [];
      this.shockwaves = [];
      this.isRunning = false;

      this.initDOM();
      if (this.options.autoStart) {
        // slight initial frame defer for CSS parsing
        setTimeout(() => this.play(), 100);
      }
    }

    setClass(el, cls) {
      if (!el) return;
      try { el.setAttribute("class", cls); } catch (_) {}
    }

    initDOM() {
      // Create or reuse container
      let stage = document.getElementById("grokd-splash-stage");
      if (!stage) {
        stage = document.createElement("div");
        stage.id = "grokd-splash-stage";
        stage.setAttribute("class", "grokd-splash-stage");
        document.body.appendChild(stage);
      }
      this.stage = stage;

      this.stage.innerHTML = `
        <div class="splash-ambient-mesh"></div>
        <div class="splash-vignette"></div>
        <canvas id="particle-canvas"></canvas>
        <div class="echo-swarm-layer" id="echo-layer"></div>

        <div class="hero-stage" id="hero-stage">
          <div class="hero-mascot-wrapper" id="hero-mascot">
            <div class="mascot-squircle-glow"></div>
            <div class="mascot-svg-card" id="mascot-card">
              <!-- Official GrokD Mascot Vector -->
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
                <defs>
                  <clipPath id="splashSquircleClip">
                    <rect x="0" y="0" width="512" height="512" rx="115" ry="115" />
                  </clipPath>
                  <linearGradient id="splDreamyRainbow" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#FF8777" />
                    <stop offset="24%" stop-color="#FFA07A" />
                    <stop offset="48%" stop-color="#70E6B6" />
                    <stop offset="72%" stop-color="#FDCB6E" />
                    <stop offset="88%" stop-color="#8065DF" />
                    <stop offset="100%" stop-color="#6C5CE7" />
                  </linearGradient>
                  <radialGradient id="splCyanGlow" cx="65%" cy="15%" r="55%">
                    <stop offset="0%" stop-color="#55E6C1" stop-opacity="0.95" />
                    <stop offset="100%" stop-color="#55E6C1" stop-opacity="0" />
                  </radialGradient>
                  <radialGradient id="splPeachGlow" cx="15%" cy="20%" r="55%">
                    <stop offset="0%" stop-color="#FF6B8B" stop-opacity="0.95" />
                    <stop offset="100%" stop-color="#FF6B8B" stop-opacity="0" />
                  </radialGradient>
                  <radialGradient id="splAmberGlow" cx="92%" cy="35%" r="50%">
                    <stop offset="0%" stop-color="#FECA57" stop-opacity="0.95" />
                    <stop offset="100%" stop-color="#FECA57" stop-opacity="0" />
                  </radialGradient>
                  <radialGradient id="splVioletGlow" cx="80%" cy="85%" r="60%">
                    <stop offset="0%" stop-color="#7451EB" stop-opacity="0.98" />
                    <stop offset="100%" stop-color="#7451EB" stop-opacity="0" />
                  </radialGradient>
                  <radialGradient id="splCoralGlow" cx="25%" cy="90%" r="50%">
                    <stop offset="0%" stop-color="#FF5252" stop-opacity="0.9" />
                    <stop offset="100%" stop-color="#FF5252" stop-opacity="0" />
                  </radialGradient>
                  <linearGradient id="splMascotGrad" x1="30%" y1="5%" x2="70%" y2="95%">
                    <stop offset="0%" stop-color="#FFFFFF" />
                    <stop offset="70%" stop-color="#FAFCFF" />
                    <stop offset="100%" stop-color="#E5EBF4" />
                  </linearGradient>
                  <radialGradient id="splMascotHighlight" cx="35%" cy="15%" r="50%">
                    <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98" />
                    <stop offset="65%" stop-color="#FFFFFF" stop-opacity="0" />
                  </radialGradient>
                  <radialGradient id="splBlushPink" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#FF4757" stop-opacity="0.35" />
                    <stop offset="100%" stop-color="#FF4757" stop-opacity="0" />
                  </radialGradient>
                  <linearGradient id="splEyeGrad" x1="25%" y1="0%" x2="75%" y2="100%">
                    <stop offset="0%" stop-color="#1E1D2D" />
                    <stop offset="60%" stop-color="#12131F" />
                    <stop offset="100%" stop-color="#2B1E38" />
                  </linearGradient>
                  <!-- Provider Brand Gradients -->
                  <linearGradient id="splGeminiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#2B7FFF" /><stop offset="50%" stop-color="#635BFF" /><stop offset="100%" stop-color="#C837AB" />
                  </linearGradient>
                  <linearGradient id="splClaudeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#D97757" /><stop offset="100%" stop-color="#BD4928" />
                  </linearGradient>
                  <linearGradient id="splOpenaiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#10A37F" /><stop offset="100%" stop-color="#086F55" />
                  </linearGradient>
                  <linearGradient id="splMetaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0081FB" /><stop offset="100%" stop-color="#0064E0" />
                  </linearGradient>
                  <linearGradient id="splDeepseekGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#1D61E7" /><stop offset="100%" stop-color="#0F44B0" />
                  </linearGradient>
                  <linearGradient id="splXaiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#12131A" /><stop offset="100%" stop-color="#2B2E3D" />
                  </linearGradient>
                </defs>

                <g clip-path="url(#splashSquircleClip)">
                  <!-- Rainbow Multi-Point Background -->
                  <rect width="512" height="512" fill="url(#splDreamyRainbow)" />
                  <rect width="512" height="512" fill="url(#splPeachGlow)" />
                  <rect width="512" height="512" fill="url(#splCyanGlow)" />
                  <rect width="512" height="512" fill="url(#splAmberGlow)" />
                  <rect width="512" height="512" fill="url(#splVioletGlow)" />
                  <rect width="512" height="512" fill="url(#splCoralGlow)" />

                  <!-- Sparkles -->
                  <g fill="#FFFFFF" opacity="0.8">
                    <path d="M 82 82 Q 82 95 69 95 Q 82 95 82 108 Q 82 95 95 95 Q 82 95 82 82 Z" />
                    <path d="M 432 72 Q 432 83 421 83 Q 432 83 432 94 Q 432 83 443 83 Q 432 83 432 72 Z" opacity="0.9" />
                    <circle cx="105" cy="150" r="4" opacity="0.7" />
                    <circle cx="425" cy="165" r="4.5" opacity="0.8" />
                    <circle cx="240" cy="65" r="3" opacity="0.6" />
                  </g>

                  <!-- 3D Mascot Dome Body -->
                  <path d="M 162 50 L 315 50 L 305 51 L 275 53 L 245 53 L 215 54 L 185 54 L 155 55 L 125 57 L 101 65 L 80 81 L 65 102 L 57 126 L 54 162 L 53 192 L 68 182 L 95 161 L 128 142 L 167 128 L 215 122 L 260 124 L 305 136 L 344 154 L 383 183 L 413 217 L 434 250 L 447 283 L 456 316 L 460 352 L 458 385 L 448 415 L 428 439 L 401 454 L 371 459 L 341 461 L 308 461 L 275 461 L 242 461 L 209 461 L 176 461 L 143 460 L 110 454 L 80 436 L 60 409 L 52 373 L 50 337 L 50 286 L 50 235 L 50 184 L 52 136 L 68 88 L 94 64 L 127 53 Z" fill="url(#splMascotGrad)" />
                  <path d="M 162 50 L 315 50 L 305 51 L 275 53 L 245 53 L 215 54 L 185 54 L 155 55 L 125 57 L 101 65 L 80 81 L 65 102 L 57 126 L 54 162 L 53 192 L 68 182 L 95 161 L 128 142 L 167 128 L 215 122 L 260 124 L 305 136 L 344 154 L 383 183 L 413 217 L 434 250 L 447 283 L 456 316 L 460 352 L 458 385 L 448 415 L 428 439 L 401 454 L 371 459 L 341 461 L 308 461 L 275 461 L 242 461 L 209 461 L 176 461 L 143 460 L 110 454 L 80 436 L 60 409 L 52 373 L 50 337 L 50 286 L 50 235 L 50 184 L 52 136 L 68 88 L 94 64 L 127 53 Z" fill="url(#splMascotHighlight)" />

                  <!-- Cheerful Pink Blush -->
                  <ellipse cx="192" cy="346" rx="28" ry="16" fill="url(#splBlushPink)" />
                  <ellipse cx="368" cy="330" rx="26" ry="15" fill="url(#splBlushPink)" />

                  <!-- PROVIDER TATTOOS -->
                  <!-- Claude Asterisk -->
                  <g transform="translate(132, 190) rotate(-10) scale(1.75)" fill="url(#splClaudeGrad)">
                    <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>
                  </g>
                  <!-- OpenAI Spiral -->
                  <g transform="translate(242, 126) rotate(-5) scale(0.165)" fill="url(#splOpenaiGrad)">
                    <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/>
                  </g>
                  <!-- Gemini Stars -->
                  <g transform="translate(408, 220) rotate(26) scale(1.65, 1.45)" fill="url(#splGeminiGrad)">
                    <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
                  </g>
                  <!-- Meta Infinity Ribbon -->
                  <g transform="translate(132, 334) rotate(-12) scale(1.65)" fill="url(#splMetaGrad)">
                    <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303z"/>
                  </g>
                  <!-- DeepSeek Whale -->
                  <g transform="translate(250, 395) scale(1.75)" fill="url(#splDeepseekGrad)">
                    <path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588"/>
                  </g>
                  <!-- xAI Monogram -->
                  <g transform="translate(350, 336) rotate(10) scale(1.55)" fill="url(#splXaiGrad)">
                    <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z" />
                  </g>

                  <!-- ANIMATABLE EYE GROUPS -->
                  <!-- Left Eye -->
                  <g id="left-eye-group" class="eye-pill">
                    <path d="M 223 223 L 235 224 L 247 228 L 257 240 L 267 254 L 277 268 L 287 284 L 296 300 L 297 312 L 294 322 L 285 332 L 273 336 L 259 335 L 245 325 L 235 309 L 226 295 L 216 281 L 206 267 L 200 255 L 199 245 L 205 233 L 217 225 Z" fill="url(#splEyeGrad)" />
                    <ellipse cx="238" cy="265" rx="5" ry="9" fill="#FFFFFF" opacity="0.85" transform="rotate(-35 238 265)" />
                    <circle cx="246" cy="292" r="2.8" fill="#FFFFFF" opacity="0.55" />
                  </g>

                  <!-- Right Eye -->
                  <g id="right-eye-group" class="eye-pill">
                    <path d="M 320 176 L 332 177 L 344 182 L 356 192 L 368 206 L 379 222 L 389 238 L 397 254 L 400 266 L 398 276 L 389 282 L 377 280 L 365 270 L 354 252 L 344 234 L 334 220 L 324 208 L 315 196 L 312 186 L 316 178 Z" fill="url(#splEyeGrad)" />
                    <ellipse cx="348" cy="200" rx="5.5" ry="10" fill="#FFFFFF" opacity="0.85" transform="rotate(-35 348 200)" />
                    <circle cx="356" cy="228" r="3" fill="#FFFFFF" opacity="0.55" />
                  </g>
                </g>
              </svg>
            </div>
            <!-- Star sparkle popup on wink -->
            <svg class="wink-star-sparkle" id="wink-sparkle" viewBox="0 0 100 100">
              <path d="M50 0 Q50 50 0 50 Q50 50 50 100 Q50 50 100 50 Q50 50 50 0 Z" fill="#FFEAA7" />
              <circle cx="50" cy="50" r="14" fill="#FFFFFF" />
            </svg>
          </div>

          <!-- TYPOGRAPHY SLAM STAGE -->
          <div class="logo-typography-stage">
            <div class="grok-text-wrapper" id="grok-wrapper">
              <span class="grok-letters">grok</span>
            </div>
            <div class="d-letter-wrapper" id="d-wrapper">
              <div class="d-hinge-pin"></div>
              <span class="d-letter">D</span>
            </div>
          </div>
        </div>

        ${this.options.standalone ? `
        <div class="splash-hint">grok"D" boot sequence · click/drag hanging D</div>
        <div class="splash-controls" id="splash-controls">
          <button class="control-btn" id="btn-replay">
            <span>↺</span> Replay
          </button>
          <button class="control-btn" id="btn-slowmo">
            <span>⏱</span> 0.5x Slow
          </button>
          <button class="control-btn active-pill" id="btn-sound">
            <span>🔊</span> Sound ON
          </button>
          <button class="control-btn" id="btn-dismiss">
            <span>✕</span> Dismiss
          </button>
          <span class="splash-status-badge" id="splash-status">ready</span>
        </div>
        ` : ""}
      `;

      this.canvas = document.getElementById("particle-canvas");
      this.ctx = this.canvas.getContext("2d");
      this.resizeCanvas();
      window.addEventListener("resize", () => this.resizeCanvas());

      this.bindInteractiveEvents();
    }

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    bindInteractiveEvents() {
      // Replay
      const btnReplay = document.getElementById("btn-replay");
      if (btnReplay) btnReplay.addEventListener("click", () => this.play());

      // Slow Mo
      const btnSlowMo = document.getElementById("btn-slowmo");
      if (btnSlowMo) {
        btnSlowMo.addEventListener("click", () => {
          this.options.speedMultiplier = this.options.speedMultiplier === 1.0 ? 0.45 : 1.0;
          btnSlowMo.classList.toggle("active-pill", this.options.speedMultiplier < 1.0);
          btnSlowMo.querySelector("span:last-child").textContent = this.options.speedMultiplier < 1.0 ? "0.5x Slow" : "1.0x Normal";
          this.play();
        });
      }

      // Audio Toggle
      const btnSound = document.getElementById("btn-sound");
      if (btnSound && this.audio) {
        btnSound.addEventListener("click", () => {
          const on = this.audio.toggle();
          btnSound.classList.toggle("active-pill", on);
          btnSound.innerHTML = on ? `<span>🔊</span> Sound ON` : `<span>🔇</span> Sound OFF`;
        });
      }

      // Dismiss
      const btnDismiss = document.getElementById("btn-dismiss");
      if (btnDismiss) {
        btnDismiss.addEventListener("click", () => this.dismiss());
      }

      // Interactive physics drag on hanging "D"
      const dWrap = document.getElementById("d-wrapper");
      if (dWrap) {
        const onStart = (e) => {
          this.isDraggingD = true;
          dWrap.classList.remove("d-idle-hang", "d-slammed");
          this.audio?.playCreak();
          e.preventDefault();
        };

        const onMove = (e) => {
          if (!this.isDraggingD) return;
          const rect = dWrap.getBoundingClientRect();
          const originX = rect.left + 12;
          const originY = rect.top + 14;
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const clientY = e.touches ? e.touches[0].clientY : e.clientY;
          const dx = clientX - originX;
          const dy = clientY - originY;
          let deg = Math.atan2(dx, dy) * (180 / Math.PI) - 45;
          deg = Math.max(-60, Math.min(85, deg));
          this.dragAngle = deg;
          dWrap.style.transform = `rotate(${deg}deg) translateY(5px)`;
        };

        const onEnd = () => {
          if (!this.isDraggingD) return;
          this.isDraggingD = false;
          this.audio?.playCreak();
          // Oscillate back to resting 15deg
          this.pendulumRelease(this.dragAngle, 15);
        };

        dWrap.addEventListener("mousedown", onStart);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onEnd);
        dWrap.addEventListener("touchstart", onStart, { passive: false });
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onEnd);
      }
    }

    pendulumRelease(startAngle, restAngle) {
      const dWrap = document.getElementById("d-wrapper");
      if (!dWrap) return;
      let angle = startAngle;
      let velocity = 0;
      const k = 0.08; // spring constant
      const damping = 0.91; // friction

      const step = () => {
        if (this.isDraggingD) return;
        const force = -k * (angle - restAngle);
        velocity = (velocity + force) * damping;
        angle += velocity;
        dWrap.style.transform = `rotate(${angle}deg) translateY(5px)`;

        if (Math.abs(angle - restAngle) > 0.3 || Math.abs(velocity) > 0.2) {
          requestAnimationFrame(step);
        } else {
          dWrap.style.transform = `rotate(${restAngle}deg) translateY(5px)`;
          dWrap.classList.add("d-idle-hang");
        }
      };
      step();
    }

    schedule(fn, delayMs) {
      const scaled = delayMs / this.options.speedMultiplier;
      const id = setTimeout(fn, scaled);
      this.timeouts.push(id);
      return id;
    }

    clearTimeline() {
      this.timeouts.forEach(clearTimeout);
      this.timeouts = [];
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    }

    setStatus(text) {
      const badge = document.getElementById("splash-status");
      if (badge) badge.textContent = text;
    }

    // ==========================================
    // MAIN SPLASH SEQUENCE TIMELINE
    // ==========================================
    play() {
      this.clearTimeline();
      this.resetVisuals();
      this.audio?.init();
      this.startParticleLoop();

      this.setStatus("1/5 echo swarm");

      // PHASE 1: iPhone Send with Echo Swarm (0ms)
      this.spawnEchoSwarm(46);

      // Audio whoosh cascade
      for (let i = 0; i < 18; i++) {
        this.schedule(() => this.audio?.playEchoWhoosh(i, 18), i * 65);
      }

      // PHASE 2: Hero Mascot Converges & Grows to Size (1400ms)
      this.schedule(() => {
        this.setStatus("2/5 hero rising");
        const hero = document.getElementById("hero-mascot");
        if (hero) hero.classList.add("active");
        this.audio?.playHeroRise();

        // Spawn central shockwave + sparkle burst
        const rect = hero.getBoundingClientRect();
        this.spawnShockwave(rect.left + rect.width / 2, rect.top + rect.height / 2, "#55E6C1");
        this.spawnBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 40);
      }, 1400);

      // PHASE 3: Funny Eyes Sequence & Cheeky Wink (2400ms - 3600ms)
      // Step 3a: Eyes dart left
      this.schedule(() => {
        this.setStatus("3/5 eyes looking...");
        const card = document.getElementById("mascot-card");
        if (card) {
          card.setAttribute("class", "mascot-svg-card eyes-look-left");
        }
        this.audio?.playEyeDart();
      }, 2400);

      // Step 3b: Eyes dart right
      this.schedule(() => {
        const card = document.getElementById("mascot-card");
        if (card) {
          card.setAttribute("class", "mascot-svg-card eyes-look-right");
        }
        this.audio?.playEyeDart();
      }, 2750);

      // Step 3c: Silly crossed eyes + head tilt
      this.schedule(() => {
        const card = document.getElementById("mascot-card");
        const hero = document.getElementById("hero-mascot");
        if (card) card.setAttribute("class", "mascot-svg-card eyes-cross");
        if (hero) hero.classList.add("head-wobble");
        this.audio?.playEyeDart();
      }, 3050);

      // Step 3d: THE WINK + Star Pop!
      this.schedule(() => {
        this.setStatus("3/5 winking ✨");
        const card = document.getElementById("mascot-card");
        const sparkle = document.getElementById("wink-sparkle");
        if (card) card.setAttribute("class", "mascot-svg-card eyes-wink");
        if (sparkle) {
          sparkle.classList.remove("pop");
          void sparkle.offsetWidth; // reflow
          sparkle.classList.add("pop");
        }
        this.audio?.playWink();

        // Sparkle particles around right eye
        const cardRect = card.getBoundingClientRect();
        this.spawnBurst(cardRect.left + cardRect.width * 0.7, cardRect.top + cardRect.height * 0.45, 25, "#FECA57");
      }, 3450);

      // PHASE 4: Slap "grok" Diagonally on the Page (3950ms)
      this.schedule(() => {
        this.setStatus("4/5 grok SLAM!");
        const grokWrap = document.getElementById("grok-wrapper");
        if (grokWrap) grokWrap.classList.add("slammed");
        this.stage.classList.add("stage-shake");
        this.audio?.playGrokSlam();

        const grokRect = grokWrap.getBoundingClientRect();
        this.spawnShockwave(grokRect.left + grokRect.width / 2, grokRect.top + grokRect.height / 2, "#FFFFFF");
        this.spawnBurst(grokRect.left + grokRect.width / 2, grokRect.top + grokRect.height / 2, 35, "#FF8777");

        setTimeout(() => this.stage.classList.remove("stage-shake"), 450);
      }, 3950);

      // PHASE 5: Slap "D" a second after (4950ms) + Tweak + Hang Off
      this.schedule(() => {
        this.setStatus("5/5 D slam & hang off ⚡");
        const dWrap = document.getElementById("d-wrapper");
        if (dWrap) {
          dWrap.classList.add("d-slammed");
        }
        this.stage.classList.add("stage-shake-heavy");
        this.audio?.playDSlamAndTweak();

        const dRect = dWrap.getBoundingClientRect();
        this.spawnShockwave(dRect.left + 20, dRect.top + 20, "#6C5CE7");
        this.spawnBurst(dRect.left + 20, dRect.top + 20, 30, "#FECA57");

        setTimeout(() => this.stage.classList.remove("stage-shake-heavy"), 550);

        // Schedule idle swing transition after pendulum settles
        this.schedule(() => {
          if (dWrap && !this.isDraggingD) {
            dWrap.classList.add("d-idle-hang");
          }
          this.setStatus("complete ✓");
          const controls = document.getElementById("splash-controls");
          if (controls) controls.classList.add("visible");
          if (this.options.onComplete) this.options.onComplete();
        }, 2800);
      }, 4950);
    }

    resetVisuals() {
      const echoLayer = document.getElementById("echo-layer");
      if (echoLayer) echoLayer.innerHTML = "";

      const hero = document.getElementById("hero-mascot");
      if (hero) hero.setAttribute("class", "hero-mascot-wrapper");

      const card = document.getElementById("mascot-card");
      if (card) card.setAttribute("class", "mascot-svg-card");

      const sparkle = document.getElementById("wink-sparkle");
      if (sparkle) sparkle.setAttribute("class", "wink-star-sparkle");

      const grokWrap = document.getElementById("grok-wrapper");
      if (grokWrap) grokWrap.setAttribute("class", "grok-text-wrapper");

      const dWrap = document.getElementById("d-wrapper");
      if (dWrap) {
        dWrap.setAttribute("class", "d-letter-wrapper");
        dWrap.style.transform = "";
      }

      this.particles = [];
      this.shockwaves = [];
    }

    // ==========================================
    // ECHO SWARM GENERATOR (iPhone Send With Echo)
    // ==========================================
    spawnEchoSwarm(count = 45) {
      const layer = document.getElementById("echo-layer");
      if (!layer) return;
      layer.innerHTML = "";

      const w = window.innerWidth;
      const h = window.innerHeight;

      // Miniature mascot SVG data URL for crisp rendering across 50 clone nodes
      const mascotSVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="115" fill="%236C5CE7"/><rect width="512" height="512" rx="115" fill="url(%23g)"/><path d="M162 50L315 50L305 51L275 53L245 53L215 54L185 54L155 55L125 57L101 65L80 81L65 102L57 126L54 162L53 192L68 182L95 161L128 142L167 128L215 122L260 124L305 136L344 154L383 183L413 217L434 250L447 283L456 316L460 352L458 385L448 415L428 439L401 454L371 459L341 461L308 461L275 461L242 461L209 461L176 461L143 460L110 454L80 436L60 409L52 373L50 337L50 286L50 235L50 184L52 136L68 88L94 64L127 53Z" fill="%23FFFFFF"/><ellipse cx="192" cy="346" rx="28" ry="16" fill="%23FF4757" opacity="0.4"/><ellipse cx="368" cy="330" rx="26" ry="15" fill="%23FF4757" opacity="0.4"/><path d="M223 223L257 240L287 284L297 312L285 332L259 335L235 309L206 267L200 255Z" fill="%231E1D2D"/><path d="M320 176L356 192L389 238L400 266L389 282L365 270L334 220L312 186Z" fill="%231E1D2D"/></svg>`;

      for (let i = 0; i < count; i++) {
        const el = document.createElement("div");
        el.setAttribute("class", "echo-clone");
        el.style.backgroundImage = `url('${mascotSVG}')`;

        // Radial distribution across viewport
        const angle = (i / count) * Math.PI * 2 + (Math.random() * 0.5 - 0.25);
        const distance = 120 + Math.random() * Math.min(w, h) * 0.45;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance * 0.85;
        const tz = Math.floor(Math.random() * 200 - 100);

        const targetScale = 0.45 + Math.random() * 0.75;
        const delay = (i * 0.024 + Math.random() * 0.08) / this.options.speedMultiplier;
        const duration = (1.4 + Math.random() * 0.5) / this.options.speedMultiplier;
        const peakOpacity = 0.75 + Math.random() * 0.25;

        el.style.setProperty("--tx", `${tx}px`);
        el.style.setProperty("--ty", `${ty}px`);
        el.style.setProperty("--tz", `${tz}px`);
        el.style.setProperty("--target-scale", targetScale);
        el.style.setProperty("--delay", `${delay}s`);
        el.style.setProperty("--duration", `${duration}s`);
        el.style.setProperty("--peak-opacity", peakOpacity);
        el.style.setProperty("--rot-start", `${Math.random() * 60 - 30}deg`);
        el.style.setProperty("--rot-mid", `${Math.random() * 40 - 20}deg`);
        el.style.setProperty("--rot-end", `${Math.random() * 90 - 45}deg`);

        layer.appendChild(el);
      }
    }

    // ==========================================
    // CANVAS PARTICLE & SHOCKWAVE SYSTEM
    // ==========================================
    spawnShockwave(x, y, color = "#55E6C1") {
      this.shockwaves.push({
        x, y,
        radius: 10,
        maxRadius: Math.max(window.innerWidth, window.innerHeight) * 0.42,
        opacity: 0.9,
        color,
        lineWidth: 6,
        growth: 24 * this.options.speedMultiplier,
      });
    }

    spawnBurst(x, y, count = 30, color) {
      const palette = ["#FF8777", "#FFA07A", "#55E6C1", "#FECA57", "#8065DF", "#6C5CE7", "#FFFFFF"];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (4 + Math.random() * 12) * this.options.speedMultiplier;
        this.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 5,
          color: color || palette[Math.floor(Math.random() * palette.length)],
          alpha: 1,
          decay: 0.02 + Math.random() * 0.02,
          gravity: 0.2,
          friction: 0.96,
        });
      }
    }

    startParticleLoop() {
      if (this.isRunning) return;
      this.isRunning = true;

      const loop = () => {
        if (!this.isRunning) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Update shockwaves
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
          const sw = this.shockwaves[i];
          sw.radius += sw.growth;
          sw.opacity -= 0.035;
          sw.lineWidth = Math.max(1, sw.lineWidth * 0.95);

          if (sw.opacity <= 0 || sw.radius >= sw.maxRadius) {
            this.shockwaves.splice(i, 1);
            continue;
          }

          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
          this.ctx.strokeStyle = sw.color;
          this.ctx.lineWidth = sw.lineWidth;
          this.ctx.globalAlpha = Math.max(0, sw.opacity);
          this.ctx.shadowBlur = 18;
          this.ctx.shadowColor = sw.color;
          this.ctx.stroke();
          this.ctx.restore();
        }

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vy += p.gravity;
          p.vx *= p.friction;
          p.vy *= p.friction;
          p.alpha -= p.decay;

          if (p.alpha <= 0) {
            this.particles.splice(i, 1);
            continue;
          }

          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          this.ctx.fillStyle = p.color;
          this.ctx.globalAlpha = Math.max(0, p.alpha);
          this.ctx.shadowBlur = 10;
          this.ctx.shadowColor = p.color;
          this.ctx.fill();
          this.ctx.restore();
        }

        this.animFrameId = requestAnimationFrame(loop);
      };

      loop();
    }

    dismiss() {
      if (this.stage) {
        this.stage.classList.add("fading-out");
        setTimeout(() => {
          this.clearTimeline();
          this.isRunning = false;
          this.stage.remove();
        }, 850);
      }
    }
  }

  window.GrokDSplash = GrokDSplash;
})();
