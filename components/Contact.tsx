"use client";

import { useState } from "react";
import { useAccount } from "@/lib/account";

/** 「联系我们」弹窗 */
export default function Contact({ onClose }: { onClose: () => void }) {
  const { me } = useAccount();
  const [email, setEmail] = useState(me?.user?.email ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [qr, setQr] = useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "提交失败，请稍后再试。");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h3>联系我们</h3>
        {sent ? (
          <>
            <p>收到了，我们会尽快回复到 {email}。</p>
            <div className="form-actions">
              <button type="button" className="btn-accent" onClick={onClose}>
                好的
              </button>
            </div>
          </>
        ) : (
          <>
            <p>使用中遇到问题、充值没到账，或者有建议，都可以在这里告诉我们。</p>
            {/* 把微信二维码图片放到 public/wechat-qr.png 就会显示在这里；没有这张图时这一块不出现 */}
            {qr && (
              <div className="wechat">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/wechat-qr.png" alt="企业微信二维码" onError={() => setQr(false)} />
                <span>
                  <strong>加企业微信进交流群</strong>
                  用微信扫码添加我们，我们拉你进用户交流群，问题能更快得到回复。
                </span>
              </div>
            )}
            <label>
              你的邮箱
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              想说的话
              <textarea
                required
                rows={5}
                maxLength={5000}
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="请尽量写清楚：做了什么、看到了什么、希望怎样"
              />
            </label>
            {error && <div className="notice">{error}</div>}
            <div className="form-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="btn-accent" disabled={busy}>
                {busy ? "正在发送…" : "发送"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
