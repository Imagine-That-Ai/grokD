// grokD seat-in: walks a first-run user from splash → a working Local or Cursor seat.
// iOS Minimalism x OpenAI ChatGPT edition.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrokDOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE = "onboarding.json";
  const OPENBURNBAR_PORT = 8320;
  const LOCAL_PROXY_CHOICES = [
    {
      id: "openburnbar",
      name: "OpenBurnBar",
      port: 8320,
      description: "OpenAI-compatible local gateway for high-speed streaming",
      badge: "Recommended",
      logo: "../assets/burnbar-mark.svg",
    },
    {
      id: "cliproxy",
      name: "CLI Proxy",
      port: 8322,
      description: "Direct command-line execution bridge",
      badge: "Fast Bridge",
      logo: "../assets/cliproxy-mark.svg",
    },
    {
      id: "vibeproxy",
      name: "Vibe Proxy",
      port: 8325,
      description: "Alternate local route and fallback gateway",
      badge: "Alternate",
      logo: "../assets/vibeproxy-mark.svg",
    },
  ];

  const PROVIDER_LOGOS = {
    xai: `<svg fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>Grok</title><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"></path></svg>`,
    openai: `<svg fill="#10a37f" fill-rule="evenodd" viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>OpenAI</title><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"></path></svg>`,
    anthropic: `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>Claude</title><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero"></path></svg>`,
    deepseek: `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>DeepSeek</title><path d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z" fill="#4D6BFE"></path></svg>`,
    gemini: `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>Gemini</title><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"></path></svg>`,
    moonshot: `<svg fill="#a855f7" fill-rule="evenodd" viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>MoonshotAI</title><path d="M1.052 16.916l9.539 2.552a21.007 21.007 0 00.06 2.033l5.956 1.593a11.997 11.997 0 01-5.586.865l-.18-.016-.044-.004-.084-.009-.094-.01a11.605 11.605 0 01-.157-.02l-.107-.014-.11-.016a11.962 11.962 0 01-.32-.051l-.042-.008-.075-.013-.107-.02-.07-.015-.093-.019-.075-.016-.095-.02-.097-.023-.094-.022-.068-.017-.088-.022-.09-.024-.095-.025-.082-.023-.109-.03-.062-.02-.084-.025-.093-.028-.105-.034-.058-.019-.08-.026-.09-.031-.066-.024a6.293 6.293 0 01-.044-.015l-.068-.025-.101-.037-.057-.022-.08-.03-.087-.035-.088-.035-.079-.032-.095-.04-.063-.028-.063-.027a5.655 5.655 0 01-.041-.018l-.066-.03-.103-.047-.052-.024-.096-.046-.062-.03-.084-.04-.086-.044-.093-.047-.052-.027-.103-.055-.057-.03-.058-.032a6.49 6.49 0 01-.046-.026l-.094-.053-.06-.034-.051-.03-.072-.041-.082-.05-.093-.056-.052-.032-.084-.053-.061-.039-.079-.05-.07-.047-.053-.035a7.785 7.785 0 01-.054-.036l-.044-.03-.044-.03a6.066 6.066 0 01-.04-.028l-.057-.04-.076-.054-.069-.05-.074-.054-.056-.042-.076-.057-.076-.059-.086-.067-.045-.035-.064-.052-.074-.06-.089-.073-.046-.039-.046-.039a7.516 7.516 0 01-.043-.037l-.045-.04-.061-.053-.07-.062-.068-.06-.062-.058-.067-.062-.053-.05-.088-.084a13.28 13.28 0 01-.099-.097l-.029-.028-.041-.042-.069-.07-.05-.051-.05-.053a6.457 6.457 0 01-.168-.179l-.08-.088-.062-.07-.071-.08-.042-.049-.053-.062-.058-.068-.046-.056a7.175 7.175 0 01-.027-.033l-.045-.055-.066-.082-.041-.052-.05-.064-.02-.025a11.99 11.99 0 01-1.44-2.402zm-1.02-5.794l11.353 3.037a20.468 20.468 0 00-.469 2.011l10.817 2.894a12.076 12.076 0 01-1.845 2.005L.657 15.923l-.016-.046-.035-.104a11.965 11.965 0 01-.05-.153l-.007-.023a11.896 11.896 0 01-.207-.741l-.03-.126-.018-.08-.021-.097-.018-.081-.018-.09-.017-.084-.018-.094c-.026-.141-.05-.283-.071-.426l-.017-.118-.011-.083-.013-.102a12.01 12.01 0 01-.019-.161l-.005-.047a12.12 12.12 0 01-.034-2.145zm1.593-5.15l11.948 3.196c-.368.605-.705 1.231-1.01 1.875l11.295 3.022c-.142.82-.368 1.612-.668 2.365l-11.55-3.09L.124 10.26l.015-.1.008-.049.01-.067.015-.087.018-.098c.026-.148.056-.295.088-.442l.028-.124.02-.085.024-.097c.022-.09.045-.18.07-.268l.028-.102.023-.083.03-.1.025-.082.03-.096.026-.082.031-.095a11.896 11.896 0 011.01-2.232zm4.442-4.4L17.352 4.59a20.77 20.77 0 00-1.688 1.721l7.823 2.093c.267.852.442 1.744.513 2.665L2.106 5.213l.045-.065.027-.04.04-.055.046-.065.055-.076.054-.072.064-.086.05-.065.057-.073.055-.07.06-.074.055-.069.065-.077.054-.066.066-.077.053-.06.072-.082.053-.06.067-.074.054-.058.073-.078.058-.06.063-.067.168-.17.1-.098.059-.056.076-.071a12.084 12.084 0 012.272-1.677zM12.017 0h.097l.082.001.069.001.054.002.068.002.046.001.076.003.047.002.06.003.054.002.087.005.105.007.144.011.088.007.044.004.077.008.082.008.047.005.102.012.05.006.108.014.081.01.042.006.065.01.207.032.07.012.065.011.14.026.092.018.11.022.046.01.075.016.041.01L14.7.3l.042.01.065.015.049.012.071.017.096.024.112.03.113.03.113.032.05.015.07.02.078.024.073.023.05.016.05.016.076.025.099.033.102.036.048.017.064.023.093.034.11.041.116.045.1.04.047.02.06.024.041.018.063.026.04.018.057.025.11.048.1.046.074.035.075.036.06.028.092.046.091.045.102.052.053.028.049.026.046.024.06.033.041.022.052.029.088.05.106.06.087.051.057.034.053.032.096.059.088.055.098.062.036.024.064.041.084.056.04.027.062.042.062.043.023.017c.054.037.108.075.161.114l.083.06.065.048.056.043.086.065.082.064.04.03.05.041.086.069.079.065.085.071c.712.6 1.353 1.283 1.909 2.031L7.222.994l.062-.027.065-.028.081-.034.086-.035c.113-.045.227-.09.341-.131l.096-.035.093-.033.084-.03.096-.031c.087-.03.176-.058.264-.085l.091-.027.086-.025.102-.03.085-.023.1-.026L9.04.37l.09-.023.091-.022.095-.022.09-.02.098-.021.091-.02.095-.018.092-.018.1-.018.091-.016.098-.017.092-.014.097-.015.092-.013.102-.013.091-.012.105-.012.09-.01.105-.01c.093-.01.186-.018.28-.024l.106-.008.09-.005.11-.006.093-.004.1-.004.097-.002.099-.002.197-.002z"></path></svg>`,
    meta: `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><title>Meta</title><path d="M6.897 4h-.024l-.031 2.615h.022c1.715 0 3.046 1.357 5.94 6.246l.175.297.012.02 1.62-2.438-.012-.019a48.763 48.763 0 00-1.098-1.716 28.01 28.01 0 00-1.175-1.629C10.413 4.932 8.812 4 6.896 4z" fill="#0064E0"></path><path d="M6.873 4C4.95 4.01 3.247 5.258 2.02 7.17a4.352 4.352 0 00-.01.017l2.254 1.231.011-.017c.718-1.083 1.61-1.774 2.568-1.785h.021L6.896 4h-.023z" fill="#0064DF"></path><path d="M10.78 9.654c-1.528 2.35-2.454 3.825-2.454 3.825-2.035 3.2-2.739 3.917-3.871 3.917a1.545 1.545 0 01-1.186-.508l-2.017 1.744.014.017C2.01 19.518 3.058 20 4.356 20c1.963 0 3.374-.928 5.884-5.33l1.766-3.13a41.283 41.283 0 00-1.227-1.886z" fill="#0082FB"></path><path d="M20.918 5.713C19.853 4.633 18.583 4 17.225 4c-1.432 0-2.637.787-3.723 1.944l-.016.016 1.382 1.24.016-.017c.715-.747 1.408-1.12 2.176-1.12.826 0 1.6.39 2.27 1.075l.015.016 1.589-1.425-.016-.016z" fill="#0082FB"></path><path d="M23.998 14.125c-.06-3.467-1.27-6.566-3.064-8.396l-.016-.016-1.588 1.424.015.016c1.35 1.392 2.277 3.98 2.361 6.971v.023h2.292v-.022z" fill="#0081FA"></path></svg>`,
  };

  const CURATED_MODELS = [
    { id: "grok-4.6", name: "Grok 4.6", provider: "xai", providerName: "xAI", logo: "../assets/lobe/grok.svg", tag: "Flagship deep reasoning & autonomous coding" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "openai", providerName: "OpenAI", logo: "../assets/lobe/openai.svg", tag: "Next-gen omni reasoning & proactive agent workflow" },
    { id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic", providerName: "Anthropic", logo: "../assets/lobe/claude-color.svg", tag: "Frontier systems architecture & deep technical writing" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", providerName: "Anthropic", logo: "../assets/lobe/claude-color.svg", tag: "High-speed hybrid reasoning & multi-file refactors" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", providerName: "DeepSeek", logo: "../assets/lobe/deepseek-color.svg", tag: "Ultra-low latency MoE deep reasoning" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", providerName: "Google", logo: "../assets/lobe/gemini-color.svg", tag: "Massive 2M context window & multimodal mastery" },
    { id: "kimi/k3", name: "Kimi K3.5", provider: "moonshot", providerName: "Moonshot", logo: "../assets/lobe/moonshot.svg", tag: "Long-horizon agentic memory & document synthesis" },
    { id: "grok-composer-2.5-fast", name: "Grok Composer 2.5 Fast", provider: "xai", providerName: "xAI", logo: "../assets/lobe/xai.svg", tag: "Real-time interactive code editor completion" },
    { id: "claude-fable-5", name: "Claude Fable 5", provider: "anthropic", providerName: "Anthropic", logo: "../assets/lobe/claude-color.svg", tag: "Creative synthesis & formal verification" },
    { id: "ollama-local", name: "Llama 4 (Ollama)", provider: "meta", providerName: "Meta / Local", logo: "../assets/lobe/meta-color.svg", tag: "100% private offline computation on this Mac" },
  ];

  function isOpenBurnBarHealthPayload(value, port) {
    return Boolean(
      value &&
      (value.status === "ok" || value.status === "healthy" || value.ok === true) &&
      value.service === "openburnbar-proxy" &&
      value.port === (port ?? OPENBURNBAR_PORT)
    );
  }

  function host() {
    if (typeof require === "function") {
      try {
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const { spawn, execFileSync } = require("child_process");
        const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
        const statePath = path.join(ROOT, FILE);
        const secGuard = require(path.join(ROOT, "security-guard.js"));
        let models = null;
        try { models = require(path.join(ROOT, "model-lib.js")); } catch (_) {}
        const store = (() => {
          try { return require(path.join(ROOT, "profile-store.js")); } catch (_) { return null; }
        })();
        const accounts = (() => {
          try { return require(path.join(ROOT, "onboard-accounts.js")); } catch (_) { return null; }
        })();
        return {
          demo: false,
          readState() {
            try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
            catch { return null; }
          },
          writeState(s) {
            secGuard.ensureDir0700(ROOT);
            secGuard.writeFile0600(statePath, JSON.stringify(s, null, 2) + "\n");
          },
          activeProfile() {
            if (store && store.getActive) {
              const a = store.getActive();
              return a ? a.id : null;
            }
            try {
              const env = JSON.parse(fs.readFileSync(path.join(ROOT, "active-env.json"), "utf8"));
              return env && env.profileId ? env.profileId : null;
            } catch { return null; }
          },
          ports: { box: 1337, host: 1338, infer: 8787, cliproxy: 8322, openburnbar: 8320, vibeproxy: 8325, ollama: 11434 },
          portUp(port) {
            try {
              const curlArgs = [
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "1",
                "--noproxy",
                "*",
                `http://127.0.0.1:${port}/health`,
              ];
              const output = execFileSync("/usr/bin/curl", curlArgs, {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 1500,
                env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
              });
              const json = JSON.parse(output);
              if (port === OPENBURNBAR_PORT) {
                return isOpenBurnBarHealthPayload(json, port);
              }
              if (port === 1337) {
                return Boolean(json && (json.ok === true || json.status === "healthy") && json.service === "grok-d-gateway-shim");
              }
              if (port === 8322) {
                return Boolean(json && (json.service === "cliproxy" || json.service === "cliproxyapi"));
              }
              if (port === 8325) {
                return Boolean(json && (json.service === "vibeproxy" || json.service === "vibe-proxy"));
              }
              if (port === 1338) {
                return Boolean(json && (json.service === "grok-d-host" || json.service === "grok-host" || json.service === "local-exec-daemon" || json.application === "grokbot-host"));
              }
              if (port === 11434) {
                return Boolean(json && (json.status === "ok" || json.status === "healthy" || json.service === "ollama"));
              }
              return false;
            } catch {
              return false;
            }
          },
          startBox() {
            if (global.__grokd_box_starting) return Promise.resolve(false);
            global.__grokd_box_starting = true;
            const sh = path.join(ROOT, "ensure-local-box.sh");
            if (!fs.existsSync(sh)) {
              global.__grokd_box_starting = false;
              throw new Error("ensure-local-box.sh is missing");
            }
            return new Promise((resolve, reject) => {
              const child = spawn("/bin/bash", [sh], { detached: true, stdio: "ignore" });
              child.on("error", (e) => {
                global.__grokd_box_starting = false;
                reject(e);
              });
              child.on("exit", (code) => {
                global.__grokd_box_starting = false;
                if (code === 0) resolve(true);
                else reject(new Error(`ensure-local-box exited with code ${code}`));
              });
              child.unref();
              setTimeout(() => { resolve(true); }, 800);
            });
          },
          setProxy(target, model) {
            if (!models) throw new Error("model-lib missing");
            return models.setModel(model || models.resolveConfig().model, target);
          },
          models() { return (models && models.CURATED) || CURATED_MODELS; },
          currentModel() { return models ? models.resolveConfig() : { model: "grok-4.6", proxyTarget: "openburnbar" }; },
          installOpenBurnBar(onFailure) {
            const inst = path.join(ROOT, "openburnbar-install.js");
            let info = { install: { proxy: "npx --ignore-scripts -y openburnbar@0.2.0 proxy --port 8320" } };
            try { info = require(inst).info(); } catch (_) {}
            const cleanEnv = {
              PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
              HOME: process.env.HOME || os.homedir(),
              TMPDIR: process.env.TMPDIR || os.tmpdir(),
              NODE_ENV: "production",
            };
            const child = spawn("npx", ["--ignore-scripts", "-y", "openburnbar@0.2.0", "proxy", "--port", "8320"], {
              detached: true,
              stdio: "ignore",
              env: cleanEnv,
            });
            const fail = (error, log) => {
              if (log) process.stderr.write("Could not start OpenBurnBar proxy: " + (error ? error.message || error : "") + "\n");
              if (typeof onFailure === "function") onFailure(error || new Error("OpenBurnBar proxy failed to start"));
            };
            child.on("error", (e) => fail(e, true));
            child.on("exit", (code, signal) => {
              if (code !== 0) fail(new Error(`OpenBurnBar process exited before it became ready (code ${code}${signal ? `, signal ${signal}` : ""})`), false);
            });
            child.unref();
            return info;
          },
          seats() {
            if (store && store.detectedCursorProfiles) return store.detectedCursorProfiles();
            return [];
          },
          async switchTo(id) {
            const sw = path.join(ROOT, "switch-profile.js");
            const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" });
            await new Promise((resolve, reject) => {
              const child = spawn(process.execPath, [sw, "switch", id], { env });
              child.on("error", reject);
              child.on("exit", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`switch-profile exited with code ${code}`));
              });
            });
            if (store && store.getActive && store.getActive().id !== id) {
              throw new Error(`Profile switch verification failed: active is ${store.getActive().id}, expected ${id}`);
            }
          },
          addSignIn() {
            if (store && accounts) {
              const p = accounts.addSignInProfile(store);
              return p.id;
            }
            const name = accounts ? accounts.nextSignInName([]) : "My Cursor";
            const sw = path.join(ROOT, "switch-profile.js");
            const out = execFileSync(process.execPath, [sw, "add", "--name", name, "--kind", "cursor"], {
              encoding: "utf8",
              timeout: 15000,
              env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
            });
            const j = JSON.parse(out.trim().split("\n").pop());
            return j.id;
          },
          snapshotCurrent(expectedId) {
            const sw = require(path.join(ROOT, "switch-profile.js"));
            return sw.withSwitchLock(() => {
              const active = store && store.getActive();
              if (!active || (expectedId && active.id !== expectedId)) return null;
              return sw.snapshot(active);
            });
          },
          renameProfile(id, name) {
            if (store && store.rename) return store.rename(id, name);
            return null;
          },
          listedCursor() {
            if (!store) return [];
            return store.list().filter((p) => p.kind === "cursor");
          },
          importSeat(id) {
            if (store && store.importDetected) return store.importDetected(id).id;
            return id;
          },
          cursorStatus() {
            try {
              if (typeof window !== "undefined" && window.desktop && window.desktop.cursorAccount) {
                return window.desktop.cursorAccount.getStatus();
              }
            } catch (_) {}
            return Promise.resolve({ kind: "unknown" });
          },
        };
      } catch (err) {
        console.error("[onboarding] Fatal error initializing host:", err);
        throw err;
      }
    }
    const isExplicitDemo = typeof window !== "undefined" && window.__GD_DEMO__ === true;
    return {
      demo: isExplicitDemo,
      _s: null,
      readState() { return this._s; },
      writeState(s) { this._s = s; try { localStorage.setItem("gd-onboard", JSON.stringify(s)); } catch (_) {} },
      ports: { box: 1337, host: 1338, infer: 8787, cliproxy: 8322, openburnbar: 8320, vibeproxy: 8325, ollama: 11434 },
      _openBurnBarInstalled: false,
      portUp(port) {
        if (!isExplicitDemo) return false;
        return port === 1337 ||
          port === 8322 ||
          (port === OPENBURNBAR_PORT && this._openBurnBarInstalled);
      },
      startBox() {},
      setProxy(target, model) { return { proxyTarget: target, model: model || "grok-4.6" }; },
      models() {
        return CURATED_MODELS;
      },
      currentModel() { return { model: "grok-4.6", proxyTarget: "openburnbar" }; },
      installOpenBurnBar() {
        this._openBurnBarInstalled = true;
        return {
          npmProxy: true,
          install: { proxy: "npx -y --ignore-scripts openburnbar@0.2.0 proxy --port 8320" },
        };
      },
      seats() { return isExplicitDemo ? [{ id: "cursor-a", name: "Grok A", seat: "A" }] : []; },
      switchTo() {},
      _signIns: 0,
      addSignIn() {
        this._signIns += 1;
        return this._signIns === 1 ? "my-cursor" : "my-cursor-" + this._signIns;
      },
      snapshotCurrent() { return isExplicitDemo; },
      renameProfile() { return null; },
      listedCursor() { return []; },
      importSeat(id) { return id; },
      cursorStatus() { return Promise.resolve(isExplicitDemo ? { kind: "logged-in", authId: "demo" } : { kind: "logged-out" }); },
    };
  }

  function blank() {
    return {
      version: 1,
      completed: false,
      skipped: false,
      seenSplash: false,
      path: null,
      step: "choose",
      proxyTarget: null,
      model: null,
      cursorProfile: null,
      cursorProfiles: [],
    };
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function start(opts) {
    if (typeof document === "undefined") return null;
    if (document.getElementById("gd-onboard")) return document.getElementById("gd-onboard").__api;
    const h = (opts && opts.host) || host();
    const state = Object.assign(blank(), h.readState() || {});
    if (opts && opts.force) {
      state.completed = false;
      state.skipped = false;
    }
    if (state.completed || state.skipped) return null;

    const root = el("div");
    root.id = "gd-onboard";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Set up Grok D");
    root.setAttribute("aria-describedby", "gd-lede");
    root.innerHTML = `
      <div class="gd-mesh"></div>
      <div class="gd-vignette"></div>
      <div class="gd-shell">
        <aside class="gd-hinge" aria-hidden="true">
          <div class="gd-pin"></div>
          <div class="gd-wire"></div>
          <div class="gd-bead" id="gd-bead"></div>
          <div class="gd-d">D</div>
          <div class="gd-mascot"></div>
        </aside>
        <section class="gd-panel">
          <div class="gd-stepper" id="gd-stepper">
            <div class="gd-step-bubble" id="gd-step-1" data-step-index="1"><span class="gd-step-num">1</span> Account</div>
            <div class="gd-step-bubble" id="gd-step-2" data-step-index="2"><span class="gd-step-num">2</span> Engine</div>
            <div class="gd-step-bubble" id="gd-step-3" data-step-index="3"><span class="gd-step-num">3</span> Complete</div>
          </div>
          <div class="gd-kicker" id="gd-kicker"><span class="gd-kicker-dot"></span><span id="gd-kicker-text">Setup</span></div>
          <h1 id="gd-title"></h1>
          <p class="gd-lede" id="gd-lede"></p>
          <div id="gd-body"></div>
          <div class="gd-actions" id="gd-actions"></div>
          <p class="gd-note" id="gd-note" role="status" aria-live="polite"></p>
        </section>
      </div>
    `;
    document.body.appendChild(root);

    const api = { host: h, state, root, render, save, finish, skip };
    root.__api = api;

    function save() { h.writeState(state); }

    function note(msg, kind) {
      const n = root.querySelector("#gd-note");
      if (!n) return;
      n.textContent = msg || "";
      n.className = "gd-note" + (kind ? " " + kind : "");
    }

    function setBead(t) {
      const bead = root.querySelector("#gd-bead");
      if (bead) bead.style.top = (12 + t * 62) + "%";
    }

    function updateStepper(stepIndex) {
      for (let i = 1; i <= 3; i++) {
        const bubble = root.querySelector("#gd-step-" + i);
        if (!bubble) continue;
        bubble.classList.toggle("is-active", i === stepIndex);
        bubble.classList.toggle("is-done", i < stepIndex);
      }
    }

    function skip() {
      state.skipped = true;
      save();
      dismiss();
    }

    function finish() {
      state.completed = true;
      state.step = "done";
      save();
      dismiss();
    }

    let _proxyReadyTimer = null;
    let _loginPollTimer = null;

    function dismiss() {
      if (_loginPollTimer) { clearInterval(_loginPollTimer); _loginPollTimer = null; }
      if (_proxyReadyTimer) { clearTimeout(_proxyReadyTimer); _proxyReadyTimer = null; }
      root.style.transition = "opacity .35s ease, transform .35s ease";
      root.style.opacity = "0";
      root.style.transform = "scale(0.985)";
      setTimeout(() => root.remove(), 380);
    }

    function go(step) {
      if (_proxyReadyTimer) { clearTimeout(_proxyReadyTimer); _proxyReadyTimer = null; }
      state.step = step;
      save();
      render();
    }

    function actions(nodes) {
      const wrap = root.querySelector("#gd-actions");
      wrap.innerHTML = "";
      nodes.forEach((n) => wrap.appendChild(n));
    }

    function btn(label, cls, fn) {
      const b = el("button", cls, label);
      b.type = "button";
      b.addEventListener("click", fn);
      return b;
    }

    function acc() {
      try {
        if (typeof require === "function") {
          const path = require("path");
          const os = require("os");
          const r = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
          return require(path.join(r, "onboard-accounts.js"));
        }
      } catch (_) {}
      return {
        alreadyIds: (s) => {
          const ids = [];
          (s.cursorProfiles || []).forEach((x) => { if (x && x.id) ids.push(x.id); });
          if (s.cursorProfile && ids.indexOf(s.cursorProfile) < 0) ids.push(s.cursorProfile);
          return ids;
        },
        remember: (s, entry) => {
          const list = (s.cursorProfiles || []).slice();
          const i = list.findIndex((x) => x && x.id === entry.id);
          if (i >= 0) list[i] = Object.assign({}, list[i], entry);
          else list.push(entry);
          return Object.assign({}, s, { cursorProfiles: list, cursorProfile: entry.id });
        },
        unusedImports: (detected, added) => {
          const have = {};
          (added || []).forEach((id) => { have[id] = true; });
          return (detected || []).filter((s) => s && s.id && !have[s.id]);
        },
        displayName: (st, fb) => (st && (st.email || st.name)) || fb || "Cursor",
      };
    }

    function keepAccount(entry) {
      const next = acc().remember(state, entry);
      state.cursorProfiles = next.cursorProfiles;
      state.cursorProfile = next.cursorProfile;
    }

    function probe() {
      const p = h.ports;
      return {
        box: h.portUp(p.box),
        host: h.portUp(p.host),
        infer: h.portUp(p.infer),
        cliproxy: h.portUp(p.cliproxy),
        openburnbar: h.portUp(p.openburnbar),
        vibeproxy: h.portUp(p.vibeproxy),
        ollama: h.portUp(p.ollama),
      };
    }

    // STEP 1: Connect Account & Seat
    function renderChoose() {
      setBead(0.1);
      updateStepper(1);
      root.querySelector("#gd-kicker-text").textContent = "Step 1 of 3 · Account";
      root.querySelector("#gd-title").textContent = "Connect your AI seat";
      root.querySelector("#gd-lede").textContent = "Choose how GrokD authenticates. Use Cursor accounts for instantaneous seat swapping, or use a standalone local seat on this Mac.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";

      const grid = el("div", "gd-choices");

      // Card 1: Cursor Multi-Account
      const cursor = el("button", "gd-seat");
      cursor.type = "button";
      cursor.dataset.kind = "cursor";
      cursor.innerHTML = `
        <div class="gd-seat-header">
          <em>Cursor Account</em>
          <span class="gd-seat-badge">Multi-Seat</span>
        </div>
        <span>Sign in with Cursor or auto-import existing accounts. Swap seats with one click from the bottom dock.</span>
      `;
      cursor.addEventListener("click", () => {
        state.path = "cursor";
        go("cursor-source");
      });

      // Card 2: Local Seat / Standalone
      const local = el("button", "gd-seat");
      local.type = "button";
      local.dataset.kind = "local";
      local.innerHTML = `
        <div class="gd-seat-header">
          <em>Local Seat (This Mac)</em>
          <span class="gd-seat-badge">Standalone</span>
        </div>
        <span>Run self-contained. Requests are routed through OpenBurnBar or local models without external seat binding.</span>
      `;
      local.addEventListener("click", () => {
        state.path = "local";
        go("local-box");
      });

      grid.appendChild(cursor);
      grid.appendChild(local);
      body.appendChild(grid);

      // Auto-detected Cursor accounts quick card
      const detected = h.seats ? h.seats() : [];
      if (detected && detected.length > 0) {
        const autoCard = el("div", "gd-verify-card");
        autoCard.innerHTML = `
          <div class="gd-verify-label">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            <span>Detected existing account: <strong>${detected[0].name}</strong></span>
          </div>
        `;
        const autoBtn = btn("Auto-Import & Continue (" + detected[0].name + ")", "gd-go", () => {
          applyCursor(detected[0].id, { name: detected[0].name, source: "import" });
        });
        autoCard.appendChild(autoBtn);
        body.appendChild(autoCard);
      }

      actions([
        btn("Quick Setup (Local)", "gd-go", () => {
          state.path = "local";
          try {
            h.startBox();
            if (h.installOpenBurnBar && !h.portUp(h.ports.openburnbar)) {
              h.installOpenBurnBar();
            }
          } catch (_) {}
          go("local-proxy");
        }),
        btn("Skip setup", "gd-skip", skip),
      ]);
    }

    // STEP 1 sub: Local Box Setup
    function renderLocalBox() {
      setBead(0.25);
      updateStepper(1);
      root.querySelector("#gd-kicker-text").textContent = "Step 1 · Local Service";
      root.querySelector("#gd-title").textContent = "Initialize background daemons";
      root.querySelector("#gd-lede").textContent = "GrokD connects to local process listeners on your Mac. Confirm the local services are online.";
      const up = probe();
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-list");
      [
        ["Gateway Shim :1337", "IDE connection interface", up.box],
        ["Host Daemon :1338", "Local execution engine", up.host],
        ["Model Router :8787", "Prompt routing proxy", up.infer],
      ].forEach(([title, sub, ok]) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = title;
        left.querySelector("small").textContent = sub;
        const pill = el("span", "gd-pill " + (ok ? "up" : "down"), ok ? "Online" : "Starting…");
        row.appendChild(left);
        row.appendChild(pill);
        list.appendChild(row);
      });
      body.appendChild(list);
      const ready = up.box && up.host;
      const startBoxBtn = btn(ready ? "Continue to Engine →" : "Start Local Engine", "gd-go", () => {
        if (ready) { go("local-proxy"); return; }
        try {
          h.startBox();
          note("Starting background engine…", "");
          startBoxBtn.disabled = true;
          setTimeout(() => { startBoxBtn.disabled = false; render(); }, 1400);
        } catch (e) {
          note(String(e.message || e), "bad");
        }
      });
      actions([
        startBoxBtn,
        btn("Back", "gd-ghost", () => go("choose")),
        btn("Skip", "gd-skip", skip),
      ]);
    }

    // STEP 2: Choose Proxy / Gateway
    function renderLocalProxy() {
      setBead(0.48);
      updateStepper(2);
      root.querySelector("#gd-kicker-text").textContent = "Step 2 of 3 · Engine & Gateway";
      root.querySelector("#gd-title").textContent = "Select your AI gateway";
      root.querySelector("#gd-lede").textContent = "Choose how completions route to model providers. OpenBurnBar is the official OpenAI-compatible gateway.";
      const up = probe();
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-proxy-grid");
      LOCAL_PROXY_CHOICES.forEach((choice) => {
        const { id, name, port, description, badge, logo } = choice;
        const ok = up[id];
        const row = el("div", "gd-proxy-choice" + (id === "openburnbar" ? " is-primary" : ""));
        row.dataset.proxy = id;

        const identity = el("div", "gd-proxy-identity");
        const mark = el("span", "gd-proxy-logo");
        const image = document.createElement("img");
        image.src = logo;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        mark.appendChild(image);

        const copy = el("div", "gd-proxy-copy");
        if (badge) copy.appendChild(el("span", "gd-proxy-badge", badge));
        copy.appendChild(el("strong", "", name));
        copy.appendChild(el("small", "", description));
        identity.appendChild(mark);
        identity.appendChild(copy);

        const controls = el("div", "gd-proxy-controls");
        const endpoint = el("code", "gd-proxy-port", "127.0.0.1:" + port);
        const pill = el("span", "gd-pill " + (ok ? "up" : "down"), ok ? "Online" : "Offline");
        pill.setAttribute("aria-label", name + " is " + (ok ? "online" : "offline"));
        const useLabel = id === "openburnbar" && !ok ? "Launch Gateway" : "Select " + name;
        const use = btn(useLabel, id === "openburnbar" ? "gd-go" : "gd-ghost", () => {
          const select = () => {
            try { h.setProxy(id, state.model); } catch (e) { note(String(e.message || e), "bad"); return; }
            state.proxyTarget = id;
            go("local-model");
          };
          if (id === "openburnbar" && !ok && h.installOpenBurnBar) {
            let launchError = null;
            let launchReady = false;
            try {
              h.installOpenBurnBar((error) => { if (!launchReady) launchError = error; });
            } catch (e) {
              note(String(e.message || e), "bad");
              return;
            }
            use.disabled = true;
            use.textContent = "Starting…";
            note("Starting the OpenBurnBar npm gateway on :8320…", "");
            const deadline = Date.now() + 30000;
            const waitForReady = () => {
              if (state.step !== "local-proxy") return;
              if (launchError) {
                use.disabled = false;
                use.textContent = "Retry";
                note(String(launchError.message || launchError), "bad");
                return;
              }
              if (h.portUp(h.ports.openburnbar)) {
                launchReady = true;
                select();
                return;
              }
              if (Date.now() >= deadline) {
                use.disabled = false;
                use.textContent = "Retry";
                note("OpenBurnBar did not start. You may proceed or retry.", "bad");
                return;
              }
              _proxyReadyTimer = setTimeout(waitForReady, 400);
            };
            _proxyReadyTimer = setTimeout(waitForReady, 250);
            return;
          }
          select();
        });
        use.classList.add("gd-proxy-button");
        controls.appendChild(endpoint);
        controls.appendChild(pill);
        controls.appendChild(use);
        row.appendChild(identity);
        row.appendChild(controls);
        list.appendChild(row);
      });
      body.appendChild(list);
      actions([
        btn("Next: Model Chooser →", "gd-go", () => go("local-model")),
        btn("Back", "gd-ghost", () => go(state.path === "cursor" ? "cursor-source" : "choose")),
        btn("Skip", "gd-skip", skip),
      ]);
    }

    // STEP 2 sub: Model Chooser (August 2026 Edition)
    let _activeProviderFilter = "all";

    function renderLocalModel() {
      setBead(0.68);
      updateStepper(2);
      const cur = h.currentModel();
      root.querySelector("#gd-kicker-text").textContent = "Step 2 of 3 · Model Selection (August 2026)";
      root.querySelector("#gd-title").textContent = "Select default model";
      root.querySelector("#gd-lede").textContent = "Choose your primary intelligence engine. You can change this anytime from the top navigation bar.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";

      const rawList = h.models ? h.models() : CURATED_MODELS;
      const list = rawList.map((m) => {
        const found = CURATED_MODELS.find((x) => x.id === m.id);
        return Object.assign({}, found || {}, m);
      });

      // Filter tabs
      const filterWrap = el("div", "gd-model-filter");
      const filterOptions = [
        { id: "all", label: "All Models" },
        { id: "xai", label: "xAI" },
        { id: "anthropic", label: "Anthropic" },
        { id: "openai", label: "OpenAI" },
        { id: "deepseek", label: "DeepSeek" },
        { id: "gemini", label: "Google" },
        { id: "moonshot", label: "Moonshot" },
        { id: "meta", label: "Local" },
      ];

      filterOptions.forEach((opt) => {
        const tab = el("button", "gd-filter-tab" + (_activeProviderFilter === opt.id ? " is-active" : ""), opt.label);
        tab.type = "button";
        tab.addEventListener("click", () => {
          _activeProviderFilter = opt.id;
          renderLocalModel();
        });
        filterWrap.appendChild(tab);
      });
      body.appendChild(filterWrap);

      const chips = el("div", "gd-models");
      const picked = state.model || cur.model || "grok-4.6";

      const filteredList = list.filter((m) => {
        if (_activeProviderFilter === "all") return true;
        const prov = m.provider || (m.id.includes("claude") ? "anthropic" : m.id.includes("gpt") ? "openai" : m.id.includes("deepseek") ? "deepseek" : m.id.includes("gemini") ? "gemini" : m.id.includes("kimi") ? "moonshot" : m.id.includes("ollama") ? "meta" : "xai");
        return prov === _activeProviderFilter;
      });

      filteredList.forEach((m) => {
        const prov = m.provider || (m.id.includes("claude") ? "anthropic" : m.id.includes("gpt") ? "openai" : m.id.includes("deepseek") ? "deepseek" : m.id.includes("gemini") ? "gemini" : m.id.includes("kimi") ? "moonshot" : m.id.includes("ollama") ? "meta" : "xai");
        const provLabel = m.providerName || (prov === "xai" ? "xAI" : prov === "anthropic" ? "Anthropic" : prov === "openai" ? "OpenAI" : prov === "deepseek" ? "DeepSeek" : prov === "gemini" ? "Google" : prov === "moonshot" ? "Moonshot" : "Local");
        const logoSvg = PROVIDER_LOGOS[prov] || PROVIDER_LOGOS.xai;

        const c = el("button", "gd-chip");
        c.type = "button";
        const isPicked = m.id === picked;
        c.setAttribute("aria-pressed", isPicked ? "true" : "false");
        c.innerHTML = `
          <div class="gd-model-logo-box" aria-hidden="true">${logoSvg}</div>
          <div class="gd-model-meta">
            <div class="gd-model-header">
              <span class="gd-model-name">${m.name}</span>
              <span class="gd-model-provider-badge">${provLabel}</span>
            </div>
            <span class="gd-model-tag">${m.tag || m.desc || "Frontier AI intelligence model"}</span>
          </div>
        `;
        c.addEventListener("click", () => {
          state.model = m.id;
          try { h.setProxy(state.proxyTarget || cur.proxyTarget, m.id); } catch (e) { note(String(e.message || e), "bad"); return; }
          renderLocalModel();
        });
        chips.appendChild(c);
      });

      body.appendChild(chips);
      actions([
        btn("Confirm Model →", "gd-go", () => {
          state.model = picked;
          try { h.setProxy(state.proxyTarget || cur.proxyTarget, picked); } catch (e) { note(String(e.message || e), "bad"); return; }
          go("verify");
        }),
        btn("Back", "gd-ghost", () => go("local-proxy")),
      ]);
    }

    // STEP 3: Verification & Launch
    function renderVerify() {
      setBead(0.92);
      updateStepper(3);
      const cur = h.currentModel();
      const up = probe();
      const rawSeat = state.cursorProfile || (state.cursorProfiles && state.cursorProfiles[0] && state.cursorProfiles[0].name) || (state.path === "cursor" ? "Cursor Seat" : "Local D");
      const seatName = String(rawSeat).slice(0, 64);
      const modelName = String(state.model || cur.model || "Grok 4.6").slice(0, 64);

      const targetMap = {
        openburnbar: { port: 8320, name: "OpenBurnBar", isUp: !!up.openburnbar },
        cliproxy: { port: 8322, name: "CLI Proxy", isUp: !!up.cliproxy },
        vibeproxy: { port: 8325, name: "Vibe Proxy", isUp: !!up.vibeproxy },
        ollama: { port: 11434, name: "Ollama", isUp: !!up.ollama },
        podex: { port: 8484, name: "Podex", isUp: !!up.podex },
      };
      const proxyKey = String(state.proxyTarget || cur.proxyTarget || "openburnbar").toLowerCase();
      const targetInfo = targetMap[proxyKey] || { port: 8320, name: proxyKey, isUp: !!(up.openburnbar || up.cliproxy || up.box) };
      const proxyLabel = `${targetInfo.name} (:${targetInfo.port})`;

      root.querySelector("#gd-kicker-text").textContent = "Step 3 of 3 · Ready";
      root.querySelector("#gd-title").textContent = "Setup complete";
      root.querySelector("#gd-lede").textContent = "GrokD is connected and ready to assist with autonomous routines, coding, and multi-turn workflows.";

      const body = root.querySelector("#gd-body");
      body.innerHTML = "";

      const card = el("div", "gd-verify-card");

      const makeVerifyItem = (svgHtml, labelText, pillText, pillCls) => {
        const item = el("div", "gd-verify-item");
        const label = el("div", "gd-verify-label");
        label.innerHTML = svgHtml;
        const span = el("span");
        span.textContent = labelText;
        label.appendChild(span);
        const pill = el("span", `gd-pill ${pillCls}`);
        pill.textContent = pillText;
        item.appendChild(label);
        item.appendChild(pill);
        return item;
      };

      card.appendChild(makeVerifyItem(
        `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
        "Connected Seat",
        seatName,
        "up"
      ));

      card.appendChild(makeVerifyItem(
        `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
        "AI Gateway",
        proxyLabel,
        targetInfo.isUp ? "up" : "down"
      ));

      card.appendChild(makeVerifyItem(
        `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`,
        "Active Model",
        modelName,
        "up"
      ));

      body.appendChild(card);

      actions([
        btn("Launch Workspace", "gd-go", finish),
        btn("Change Model", "gd-ghost", () => go("local-model")),
        btn("Add Accounts", "gd-ghost", () => go("cursor-source")),
      ]);
      note("You can reopen setup anytime by choosing 'Setup Wizard' in the bottom dock menu.", "good");
    }

    // Cursor source accounts selector
    function renderCursorSource() {
      setBead(0.35);
      updateStepper(1);
      const helpers = acc();
      const added = helpers.alreadyIds(state);
      const n = (state.cursorProfiles || []).length;
      root.querySelector("#gd-kicker-text").textContent = n ? "Step 1 · Additional Seat" : "Step 1 · Connect Cursor";
      root.querySelector("#gd-title").textContent = n ? "Add another account" : "Connect Cursor seat";
      root.querySelector("#gd-lede").textContent = n
        ? n + " account(s) connected. Import another seat or proceed to Engine setup."
        : "Import an existing login from this Mac, or sign in to a new Cursor account.";
      const body = root.querySelector("#gd-body");
      body.innerHTML = "";
      const list = el("div", "gd-list");
      (state.cursorProfiles || []).forEach((p) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = p.name || p.id;
        left.querySelector("small").textContent = p.source === "import" ? "Imported seat · Ready" : "Signed in · Ready";
        row.appendChild(left);
        row.appendChild(el("span", "gd-pill up", "Active"));
        list.appendChild(row);
      });
      const seats = helpers.unusedImports(h.seats ? h.seats() : [], added);
      seats.forEach((s) => {
        const row = el("div", "gd-row");
        const left = document.createElement("div");
        left.innerHTML = `<strong></strong><small></small>`;
        left.querySelector("strong").textContent = "Import " + s.name;
        left.querySelector("small").textContent = "Copies credentials into GrokD safely without altering other installations.";
        const use = btn("Import", "gd-go", () => applyCursor(s.id, {
          name: s.name,
          source: "import",
        }));
        row.appendChild(left);
        row.appendChild(use);
        list.appendChild(row);
      });
      const own = el("div", "gd-row");
      own.innerHTML = n
        ? "<div><strong>Sign in with another account</strong><small>Opens a new Cursor login window.</small></div>"
        : "<div><strong>Sign in with Cursor</strong><small>Opens the Cursor authentication window.</small></div>";
      own.appendChild(btn("Sign in", "gd-ghost", () => {
        try {
          const id = h.addSignIn();
          applyCursor(id, { name: "New Cursor", source: "signin" });
        } catch (e) {
          note(String(e.message || e), "bad");
        }
      }));
      list.appendChild(own);
      body.appendChild(list);

      const nextActs = [];
      if (n > 0 || seats.length === 0) {
        nextActs.push(btn("Next: Engine & Gateway →", "gd-go", () => go("local-proxy")));
      }
      nextActs.push(btn("Back", "gd-ghost", () => go("choose")));
      nextActs.push(btn("Skip", "gd-skip", skip));
      actions(nextActs);
      if (!seats.length && !n) note("No existing Cursor sessions found. Click 'Sign in' to begin.", "");
    }

    function applyCursor(id, meta) {
      try {
        if (meta && meta.source === "import" && h.importSeat) id = h.importSeat(id);
      } catch (e) {
        note(String(e.message || e), "bad");
        return;
      }
      keepAccount({
        id,
        name: (meta && meta.name) || id,
        source: (meta && meta.source) || "signin",
      });
      state.step = "cursor-login";
      save();
      note("Opening seat…", "");
      Promise.resolve()
        .then(() => h.switchTo(id))
        .then(() => {
          if (h.demo) {
            go("cursor-login");
            return;
          }
          if (meta && meta.source === "import") {
            go("local-proxy");
            return;
          }
          renderCursorLogin();
        })
        .catch((e) => {
          note(String(e.message || e), "bad");
        });
    }

    function renderCursorLogin() {
      if (_loginPollTimer) { clearInterval(_loginPollTimer); _loginPollTimer = null; }
      setBead(0.55);
      updateStepper(1);
      root.querySelector("#gd-kicker-text").textContent = "Step 1 · Cursor Authentication";
      root.querySelector("#gd-title").textContent = "Complete sign-in in browser";
      root.querySelector("#gd-lede").textContent = "Complete the sign-in prompt if a window appears. GrokD will detect your session automatically.";
      root.querySelector("#gd-body").innerHTML = "";
      const check = btn("Check status", "gd-go", () => pollLogin(true));
      actions([
        check,
        btn("Continue to Engine →", "gd-ghost", () => {
          if (_loginPollTimer) { clearInterval(_loginPollTimer); _loginPollTimer = null; }
          go("local-proxy");
        }),
        btn("Back", "gd-ghost", () => {
          if (_loginPollTimer) { clearInterval(_loginPollTimer); _loginPollTimer = null; }
          go("cursor-source");
        }),
        btn("Skip", "gd-skip", () => {
          if (_loginPollTimer) { clearInterval(_loginPollTimer); _loginPollTimer = null; }
          skip();
        }),
      ]);
      pollLogin(false);
      let pollCount = 0;
      _loginPollTimer = setInterval(() => {
        pollCount++;
        if (state.step !== "cursor-login" || pollCount > 30) {
          clearInterval(_loginPollTimer);
          _loginPollTimer = null;
          return;
        }
        pollLogin(false);
      }, 2000);
    }

    function pollLogin(manual) {
      note(manual ? "Checking login status…" : "Waiting for authentication…");
      Promise.resolve(h.cursorStatus()).then((s) => {
        const activeId = h.activeProfile ? h.activeProfile() : state.cursorProfile;
        if (activeId && state.cursorProfile && activeId !== state.cursorProfile) {
          note("Switching seat…", "");
          return;
        }
        if (s && s.kind === "logged-in") {
          let snapOk = true;
          if (h.snapshotCurrent) {
            try {
              const res = h.snapshotCurrent(state.cursorProfile);
              if (res === null || res === false) snapOk = false;
            } catch (e) {
              snapOk = false;
              note(String(e.message || e), "bad");
            }
          }
          if (!snapOk) {
            note("Finalizing profile snapshot…", "");
            return;
          }
          if (_loginPollTimer) { clearInterval(_loginPollTimer); _loginPollTimer = null; }
          const label = acc().displayName(s, state.cursorProfile);
          try { if (h.renameProfile && state.cursorProfile) h.renameProfile(state.cursorProfile, label); } catch (_) {}
          keepAccount({
            id: state.cursorProfile,
            name: label,
            source: ((state.cursorProfiles || []).find((x) => x.id === state.cursorProfile) || {}).source || "signin",
            email: s.email || "",
          });
          state.step = "local-proxy";
          save();
          render();
          return;
        }
        note(s && s.kind === "logging-in" ? "Authentication in progress…" : "Waiting for sign in.", "");
      }).catch((e) => note(String(e.message || e), "bad"));
    }

    function renderCursorReady() {
      go("verify");
    }

    function render() {
      note("");
      const step = state.step || "choose";
      root.dataset.step = step;
      if (step === "choose") renderChoose();
      else if (step === "local-box") renderLocalBox();
      else if (step === "local-proxy") renderLocalProxy();
      else if (step === "local-model") renderLocalModel();
      else if (step === "local-ready" || step === "verify") renderVerify();
      else if (step === "cursor-source") renderCursorSource();
      else if (step === "cursor-login" || step === "cursor-apply") renderCursorLogin();
      else if (step === "cursor-ready") renderCursorReady();
      else renderChoose();
    }

    save();
    render();

    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") skip();
    });
    return api;
  }

  function shouldShow(h) {
    const hostApi = h || host();
    const s = Object.assign(blank(), hostApi.readState() || {});
    return !s.completed && !s.skipped;
  }

  function markSplashSeen() {
    const h = host();
    const s = Object.assign(blank(), h.readState() || {});
    s.seenSplash = true;
    h.writeState(s);
    return s;
  }

  return { start, shouldShow, markSplashSeen, host, blank, isOpenBurnBarHealthPayload };
});
