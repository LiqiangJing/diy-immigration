"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Chat from "@/components/Chat";
import Cases from "@/components/Cases";
import Profile from "@/components/Profile";
import { emptyProfile, profileToText } from "@/lib/profile";
import type { Profile as ProfileData } from "@/lib/profile";
import type { Conversation, ImmigrationCase } from "@/lib/types";

const CONV_KEY = "pathway.conversations";
const CASE_KEY = "pathway.cases";
const PROFILE_KEY = "pathway.profile";

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

type View = "chat" | "cases" | "profile";

export default function Home() {
  const [view, setView] = useState<View>("chat");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cases, setCases] = useState<ImmigrationCase[]>([]);
  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 只有用户主动切换会话时才重新挂载 Chat；发送首条消息创建会话时不能重挂载，否则会打断流式输出
  const [chatKey, setChatKey] = useState(0);
  const openConv = (id: string | null) => {
    setActiveId(id);
    setChatKey((k) => k + 1);
    setSidebarOpen(false);
  };
  // 附件内容（base64）只保存在内存里，不写入 localStorage
  const fileData = useRef(new Map<string, string>());

  useEffect(() => {
    setConvs(load<Conversation[]>(CONV_KEY, []));
    setCases(load<ImmigrationCase[]>(CASE_KEY, []));
    setProfile({ ...emptyProfile(), ...load<Partial<ProfileData>>(PROFILE_KEY, {}) });
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

  const patchConv = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) =>
      setConvs((list) => list.map((c) => (c.id === id ? fn(c) : c))),
    [],
  );
  const addConv = useCallback((c: Conversation) => {
    setConvs((list) => [c, ...list]);
    setActiveId(c.id);
  }, []);

  const active = convs.find((c) => c.id === activeId) ?? null;
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);

  const go = (v: View) => {
    setView(v);
    setSidebarOpen(false);
  };

  return (
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
            <strong>Chat</strong>
            <span>移民问题，随时问</span>
          </button>
          <button className={view === "cases" ? "on" : ""} onClick={() => go("cases")}>
            <strong>Case</strong>
            <span>准备 NIW、EB-1A 案件材料</span>
          </button>
          <button className={view === "profile" ? "on" : ""} onClick={() => go("profile")}>
            <strong>My Profile</strong>
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
            fileData={fileData.current}
            profileText={profileToText(profile)}
            firstName={profile.firstName.trim()}
          />
        ) : view === "cases" ? (
          <Cases cases={cases} setCases={setCases} />
        ) : (
          <Profile profile={profile} setProfile={setProfile} />
        )}
      </main>
    </div>
  );
}
