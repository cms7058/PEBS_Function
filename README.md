# PEBS · NIST 工程建模 Demo

React + Vite 前端；Rust + Axum JSON API。建模分析与 PDF 存储在本机完成。使用 TO-SKILL 生成功能时，提取后的书籍文字会发送到配置的模型服务。

book-to-skill 生成的是供大模型读取和执行的 Agent Skill，并不是可独立运行的应用程序。应用负责保存书籍、审核和管理 Skill、接收工程问题；大模型读取适用的 Skill 后引导用户完成分析。用户可以在本应用的问答界面调用后端模型，也可以将生成的技能包安装到兼容的 Agent 宿主中使用。当前 Demo 只有逐项 Skill 调用，尚无跨多个 Skill 的自动规划与十层流程对话编排。

## 启动

```bash
npm install
python3 scripts/index_handbook.py '/Users/mingyue/公司标准/EMD /NIST_handbook.pdf'
bash scripts/start.sh
```

打开 http://127.0.0.1:5173 。后台为 http://127.0.0.1:8787 。首次编译 Rust 需要几分钟。

## 体验路径

1. 点击“新建工程项目”，填写项目名称、工程问题和成功标准。原有示例保留为单独的演示项目。
2. 第 3 层定义计划测量的 X/Y；第 4 层上传本项目 CSV 并确认列映射。实际项目从空数据开始，只有演示项目可载入模拟数据。
3. 第 6 层点击运行；第 7 层查看预测、留出验证和残差。
4. 第 8 层调整参数滑块查看预测（不是已验证的生产参数）。
5. 第 9–10 层记录实施计划和现场反馈；导出 Markdown 报告。
6. 知识资料库搜索 regression、validation、回归等，打开原 PDF 页码。
7. Skill 技能页对新书提取、预估并生成技能包。审核通过后，点击“调用”输入工程问题，查看依据与执行步骤。

## 实现范围与边界

- 真实读取本地 2,333 页 PDF，提取页文本、章节和网页来源，计算源文件 SHA-256。
- 全文关键词搜索 + 常用中英术语映射；不是语义检索。公式、图形未完整结构化，须核对原 PDF。
- 历史 NIST 方法草稿为人工整理模板；新生成的技能使用开源 book-to-skill。`codex` 模式由本机 Agent 显式执行上游 `SKILL.md`；`openai` / `ollama` 模式由桥接层调用上游提取器与规范。两类记录会标明处理方式。
- 平台书籍、审核 Skill 和管理员配置保存在服务端平台目录；每个注册账号的工程项目、CSV 数值数据、私有书籍与私有 Skill 保存在 `data/tenants/<user-id>/`，浏览器仅保留当前选择和未保存草稿。账号、会员、额度、订单和验证码由服务端账本管理。
- 收费目录固定为两档：中文 normal ¥159/月（¥1590/年，150 分析额度/月）和 high ¥599/月（¥5990/年，600 分析额度/月）；英文界面对应 $19/月（$190/年）和 $99/月（$990/年）。英文美元订单只走 Apple Pay / Stripe，中文人民币订单支持微信、支付宝和 Apple Pay / Stripe。Ultra 仅保留为历史兼容记录，不对外售卖。
- 线性、交互项与二次响应面：仅用训练数据中心化/缩放，通过 Householder QR 最小二乘求解，检测恒定因素与模型项秩不足。指数和幂函数用对数拟合初始化，再用 Levenberg–Marquardt 在原始 Y 尺度最小化平方误差。当前未计算置信区间。
- 前 80% 训练，后 20% 留出。报告 R² 为相对训练均值基线的预测评分，并非以留出均值定义的传统 R²。
- 支持 1–6 个 X、1 个连续 Y，15–20,000 条数值记录。列必须全部数值，缺失值不自动剔除。
- 模拟数据有 80 条，温度/压力/时间与强度呈线性关系并含确定性扰动。所有示例明确标注。
- 无 p 值、置信区间、自动模型选择、自动 DOE、实时 SPC 和设备控制。
- 范围内参数组合可能仍超出联合数据支持，模型只表明关联，需要工程与现场验证。
- 新数据导入会清除当前模型；保留旧结果请先导出。重新计算保留 1–5 层记录，撤销后续完成记录。

