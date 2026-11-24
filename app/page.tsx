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
import { dropFile, forgetLocalFiles, kvDel, kvGet, kvPut, setRemoteFiles } from "@/lib/files";
import { clearMeta, fetchAll, fileIds, filesSafeOnServer, hashOf, isEmpty, loadMeta, mergeKey, pushOne, saveMeta, saveStash, SYNC_KEYS, takeStash, uploadMissingFiles } from "@/lib/sync";
import type { SyncKey, SyncMeta } from "@/lib/sync";
import { normalizeCases, normalizeConversations, normalizeDocs } from "@/lib/types";
import type { Conversation, DocFile, ImmigrationCase } from "@/lib/types";

const CONV_KEY = "pathway.conversations";
const CASE_KEY = "pathway.cases";
const PROFILE_KEY = "pathway.profile";
const DOCS_KEY = "pathway.docs";
const STORE: Record<SyncKey, string> = { conversations: CONV_KEY, cases: CASE_KEY, profile: PROFILE_KEY, docs: DOCS_KEY };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 存进浏览器；存不进去（空间满了、隐私模式）返回 false */
function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const parse = (json: string | undefined): unknown => {
  try {
    return json ? JSON.parse(json) : undefined;
  } catch {
    return undefined;
  }
};

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
  const email = me?.user?.email ?? "";
  const emailRef = useRef(email);
  emailRef.current = email;

  // 每个发给本站接口的请求都带上「页面以为自己登录的是哪个账号」。同一个浏览器的另一个标签页换了账号之后，
  // 这个标签页的请求会被服务器当成没登录（见 lib/server/auth.ts），这时重新读一次登录状态，页面跟着换过去
  useEffect(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const ours =
        typeof input === "string" && input.startsWith("/api/") && !input.startsWith("/api/me") && !input.startsWith("/api/auth/");
      if (!ours || !emailRef.current) return orig(input, init);
      const headers = new Headers(init?.headers);
      headers.set("X-Account", emailRef.current);
      const res = await orig(input, { ...init, headers });
      if (res.status === 401) refresh();
      return res;
    };
    return () => {
      window.fetch = orig;
    };
  }, [refresh]);

  useEffect(() => {
    refresh();
    // 从支付页面跳回来
    const paid = new URLSearchParams(window.location.search).get("paid");
    if (paid) {
      window.history.replaceState(null, "", window.location.pathname);
      setView("account");
      setToast(paid === "1" ? "支付成功，credit 到账可能需要几秒钟。" : "支付已取消。");
      // 到账通知是支付平台另外发给服务器的，可能比跳转晚几秒：多看几次余额
      if (paid === "1") [2000, 5000, 10_000, 20_000, 40_000].forEach((ms) => setTimeout(refresh, ms));
    }
  }, [refresh]);

  const guard = useCallback(
    (cost = 1) => {
      if (!me?.user) {
        setAuthOpen(true);
        return false;
      }
      // cost 为 0 的功能不收费，只要求登录
      if (cost > 0 && me.user.credits < cost) {
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
  // 从聊天的确认卡片点「去看填好的页面」时记下要打开哪一栏；之后从侧边栏正常进入时不再沿用
  const [jump, setJump] = useState<Place | null>(null);

  // ---- 登录后把数据同步到服务器（浏览器里仍保留一份）----
  const [syncState, setSyncState] = useState<"off" | "syncing" | "ok" | "error">("off");
  const [cloudFull, setCloudFull] = useState(false); // 云端文件空间满了
  const [localFull, setLocalFull] = useState(false); // 浏览器的存储满了
  const current: Record<SyncKey, unknown> = { conversations: convs, cases, profile, docs };
  const currentRef = useRef(current);
  currentRef.current = current;
  const metaRef = useRef<SyncMeta | null>(null);
  const sentRef = useRef<Partial<Record<SyncKey, string>>>({}); // 每份数据上次和服务器对齐时的内容
  const seenRef = useRef<Partial<Record<SyncKey, unknown>>>({}); // 每份数据上次检查时的样子，用来发现改动
  const ownerRef = useRef<string | null>(null); // 页面里现在的内容属于哪个账号；null 是没登录时填的
  const inflight = useRef<Partial<Record<SyncKey, boolean>>>({});
  const again = useRef<Partial<Record<SyncKey, boolean>>>({});
  const [syncReady, setSyncReady] = useState(false);
  const timers = useRef<Partial<Record<SyncKey, ReturnType<typeof setTimeout>>>>({});
  const storedRef = useRef<Partial<Record<SyncKey, unknown>>>({}); // 每份数据上次存进浏览器（或安排保存）时的样子

  useEffect(() => {
    ownerRef.current = loadMeta()?.user ?? null;
    const c = normalizeConversations(load<unknown>(CONV_KEY, []));
    const k = normalizeCases(load<unknown>(CASE_KEY, []));
    const d = normalizeDocs(load<unknown>(DOCS_KEY, []));
    const raw = load<Record<string, unknown> | null>(PROFILE_KEY, null);
    const pr = normalizeProfile(raw ?? {});
    // 刚读出来的内容不用马上再写回去（写回去还可能盖掉别的标签页刚存的新内容）。
    // 只有原来存着档案、补齐字段或转换旧格式之后和原来不一样时才写一次；原来什么都没存的也不写
    const keep = raw === null || JSON.stringify(pr) === JSON.stringify(raw);
    storedRef.current = { conversations: c, cases: k, docs: d, ...(keep ? { profile: pr } : {}) };
    setConvs(c);
    setCases(k);
    setDocs(d);
    setProfile(pr);
    setLoaded(true);
  }, []);

  // 存进浏览器：停手 0.4 秒后再写，AI 流式输出时不用每个字都把整份数据重写一遍；离开页面时立刻写
  const unsaved = useRef<Partial<Record<SyncKey, unknown>>>({});
  const waitingSince = useRef(0);
  const flushSave = useCallback((key: SyncKey) => {
    if (!(key in unsaved.current)) return;
    const ok = save(STORE[key], unsaved.current[key]);
    delete unsaved.current[key];
    const meta = metaRef.current;
    if (meta && Boolean(meta.stale?.[key]) === ok) {
      // 没存进去：记下来，下次打开时这份以服务器为准，不拿旧内容去盖服务器上的新内容
      meta.stale = { ...meta.stale, [key]: !ok };
      saveMeta(meta);
    }
    if (!ok) setLocalFull(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    for (const k of SYNC_KEYS) {
      if (storedRef.current[k] === currentRef.current[k]) continue;
      storedRef.current[k] = currentRef.current[k];
      unsaved.current[k] = currentRef.current[k];
    }
    if (!Object.keys(unsaved.current).length) return;
    // AI 连续输出时改动不断，一直等「停手」会很久都不存：最多攒 3 秒
    const now = Date.now();
    waitingSince.current ||= now;
    const flush = () => {
      waitingSince.current = 0;
      SYNC_KEYS.forEach(flushSave);
    };
    if (now - waitingSince.current > 3000) {
      flush();
      return;
    }
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [convs, cases, profile, docs, loaded, flushSave]);

  /** 用函数式更新改一份数据：基于最新的状态，不会冲掉正在进行的修改（比如流式输出中的聊天） */
  const update = useCallback((key: SyncKey, f: (prev: unknown) => unknown) => {
    if (key === "conversations") setConvs((prev) => normalizeConversations(f(prev)));
    else if (key === "cases") setCases((prev) => normalizeCases(f(prev)));
    else if (key === "docs") setDocs((prev) => normalizeDocs(f(prev)));
    else
      setProfile((prev) => {
        const next = f(prev);
        return next === prev ? prev : normalizeProfile((next ?? {}) as Record<string, unknown>);
      });
  }, []);

  /**
   * 记下一份数据和服务器对齐时的内容。内存里留一份；另存一份到 IndexedDB，
   * 这样刷新页面、重新登录之后，仍然能对照它分清「哪边改了什么」，而不是把没动过的地方也当成冲突。
   */
  const remember = useCallback((meta: SyncMeta, key: SyncKey, json: string) => {
    sentRef.current[key] = json;
    meta.hash = { ...meta.hash, [key]: hashOf(json) };
    void kvPut(`base:${meta.user}:${key}`, json);
  }, []);

  const settle = useCallback((meta: SyncMeta) => {
    setSyncState(SYNC_KEYS.some((k) => meta.dirty[k]) ? "syncing" : "ok");
  }, []);

  const pushKey = useCallback(
    async (key: SyncKey): Promise<void> => {
      const meta = metaRef.current;
      if (!meta || meta.user !== emailRef.current) return; // 没登录，或者登录的已经不是这份数据的账号
      if (inflight.current[key]) {
        again.current[key] = true; // 上一次还没传完：等它结束再传，免得两次用同一个版本号撞上
        return;
      }
      const json = JSON.stringify(currentRef.current[key]);
      if (json === sentRef.current[key]) {
        if (meta.dirty[key]) {
          meta.dirty[key] = false;
          saveMeta(meta);
        }
        settle(meta);
        return;
      }
      inflight.current[key] = true;
      setSyncState("syncing");
      const r = await pushOne(key, json, meta.revs[key] ?? 0);
      inflight.current[key] = false;
      if (metaRef.current !== meta) return; // 期间换了账号
      const retry = (ms: number) => {
        clearTimeout(timers.current[key]);
        timers.current[key] = setTimeout(() => pushKey(key), ms);
      };
      if (r.ok) {
        meta.revs[key] = r.rev;
        remember(meta, key, json);
        // 上传期间又有新改动的话再传一次
        meta.dirty[key] = again.current[key] || JSON.stringify(currentRef.current[key]) !== json;
        saveMeta(meta);
        settle(meta);
        if (meta.dirty[key]) retry(again.current[key] ? 0 : 1500);
      } else if (r.conflict) {
        // 别的设备先保存了：对照上次对齐时的内容合并，再以服务器的版本号传一次
        const base = parse(sentRef.current[key]);
        const theirs = parse(r.conflict.value) ?? null;
        meta.revs[key] = r.conflict.rev;
        remember(meta, key, r.conflict.value);
        saveMeta(meta);
        update(key, (prev) => mergeKey(key, base, prev, theirs));
        retry(300);
      } else if (r.status === 401) {
        refresh(); // 登录失效或换了账号
      } else {
        setSyncState("error");
        retry(20_000);
      }
      again.current[key] = false;
    },
    [update, settle, refresh, remember],
  );

  /** 把这个浏览器里有、服务器上还没有的文件补传上去（之前传失败的也会在这里重试） */
  const lastBackfill = useRef(0);
  const backfill = useCallback(() => {
    if (!metaRef.current || Date.now() - lastBackfill.current < 60_000) return;
    lastBackfill.current = Date.now();
    uploadMissingFiles(fileIds(currentRef.current.cases, currentRef.current.conversations, currentRef.current.docs));
  }, []);

  // 登录（或刷新页面后恢复登录）时，先和服务器对齐一次；失败了隔一会儿重试
  useEffect(() => {
    if (!loaded || !email) {
      metaRef.current = null;
      setSyncReady(false);
      setSyncState("off");
      setRemoteFiles(false);
      setCloudFull(false);
      return;
    }
    // 换了账号（比如另一个标签页登录了别的账号）：旧账号的同步立刻停下。
    // 不然在新账号对齐完之前，排着队的保存会带着旧账号的内容发出去，而这时登录的已经是新账号了
    const before = metaRef.current;
    if (before && before.user !== email) {
      SYNC_KEYS.forEach((k) => clearTimeout(timers.current[k]));
      metaRef.current = null;
      setSyncReady(false);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const run = async () => {
      setSyncState("syncing");
      const server = await fetchAll();
      if (cancelled) return;
      if (server === "auth") {
        refresh();
        return;
      }
      if (!server) {
        setSyncState("error");
        timer = setTimeout(run, Math.min(60_000, 4000 * 2 ** attempt++));
        return;
      }
      const old = loadMeta();
      const owner = ownerRef.current;
      const mine = owner === null || owner === email;
      if (!mine) {
        // 页面里现在是另一个账号的内容：把它还没传上去的部分存起来（那个账号再登录时合并回去），再换成这个账号的
        const prev = before?.user === owner ? before : old?.user === owner ? old : null;
        const unsynced: Partial<Record<SyncKey, unknown>> = {};
        for (const key of SYNC_KEYS) {
          const cur = currentRef.current[key];
          if (isEmpty(key, cur)) continue;
          const h = prev?.hash?.[key];
          if (prev ? (h !== undefined ? hashOf(JSON.stringify(cur)) !== h : Boolean(prev.dirty[key])) : true) unsynced[key] = cur;
        }
        saveStash(owner, unsynced);
      }
      // 这份本地内容上次和这个账号对齐时的记录；没有的话（第一次在这个浏览器登录）本地有内容就算有改动
      const known = mine && old?.user === email ? old : null;
      // 上次对齐时的内容（存在 IndexedDB 里）。和记录的指纹对得上才用
      const bases: Partial<Record<SyncKey, unknown>> = {};
      if (known) {
        await Promise.all(
          SYNC_KEYS.map(async (key) => {
            const json = await kvGet(`base:${email}:${key}`);
            if (json !== undefined && known.hash?.[key] === hashOf(json)) bases[key] = parse(json);
          }),
        );
        if (cancelled) return;
      }
      const stash = takeStash(email); // 之前被别的账号顶掉时存起来的、还没上传的内容
      const meta: SyncMeta = { user: email, revs: {}, dirty: {}, hash: {}, stale: {} };
      const sent: Partial<Record<SyncKey, string>> = {};
      for (const key of SYNC_KEYS) {
        const s = server[key];
        const theirs = parse(s?.value) ?? null;
        meta.revs[key] = s?.rev ?? 0;
        const local = currentRef.current[key];
        // 服务器上还没有这份数据、本地也是空的：当作已经对齐，不用把空内容传一遍
        sent[key] = s?.value ?? (mine && isEmpty(key, local) && stash?.[key] === undefined ? JSON.stringify(local) : "");
        meta.hash![key] = hashOf(sent[key]!);
        void kvPut(`base:${email}:${key}`, sent[key]!);
        if (!mine) {
          update(key, () => theirs);
        } else if (s) {
          const h = known?.hash?.[key];
          const stale = Boolean(known?.stale?.[key]);
          const changed = stale
            ? false
            : known
              ? h !== undefined
                ? hashOf(JSON.stringify(local)) !== h
                : Boolean(known.dirty[key])
              : !isEmpty(key, local);
          const moved = !known || known.revs[key] !== s.rev;
          if (changed && moved) update(key, (prev) => mergeKey(key, bases[key], prev, theirs)); // 两边都有改动
          else if (!changed && (moved || stale)) update(key, () => theirs); // 只有别的设备改过：用服务器的
          // 只有本地改过：保持不动，下面会传上去
        }
        const kept = stash?.[key];
        if (kept !== undefined) update(key, (prev) => mergeKey(key, undefined, kept, prev));
      }
      metaRef.current = meta;
      sentRef.current = sent;
      seenRef.current = {};
      ownerRef.current = email;
      saveMeta(meta);
      setRemoteFiles(true, () => setCloudFull(true));
      setSyncReady(true);
      setSyncState("ok");
      setTimeout(() => {
        if (!cancelled) backfill();
      }, 3000);
    };
    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loaded, email, update, refresh, backfill]);

  // 之后每次改动，停手两秒后保存到服务器
  useEffect(() => {
    const meta = metaRef.current;
    if (!syncReady || !meta) return;
    let changed = false;
    for (const key of SYNC_KEYS) {
      const value = currentRef.current[key];
      const first = !(key in seenRef.current);
      if (!first && seenRef.current[key] === value) continue;
      seenRef.current[key] = value;
      // 刚对齐完的第一次：内容和服务器一样就不用传（从服务器取回来的内容补齐字段后可能略有不同，那就传一次）
      if (first && JSON.stringify(value) === sentRef.current[key]) continue;
      if (!meta.dirty[key]) {
        meta.dirty[key] = true;
        changed = true;
      }
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => pushKey(key), 2000);
    }
    if (changed) {
      saveMeta(meta);
      setSyncState("syncing");
    }
  }, [convs, cases, profile, docs, syncReady, pushKey]);

  /** 看看服务器上有没有别的设备存进来的新内容，有就并进来 */
  const pulling = useRef(false);
  const lastPull = useRef(0);
  const pull = useCallback(async () => {
    const meta = metaRef.current;
    if (!meta || pulling.current || Date.now() - lastPull.current < 4000) return;
    pulling.current = true;
    try {
      const server = await fetchAll();
      if (metaRef.current !== meta) return;
      if (server === "auth") {
        refresh();
        return;
      }
      if (!server) return;
      let moved = false;
      for (const key of SYNC_KEYS) {
        const s = server[key];
        if (!s || s.rev === (meta.revs[key] ?? 0) || inflight.current[key]) continue;
        const base = parse(sentRef.current[key]);
        const theirs = parse(s.value) ?? null;
        meta.revs[key] = s.rev;
        remember(meta, key, s.value);
        update(key, (prev) => mergeKey(key, base, prev, theirs));
        moved = true;
      }
      if (moved) saveMeta(meta);
    } finally {
      pulling.current = false;
      lastPull.current = Date.now();
    }
  }, [update, refresh, remember]);

  // 切回这个页面时：看一眼登录状态和余额，取回别的设备的改动，重试没传成功的文件；离开页面时把还没存的立刻存掉
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        pull();
        backfill();
      } else {
        SYNC_KEYS.forEach(flushSave);
        for (const key of SYNC_KEYS) {
          if (metaRef.current?.dirty[key]) {
            clearTimeout(timers.current[key]);
            pushKey(key);
          }
        }
      }
    };
    const onFocus = () => document.visibilityState === "visible" && onChange();
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onChange);
    };
  }, [refresh, pull, backfill, flushSave, pushKey]);

  /** 退出登录：内容都已经在云端的话，把这个浏览器里的清掉；还有没传上去的就先留着 */
  const logout = useCallback(async () => {
    const meta = metaRef.current;
    const unsynced = () => SYNC_KEYS.some((k) => inflight.current[k] || JSON.stringify(currentRef.current[k]) !== sentRef.current[k]);
    if (meta) {
      for (let i = 0; i < 20 && unsynced(); i++) {
        for (const key of SYNC_KEYS) {
          clearTimeout(timers.current[key]);
          if (!inflight.current[key]) await pushKey(key);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const clean = Boolean(meta) && metaRef.current === meta && !unsynced();
    // 上传的文件：云端确实有的，退出后把这个浏览器里的那份也清掉（要趁还登录着的时候核对）
    const cur = currentRef.current;
    const safeFiles = clean ? await filesSafeOnServer(fileIds(cur.cases, cur.conversations, cur.docs)) : [];
    const res = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setToast("退出失败，请检查网络后再试。");
      return;
    }
    if (clean) {
      SYNC_KEYS.forEach((k) => clearTimeout(timers.current[k]));
      metaRef.current = null;
      ownerRef.current = null;
      setSyncReady(false);
      clearMeta();
      if (meta) SYNC_KEYS.forEach((k) => void kvDel(`base:${meta.user}:${k}`));
      void forgetLocalFiles(safeFiles);
      setConvs([]);
      setCases([]);
      setDocs([]);
      setProfile(emptyProfile());
      setActiveId(null);
      setChatKey((k) => k + 1);
      setPendingCaseId(null);
      setJump(null);
      setToast("");
    } else {
      setToast("有内容还没来得及保存到云端，先留在这个浏览器里；下次用这个账号登录后会自动保存。");
    }
    refresh();
  }, [pushKey, refresh]);

  /** 删了会话、文档、案件或附件之后：它们带的文件如果没有别处在用，就从本机和云端删掉 */
  const releaseFiles = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setTimeout(() => {
      const used = new Set(fileIds(currentRef.current.cases, currentRef.current.conversations, currentRef.current.docs));
      for (const id of new Set(ids)) if (!used.has(id)) dropFile(id);
    }, 800); // 等删除先生效
  }, []);

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

  const go = (v: View) => {
    setView(v);
    setSidebarOpen(false);
  };

  return (
    <AccountContext.Provider value={{ me, guard, refresh, releaseFiles }}>
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
                      releaseFiles(fileIds(c));
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
              {cloudFull && " · 云端文件空间已满（每个账号 500 MB），新上传的文件只存在这个浏览器里，请删掉一些不用的文件"}
              {localFull && " · 这个浏览器的存储空间满了，最近的内容可能没存在本机（云端不受影响）；可以删掉一些旧会话"}
            </span>
          ) : (
            <>
              <button onClick={() => setAuthOpen(true)}>
                <span className="account-email">登录 / 注册</span>
                <span className="account-credits">登录后开始使用</span>
              </button>
              {localFull && <span className="sync-state error">这个浏览器的存储空间满了，新填的内容可能保存不下来。登录后内容会保存到云端。</span>}
            </>
          )}
        </div>
      </aside>

      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <button className="menu-btn" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
          ☰
        </button>
        {/* 聊天一直留在页面上，切到别的页面时只是藏起来：正在生成的回复不会断，输入框里的内容也还在 */}
        <div style={{ display: view === "chat" ? "contents" : "none" }}>
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
        </div>
        {view === "chat" ? null : view === "cases" ? (
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
              onLogout={logout}
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
