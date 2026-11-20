import Anthropic from "@anthropic-ai/sdk";
import type { ApiMessage } from "@/lib/types";
import { streamViaClaudeCli } from "@/lib/claudeCli";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `你是一个帮助用户自己准备（DIY）美国职业移民申请的助手，专注于 NIW（EB-2 国家利益豁免）和 EB-1A（杰出人才）。

你可以做的事：解释法律标准（NIW 的 Dhanasar 三要素、EB-1A 的十项标准与 Final Merits 整体评估）、评估用户背景的强项和薄弱点、分析用户上传的材料（简历、论文列表、推荐信、Petition Letter 草稿等）、帮助规划材料清单和时间线、修改文书。

原则：
- 给出具体、可执行的判断，直接指出材料里的问题，不要泛泛而谈。
- 信息不足以判断时，说明还需要哪些信息。
- 排期、申请费、表格版本、政策等会随时间变化，你的知识可能过时；涉及这些内容时提醒用户以 USCIS 和国务院 Visa Bulletin 的最新官方信息为准，不要编造具体日期或数字。
- 你不是律师，提供的是一般性信息而非法律意见；案情复杂（如有拒签史、身份问题）时建议咨询持牌移民律师。不必每条回复都重复这句话。
- 用用户使用的语言回复，默认中文；法律术语可保留英文原文。`;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function toContent(m: ApiMessage): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of m.attachments ?? []) {
    if (!a.data) {
      blocks.push({
        type: "text",
        text: `[用户此前上传过附件「${a.name}」，其内容已不在当前会话中；如需分析请让用户重新上传]`,
      });
    } else if (a.type === "application/pdf") {
      blocks.push({
        type: "document",
        title: a.name,
        source: { type: "base64", media_type: "application/pdf", data: a.data },
      });
    } else if ((IMAGE_TYPES as readonly string[]).includes(a.type)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: a.type as ImageType, data: a.data },
      });
    } else {
      const text = Buffer.from(a.data, "base64").toString("utf8");
      blocks.push({ type: "text", text: `<file name="${a.name}">\n${text}\n</file>` });
    }
  }
  if (m.text.trim()) blocks.push({ type: "text", text: m.text });
  return blocks;
}

export async function POST(req: Request) {
  let body: { messages?: ApiMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = (body.messages ?? [])
    .map((m) => ({ role: m.role, content: toContent(m) }))
    .filter((m) => m.content.length > 0);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "消息为空" }, { status: 400 });
  }

  const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

  // 没有配置 API Key 时，走本机 Claude Code 订阅登录（仅供本地测试）
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    // 订阅通道一次只接收一条用户消息，所以把历史对话展开进同一条消息
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    messages.forEach((m, i) => {
      const last = i === messages.length - 1;
      const who = m.role === "user" ? "用户" : "助手";
      content.push({ type: "text", text: last ? "【当前消息 · 用户】" : `【此前对话 · ${who}】` });
      content.push(...(m.content as Anthropic.Beta.BetaContentBlockParam[]));
    });
    return new Response(streamViaClaudeCli({ system: SYSTEM, content, signal: req.signal }), {
      headers,
    });
  }

  const client = new Anthropic();
  const stream = client.beta.messages.stream(
    {
      model: "claude-opus-5-5",
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // 模型因安全策略拒答时，由服务端自动切换到备用模型重试
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      messages,
    },
    { signal: req.signal },
  );

  const encoder = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        stream.on("text", (delta) => send(delta));
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          send("\n\n> 这个请求被模型拒绝了，请换一种问法。");
        } else if (final.stop_reason === "max_tokens") {
          send("\n\n> 回复过长被截断，可以让我「继续」。");
        }
      } catch (err) {
        if (req.signal.aborted) return;
        let msg = "请求失败，请稍后重试。";
        if (err instanceof Anthropic.AuthenticationError) msg = "API Key 无效，请检查 .env.local。";
        else if (err instanceof Anthropic.RateLimitError) msg = "请求过于频繁，请稍后再试。";
        else if (err instanceof Anthropic.BadRequestError) msg = `请求被拒绝：${err.message}`;
        else if (err instanceof Anthropic.APIError) msg = `服务出错（${err.status ?? "网络"}）：${err.message}`;
        console.error("[api/chat]", err);
        send(`\n\n> ⚠️ ${msg}`);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(out, { headers });
}
