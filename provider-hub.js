// OpenBurnBar Provider Hub UI & OAuth Subscription Manager for Grok "D"
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
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
      try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_) {}
      return next;
    } catch (e) {
      console.error("[provider-hub] saveConfig error:", e);
      return readConfig();
    }
  }

  async function triggerOAuth(provider) {
    try {
      const res = await fetch("http://127.0.0.1:8320/api/oauth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider })
      });
      const data = await res.json();
      return data;
    } catch (e) {
      console.error("[provider-hub] OAuth trigger error:", e);
      return { ok: false, error: e.message };
    }
  }

  function renderProviderModal() {
    const existing = document.getElementById("grok-provider-hub-modal");
    if (existing) existing.remove();

    const cfg = readConfig();
    const providers = cfg.providers || {};

    const modal = document.createElement("div");
    modal.id = "grok-provider-hub-modal";
    modal.style.cssText = \`
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(4, 7, 13, 0.82);
      backdrop-filter: blur(32px) saturate(190%);
      -webkit-backdrop-filter: blur(32px) saturate(190%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      color: #f0f6fc;
      opacity: 0;
      transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    \`;

    modal.innerHTML = \`
      <div style="
        width: 660px;
        max-width: 94vw;
        max-height: 90vh;
        background: #0d1117;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 22px;
        box-shadow: 0 28px 72px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: scaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <!-- Header -->
        <div style="padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, #f97316, #ea580c); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(249,115,22,0.4);">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div>
              <div style="font-size: 15px; font-weight: 700; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px;">
                <span>AI Subscriptions & Provider Hub</span>
                <span style="font-size: 10px; font-weight: 700; background: rgba(249,115,22,0.2); color: #fb923c; padding: 2px 7px; border-radius: 6px; border: 1px solid rgba(249,115,22,0.3);">:8320</span>
              </div>
              <div style="font-size: 11px; color: #8b949e; margin-top: 1px;">Use your ChatGPT Plus, Claude Pro, or Cursor subscriptions via OAuth</div>
            </div>
          </div>
          <button id="hub-close-btn" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: #8b949e; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; transition: all 0.15s;">✕</button>
        </div>

        <!-- Body -->
        <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 18px;">
          
          <!-- PRIMARY SECTION: 1-Click Subscription OAuth -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
              <div style="font-size: 12px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                <span>⚡</span> 1-Click OAuth Subscriptions (No API Keys Needed)
              </div>
              <span style="font-size: 11px; color: #10b981; font-weight: 600;">Monthly Plans Supported</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              
              <!-- OpenAI / Codex / ChatGPT Subscription -->
              <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <div style="font-size: 13px; font-weight: 700; color: #34d399; display: flex; align-items: center; gap: 6px;">
                      <span>🤖</span> ChatGPT Plus / Pro
                    </div>
                  </div>
                  <div style="font-size: 11px; color: #94a3b8; line-height: 1.35; margin-bottom: 10px;">
                    Use your monthly ChatGPT subscription (GPT-4o, o3-mini, o1) via Codex OAuth.
                  </div>
                </div>
                <button id="btn-oauth-codex" style="background: #059669; border: none; color: #fff; padding: 6px 12px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(5,150,105,0.35);">
                  Login with ChatGPT ↗
                </button>
              </div>

              <!-- Claude Pro / Claude Code Subscription -->
              <div style="background: rgba(168, 85, 247, 0.06); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <div style="font-size: 13px; font-weight: 700; color: #c084fc; display: flex; align-items: center; gap: 6px;">
                      <span>🧠</span> Claude Pro / Max
                    </div>
                  </div>
                  <div style="font-size: 11px; color: #94a3b8; line-height: 1.35; margin-bottom: 10px;">
                    Use your Claude Pro / Team subscription (Claude 3.7 Sonnet, Opus) via OAuth.
                  </div>
                </div>
                <button id="btn-oauth-claude" style="background: #7c3aed; border: none; color: #fff; padding: 6px 12px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(124,58,237,0.35);">
                  Login with Claude ↗
                </button>
              </div>

              <!-- xAI Subscription -->
              <div style="background: rgba(249, 115, 22, 0.06); border: 1px solid rgba(249, 115, 22, 0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <div style="font-size: 13px; font-weight: 700; color: #fb923c; display: flex; align-items: center; gap: 6px;">
                      <span>🚀</span> xAI / Grok Sub
                    </div>
                  </div>
                  <div style="font-size: 11px; color: #94a3b8; line-height: 1.35; margin-bottom: 10px;">
                    Authenticate directly with your xAI account to access Grok 2 & Grok Beta.
                  </div>
                </div>
                <button id="btn-oauth-xai" style="background: #ea580c; border: none; color: #fff; padding: 6px 12px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(234,88,12,0.35);">
                  Login with xAI ↗
                </button>
              </div>

              <!-- OpenRouter PKCE OAuth -->
              <div style="background: rgba(56, 189, 248, 0.06); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <div style="font-size: 13px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
                      <span>🌐</span> OpenRouter (All AI)
                    </div>
                  </div>
                  <div style="font-size: 11px; color: #94a3b8; line-height: 1.35; margin-bottom: 10px;">
                    1-Click OAuth to access DeepSeek R1, Llama 3.3, and all frontier models.
                  </div>
                </div>
                <button id="btn-oauth-openrouter" style="background: #0284c7; border: none; color: #fff; padding: 6px 12px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(2,132,199,0.35);">
                  Connect OpenRouter ↗
                </button>
              </div>

            </div>
          </div>

          <!-- SECONDARY SECTION: Direct API Keys & Tokens -->
          <div>
            <div style="font-size: 12px; font-weight: 700; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
              Or Direct API Keys & Pay-As-You-Go Tokens
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <!-- OpenAI -->
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px;">
                <div style="font-size: 11px; font-weight: 650; margin-bottom: 4px; color: #c9d1d9;">OpenAI Key (sk-...)</div>
                <input id="key-openai" type="password" placeholder="sk-proj-..." value="${cfg.openaiApiKey || providers.openai?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none;" />
              </div>

              <!-- xAI Grok -->
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px;">
                <div style="font-size: 11px; font-weight: 650; margin-bottom: 4px; color: #c9d1d9;">xAI Grok Key (xai-...)</div>
                <input id="key-xai" type="password" placeholder="xai-..." value="${cfg.xaiApiKey || providers.xai?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none;" />
              </div>

              <!-- Anthropic -->
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px;">
                <div style="font-size: 11px; font-weight: 650; margin-bottom: 4px; color: #c9d1d9;">Anthropic Key (sk-ant-...)</div>
                <input id="key-anthropic" type="password" placeholder="sk-ant-..." value="${cfg.anthropicApiKey || providers.anthropic?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none;" />
              </div>

              <!-- DeepSeek -->
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px;">
                <div style="font-size: 11px; font-weight: 650; margin-bottom: 4px; color: #c9d1d9;">DeepSeek / ZAI (sk-...)</div>
                <input id="key-deepseek" type="password" placeholder="sk-..." value="${cfg.deepseekApiKey || providers.deepseek?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none;" />
              </div>

              <!-- MiniMax -->
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px;">
                <div style="font-size: 11px; font-weight: 650; margin-bottom: 4px; color: #c9d1d9;">MiniMax Key (sk-cp-...)</div>
                <input id="key-minimax" type="password" placeholder="sk-cp-... / token" value="${cfg.minimaxApiKey || providers.minimax?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none;" />
              </div>

              <!-- Google Gemini -->
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px;">
                <div style="font-size: 11px; font-weight: 650; margin-bottom: 4px; color: #c9d1d9;">Google Gemini (AIza...)</div>
                <input id="key-gemini" type="password" placeholder="AIzaSy..." value="${cfg.geminiApiKey || providers.gemini?.apiKey || ""}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none;" />
              </div>
            </div>
          </div>

          <!-- Free Local AI Status -->
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
              <span style="font-size: 11px; color: #d1fae5; font-weight: 600;">Ollama (:11434) & LM Studio (:1234) Auto-Discovery Active</span>
            </div>
            <a href="https://burnbar.app" target="_blank" style="color: #38bdf8; text-decoration: none; font-size: 11px; font-weight: 600;">BurnBar Mac App ↗</a>
          </div>

        </div>

        <!-- Footer -->
        <div style="padding: 14px 24px; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 11px; color: #8b949e;">Hot-reloaded into Grok D immediately upon save.</div>
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

    // OAuth Subscriptions Triggers
    modal.querySelector("#btn-oauth-codex").addEventListener("click", async () => {
      const res = await triggerOAuth("codex");
      if (typeof window.showToast === "function") {
        window.showToast("Opening ChatGPT / Codex subscription login in browser…");
      }
    });

    modal.querySelector("#btn-oauth-claude").addEventListener("click", async () => {
      const res = await triggerOAuth("claude");
      if (typeof window.showToast === "function") {
        window.showToast("Opening Claude Pro subscription login in browser…");
      }
    });

    modal.querySelector("#btn-oauth-xai").addEventListener("click", async () => {
      const res = await triggerOAuth("xai");
      if (typeof window.showToast === "function") {
        window.showToast("Opening xAI subscription login in browser…");
      }
    });

    modal.querySelector("#btn-oauth-openrouter").addEventListener("click", () => {
      const url = "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A8320%2Fauth%2Fcallback";
      try { shell.openExternal(url); } catch { window.open(url, "_blank"); }
    });

    modal.querySelector("#hub-save-btn").addEventListener("click", () => {
      const patch = {
        openaiApiKey: modal.querySelector("#key-openai").value.trim() || undefined,
        xaiApiKey: modal.querySelector("#key-xai").value.trim() || undefined,
        deepseekApiKey: modal.querySelector("#key-deepseek").value.trim() || undefined,
        minimaxApiKey: modal.querySelector("#key-minimax").value.trim() || undefined,
        geminiApiKey: modal.querySelector("#key-gemini").value.trim() || undefined,
        anthropicApiKey: modal.querySelector("#key-anthropic").value.trim() || undefined,
        providers: {
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
        window.showToast("⚡ Subscriptions & Keys Saved & Hot-Reloaded!");
      }
    });
  }

  module.exports = { renderProviderModal, triggerOAuth };
})();
