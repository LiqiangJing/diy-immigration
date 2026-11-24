# 回归测试

改了代码之后，跑一遍这里的测试，确认原来好用的功能没有坏。

```bash
tests/run.sh          # 全部（约 20 分钟，其中两组要调用模型和外部学术接口）
tests/run.sh quick    # 不调模型、不访问外部接口的部分（约 8 分钟）
```

脚本会自己构建项目，在 3999 端口起一个临时的测试站，数据放在 `tests/.work/`（不进仓库），和真实数据互不影响；跑完自动关掉。

## 里面有什么

| 位置 | 内容 |
| --- | --- |
| `unit/merge.test.ts` | 多台设备同时修改时的合并规则 |
| `unit/actions.test.ts` | 聊天里 AI 提出的操作怎么解析、过滤 |
| `unit/normalize.test.ts` | 残缺的存档不会让页面出错；各份报告文档的生成 |
| `unit/packet.test.ts` | 打包 PDF 的排版：表格、特殊字符、加密文件、旋转的页面等 |
| `unit/scholar.test.ts` | Google Scholar 网页的解析，以及对特意构造的输入不会卡死 |
| `e2e/api_test.py`、`api_test2.py` | 直接打接口：登录、密码、限流、数据同步、文件、扣费、各种非法输入 |
| `e2e/t_profile.py` | 我的档案：基本资料、贡献总结、拟从事事业 |
| `e2e/t_cases.py` | 案件：向导、文档、文件、清单、打包下载（逐页检查生成的 PDF） |
| `e2e/t_account.py` | 登录弹窗、密码、账户页、联系我们、条款页、演示页、手机版式 |
| `e2e/t_sync.py` | 两台设备同一个账号、同时修改、删除、退出登录、换账号 |
| `e2e/t_new.py` | 撤销和恢复、换文件、删除时清附件、掉线重试、登录过期、两个标签页换账号等 |
| `e2e/t_chat.py` | 聊天和 AI 写文书（会调用模型） |
| `e2e/t_scholar.py` | 学术记录、重要引用分析、引用地图、论文下载（会访问外部学术接口并调用模型） |

## 需要装的东西

- Python 3、`pip install playwright requests pillow`，然后 `playwright install chromium`
- `pdftotext`、`pdfinfo`、`pdfimages`（poppler-utils），`gs`（Ghostscript，用来生成加密 PDF 的测试样例）
- 调模型的两组走本机已登录的 Claude Code（`LLM_PROVIDER=cli`），不花线上的 API 额度

## 单独跑一组

先起测试站（见 `run.sh` 里的那几行），然后：

```bash
cd tests/e2e && python3 t_cases.py
tests/unit/run.sh merge.test.ts
```

测试里的人物、论文、单位都是虚构的。按姓名查找学术记录那一组用的是一位公开的知名学者的公开数据。
