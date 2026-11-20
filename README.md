# DIY Immigration · NIW / EB-1A 自助申请助手

帮助用户自己准备 NIW 和 EB-1A 移民申请的 Web 应用。

- **聊天**：流式对话，可上传 PDF、图片、TXT、Markdown（简历、推荐信、Petition Letter 草稿等）让 AI 分析
- **我的档案**：填写学历、学术记录和未来计划，聊天时自动作为背景提供给 AI
- **案件**：每个案件是一个项目，包含文档（左边文档、右边聊天，AI 直接起草和修改，可撤销）、上传的文件和材料清单；聊天可以关联案件并引用其中的文档和文件

## 运行

```bash
npm install
cp .env.local.example .env.local   # 填入 ANTHROPIC_API_KEY（可选，见下）
npm run dev                        # http://localhost:3000
```

没有配置 `ANTHROPIC_API_KEY` 时，聊天会改走本机已登录的 Claude Code（订阅），方便开发者自己本地测试；这条通道关闭了所有工具，只做纯文本对话。正式上线给别人用必须配置 API Key。

## 结构

| 路径 | 说明 |
| --- | --- |
| `app/page.tsx` | 整体布局、侧边栏、本地存储 |
| `components/Chat.tsx` | 聊天界面、文件上传 |
| `components/Cases.tsx` | 案件：文档、文件、材料清单 |
| `components/Profile.tsx` | 个人档案表单 |
| `components/Docs.tsx` | 文档工作区（文档 + 聊天） |
| `lib/files.ts` | 文件校验与存储（IndexedDB） |
| `lib/docEdits.ts` | 解析并应用 AI 对文档的修改 |
| `app/api/chat/route.ts` | 调用 Claude API 并流式返回，系统提示词在这里 |
| `lib/checklists.ts` | NIW / EB-1A 材料清单 |

## 当前限制

- 会话、文档、案件和个人档案保存在浏览器 localStorage，没有账号和后端数据库
- 上传的文件保存在浏览器 IndexedDB，换浏览器或清除站点数据后会丢失
- 暂不支持 Word（.docx）文件
