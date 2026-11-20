# DIY Immigration · NIW / EB-1A 自助申请助手

帮助用户自己准备 NIW 和 EB-1A 移民申请的 Web 应用。

- **Chat**：流式对话，可上传 PDF、图片、TXT、Markdown（简历、推荐信、Petition Letter 草稿等）让 AI 分析
- **My Profile**：填写学历、学术记录和未来计划，聊天时自动作为背景提供给 AI
- **Case**：创建 NIW / EB-1A 案件，按材料清单跟踪准备进度

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
| `components/Cases.tsx` | 案件管理 |
| `components/Profile.tsx` | 个人档案表单 |
| `app/api/chat/route.ts` | 调用 Claude API 并流式返回，系统提示词在这里 |
| `lib/checklists.ts` | NIW / EB-1A 材料清单 |

## 当前限制

- 会话、案件和个人档案保存在浏览器 localStorage，没有账号和后端数据库
- 上传的文件内容只保存在内存里，刷新页面后需要重新上传
- 暂不支持 Word（.docx）文件
