# PEBS macOS 本地版（SwiftUI）

独立于 React 网页端的新应用。macOS 14+；当前构建脚本生成本机架构版本（本机为 Apple Silicon）。SwiftUI 原生界面、SQLite 本地数据、Rust CLI 计算，没有 HTTP 服务、模型 API、联网请求或终端运行依赖。

## 构建与测试

需要 Apple Command Line Tools（Swift 6+）和 Rust。初次构建可能需要下载 Cargo 依赖。

```bash
cd macos
swift run PEBSChecks
cargo test --manifest-path engine/Cargo.toml
bash scripts/build.sh
open build/PEBS.app
```

输出 `macos/build/PEBS.app`，带本机 ad-hoc 签名，供开发测试。正式分发需 Developer ID 签名、公证及在目标系统测试；本版未制作正式 DMG、自动更新或 App Store 发布。

## 使用

1. 新建项目，在第 1–3 步记录业务目标、瓶颈、变量和单位。
2. 第 4 步下载 CSV 模板、导入采集数据，或载入带明显标记的模拟数据。支持编辑 CSV 文本和重复上传。错误定位至行、列；通过格式检查才能继续。
3. 第 5 步选择 Y、1–6 个 X 和模型方法。
4. 第 6 步调用随应用打包的 Rust 引擎：线性、交互、二次响应面、指数和幂函数回归。直接引用网页端的 `backend/src/regression.rs`，无需启动网页端。
5. 第 7 步查看留出误差、标准化公式和残差图，填写验证方案。第 8–10 步手动记录优化方案、实施任务和监控结论。
6. 项目自动保存；「导出项目」生成包含流程记录、CSV 和模型的 JSON；「导入项目」建立新副本。删除前有确认。
7. 书籍资料库导入 PDF 后，使用 PDFKit 连续滚动、原书超链接和系统支持的搜索。书籍保存到本地副本，不修改原文件。
8. Skill 方法库选择目录导入已有 `SKILL.md` 包（递归扫描）。例如选择本项目 `data/catalog/generated`，即可导入此前生成的包。正文供本地关键词检索，章节参考文件整包复制，通过「打开技能参考文件夹」阅读。

每步必填记录且前序步骤完成才可继续。修改上游内容会清除后续完成状态；数据、变量、方法变化会清除旧模型。计算在后台进程进行，保存结果前检查配置是否已经改变。

## 数据与范围

用户数据位于 `~/Library/Application Support/PEBS/`：

- `pebs.sqlite`：项目、书籍索引、Skill 正文。
- `Books/`：导入 PDF。
- `Skills/`：导入技能包的参考文件副本。

项目 JSON 备份不包含书籍和 Skill 包。完整备份应在应用关闭后复制整个 PEBS 用户数据目录（SQLite 使用 WAL）。网页端数据不会自动迁移、读取或修改。Skill 可通过上述目录导入。

这是无需大模型的本地建模 MVP。Skill 作为方法文档使用，不会自动将任意文档指令转换成代码。暂不包括自然语言问答、OCR、语义检索、自动 book-to-skill、自动优化搜索、实时数据连接、账号与付费同步。后续可增加本地模型作为可选增强。

CSV 当前只支持 UTF-8、逗号分隔数值数据，不支持 Excel 直接导入、日期列或缺失值插补。需 15–20,000 行；实际样本下限取决于参数数。前 80% 行训练、后 20% 行验证，划分不随机。模拟数据不是现场证据。统计验证仍需测量可靠性、残差检查与现场实验。

## 目录

- `Sources/PEBSMac`：SwiftUI、PDFKit、Charts 界面和应用状态。
- `Sources/PEBSCore`：SQLite、CSV 检查、项目对象、本地引擎协议。
- `engine`：独立 Rust 命令行适配器，复用现有回归实现。
- `Checks`：CSV、持久化和完成状态失效测试。
- `scripts/build.sh`：`.app` 打包与本地签名。
