// OpenBurnBar Provider Hub UI & OAuth Modal for Grok "D"
"use strict";

(function () {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const { shell } = require("electron");

  const ROOT = process.env.GROK_PROFILE_ROOT || path.join(os.homedir(), ".grok", "grokbot-d");
  const CONFIG_PATH = path.join(ROOT, "model-config.json");

  function readConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {}
    return {};
  }

  function saveConfig(patch) {
    try {
      const cur = readConfig();
      const next = { ...cur, ...patch };
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
      return next;
    } catch (e) {
      console.error("[provider-hub] saveConfig error:", e);
      return readConfig();
    }
  }

  function renderProviderModal() {
    const existing = document.getElementById("grok-provider-hub-modal");
    if (existing) existing.remove();

    const cfg = readConfig();
    const providers = cfg.providers || {};

    const modal = document.createElement("div");
    modal.id = "grok-provider-hub-modal";
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(4, 7, 13, 0.78);
      backdrop-filter: blur(28px) saturate(180%);
      -webkit-backdrop-filter: blur(28px) saturate(180%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      color: #f0f6fc;
      opacity: 0;
      transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    modal.innerHTML = \`
      <div style="
        width: 620px;
        max-width: 92vw;
        max-height: 88vh;
        background: #0f141c;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 20px;
        box-shadow: 0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: scaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <!-- Header -->
        <div style="padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #f97316, #ea580c); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(249,115,22,0.35);">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div>
              <div style="font-size: 15px; font-weight: 700; letter-spacing: -0.01em;">OpenBurnBar & AI Providers</div>
              <div style="font-size: 11px; color: #8b949e;">Universal AI Gateway & Subscription Hub (:8320)</div>
            </div>
          </div>
          <button id="hub-close-btn" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: #8b949e; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; transition: all 0.15s;">✕</button>
        </div>

        <!-- Body / Scrollable Content -->
        <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px;">
          
          <!-- OpenRouter OAuth / API Key Banner -->
          <div style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(99, 102, 241, 0.08)); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 14px; padding: 14px 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">🌐</span>
                <span style="font-size: 13px; font-weight: 700; color: #38bdf8;">OpenRouter (All Models in 1 Key)</span>
              </div>
              <button id="hub-openrouter-oauth" style="background: #0284c7; border: none; color: #fff; padding: 5px 12px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 8px rgba(2,132,199,0.35);">
                Connect with OAuth ↗
              </button>
            </div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; margin-bottom: 10px;">
              Direct access to Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, and Llama 3.3 with no subscriptions needed.
            </div>
            <input id="key-openrouter" type="password" placeholder="Or paste sk-or-v1-..." value="${cfg.openrouterApiKey || providers.openrouter?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 12px; outline: none;" />
          </div>

          <!-- Direct Providers Grid -->
          <div style="font-size: 12px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px;">Direct Provider API Keys</div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <!-- OpenAI -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 650; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>🤖</span> OpenAI / ChatGPT
              </div>
              <input id="key-openai" type="password" placeholder="sk-proj-..." value="${cfg.openaiApiKey || providers.openai?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; outline: none;" />
            </div>

            <!-- xAI Grok -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 650; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>🚀</span> xAI Grok
              </div>
              <input id="key-xai" type="password" placeholder="xai-..." value="${cfg.xaiApiKey || providers.xai?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; outline: none;" />
            </div>

            <!-- DeepSeek / ZAI -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 650; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>⚡</span> DeepSeek / ZAI
              </div>
              <input id="key-deepseek" type="password" placeholder="sk-..." value="${cfg.deepseekApiKey || providers.deepseek?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; outline: none;" />
            </div>

            <!-- MiniMax -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 650; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>🌟</span> MiniMax (Text-01)
              </div>
              <input id="key-minimax" type="password" placeholder="sk-cp-... / key" value="${cfg.minimaxApiKey || providers.minimax?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; outline: none;" />
            </div>

            <!-- Google Gemini -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 650; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>💎</span> Google Gemini
              </div>
              <input id="key-gemini" type="password" placeholder="AIzaSy..." value="${cfg.geminiApiKey || providers.gemini?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; outline: none;" />
            </div>

            <!-- Anthropic Claude -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 650; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>🧠</span> Anthropic Claude
              </div>
              <input id="key-anthropic" type="password" placeholder="sk-ant-..." value="${cfg.anthropicApiKey || providers.anthropic?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; outline: none;" />
            </div>
          </div>

          <!-- Local Engine Auto-Discovery Indicator -->
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 12px; font-weight: 650; color: #10b981; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
                Local AI Auto-Discovery Active
              </div>
              <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">
                Ollama (:11434) and LM Studio (:1234) models are automatically discovered without API keys.
              </div>
            </div>
            <a href="https://burnbar.app" target="_blank" style="color: #38bdf8; text-decoration: none; font-size: 11px; font-weight: 600;">BurnBar App ↗</a>
          </div>

        </div>

        <!-- Footer -->
        <div style="padding: 14px 24px; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 11px; color: #8b949e;">Changes are hot-reloaded to :8320 immediately.</div>
          <div style="display: flex; gap: 10px;">
            <button id="hub-cancel-btn" style="background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #c9d1d9; padding: 7px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">Cancel</button>
            <button id="hub-save-btn" style="background: linear-gradient(135deg, #f97316, #ea580c); border: none; color: #fff; padding: 7px 20px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 10px rgba(249,115,22,0.4);">Save & Hot Reload</button>
          </div>
        </div>
      </div>
    \`;

    document.body.appendChild(modal);
    requestAnimationFrame(() => { modal.style.opacity = "1"; });

    const close = () => {
      modal.style.opacity = "0";
      setTimeout(() => modal.remove(), 220);
    };

    modal.querySelector("#hub-close-btn").addEventListener("click", close);
    modal.querySelector("#hub-cancel-btn").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

    modal.querySelector("#hub-openrouter-oauth").addEventListener("click", () => {
      const url = "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A8320%2Fauth%2Fcallback";
      try { shell.openExternal(url); } catch { window.open(url, "_blank"); }
    });

    modal.querySelector("#hub-save-btn").addEventListener("click", () => {
      const patch = {
        openrouterApiKey: modal.querySelector("#key-openrouter").value.trim() || undefined,
        openaiApiKey: modal.querySelector("#key-openai").value.trim() || undefined,
        xaiApiKey: modal.querySelector("#key-xai").value.trim() || undefined,
        deepseekApiKey: modal.querySelector("#key-deepseek").value.trim() || undefined,
        minimaxApiKey: modal.querySelector("#key-minimax").value.trim() || undefined,
        geminiApiKey: modal.querySelector("#key-gemini").value.trim() || undefined,
        anthropicApiKey: modal.querySelector("#key-anthropic").value.trim() || undefined,
        providers: {
          openrouter: { enabled: !!modal.querySelector("#key-openrouter").value.trim(), apiKey: modal.querySelector("#key-openrouter").value.trim() || undefined },
          openai: { enabled: !!modal.querySelector("#key-openai").value.trim(), apiKey: modal.querySelector("#key-openai").value.trim() || undefined },
          xai: { enabled: !!modal.querySelector("#key-xai").value.trim(), apiKey: modal.querySelector("#key-xai").value.trim() || undefined },
          deepseek: { enabled: !!modal.querySelector("#key-deepseek").value.trim(), apiKey: modal.querySelector("#key-deepseek").value.trim() || undefined },
          minimax: { enabled: !!modal.querySelector("#key-minimax").value.trim(), apiKey: modal.querySelector("#key-minimax").value.trim() || undefined },
          gemini: { enabled: !!modal.querySelector("#key-gemini").value.trim(), apiKey: modal.querySelector("#key-gemini").value.trim() || undefined },
          anthropic: { enabled: !!modal.querySelector("#key-anthropic").value.trim(), apiKey: modal.querySelector("#key-anthropic").value.trim() || undefined },
        }
      };
      saveConfig(patch);
      close();
      if (typeof window.showToast === "function") {
        window.showToast("⚡ OpenBurnBar Providers Saved & Hot-Reloaded!");
      }
    });
  }

  module.exports = { renderProviderModal };
})();
