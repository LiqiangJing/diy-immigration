# DIY Immigration · NIW / EB-1A 自助申请助手

帮助用户自己准备 NIW 和 EB-1A 移民申请的 Web 应用。

- **聊天**：流式对话，可上传 PDF、图片、TXT、Markdown（简历、推荐信、Petition Letter 草稿等）让 AI 分析
- **学术数据**：在「我的档案」里按姓名一键从 OpenAlex 获取论文列表、引用数和 h-index，并可生成「论文与引用记录」文档
- **账户与 credit**：邮箱验证码登录；聊天按用量扣 credit，学术数据按次扣；通过 Stripe 充值（信用卡 / 支付宝）
- **我的档案**：填写学历、学术记录和未来计划，聊天时自动作为背景提供给 AI
- **案件**：每个案件是一个项目，包含文档（左边文档、右边聊天，AI 直接起草和修改，可撤销）、上传的文件、材料清单，以及把文书和材料合成一份带目录、Exhibit 分隔页和页码的 PDF 的「打包下载」；聊天可以关联案件并引用其中的文档和文件

## 运行

```bash
npm install
cp .env.local.example .env.local   # 填入 ANTHROPIC_API_KEY（可选，见下）
npm run dev                        # http://localhost:3000
```

没有配置 `ANTHROPIC_API_KEY` 时，聊天会改走本机已登录的 Claude Code（订阅），方便开发者自己本地测试；这条通道关闭了所有工具，只做纯文本对话。正式上线给别人用必须配置 API Key。

登录、余额和扣费记录存在服务端的 SQLite 数据库（`data/app.db`）。要对外开放还需要在 `.env.local` 里配置：发验证码邮件的 SMTP（不配置时验证码会直接显示在登录页，只能自己测试）、Stripe 的密钥和 Webhook 密钥（Webhook 地址 `/api/billing/webhook`，并在 Stripe 后台启用支付宝）。各项说明见 `.env.local.example`。

## 结构

| 路径 | 说明 |
| --- | --- |
| `app/page.tsx` | 整体布局、侧边栏、本地存储 |
| `components/Chat.tsx` | 聊天界面、文件上传 |
| `components/Cases.tsx` | 案件：文档、文件、材料清单 |
| `components/Profile.tsx` | 个人档案表单 |
| `components/Docs.tsx` | 文档工作区（文档 + 聊天） |
| `lib/files.ts` | 文件校验与存储（IndexedDB） |
| `components/Packer.tsx`、`lib/packet.ts` | 打包下载：把文书和材料合成一份 PDF |
| `lib/server/` | 数据库、登录、credit 规则 |
| `app/api/auth/`、`app/api/billing/`、`app/api/me/` | 登录、充值、余额接口 |
| `lib/docEdits.ts` | 解析并应用 AI 对文档的修改 |
| `app/api/chat/route.ts` | 调用 Claude API 并流式返回，系统提示词在这里 |
| `lib/checklists.ts` | NIW / EB-1A 材料清单 |

## 当前限制

- 会话、文档、案件和个人档案仍保存在浏览器 localStorage，还没有跟账号绑定，换设备看不到
- 上传的文件保存在浏览器 IndexedDB，换浏览器或清除站点数据后会丢失
- 暂不支持 Word（.docx）文件
