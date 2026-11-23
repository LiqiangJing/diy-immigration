"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Chat from "@/components/Chat";
import Cases, { caseLibrary, caseLine } from "@/components/Cases";
import Profile from "@/components/Profile";
import Account from "@/components/Account";
import Auth from "@/components/Auth";
import Contact from "@/components/Contact";
import { AccountContext } from "@/lib/account";
import type { Me } from "@/lib/account";
import { citationReport, emptyProfile, endeavorReport, normalizeProfile, notableReport, profileToText, socReport } from "@/lib/profile";
import type { Profile as ProfileData } from "@/lib/profile";
import type { Place } from "@/lib/actions";
import { setRemoteFiles } from "@/lib/files";
import { fetchAll, fileIds, isEmpty, loadMeta, merge, pushOne, saveMeta, SYNC_KEYS, uploadMissingFiles } from "@/lib/sync";
import type { SyncKey, SyncMeta } from "@/lib/sync";
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

  // ---- 登录后把数据同步到服务器（浏览器里仍保留一份）----
  const [syncState, setSyncState] = useState<"off" | "syncing" | "ok" | "error">("off");
  const current: Record<SyncKey, unknown> = { conversations: convs, cases, profile, docs };
  const currentRef = useRef(current);
  currentRef.current = current;
  const metaRef = useRef<SyncMeta | null>(null);
  const sentRef = useRef<Partial<Record<SyncKey, string>>>({}); // 每份数据上次和服务器对齐时的内容
  const [syncReady, setSyncReady] = useState(false);
  const timers = useRef<Partial<Record<SyncKey, ReturnType<typeof setTimeout>>>>({});
  const email = me?.user?.email ?? "";

  const applyKey = useCallback((key: SyncKey, value: unknown) => {
    if (key === "conversations") setConvs(Array.isArray(value) ? (value as Conversation[]) : []);
    else if (key === "cases") setCases(Array.isArray(value) ? (value as ImmigrationCase[]) : []);
    else if (key === "docs") setDocs(Array.isArray(value) ? (value as DocFile[]) : []);
    else setProfile(normalizeProfile((value ?? {}) as Record<string, unknown>));
  }, []);

  const pushKey = useCallback(
    async (key: SyncKey) => {
      const meta = metaRef.current;
      if (!meta) return;
      const json = JSON.stringify(currentRef.current[key]);
      if (json === sentRef.current[key]) return;
      setSyncState("syncing");
      const r = await pushOne(key, json, meta.revs[key] ?? 0);
      if (metaRef.current !== meta) return; // 期间换了账号
      if (r.ok) {
        meta.revs[key] = r.rev;
        sentRef.current[key] = json;
        // 上传期间又有新改动的话，下面的 effect 会再排一次
        meta.dirty[key] = JSON.stringify(currentRef.current[key]) !== json;
        saveMeta(meta);
        setSyncState(SYNC_KEYS.some((k) => meta.dirty[k]) ? "syncing" : "ok");
      } else if (r.conflict) {
        // 别的设备先保存了：合并后以服务器的版本号再传一次
        let theirs: unknown = null;
        try {
          theirs = r.conflict.value ? JSON.parse(r.conflict.value) : null;
        } catch {}
        meta.revs[key] = r.conflict.rev;
        sentRef.current[key] = r.conflict.value;
        saveMeta(meta);
        applyKey(key, merge(key, currentRef.current[key], theirs));
      } else {
        setSyncState("error");
        clearTimeout(timers.current[key]);
        timers.current[key] = setTimeout(() => pushKey(key), 20_000);
      }
    },
    [applyKey],
  );

  // 登录（或刷新页面后恢复登录）时，先和服务器对齐一次
  useEffect(() => {
    if (!loaded || !email) {
      metaRef.current = null;
      setSyncReady(false);
      setSyncState("off");
      setRemoteFiles(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setSyncState("syncing");
      const server = await fetchAll();
      if (cancelled) return;
      if (!server) {
        setSyncState("error");
        return;
      }
      const old = loadMeta();
      const sameUser = old?.user === email;
      // 本地数据上次属于另一个账号：不能混进这个账号，直接换成这个账号在服务器上的数据
      const foreign = Boolean(old) && !sameUser;
      const meta: SyncMeta = { user: email, revs: {}, dirty: {} };
      const sent: Partial<Record<SyncKey, string>> = {};
      for (const key of SYNC_KEYS) {
        const local = currentRef.current[key];
        const s = server[key];
        let theirs: unknown = null;
        try {
          theirs = s?.value ? JSON.parse(s.value) : null;
        } catch {}
        meta.revs[key] = s?.rev ?? 0;
        sent[key] = s?.value ?? "";
        if (foreign) {
          applyKey(key, theirs);
        } else if (!s) {
          meta.dirty[key] = !isEmpty(key, local); // 服务器上还没有：把本地的传上去
          if (!meta.dirty[key]) sent[key] = JSON.stringify(local);
        } else if (sameUser && old.revs[key] === s.rev) {
          // 服务器没变，本地的就是最新的；本地和服务器内容不同的话（比如退出登录期间改过），下面的 effect 会发现并上传
          meta.dirty[key] = Boolean(old.dirty[key]);
        } else if (sameUser && !old.dirty[key]) {
          applyKey(key, theirs); // 别的设备改过，本地没有未上传的改动：用服务器的
        } else {
          applyKey(key, merge(key, local, theirs)); // 两边都改过，或者是登录前就在这个浏览器里填的内容
          meta.dirty[key] = true;
        }
      }
      metaRef.current = meta;
      sentRef.current = sent;
      saveMeta(meta);
      setRemoteFiles(true);
      setSyncReady(true);
      setSyncState("ok");
      // 以前只存在这个浏览器里的文件，补传到服务器
      setTimeout(() => {
        if (!cancelled) uploadMissingFiles(fileIds(currentRef.current.cases, currentRef.current.conversations));
      }, 3000);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, email, applyKey]);

  // 之后每次改动，停手两秒后保存到服务器
  useEffect(() => {
    const meta = metaRef.current;
    if (!syncReady || !meta) return;
    for (const key of SYNC_KEYS) {
      const json = JSON.stringify(currentRef.current[key]);
      // 从服务器取回来的内容经过补齐字段后，文字上可能和原样不同但意思一样；只有真的不同才算改动
      if (json === sentRef.current[key]) {
        if (meta.dirty[key]) {
          meta.dirty[key] = false;
          saveMeta(meta);
          if (!SYNC_KEYS.some((k) => meta.dirty[k])) setSyncState("ok");
        }
        continue;
      }
      if (!meta.dirty[key]) {
        meta.dirty[key] = true;
        saveMeta(meta);
      }
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => pushKey(key), 2000);
    }
  }, [convs, cases, profile, docs, syncReady, pushKey]);

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

  // 用户的案件只有一种类型时，档案里的填写说明只显示那一种的
  const caseOnly = cases.length === 0 ? null : cases.every((c) => c.type === "NIW") ? "NIW" : cases.every((c) => c.type === "EB-1A") ? "EB-1A" : null;

  // 从聊天的确认卡片点「去看填好的页面」时记下要打开哪一栏；之后从侧边栏正常进入时不再沿用
  const [jump, setJump] = useState<Place | null>(null);
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
          <button className={view === "cases" ? "on" : ""} onClick={() => (setJump(null), go("cases"))}>
            <strong>案件</strong>
            <span>文档、文件、材料清单</span>
          </button>
          <button className={view === "profile" ? "on" : ""} onClick={() => (setJump(null), go("profile"))}>
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
          <a className="contact-link" href="/demo" target="_blank" rel="noreferrer">
            功能演示
          </a>
          <button className="contact-link" onClick={() => setContactOpen(true)}>
            联系我们
          </button>
          <span className="legal-links">
            <a href="/terms" target="_blank" rel="noreferrer">服务条款</a> · <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a>
          </span>
          {me?.user ? (
            <button className={view === "account" ? "on" : ""} onClick={() => go("account")}>
              <span className="account-email">{me.user.email}</span>
              <span className="account-credits">{me.user.credits} credits · 充值</span>
            </button>
          ) : null}
          {me?.user ? (
            <span className={`sync-state ${syncState}`}>
              {syncState === "ok"
                ? "数据已保存到云端"
                : syncState === "syncing"
                  ? "正在保存到云端…"
                  : syncState === "error"
                    ? "云端保存失败，稍后自动重试（内容仍在本浏览器里）"
                    : ""}
            </span>
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
            profileText={profileToText(profile, linkedCase?.type === "NIW")}
            firstName={(profile.chineseName || profile.firstName).trim()}
            library={linkedCase ? caseLibrary(linkedCase, docs) : undefined}
            contextLine={linkedCase ? caseLine(linkedCase) : undefined}
            ops={{
              profile,
              cases,
              linkedCaseId: linkedCase?.id ?? null,
              commit: (r) => {
                if (r.profile) setProfile(r.profile);
                if (r.cases) setCases(r.cases);
              },
              open: (place) => {
                setJump(place);
                go(place.view);
              },
            }}
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
            profile={profile}
            goProfile={(tab) => {
              setJump(tab ? { view: "profile", tab } : null);
              go("profile");
            }}
            petitioner={`${profile.firstName} ${profile.lastName}`.trim()}
            citationReport={citationReport(profile)}
            notableReport={notableReport(profile)}
            socReport={socReport(profile)}
            endeavorReport={endeavorReport(profile)}
            initialOpen={jump?.view === "cases" ? jump : undefined}
          />
        ) : view === "profile" ? (
          <Profile
            profile={profile}
            setProfile={setProfile}
            initialTab={jump?.view === "profile" ? jump.tab : undefined}
            only={caseOnly}
          />
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