## API（供将来 iOS 共用）

- `GET /api/health`：连接状态。
- `GET /api/library`：文档版本、页数、章节和 Skill 模板。
- `GET /api/search?q=regression`：返回最多 8 个来源页。
- `POST /api/analyze`：JSON `{columns: string[], rows: number[][], x: number[], y: number, method?: "linear"|"interaction"|"quadratic"|"exponential"|"power"}`；默认 linear。返回 schema_version=2、标准化模型项、预测规则、公式、数据范围、原单位预测与残差、训练/留出误差和求解状态。

Vite 代理 `/api`，避免开发跨域。未来 iOS 用 URLSession 直接调用相同 JSON API。正式部署需 HTTPS、身份认证、企业权限、服务器数据库、文件存储和独立计算任务。

PDF 与生成索引被 gitignore 排除，不随代码发布。原文件保持不变。重建索引后重启 Rust。

## 书籍列表与 Skill 技能

知识资料库支持新建待上传书籍、编辑书名、筛选、上传最大 50 MB 的 PDF、在线查看和删除。PDF 用 `pdftotext` 提取原文，搜索覆盖所有已索引书籍；扫描件可在书籍列表点击“进行 OCR”，在本机后台识别。现有 NIST PDF 首次启动时自动导入列表，时间使用本地文件修改时间。

此前讨论的十层参考书单保存在 `scripts/ten_layer_books.json`。运行 `python3 scripts/import_ten_layer_books.py` 可幂等地将 18 条去重后的书籍、讲义与论文资料加入列表，并标记对应层级及来源入口。该命令只导入书目，不下载远程全文；当前只有本地 NIST 手册状态为“上传完成”，其余条目为“待上传”。

“在线查看”在当前标签进入应用内 PDF 阅读器 `/reader.html?book=书籍ID&page=页码`，支持翻页、页码跳转、缩放和下载原文件；左上角返回知识资料库。浏览器直接打开 `/api/books/书籍ID/pdf` 仍是原始 PDF 接口，部分内置浏览器不会显示原生 PDF 预览。

“Skill技能” → “TO-SKILL” 每次打开都会刷新书籍与技能列表，并显示全部书籍（新添加的优先）。待上传、扫描件需 OCR、已生成 Skill 都明确标注并说明原因；只有已上传、可提取文字且尚未生成 book-to-skill 技能的书籍能够提取和生成。先运行 [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill) 的原版 PDF 提取器，显示页数、段落任务数和 token 用量预估。当前本机 Demo 配置为 `codex`：确认后在独立工作目录启动已登录的 Codex CLI，显式触发 `$book-to-skill`，按上游完整 `SKILL.md` 流程生成 `SKILL.md`、`chapters/`、`glossary.md`、`patterns.md`、`cheatsheet.md`；后端再运行上游扫描并打包为 ZIP。生成任务在后台运行，页面显示进度。旧有 NIST 模板保留并标记为“NIST 方法模板”，不会冒充新生成结果。删除 Skill 不会删除来源书籍或 PDF；当一本书的全部 Skill 都被删除后，可以重新进行 TO-SKILL。

