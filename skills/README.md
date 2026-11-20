# 第三方 Skills

`immigration-attorney/` 里的文件来自开源项目
[juntoku9/claude_immigration_attorney](https://github.com/juntoku9/claude_immigration_attorney)
（提交 `e477d09`，2026-04-24），按 MIT 许可证使用，许可证全文见 `immigration-attorney/LICENSE`。

只取用了其中和 NIW / EB-1A 相关的几个 skill 以及共用的 `knowledge/` 参考资料，文件内容未作修改。
这些 skill 原本是为在本地文件夹里运行的 Claude Code 写的；在本应用里由 `lib/server/skills.ts`
把它们和一段适配说明一起作为系统提示加载（见该文件）。

这些内容是社区整理的一般性资料，不是法律意见，其中引用的政策可能已经过时。

# 自己写的 Skills

`diy/` 里的是本项目自己写的工作流说明（表格填写指引、Cover Letter 和 Exhibit 清单），由 `lib/server/skills.ts` 直接加载。
