"use client";

import { useEffect, useState } from "react";
import { loyaltyNext } from "@/lib/loyalty";
import { useAccount } from "@/lib/account";

/** 设置或修改登录密码（可选；不设就一直用邮箱验证码登录） */
function Password({ has, onSaved }: { has: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setMsg("两次输入的密码不一样。");
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "保存失败，请稍后再试。");
      setPw("");
      setPw2("");
      setOpen(false);
      setMsg("密码已保存，下次可以用邮箱和密码登录。");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>登录密码</h3>
      <small>
        {has
          ? "已设置密码，可以用邮箱和密码登录。忘记密码时用邮箱验证码登录，再到这里重设。"
          : "还没有设置密码，目前每次都用邮箱验证码登录。设一个密码后，收不到验证码邮件时也能登录。"}
      </small>
      {open ? (
        <form onSubmit={save}>
          <label>
            新密码（至少 8 位）
            <input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            再输入一次
            <input type="password" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </label>
          <div className="form-actions">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="submit" className="btn-accent" disabled={busy}>
              {busy ? "请稍候…" : "保存密码"}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn-ghost" onClick={() => (setOpen(true), setMsg(""))}>
          {has ? "修改密码" : "设置密码"}
        </button>
      )}
      {msg && <div className="notice">{msg}</div>}
    </section>
  );
}

/** 账户页：余额、充值、credit 流水 */
export default function Account({ onLogin, onLogout }: { onLogin: () => void; onLogout: () => void }) {
  const { me, refresh } = useAccount();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [method, setMethod] = useState<"alipay" | "stripe" | null>(null);
  // 去了支付页面又点浏览器的后退回来时，页面是原样恢复的：把「正在跳转」的状态清掉，并重新读一次余额
  useEffect(() => {
    const back = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setBusy("");
      refresh();
    };
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, [refresh]);

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

  const methods = [
    ...(me.alipayEnabled ? [{ id: "alipay" as const, label: "支付宝" }] : []),
    ...(me.stripeEnabled ? [{ id: "stripe" as const, label: "信用卡" }] : []),
  ];
  const active = methods.find((m) => m.id === method)?.id ?? methods[0]?.id ?? null;

  // 支付宝单笔限额：超过的档位不显示，提示分多次买小档
  const cap = me.alipayMaxCny ?? 0;
  const capped = active === "alipay" && cap > 0 && me.packs.some((p) => p.cny > cap);
  const packs = capped ? me.packs.filter((p) => p.cny <= cap) : me.packs;

  // 小额档累计赠送：规则和这个用户的进度
  const loyalty = active === "alipay" && me.loyalty?.tiers.length ? me.loyalty : null;
  const basePack = loyalty && me.packs.find((p) => p.id === loyalty.pack);
  const next = loyalty && loyaltyNext(loyalty.paid, loyalty.tiers, loyalty.cycle);

  async function buy(pack: string) {
    setBusy(pack);
    setError("");
    try {
      const res = await fetch(active === "alipay" ? "/api/billing/alipay/checkout" : "/api/billing/checkout", {
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
          按每次实际用量扣：普通问答每次几十个，一次案件评估约 200，起草或修改一封信每次约 200–300，带大文件会更多。
          做完一个案件一般需要 5000–10000。一键获取学术数据每次 {me.scholarCost} 个；重要引用分析每篇论文约 50–250。
        </small>
      </section>

      <h3 className="section-title">充值</h3>
      {methods.length > 1 && (
        <div className="seg small pay-methods">
          {methods.map((m) => (
            <button key={m.id} className={active === m.id ? "on" : ""} onClick={() => setMethod(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      {active === "alipay" && me.alipaySandbox && (
        <div className="notice">当前是支付宝沙箱（测试）环境，请用沙箱买家账号付款，不会产生真实扣款。</div>
      )}
      <div className="case-list">
        {packs.map((p) => (
          <button key={p.id} className="case-card" disabled={!active || busy !== ""} onClick={() => buy(p.id)}>
            <strong>{p.credits} credits</strong>
            <span className="case-meta">
              {active === "alipay" ? `¥${p.cny}` : `$${p.usd}`}
              {p.credits > p.usd * 100 && ` · 多送 ${p.credits - p.usd * 100}`}
            </span>
            <span className="tag">{busy === p.id ? "正在跳转…" : active === "alipay" ? "支付宝" : active === "stripe" ? "信用卡" : "未开通"}</span>
          </button>
        ))}
      </div>
      {loyalty && basePack && (
        <div className="loyalty">
          <strong>多买多送</strong>
          <p>
            ¥{basePack.cny} 这一档按累计购买的笔数赠送：
            {loyalty.tiers.map((t, i) => `满 ${t.count} 笔${i ? "再" : ""}送 ${t.bonus} credits`).join("，")}
            。付完那一笔时自动到账，满 {loyalty.cycle} 笔后重新累计。
          </p>
          <p className="loyalty-progress">
            你已经买了 {loyalty.paid} 笔
            {next && (
              <>
                ，再买 <b>{next.need}</b> 笔送 <b>{next.bonus}</b> credits
              </>
            )}
            。
          </p>
        </div>
      )}
      {!active && <div className="notice">充值功能还没有开通。</div>}
      {error && <div className="notice">{error}</div>}

      <Password has={me.user.hasPassword} onSaved={refresh} />

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
