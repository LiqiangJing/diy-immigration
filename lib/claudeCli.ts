import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 本地测试用：没有配置 ANTHROPIC_API_KEY 时，通过本机已登录的 Claude Code（订阅）生成回复。
 * 所有工具、MCP、技能和用户设置都被关闭，进程在一个空目录里运行，只做纯文本对话。
 * 仅供开发者自己本地测试；正式上线必须改用 API Key。
 */
export function streamViaClaudeCli(opts: {
  system: string;
  content: unknown[]; // 一条 user 消息的 content blocks
  signal: AbortSignal;
  /** 结束时回调一次；拿不到用量时参数为 null */
  onDone?: (usage: Record<string, number> | null) => void;
}): ReadableStream<Uint8Array> {
  const cwd = join(tmpdir(), "pathway-claude-cli");
  mkdirSync(cwd, { recursive: true });

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const child = spawn(
    process.env.CLAUDE_CLI_PATH || "claude",
    [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources", "",
      "--no-session-persistence",
      "--model", "opus",
      "--system-prompt", opts.system,
    ],
    { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
  );

  const encoder = new TextEncoder();
  const kill = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  opts.signal.addEventListener("abort", kill);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let gotText = false;
      let reported = false;
      let usage: Record<string, number> | null = null;
      let buf = "";
      let stderr = "";
      const send = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        opts.signal.removeEventListener("abort", kill);
        opts.onDone?.(usage);
        try {
          controller.close();
        } catch {}
      };
      const fail = (msg: string) => {
        if (reported || opts.signal.aborted) return;
        reported = true;
        send(`\n\n> ⚠️ ${msg}`);
      };

      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (
          ev.type === "stream_event" &&
          ev.event?.type === "content_block_delta" &&
          ev.event.delta?.type === "text_delta"
        ) {
          gotText = true;
          send(ev.event.delta.text);
        } else if (ev.type === "result" && ev.usage && !ev.is_error) {
          usage = ev.usage;
        } else if (ev.type === "result" && ev.is_error) {
          fail(`Claude 订阅通道出错：${String(ev.result ?? ev.subtype ?? "未知错误").slice(0, 300)}`);
        }
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(handle);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c: string) => {
        stderr = (stderr + c).slice(-2000);
      });
      child.on("error", (err) => {
        fail(`无法启动 claude 命令（${err.message}）。请确认已安装并登录 Claude Code，或改为配置 ANTHROPIC_API_KEY。`);
        close();
      });
      child.on("close", (code) => {
        handle(buf);
        if (code !== 0 && !gotText) {
          console.error("[claude-cli]", code, stderr);
          fail(`Claude 订阅通道异常退出（${code}）。${stderr.trim().slice(-200)}`);
        }
        close();
      });

      child.stdin.on("error", () => {});
      child.stdin.end(
        JSON.stringify({ type: "user", message: { role: "user", content: opts.content } }) + "\n",
      );
    },
    cancel() {
      kill();
    },
  });
}
