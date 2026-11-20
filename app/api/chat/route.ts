import Anthropic from "@anthropic-ai/sdk";
import type { ApiMessage } from "@/lib/types";
import { streamViaClaudeCli } from "@/lib/claudeCli";
import { getUser } from "@/lib/server/auth";
import { addCredits, chatCost } from "@/lib/server/credits";
import { skillPrompt } from "@/lib/server/skills";

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

const docSystem = (title: string, kind: string) => `

用户现在在「文档工作区」里写文档，类型是「${kind}」，标题是「${title}」。用户的每条最新消息后面都附有文档当前的完整内容（<current_document>）。你可以直接修改这份文档，方法是在回复里输出下面的标签：

- 写入或整体重写：<doc_write>完整的新文档内容</doc_write>
- 局部修改：<doc_edit><find>要被替换的原文</find><replace>替换后的文字</replace></doc_edit>，可以连续输出多个

规则：
- 文档为空或需要大幅重写时用 doc_write；其余情况用 doc_edit，不要为了小改动重写全文。
- find 必须和文档里的文字逐字一致（包括标点和换行），并且在文档里只出现一次；取能唯一定位的最短片段。
- 文档内容用 Markdown。英文文书（Petition Letter、推荐信等）用英文写，除非用户另有要求。
- 标签以外的文字是给用户看的聊天回复：简短说明你改了什么、为什么，不要把文档内容再贴一遍。
- 用户只是提问或讨论时，不要修改文档。
- 不要编造用户没有提供的事实（论文、引用数、奖项、推荐人身份、数据等）。缺信息时在文档里写 [待补充：需要什么]，并在聊天里向用户要。`;

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
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (user.credits <= 0) {
    return Response.json({ error: "Credit 余额不足，请先充值。" }, { status: 402 });
  }
  let charged = false;
  // produced = 这次有没有真的给出回复；后端出错、什么都没生成时不扣费
  const charge = (usage: Parameters<typeof chatCost>[0], produced = true) => {
    if (charged) return;
    charged = true;
    if (produced) addCredits(user.id, -chatCost(usage), "聊天");
  };

  let body: {
    messages?: ApiMessage[];
    profile?: string;
    doc?: { title?: string; kind?: string; content?: string; skill?: string; caseType?: string };
  };
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

  const profile = typeof body.profile === "string" ? body.profile.trim().slice(0, 4000) : "";
  const doc = body.doc && typeof body.doc.content === "string" ? body.doc : null;
  if (doc) {
    const last = messages[messages.length - 1].content as Anthropic.Beta.BetaContentBlockParam[];
    last.push({
      type: "text",
      text: doc.content!.trim()
        ? `<current_document>\n${doc.content}\n</current_document>`
        : "<current_document>（文档目前是空的）</current_document>",
    });
  }
  const base = doc
    ? SYSTEM +
      docSystem(String(doc.title ?? "").slice(0, 200), String(doc.kind ?? "").slice(0, 100)) +
      skillPrompt(doc.skill, doc.caseType)
    : SYSTEM;
  const system = profile
    ? `${base}\n\n以下是用户在「我的档案」里自己填写的背景档案，回答时结合它，但它未经核实，也可能不完整：\n<user_profile>\n${profile}\n</user_profile>`
    : base;

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
    return new Response(streamViaClaudeCli({ system, content, signal: req.signal, onDone: charge }), {
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
      system,
      messages,
    },
    { signal: req.signal },
  );

  const encoder = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      let produced = false;
      try {
        stream.on("text", (delta) => {
          produced = true;
          send(delta);
        });
        const final = await stream.finalMessage();
        charge(final.usage);
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
        charge(null, produced); // 中途停止时拿不到用量，按最低数额扣；完全没生成则不扣
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
