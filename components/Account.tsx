"use client";

import { useState } from "react";
import { useAccount } from "@/lib/account";

/** 账户页：余额、充值、credit 流水 */
export default function Account({ onLogin, onLogout }: { onLogin: () => void; onLogout: () => void }) {
  const { me } = useAccount();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  if (!me?.user) {
    return (
      <div className="cases">
        <div className="empty">
          <h3>还没有登录</h3>
          <p>登录后可以使用聊天、文档写作和学术数据获取。新用户会获赠一些 credit。</p>
          <button className="btn-accent" onClick={onLogin}>
            登录 / 注册
          </button>
        </div>
      </div>
    );
  }

  async function buy(pack: string) {
    setBusy(pack);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? "创建支付页面失败。");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建支付页面失败。");
      setBusy("");
    }
  }

  return (
    <div className="cases">
      <div className="case-head">
        <div>
          <h2>账户</h2>
          <p>{me.user.email}</p>
        </div>
        <button className="btn-ghost" onClick={onLogout}>
          退出登录
        </button>
      </div>

      <section className="card balance">
        <span>Credit 余额</span>
        <strong>{me.user.credits}</strong>
        <small>
          聊天和文档写作按每次实际用量扣，一般的一轮问答是几个 credit，带大文件或长文书会更多；一键获取学术数据每次{" "}
          {me.scholarCost} 个。
        </small>
      </section>

      <h3 className="section-title">充值</h3>
      <div className="case-list">
        {me.packs.map((p) => (
          <button key={p.id} className="case-card" disabled={!me.paymentsEnabled || busy !== ""} onClick={() => buy(p.id)}>
            <strong>{p.credits} credits</strong>
            <span className="case-meta">
              ${p.usd}
              {p.credits > p.usd * 100 && ` · 多送 ${p.credits - p.usd * 100}`}
            </span>
            <span className="tag">{busy === p.id ? "正在跳转…" : "信用卡 / 支付宝"}</span>
          </button>
        ))}
      </div>
      {!me.paymentsEnabled && <div className="notice">充值功能还没有开通。</div>}
      {error && <div className="notice">{error}</div>}

      <h3 className="section-title">最近的 credit 记录</h3>
      {me.history.length === 0 ? (
        <p className="group-note">还没有记录。</p>
      ) : (
        <ul className="file-list">
          {me.history.map((h, i) => (
            <li key={i}>
              <span className="file-name">{h.reason}</span>
              <span className="case-meta">{new Date(h.at).toLocaleString("zh-CN")}</span>
              <strong className={h.delta > 0 ? "plus" : "minus"}>
                {h.delta > 0 ? "+" : ""}
                {h.delta}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
