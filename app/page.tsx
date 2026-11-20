"use client";

import { useCallback, useEffect, useState } from "react";
import Chat from "@/components/Chat";
import Cases, { caseLibrary, caseLine } from "@/components/Cases";
import Profile from "@/components/Profile";
import Account from "@/components/Account";
import Auth from "@/components/Auth";
import Contact from "@/components/Contact";
import { AccountContext } from "@/lib/account";
import type { Me } from "@/lib/account";
import { citationReport, emptyProfile, normalizeProfile, profileToText } from "@/lib/profile";
import type { Profile as ProfileData } from "@/lib/profile";
import type { Conversation, DocFile, ImmigrationCase } from "@/lib/types";

const CONV_KEY = "pathway.conversations";
const CASE_KEY = "pathway.cases";
const PROFILE_KEY = "pathway.profile";
const DOCS_KEY = "pathway.docs";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

type View = "chat" | "cases" | "profile" | "account";

export default function Home() {
  const [view, setView] = useState<View>("chat");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cases, setCases] = useState<ImmigrationCase[]>([]);
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (res.ok) setMe(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    // 从 Stripe 支付页面跳回来
    const paid = new URLSearchParams(window.location.search).get("paid");
    if (paid) {
      window.history.replaceState(null, "", window.location.pathname);
      setView("account");
      setToast(paid === "1" ? "支付成功，credit 到账可能需要几秒钟。" : "支付已取消。");
      if (paid === "1") setTimeout(refresh, 4000);
    }
  }, [refresh]);

  const guard = useCallback(
    (cost = 1) => {
      if (!me?.user) {
        setAuthOpen(true);
        return false;
      }
      if (me.user.credits < cost) {
        setToast("Credit 余额不足，请先充值。");
        setView("account");
        return false;
      }
      return true;
    },
    [me],
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 只有用户主动切换会话时才重新挂载 Chat；发送首条消息创建会话时不能重挂载，否则会打断流式输出
  const [chatKey, setChatKey] = useState(0);
  const openConv = (id: string | null) => {
    setActiveId(id);
    setChatKey((k) => k + 1);
    setSidebarOpen(false);
  };
  // 还没发出第一条消息的新会话要关联的案件
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);

  useEffect(() => {
    setConvs(load<Conversation[]>(CONV_KEY, []));
    setCases(load<ImmigrationCase[]>(CASE_KEY, []));
    setDocs(load<DocFile[]>(DOCS_KEY, []));
    setProfile(normalizeProfile(load<Record<string, unknown>>(PROFILE_KEY, {})));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) save(CONV_KEY, convs);
  }, [convs, loaded]);
  useEffect(() => {
    if (loaded) save(CASE_KEY, cases);
  }, [cases, loaded]);
  useEffect(() => {
    if (loaded) save(PROFILE_KEY, profile);
  }, [profile, loaded]);
  useEffect(() => {
    if (loaded) save(DOCS_KEY, docs);
  }, [docs, loaded]);

  const patchConv = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) =>
      setConvs((list) => list.map((c) => (c.id === id ? fn(c) : c))),
    [],
  );
  const addConv = useCallback(
    (c: Conversation) => {
      setConvs((list) => [{ ...c, caseId: pendingCaseId ?? undefined }, ...list]);
      setActiveId(c.id);
    },
    [pendingCaseId],
  );

  const active = convs.find((c) => c.id === activeId) ?? null;
  const linkedId = active ? (active.caseId ?? null) : pendingCaseId;
  const linkedCase = cases.find((c) => c.id === linkedId) ?? null;
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);

  const go = (v: View) => {
    setView(v);
    setSidebarOpen(false);
  };

  return (
    <AccountContext.Provider value={{ me, guard, refresh }}>
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            D
          </span>
          <span className="brand-name">DIY Immigration</span>
        </div>

        <nav className="nav">
          <button className={view === "chat" ? "on" : ""} onClick={() => go("chat")}>
            <strong>聊天</strong>
            <span>移民问题，随时问</span>
          </button>
          <button className={view === "cases" ? "on" : ""} onClick={() => go("cases")}>
            <strong>案件</strong>
            <span>文档、文件、材料清单</span>
          </button>
          <button className={view === "profile" ? "on" : ""} onClick={() => go("profile")}>
            <strong>我的档案</strong>
            <span>学历、成果与未来计划</span>
          </button>
        </nav>

        {view === "chat" && (
          <>
            <button
              className="btn-dark"
              onClick={() => openConv(null)}
            >
              + 新建会话
            </button>
            <div className="history">
              {sorted.length > 0 && <div className="history-label">历史会话</div>}
              {sorted.map((c) => (
                <div key={c.id} className={`history-item ${c.id === activeId ? "on" : ""}`}>
                  <button
                    className="history-title"
                    onClick={() => openConv(c.id)}
                  >
                    {c.title}
                  </button>
                  <button
                    className="history-del"
                    title="删除会话"
                    aria-label={`删除会话 ${c.title}`}
                    onClick={() => {
                      if (!confirm(`删除会话「${c.title}」？`)) return;
                      setConvs((list) => list.filter((x) => x.id !== c.id));
                      if (activeId === c.id) openConv(null);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="account-box">
          <button className="contact-link" onClick={() => setContactOpen(true)}>
            联系我们
          </button>
          {me?.user ? (
            <button className={view === "account" ? "on" : ""} onClick={() => go("account")}>
              <span className="account-email">{me.user.email}</span>
              <span className="account-credits">{me.user.credits} credits · 充值</span>
            </button>
          ) : (
            <button onClick={() => setAuthOpen(true)}>
              <span className="account-email">登录 / 注册</span>
              <span className="account-credits">登录后开始使用</span>
            </button>
          )}
        </div>
      </aside>

      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
          ☰
        </button>
        {view === "chat" ? (
          <Chat
            key={chatKey}
            conv={active}
            addConv={addConv}
            patchConv={patchConv}
            profileText={profileToText(profile)}
            firstName={(profile.chineseName || profile.firstName).trim()}
            library={linkedCase ? caseLibrary(linkedCase, docs) : undefined}
            contextLine={linkedCase ? caseLine(linkedCase) : undefined}
            caseLink={{
              cases,
              value: linkedCase?.id ?? null,
              onChange: (id) =>
                active
                  ? patchConv(active.id, (c) => ({ ...c, caseId: id ?? undefined }))
                  : setPendingCaseId(id),
            }}
          />
        ) : view === "cases" ? (
          <Cases
            cases={cases}
            setCases={setCases}
            docs={docs}
            setDocs={setDocs}
            profileText={profileToText(profile)}
            petitioner={`${profile.firstName} ${profile.lastName}`.trim()}
            citationReport={citationReport(profile)}
          />
        ) : view === "profile" ? (
          <Profile profile={profile} setProfile={setProfile} />
        ) : (
          <>
            {toast && <div className="toast">{toast}</div>}
            <Account
              onLogin={() => setAuthOpen(true)}
              onLogout={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                setToast("");
                refresh();
              }}
            />
          </>
        )}
      </main>

      {contactOpen && <Contact onClose={() => setContactOpen(false)} />}
      {authOpen && (
        <Auth
          onClose={() => setAuthOpen(false)}
          onDone={() => {
            setAuthOpen(false);
            refresh();
          }}
        />
      )}
    </div>
    </AccountContext.Provider>
  );
}
