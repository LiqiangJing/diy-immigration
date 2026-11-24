"use client";

import { useSyncExternalStore } from "react";

/**
 * 正在进行的耗时操作（引用分析、引用地图、下载论文）。状态放在组件外面：
 * 用户中途切到别的页面再回来，按钮仍然显示「进行中」，不会被再点一次、再扣一次费；结果和报错也不会丢。
 */
type State = { running: Record<string, string>; errors: Record<string, string>; notes: Record<string, Record<string, string>> };
let state: State = { running: {}, errors: {}, notes: {} };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** 开始一项操作；detail 是给界面看的说明（比如正在分析哪篇论文）。已经在进行时返回 false */
export function begin(key: string, detail = "1"): boolean {
  if (state.running[key]) return false;
  state = { ...state, running: { ...state.running, [key]: detail }, errors: { ...state.errors, [key]: "" } };
  emit();
  return true;
}

export function end(key: string, error = "") {
  const running = { ...state.running };
  delete running[key];
  state = { ...state, running, errors: { ...state.errors, [key]: error } };
  emit();
}

/** 记一条逐项的进度说明（比如每篇论文的下载结果） */
export function note(key: string, item: string, text: string) {
  state = { ...state, notes: { ...state.notes, [key]: { ...state.notes[key], [item]: text } } };
  emit();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const useRunning = () => useSyncExternalStore(subscribe, () => state, () => state);