开源项目已放在 `vendor/book-to-skill/`，来源版本为 `726f3362015bcc0c8a1f71b3bf5fbbb272d9ce25`，采用 MIT 许可证（见 `vendor/book-to-skill/LICENSE.md`）。其 [GitHub 下载地址](https://github.com/virgiliojr94/book-to-skill) 可用于获取更新。上游的独立 Python 命令只负责提取文本；本项目的 `scripts/book_to_skill_bridge.py` 负责从网页任务触发 Agent、校验并保存产物。

本机 Demo 已在 `.env.local` 设置 `BOOK_TO_SKILL_PROVIDER=codex`。此模式要求机器安装并登录 Codex CLI，无需另外设置 `OPENAI_API_KEY`；书籍内容会由已登录的 Codex 模型处理，使用量计入该账户。该模式仅适合本机单用户 Demo，不能作为多用户服务共享个人登录。若要改用独立服务，OpenAI 模式设置 `BOOK_TO_SKILL_PROVIDER=openai`、`OPENAI_API_KEY` 和 `BOOK_TO_SKILL_MODEL`；Ollama 模式设置 `BOOK_TO_SKILL_PROVIDER=ollama` 与本机已下载的 `BOOK_TO_SKILL_MODEL`。环境变量修改后需重启；也可在新增的“模型配置”页面保存，立即生效。`.env.local` 已排除在版本控制之外；密钥仅在本机模型配置页面输入，不要提交到仓库。OpenAI 模式使用 Responses API；`BOOK_TO_SKILL_API_BASE` 可用于兼容测试端点。Ollama 模式使用本机 `/api/chat` 的结构化输出，默认地址为 `http://127.0.0.1:11434`。未配置可用宿主时，提取与用量预估仍可用，生成与调用按钮会保持不可用。技术文档模式需要上游可选依赖 Docling；默认快速文本模式使用已安装的 `pdftotext`。图片型 PDF 可先使用书籍列表的 OCR 功能。长书会消耗较多模型用量，请先查看预估。

生成后的平台 Skill 文件、章节、原书 SHA-256、生成模型和技能包保存在平台目录；用户生成的书籍与 Skill 保存在各自租户目录，服务重启后仍在。平台 Skill 仅管理员可见，普通用户只能查看和调用自己的审核 Skill。调用需要服务器模型 API；书籍内容不会被重新处理成另一条 Skill。正式多实例部署仍需要 PostgreSQL、对象存储和分布式任务协调。

平台数据存储在 `data/catalog/`，用户私有数据存储在 `data/tenants/<user-id>/`，重启后保留。删除书籍会删除该书的文件、索引和关联 Skill，界面会先确认。生产环境应将这些目录替换为带访问控制的对象存储与备份策略。

相关接口：`GET/POST /api/books`，`PATCH/DELETE /api/books/:id`，`PUT/GET /api/books/:id/pdf`，`POST /api/books/:id/to-skill/preview`，`POST /api/books/:id/to-skill`，`GET /api/skill-jobs/:id`，`GET /api/skill-engine`，`GET /api/skills`，`GET /api/skills/:id/content`，`GET /api/skills/:id/archive`，`DELETE /api/skills/:id`，`POST /api/skills/:id/review`，`POST /api/skills/:id/apply`，`GET /api/knowledge/search?q=...`。

书籍与 Skill 的纯逻辑验证可运行 `node scripts/check_skill_books.mjs`、`python3 scripts/check_book_chapters.py` 和 `python3 scripts/check_skill_capabilities.py`。带 HTTP 权限的回归统一使用 `python3 scripts/check_commerce_api.py`，它会在临时目录创建管理员和普通用户并验证登录、私有目录隔离、权限、额度与退出登录，不调用真实模型或支付。

运行 `python3 scripts/check_codex_skill_host.py` 可用模拟 Codex CLI 验证网页后端调用参数、上游 Skill 发现、产物校验与已存 Skill 调用。真实 Codex 模式已使用合成 PDF 验证生成与调用；该测试不会自动对书库中的真实书籍执行生成。


## MiniMax 与后台模型配置

模型配置页只对管理员开放；普通用户的模型请求使用管理员配置的服务器模型，不能读取或修改密钥。

打开 `/?view=settings`，选择 MiniMax，模型名称填 `MiniMax-M3`，选择密钥对应的中国站或国际站，填写 API Key 后保存并测试连接。测试仅发送简短消息，不发送书籍。支持的其他宿主为本机 Codex、OpenAI、Ollama；当前一个活动配置同时用于生成和调用。MiniMax 使用官方 OpenAI-compatible Chat Completions 接口：<https://platform.minimax.io/docs/api-reference/text-openai-api>。M3 请求禁用思考以控制结构化输出长度；回答严格检查字段和类型，截断或无效 JSON 会显示失败，不保存为成功结果。

`GET/PUT /api/model-config` 读取/保存配置，`POST /api/model-config/test` 测试已保存配置。配置文件为 `data/catalog/model-config.json`，权限 0600，已被 gitignore 排除；是本机受权限保护的明文文件，并非加密密钥库。API 从不返回密钥。相同服务与站点留空保留密钥，切换服务或站点不沿用旧密钥。每次任务启动时取配置快照；切换设置不影响已经开始的任务。生产部署前必须将该接口置于管理员身份认证之后，并迁移到密钥管理服务。

生成后的 Markdown Skill 与模型供应商无关。后端加载技能与相关章节，MiniMax 负责理解并回答；模型不会自行访问服务器文件。模型供应商连接与生成需要先完成管理员登录和服务配置；真实 MiniMax 调用需有效密钥。旧的 `check_book_to_skill.py` 与 `check_catalog.py` 保留为早期单用户开发夹具，不应绕过商业账号网关使用。

后续工程空间架构：React / iOS → Rust API → 项目与对话存储 → 十阶段编排 → 已审核 Skill 与知识检索 → 模型 + 确定性计算工具。每个工程空间应保存阶段状态、数据版本、模型版本、对话和验证报告。当前支持多个工程项目、阶段状态保存和确定性建模；多轮聊天、自动十步编排和 iOS 客户端尚未实现。


## 回归与非线性建模

第 4 步可载入线性、二次响应面、指数或幂函数模拟数据，或上传自己的 CSV。第 5 步手动选择五种模型之一，第 6 步计算模型，显示标准化公式、参数与求解信息，第 7 步查看原始 Y 单位的训练/留出误差与残差，第 8 步滑块试算使用同一个模型的全部项。报告保留模型项、标准化定义与求解信息。

- 线性：截距与各因素主效应。
- 交互：主效应与两两交互项；二次响应面再加入平方项。二次模型要求因素至少有三个不同水平以及可估计的联合设计。
- 指数：`Y=a*exp(sum(b_i*X_i))`，要求全部 Y>0。
- 幂函数：`Y=a*product(X_i^b_i)`，要求全部 X>0、Y>0。此形式不含偏置项。
- 指数/幂函数的 a>0，对数回归只用于初始化，最终拟合优化原始尺度平方误差。非收敛、溢出、秩不足或样本量不足返回明确错误。
- 模型至少要求训练样本数为参数数的三倍；前 80% 拟合、后 20% 验证。不做自动异常删除，不提供预测区间，不自动搜索最优参数。反复使用同一留出集选方法后，需要新的独立验证数据。

数值与 API 契约在 `backend/src/regression.rs`；前端试算按 `prediction_spec`、`terms` 与 `factors` 重建同一预测。旧本地线性结果可继续显示和试算，重新计算后升级为新格式。运行 `cargo test --manifest-path backend/Cargo.toml` 检查已知模型恢复、原始尺度优化、训练/验证隔离、正值约束、共线和样本要求。运行 `node scripts/check_regression.mjs` 在本机 API 启动后检查所有模型及前后端预测一致性；不修改书库或浏览器数据。

方法依据：[NIST 非线性最小二乘](https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd142.htm)、[最小二乘估计](https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm)。本次是确定性计算扩展，不需要模型 API Key。


## 实际工程项目

工作台顶部支持新建与切换工程项目。新建项目只带入用户填写的名称、问题和目标；数据为空，模型、完成记录和参数试算均重置。原来浏览器中的项目在首次初始化时保留，不在新建时覆盖。实际项目只能上传自己的 CSV，演示项目可以载入模拟数据。

第 3 步在没有数据时定义计划采集的结果变量和影响因素，可继续到第 4 步采集/上传。上传后显示本项目的文件名、行数及 X/Y 列映射，确认映射后继续；无数据、缺失数据、样本不足或尚未建模时，相应步骤不能标记完成。未来步骤按顺序解锁，已完成步骤可回退修改，数据或变量变化会撤销相关计算与后续进度。

`GET/POST /api/projects` 列出/创建项目；`GET/PUT /api/projects/:id` 读取/保存完整项目状态。新建默认实际项目；后台拒绝在实际项目中保存 synthetic=true 的模拟数据。项目自动暂存到后端，切换前先暂存当前状态；刷新或服务重启后恢复。项目文件不提交到 Git。当前已由账号网关执行身份认证与项目权限，正式多实例部署仍需共享数据库、对象存储和任务协调。需求文字用于定义工程问题，不会自动生成现场数据。

项目逻辑可通过 Rust 测试与 `scripts/check_project_materials.py` 验证；商业登录、项目租户隔离和空实际项目由 `python3 scripts/check_commerce_api.py` 覆盖。旧的 `check_projects.py` 仍可用于未接入账号网关的早期开发夹具。


## 暂存、保存与历史项目

工作台提供“暂存项目”“保存项目”和“历史项目”。暂存保留最新工作内容，便于稍后继续；保存保留一份当前内容快照并显示已保存状态。保存后再次编辑会回到暂存草稿状态，但不会覆盖上次保存的快照。每次点击保存替换最近保存的版本，当前不保留全部历史版本。仅打开或切换项目不改变其已保存状态。

历史项目页面 `/?view=history` 支持按名称或工程要求搜索，筛选暂存 / 已保存状态，查看项目进度、创建时间、修改时间及保存时间。详情可切换最新工作内容和最近保存的版本；“继续项目”恢复最新工作内容、数据、模型和十步进度。时间按中国标准时间显示。

`PUT /api/projects/:id` 增加 `action`：`autosave`（默认）、`draft` 或 `save`。项目文件保存在 `data/projects/`，新增状态、暂存时间、保存时间、最近保存快照及保存次数。旧文件默认视为暂存项目，可以继续编辑并保存。自动暂存相同内容不改变保存状态或时间。

`python3 scripts/check_projects.py` 还验证显式暂存 / 保存、保存快照保护、历史列表元数据、无效操作拒绝和重启后快照恢复。Rust 单元测试覆盖浏览器整数 / 小数序列化差异，避免打开项目后误变更保存状态。

运行 `node scripts/check_skill_books.mjs` 验证新书可见、状态提示、扫描件与待上传生成限制、已有模板仍允许生成，以及新书优先排序。


## 扫描书籍 OCR

知识资料库和 TO-SKILL 弹窗均提供“进行 OCR”。识别在本机运行，支持简体中文、繁体中文与英语，不调用大模型。页面每三秒查询页数进度；识别失败可重试，服务重启后显示继续 OCR。按页保存文本和 PDF 检查点，重试跳过已完成页，同一时间只接受一本书。关闭网页不停止处理。

原始 PDF 保留在原位置，转换结果存入 `data/catalog/ocr/:id/searchable.pdf`。全部页面成功并合并后，后端更新原书记录、页数和知识搜索索引。在线查看使用带文字层的 PDF，可另行下载原始 PDF。点击“检查识别文字”逐页核对结果；TO-SKILL 随后可提取并预估，但不会自动生成 Skill。OCR 对复杂公式、表格和模糊扫描可能误识别，应先检查。当前 200 DPI 生成的 PDF 可能变大；需保留足够磁盘空间，长书耗时取决于页数和机器性能。

依赖系统 Tesseract 与 Poppler（pdfinfo/pdftoppm/pdfunite）。`python3 scripts/setup_ocr.py` 下载并校验官方中文语言包，并复制本机英语包与 PDF 字体到项目 `data/ocr/tessdata/`。目录已被 gitignore 排除。可通过 `OCR_TESSDATA_DIR` 指定其他完整语言包目录。

接口：`POST/GET /api/books/:id/ocr` 启动 / 查询，`GET /api/books/:id/ocr/text?page=1` 检查文字，`GET /api/books/:id/original` 下载原件。运行 `python3 scripts/check_ocr.py` 对隔离测试服务（默认8789）和 `OCR_TEST_PDF` 扫描样本验证转换、原文件保留、手动 Skill 提取和未自动生成；`python3 scripts/check_ocr_resume.py` 验证失败后按页继续。

## 按章节生成 Skill

TO-SKILL 的“生成内容范围”可选择整本书或部分章节。部分章节自动读取原 PDF 书签；无书签时从书内目录识别，并使用正文标题或 PDF 页码标签确认页码。界面仅勾选目录，不再手动填写章节名和页码。可选多个章节、小节，上级和下级重叠范围自动合并。无法核对页码的目录条目不可选；无可识别目录时明确提示，可先 OCR 或整本书提取，不猜测页码。更改书籍、提取方式或章节范围会清空旧预估，须重新提取后确认。

后端生成只含所选页的临时 PDF，再交给原版 book-to-skill 提取器；Codex 模式也只收到这个临时 PDF。用量预估按所选内容计算。生成包新增 source-scope.md 和 SKILL.md 来源范围说明，技能记录保存 source_scope、source_page_map 与首个原书页码，不宣称覆盖整本书。同一本书可以生成多个独立技能包，可一次选择多章；新包不会覆盖旧包。

预估接口可传 ranges:[{label:"回归分析",start:10,end:25}]，不传或 null 代表整本书。响应包含 preview_id、source_scope、source_page_map 和 total_book_pages。网页确认生成时提交 preview_id，后端拒绝被其他预估替换的旧确认。运行 python3 scripts/check_chapter_selection.py 使用本地模拟模型验证多段选择、范围校验、未选页面不进入模型输入、预估减少以及技能包来源记录。

## 本机启动与项目服务恢复

运行 `npm start` 同时启动 Rust 后端（8787）和网页（5175）；脚本等待后端健康检查通过后才启动网页。启动终端需要保持运行，停止脚本或重启机器后需再次启动。已有工程保存在 data/projects/，不会因停止服务丢失。

项目请求在服务离线或代理失败时显示明确的连接提示，创建表单内容保持不变。首次加载失败后可点击“重新连接项目服务”，恢复服务后重新读取工程。

## 工程流程构建助手

新建实际项目后，助手结合问题、目标、变量、数据概况与已有模型指标生成建议。进入第 2–10 步时自动生成首次建议；项目资料变化时提示更新，用户可补充问题并手动刷新。结果按工程和阶段保存，重新打开可查看；后端缓存相同请求，更新建议才重新调用模型。建议不会自动填写工程字段、计算模型或完成阶段。

检索优先使用本地书籍索引与已审核 Skill，读取相关页及技能章节，限制上下文长度；随后可选择补充 Crossref 论文检索（题名、DOI、可用摘要，并非全网网页或全文检索）。可提供英文工艺关键词改善检索相关性。外部检索只接收问题关键词，不接收 PDF 或原始数据行。配置的模型接收工程上下文与相关资料片段，返回操作方向、待验证假设、补充问题、输入成果与限制；来源卡片区分实际引用与待读线索。联网失败时明确提示并使用本地依据。

后台沿用模型配置，支持已有 OpenAI、MiniMax、Ollama 与本机 Codex 模式。接口为 POST /api/project-guide；生成建议需要模型服务可用。运行 python3 scripts/check_project_guide.py 验证检索、缓存、2–10 阶段及来源校验；python3 scripts/check_guide_api.py 使用隔离的模拟模型验证真实 HTTP 调用链与项目隔离。

## 导入助手建议与阶段资料

十个流程页面提供“导入助手建议”。按钮使用当前阶段已生成的建议和工程摘要，通过后台配置的模型整理字段、变量、采集表、分析工作表与填写说明；预览中可修改字段、变量单位、教学模拟范围和采集列名。确认前不写入项目；选中的字段替换当前值，第3步根据确认的变量填写 X/Y。已有 CSV 保留，仅列名完全一致时同步映射。变更前3步的输入会清除旧模型、情景和受影响的完成记录，需要重新建模；第9/10步未知现场结果与负责人不得由模型虚构。

阶段资料保存在项目 state.materials[stage]，采集表与分析表可在线编辑并导出 UTF-8 CSV，分析表保留实际结果和备注。当前每阶段保留最近一次导入，重新确认会替换该阶段的旧资料表；请先导出需要保留的记录。采集表分页在线填报，每页10行，最多20,000条记录。数值建模空表仅含 X/Y，追溯信息留在采集表中。

模拟数据在浏览器按用户确认的变量范围生成100行独立采样和人为响应关系，说明明确标记为教学假设。提供预览、描述统计及 CSV 下载，不覆盖实际工程的数据。点击“新建模拟预览项目”创建独立演示工程，记录原工程ID，从第4步继续拟合、验证与参数探索；实际工程状态保持原样。模拟拟合表现不能作为实际方案验证。

接口 POST /api/project-materials 只返回候选资料，不自动修改工程。运行 python3 scripts/check_project_materials.py、node scripts/check_stage_materials.mjs 与 python3 scripts/check_guide_api.py 验证十阶段字段权限、模型调用链、范围检查、数据保护及模拟工程隔离。模型生成预览消耗模型用量；资料编辑、模拟生成和描述统计不调用模型。

资料生成限制为最多7个建模变量（1个Y及最多6个X）、40个采集列、12条分析事项和说明。模型返回不合规格式时最多再调用一次自动修正，仍不合规则提示重试且不写入项目。预览期间工程输入或建议版本改变时，确认导入会要求重新生成预览。


## 采集表上传、检查与修复

导入助手建议后，在每个阶段的“采集模板、上传与质量检查”下载仅含表头的空模板。用 Excel 填报并另存为 CSV UTF-8，再上传替换首张同类表，或增加新批次表；也可直接在线填报、增删行并下载当前表。支持 CSV，不直接解析 XLSX。数值数据模板只包含 X/Y，是可选的；采集表用于保留批次、时间等追溯资料，不能用数值表替代。

检查前可确认必填列、文本／数值／整数／日期类型、实际测量范围与变量映射。默认模板列必填，X/Y列始终必填。实际测量范围由用户填写，不采用模拟数据的教学范围。完全空白的预留行不计入数据；部分填报的必填缺失会阻止通过。检查涵盖表头、缺失、占位文字、有限数值、日期、设定范围、完全重复记录和采集表／数值表的 X/Y 数值及数量一致性。问题显示表名、行号、列名和处理方向，支持问题清单下载；每轮最多显示和导出200项，保留总问题数，可分批修正后重查。

“预览格式修复”只处理首尾空白、数值全角字符、明确的千位分隔符和合法日期分隔符。用户确认才应用，不补造缺失值、不修改越界测量、不删除重复记录；确认后还需重新检查。错误文件不会覆盖原表，但会阻止下一步；可重新上传，或明确弃用失败上传、改填原表后再检查。

全部已提交采集及数值表通过当前检查后，才可继续；任一表格、规则、变量映射变化会使原检查失效。网页锁定继续按钮与后续阶段入口，Rust 在流程推进时独立重跑检查并核对数据指纹，拒绝过期或伪造的通过结果。未通过的资料仍可暂存、保存和重新打开，保留最近20轮检查记录。检查通过的数值记录至少15条时，可显式载入建模数据；不会自动覆盖已有工程 CSV。该检查不证明测量可靠性、采样独立性或业务结论正确。

单个 CSV 最多8 MB，每阶段最多20张表、合计20,000条记录、40个采集列；仍受项目状态12 MB与检查请求10 MB限制。CSV导出的公式样式文本会作为文字处理。采集检查与格式修复在本地运行，不消耗模型 token。

接口：POST /api/collection/upload 接收 filename、csv、kind、table_id，返回 accepted、table 或 issues；POST /api/collection/check 与 /repair 接收 stage、material。check 返回通过结果、指纹、问题、记录数量和可用数值数据；repair 仅返回候选表格与修改预览。项目 PUT /api/projects/:id 在推进时重新验证。

验证：node scripts/check_collection_workflow.mjs。HTTP回归使用隔离服务：先运行 python3 scripts/check_guide_api.py --serve --collection --port 8789，再运行 python3 scripts/check_collection_api.py。实际工程数据不用于测试。


## 书籍 Skill 提取状态与原书目录

知识资料库的书籍列表显示“全部提取 / 部分提取 / 未提取”，点击状态打开该书全部 Skill 列表，含已审核、待审核和预设方法模板。“提取 Skill”直接打开 TO-SKILL 弹窗并选中该书。状态只统计 book-to-skill 生成包：整本书包为全部提取，章节包按 PDF 页码取并集，覆盖全书后变为全部提取；方法模板不代表整书已提取。删除包后即时重新计算。

GET /api/books/:id/chapters 自动返回原 PDF 书签的目录层级与 PDF 起止页，使用已安装的 PDF.js 在本地读取，缓存由 PDF 路径、大小和修改时间校验；OCR 输出变化后自动失效。不调用大模型或联网，不消耗模型 token。书签不完整时，使用重复且一致的正文标题／页眉补充缺失章节，标明需核对；无法确认末尾上级篇目的范围时禁止选择该篇，可选择其章节。没有书签时，在前80页内识别书内目录，只有正文标题或页码标签／多个一致偏移能确认的页码才允许选择。书签可能不完整、扫描 OCR 可能有误；界面明确显示目录来源与限制，不补造章节。目录可搜索、勾选，小节与上级章节范围合并后再提取和预估。未选任何可确认章节时，不能进入提取预估。

部分提取的书籍允许继续生成独立包；全部提取时，列表与 TO-SKILL 按钮置灰并说明原因，点击提取状态仍可查看已有技能。删除相关生成包后重新计算可提取状态。新包保存 artifact_id 和独立目录及 ZIP，下载、调用、流程助手检索和删除均使用对应包；历史包兼容旧的书籍目录路径。删除一个包不会删掉同书其他包。验证：node scripts/check_skill_books.mjs、python3 scripts/check_book_chapters.py、python3 scripts/check_book_to_skill.py；最后一项使用隔离目录和本地模拟模型，不消耗真实模型用量。

## 技能能力等级与会员推荐

当前带账号的 HTTP 回归以 `python3 scripts/check_commerce_api.py` 为准；它验证三个会员层级的服务端权限、来源隐藏、直接调用限制、缓存隔离与登录会话。旧的 `check_access_policy.py` 与 `check_book_to_skill.py` 是本机预览身份时代的开发夹具，不能绕过商业账号网关，也不代表当前登录系统。

本节下面保留的“本机预览身份”说明仅用于解释旧接口和缓存格式；当前运行路径已切换到真实账号、会员账本与管理员权限，普通用户不能通过请求体或本地身份配置提升访问级别。

技能按跨书籍统一的能力标签归组（瓶颈分析、回归建模、实验设计等），对技能摘要和自身生成包做离线内容初评，保存 capability_tier、capabilities 与评估依据。normal 为基础方法；high 需具体方法、可执行步骤与验证或适用条件；Ultra 还需代码或可核对数值示例、多维验证及使用边界。书名、页数和文本长度不决定等级。一个包包含多种能力时，包等级取其中最高等级；模板只评自身摘要，不借用同书完整包。初评不等于计算正确性或现场效果认证。

既有技能在首次启动时补充评估，新生成包自动评估。技能管理可按等级筛选、比较同能力的不同来源、查看依据、人工确认或修改每项能力等级；重新评估保留人工确认。内容初评与权限筛选不调用模型。只有已审核包参与工作台推荐。normal 可用 normal；high 可用 normal/high；Ultra 可用全部。先按整个包等级过滤，再在同一能力中选许可内最高等级及更充分的证据，最多推荐两个相关包。直接调用接口也检查等级，不能只靠按钮限制。

模型配置新增“会员与角色策略”，**当前是本机预览身份，不是登录、订阅或支付系统**。等级与角色分开：普通用户的流程助手来源仅显示知识点，不返回原书名、页码或阅读链接；研究人员和管理员可显示书名与页码。旧项目缓存也按当前角色隐藏名称；切换身份后旧建议标为过期，用户手动更新后才能导入资料，不自动消耗模型用量。后端把配置传给检索与模型，缓存包含权限，避免跨等级复用。正式服务须由已认证账户提供会员和角色，不能把此本机预览接口作为公共会员授权接口。

接口：GET/PUT /api/access-profile 读取/保存本机预览策略；POST /api/skills/evaluate 重新内容初评；PATCH /api/skills/:id/classification 接收完整的 capabilities:[{id,tier}] 与确认 reason。ultra 是接口值，界面显示 Ultra。

验证：python3 scripts/check_skill_capabilities.py、python3 scripts/check_project_guide.py、node scripts/check_guide_access.mjs、python3 scripts/check_access_policy.py。最后一项使用临时目录和本地模拟模型，验证三个会员层级、来源角色、直接调用限制、缓存隔离、旧建议拒绝与配置重启持久化，不使用真实工程数据或模型用量。
