"use client";

import { useState } from "react";

/** 邮箱验证码登录弹窗；新邮箱会自动注册 */
export default function Auth({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devCode, setDevCode] = useState("");

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "请求失败，请稍后再试。");
    return data;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === "email") {
        const data = await post("/api/auth/request", { email });
        setDevCode(data.devCode ?? "");
        setStep("code");
      } else {
        await post("/api/auth/verify", { email, code });
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h3>登录 / 注册</h3>
        {step === "email" ? (
          <>
            <p>输入邮箱，我们会发一个 6 位验证码。第一次登录会自动注册。</p>
            <p className="legal-agree">
              登录或注册即表示你同意
              <a href="/terms" target="_blank" rel="noreferrer">服务条款</a>和
              <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a>。本服务不是律师事务所，不提供法律意见。
            </p>
            <label>
              邮箱
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          </>
        ) : (
          <>
            <p>
              验证码已发送到 {email}，10 分钟内有效。
              <button type="button" className="link" onClick={() => setStep("email")}>
                换一个邮箱
              </button>
            </p>
            {devCode && (
              <div className="dev-code">
                测试模式（服务端还没配置发信）：验证码是 <strong>{devCode}</strong>
              </div>
            )}
            <label>
              验证码
              <input
                required
                autoFocus
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6 位数字"
              />
            </label>
          </>
        )}
        {error && <div className="notice">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn-accent" disabled={busy}>
            {busy ? "请稍候…" : step === "email" ? "发送验证码" : "登录"}
          </button>
        </div>
      </form>
    </div>
  );
}
