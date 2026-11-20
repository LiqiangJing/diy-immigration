import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { ResponseInput, ResponseInputMessageContentList } from "openai/resources/responses/responses";
import type { Usage } from "./credits";

/**
 * OpenAI 兼容通道（官方 API 或 Azure 上的部署），用 Responses API 流式输出。
 * 变量名特意不用 OPENAI_ 开头：很多机器的环境里本来就设了 OPENAI_API_KEY，会盖掉项目里的配置。
 * 配置：GPT_API_KEY 必填；GPT_BASE_URL 指向 Azure 时填它给的地址；GPT_MODEL 是模型或部署名。
 */

export const openaiConfigured = () => Boolean(process.env.GPT_API_KEY);
export const openaiModel = () => process.env.GPT_MODEL || "gpt-6.2-sol";

type Block = Anthropic.Beta.BetaContentBlockParam;
type Msg = { role: "user" | "assistant"; content: Block[] };

/** 把路由里已经整理好的消息（Claude 的内容块格式）转成 Responses API 的输入 */
function toInput(messages: Msg[]): ResponseInput {
  return messages.map((m) => {
    if (m.role === "assistant") {
      return { role: "assistant" as const, content: m.content.map((b) => (b.type === "text" ? b.text : "")).join("\n") };
    }
    const content: ResponseInputMessageContentList = [];
    for (const b of m.content) {
      if (b.type === "text") {
        content.push({ type: "input_text", text: b.text });
      } else if (b.type === "document" && b.source?.type === "base64") {
        content.push({
          type: "input_file",
          filename: b.title || "document.pdf",
          file_data: `data:application/pdf;base64,${b.source.data}`,
        });
      } else if (b.type === "image" && b.source.type === "base64") {
        content.push({
          type: "input_image",
          detail: "auto",
          image_url: `data:${b.source.media_type};base64,${b.source.data}`,
        });
      }
    }
    return { role: "user" as const, content };
  });
}

export function streamViaOpenAI(opts: {
  system: string;
  messages: Msg[];
  signal: AbortSignal;
  onDone: (usage: Usage | null, produced: boolean) => void;
}): ReadableStream<Uint8Array> {
  const client = new OpenAI({
    apiKey: process.env.GPT_API_KEY,
    baseURL: process.env.GPT_BASE_URL || undefined,
  });
  const encoder = new TextEncoder();
  const abort = new AbortController();
  opts.signal.addEventListener("abort", () => abort.abort());

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      let produced = false;
      let usage: Usage | null = null;
      try {
        const stream = await client.responses.create(
          {
            model: openaiModel(),
            instructions: opts.system,
            input: toInput(opts.messages),
            stream: true,
            store: false,
          },
          { signal: abort.signal },
        );
        for await (const ev of stream) {
          if (ev.type === "response.output_text.delta" || ev.type === "response.refusal.delta") {
            produced = true;
            send(ev.delta);
          } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
            const u = ev.response.usage;
            if (u) {
              // input_tokens 里包含了命中缓存和写入缓存的部分，拆开来分别计价
              const cached = u.input_tokens_details?.cached_tokens ?? 0;
              const written = u.input_tokens_details?.cache_write_tokens ?? 0;
              usage = {
                input_tokens: Math.max(0, u.input_tokens - cached - written),
                cache_read_input_tokens: cached,
                cache_creation_input_tokens: written,
                output_tokens: u.output_tokens,
              };
            }
            if (ev.type === "response.incomplete") {
              send(
                ev.response.incomplete_details?.reason === "content_filter"
                  ? "\n\n> 这段内容被平台的内容过滤拦下了，请换一种问法。"
                  : "\n\n> 回复过长被截断，可以让我「继续」。",
              );
            }
          } else if (ev.type === "response.failed") {
            send(`\n\n> ⚠️ 模型服务出错：${ev.response.error?.message ?? "未知错误"}`);
          } else if (ev.type === "error") {
            send(`\n\n> ⚠️ 模型服务出错：${ev.message}`);
          }
        }
      } catch (err) {
        if (!opts.signal.aborted) {
          let msg = "请求失败，请稍后重试。";
          if (err instanceof OpenAI.AuthenticationError) msg = "API Key 无效，请检查配置。";
          else if (err instanceof OpenAI.RateLimitError) msg = "请求过于频繁或额度不足，请稍后再试。";
          else if (err instanceof OpenAI.NotFoundError) msg = "找不到这个模型或部署，请检查 GPT_BASE_URL 和 GPT_MODEL。";
          else if (err instanceof OpenAI.BadRequestError) msg = `请求被拒绝：${err.message}`;
          else if (err instanceof OpenAI.APIError) msg = `服务出错（${err.status ?? "网络"}）：${err.message}`;
          console.error("[openai]", err);
          send(`\n\n> ⚠️ ${msg}`);
        }
      } finally {
        opts.onDone(usage, produced);
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });
}
