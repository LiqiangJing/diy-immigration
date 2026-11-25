# DIY Immigration · NIW / EB-1A 自助申请助手

帮助用户自己准备 NIW 和 EB-1A 移民申请的 Web 应用。

- **聊天**：流式对话，可上传 PDF、图片、TXT、Markdown（简历、推荐信、Petition Letter 草稿等）让 AI 分析；也可以让它替你操作系统：它把要做的事整理成卡片，确认后才生效，包括填、改、清空档案（项目按「项目 1、项目 2」的编号来指），新建、修改、删除案件，管理案件里的文件和文档，新建和整理会话，以及带你去做不了的那一页。应用过的卡片可以撤销；删除案件、文件、文档、会话要单独确认，不能撤销
- **我的档案**：基本资料、学术记录与引用（Google Scholar / Semantic Scholar / OpenAlex、重要引用分析、引用地图）、贡献总结、拟从事事业（NIW），每一项都有填写说明和示例
- **案件**：申请向导按顺序带着做；文档工作区左边文档、右边聊天，AI 直接起草和修改（可撤销、可恢复）；上传的文件；材料清单；把文书和材料合成一份带目录、Exhibit 分隔页和页码的 PDF
- **AI 工作流**：案件评估、起草 Petition Letter、起草推荐信、提交前审计、RFE 回复、表格填写指引、Cover Letter，基于开源 skills（见 `skills/README.md`）
- **账户与 credit**：邮箱验证码登录，可另设密码；聊天按用量扣 credit，学术数据按次扣；充值支持支付宝直连和 Stripe
- **多设备同步**：登录后档案、案件、文档、会话和上传的文件保存到服务器；多台设备同时改会逐项合并

## 运行

```bash
npm install
cp .env.local.example .env.local   # 填入 ANTHROPIC_API_KEY（可选，见下）
npm run dev                        # http://localhost:3000
```

没有配置 `ANTHROPIC_API_KEY` 时，聊天会改走本机已登录的 Claude Code（订阅），方便开发者自己本地测试；这条通道关闭了所有工具，只做纯文本对话。正式上线给别人用必须配置 API Key。

登录、余额和扣费记录存在服务端的 SQLite 数据库（`data/app.db`）。要对外开放还需要在 `.env.local` 里配置：发验证码邮件的 SMTP（不配置时验证码会直接显示在登录页，只能自己测试）、支付宝的应用 ID 和密钥（异步通知地址 `/api/billing/alipay/notify`）和 / 或 Stripe 的密钥和 Webhook 密钥（Webhook 地址 `/api/billing/webhook`）。各项说明见 `.env.local.example`。

## 结构

| 路径 | 说明 |
| --- | --- |
| `app/page.tsx` | 整体布局、侧边栏、本地存储和云端同步 |
| `lib/sync.ts` | 同步用的合并规则（多台设备同时修改时怎么并） |
| `components/Chat.tsx` | 聊天界面、文件上传 |
| `lib/actions.ts`、`lib/undo.ts` | 聊天助手能提出的操作（解析、展示、应用）和卡片的撤销 |
| `components/Cases.tsx` | 案件：文档、文件、材料清单 |
| `components/Profile.tsx` | 个人档案表单 |
| `components/Docs.tsx` | 文档工作区（文档 + 聊天） |
| `lib/files.ts` | 文件校验与存储（IndexedDB） |
| `components/Packer.tsx`、`lib/packet.ts` | 打包下载：把文书和材料合成一份 PDF |
| `lib/server/` | 数据库、登录、credit 规则 |
| `app/api/auth/`、`app/api/billing/`、`app/api/me/` | 登录、充值、余额接口 |
| `skills/`、`lib/skills.ts`、`lib/server/skills.ts` | 第三方 skills 及其加载 |
| `lib/docEdits.ts` | 解析并应用 AI 对文档的修改 |
| `app/api/chat/route.ts` | 调用 Claude API 并流式返回，系统提示词在这里 |
| `lib/checklists.ts` | NIW / EB-1A 材料清单 |

## 测试

`tests/` 里有一套回归测试：接口测试、浏览器里的端到端测试（Playwright）和几个纯函数的单元测试。跑法见 `tests/README.md`。

## 发布

`sh deploy/deploy.sh` 把当前代码发布到服务器：新版本先建在另一个目录里（`.next-a` / `.next-b` 轮流用，见 `next.config.mjs`），建好后切换过去并重启；起不来会自动换回上一个版本。`deploy/` 里的服务配置、反向代理配置和备份脚本如果和服务器上的不一样，也会一并更新。

## 当前限制

- 暂不支持 Word（.docx）文件
- 打包出来的 PDF 用的是标准英文字体，中文写不进去（递交给 USCIS 的材料本来就应该是英文）
- 备份和网站在同一台服务器上，服务器整个丢失的话备份也一起丢（还没有异地备份）
