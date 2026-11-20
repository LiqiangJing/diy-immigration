import Anthropic from "@anthropic-ai/sdk";
import { streamViaClaudeCli } from "@/lib/claudeCli";
import { PRICES } from "./credits";
import type { Price, Usage } from "./credits";
import { openaiConfigured, streamViaOpenAI } from "./openai";

/** 用哪个模型通道：LLM_PROVIDER 可强制指定；否则配了哪家的 Key 就用哪家，都没配就走本机的 Claude 订阅 */
export function llmProvider(): string {
  return (
    process.env.LLM_PROVIDER ||
    (openaiConfigured()
      ? "openai"
      : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
        ? "anthropic"
        : "cli")
  );
}

export const llmPrice = (provider = llmProvider()): Price =>
  provider === "openai" ? PRICES["gpt-6.2-sol"] : PRICES["claude-opus-5-5"];

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

/**
 * 一次性的（不是聊天流）模型调用，给后台的分析任务用。
 * 返回完整文字和用量；模型服务出错时抛出异常。
 */
export async function completeText(opts: {
  system: string;
  text: string;
  signal: AbortSignal;
}): Promise<{ text: string; usage: Usage | null; price: Price }> {
  const provider = llmProvider();
  const price = llmPrice(provider);
  const content = [{ type: "text" as const, text: opts.text }];
  let usage: Usage | null = null;
  let produced = false;
  const onDone = (u: Usage | null, p: boolean) => {
    usage = u;
    produced = p;
  };

  let text: string;
  if (provider === "openai") {
    text = await drain(
      streamViaOpenAI({ system: opts.system, messages: [{ role: "user", content }], signal: opts.signal, onDone }),
    );
  } else if (provider === "cli") {
    text = await drain(streamViaClaudeCli({ system: opts.system, content, signal: opts.signal, onDone }));
  } else {
    const final = await new Anthropic().messages
      .stream(
        {
          model: "claude-opus-5-5",
          max_tokens: 32000,
          thinking: { type: "adaptive" },
          system: opts.system,
          messages: [{ role: "user", content }],
        },
        { signal: opts.signal },
      )
      .finalMessage();
    text = final.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    usage = final.usage;
    produced = Boolean(text);
  }
  // 两个流式通道出错时会把「> ⚠️ …」写进正文而不是抛异常，这里统一成异常
  if (!produced || /\n\n> ⚠️ /.test(text)) throw new Error("模型服务出错，请稍后再试。");
  return { text, usage, price };
}
