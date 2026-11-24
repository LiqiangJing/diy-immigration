"use client";

import { createContext, useContext } from "react";

export type Me = {
  user: { email: string; credits: number; hasPassword: boolean } | null;
  history: { delta: number; reason: string; at: number }[];
  packs: { id: string; usd: number; cny: number; credits: number }[];
  scholarCost: number;
  notableMin: number;
  stripeEnabled: boolean;
  alipayEnabled: boolean;
  alipaySandbox: boolean;
};

export type AccountApi = {
  me: Me | null;
  /** 做要花 credit 的事之前调用：没登录会弹出登录框，余额不够会跳到账户页；返回是否可以继续 */
  guard: (cost?: number) => boolean;
  /** 重新读取余额 */
  refresh: () => Promise<void>;
  /** 这些文件可能不再被用到了（删了会话、文档、案件或附件）：没有别处引用的会从本机和云端删掉 */
  releaseFiles: (ids: string[]) => void;
};

export const AccountContext = createContext<AccountApi>({
  me: null,
  guard: () => true,
  refresh: async () => {},
  releaseFiles: () => {},
});

export const useAccount = () => useContext(AccountContext);
