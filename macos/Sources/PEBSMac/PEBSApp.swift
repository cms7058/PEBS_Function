import SwiftUI
import PDFKit
import Charts
import PEBSCore

@main struct PEBSApp: App {
    @StateObject private var store=AppStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).frame(minWidth:1050,minHeight:720)
                .tint(.blue)
                .alert("操作提示",isPresented:Binding(get:{store.error != nil},set:{if !$0 {store.error=nil}})) { Button("知道了"){store.error=nil} } message: { Text(store.error ?? "") }
        }.commands {
            CommandGroup(after:.newItem) { Button("导入项目…"){store.importProject()}.keyboardShortcut("o") }
        }
    }
}
struct RootView: View {
    @EnvironmentObject var store: AppStore
    @State private var newProject=false
    @State private var name=""
    @State private var deleteProject: Project?
    var body: some View {
        NavigationSplitView {
            VStack(alignment:.leading,spacing:16) {
                HStack { Image(systemName:"function").font(.title);Text("PEBS").font(.largeTitle.bold()) }.padding(.top)
                Text("本地工程建模").foregroundStyle(.secondary)
                Button(action:{newProject=true}) { Label("新建工程项目",systemImage:"plus") }.buttonStyle(.borderedProminent)
                List(selection:$store.selected) {
                    Section("我的空间") {
                        Label("开始使用",systemImage:"house").tag("home")
                        Label("书籍资料库",systemImage:"books.vertical").tag("books")
                        Label("Skill 方法库",systemImage:"square.stack.3d.up").tag("skills")
                    }
                    Section("工程项目") {
                        ForEach(store.projects) { project in
                            VStack(alignment:.leading) { Text(project.name);Text("步骤 \(project.step+1) · \(project.updated.formatted(date:.abbreviated,time:.omitted))").font(.caption).foregroundStyle(.secondary) }
                                .tag(project.id).contextMenu { Button("删除项目",role:.destructive){deleteProject=project} }
                        }
                    }
                }.listStyle(.sidebar)
                Text("数据保存在本机\n无需模型 API · 离线计算").font(.caption).foregroundStyle(.secondary).padding(.bottom)
            }.padding(.horizontal,14)
        } detail: {
            if let index=store.projects.firstIndex(where:{$0.id==store.selected}) {
                ProjectView(project:store.projects[index]).id(store.projects[index].id)
            } else if store.selected=="books" { BooksView() }
            else if store.selected=="skills" { SkillsView() }
            else { home }
        }
        .sheet(isPresented:$newProject) {
            VStack(alignment:.leading,spacing:20) {
                Text("新建工程项目").font(.title2.bold())
                TextField("项目名称",text:$name).textFieldStyle(.roundedBorder)
                Text("从业务问题开始，按十层流程采集数据、计算和验证模型。").foregroundStyle(.secondary)
                HStack { Button("取消"){newProject=false};Spacer();Button("创建项目"){store.create(name);name="";newProject=false}.buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || store.database==nil) }
            }.padding(28).frame(width:460)
        }
        .confirmationDialog("删除项目？该操作不可撤销。",isPresented:Binding(get:{deleteProject != nil},set:{if !$0 {deleteProject=nil}})) { Button("删除",role:.destructive){if let project=deleteProject {store.remove(project)};deleteProject=nil} }
    }
    var home: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:24) {
                Text("从问题到可验证的工程模型").font(.system(size:32,weight:.bold))
                Text("PEBS · macOS 本地版").font(.title3).foregroundStyle(.blue)
                Text("新建项目，定义 X / Y，导入 CSV，并使用本地计算引擎建立模型。项目会自动保存，也可导出备份。").foregroundStyle(.secondary)
                HStack { Button("新建项目"){newProject=true}.buttonStyle(.borderedProminent);Button("导入项目"){store.importProject()} }
                Divider()
                ForEach(Array(Stage.all.enumerated()),id:\.offset) { index,stage in
                    HStack(alignment:.top,spacing:16) { Text(String(format:"%02d",index+1)).font(.title3.monospaced()).foregroundStyle(.blue);VStack(alignment:.leading,spacing:5){Text(stage.title).bold();Text(stage.guidance).font(.callout).foregroundStyle(.secondary)} }
                }
                Text("本版提供规则指引与本地计算。优化方案和监控记录需手动填写；书籍尚不支持 OCR 和全文语义问答。").font(.caption).foregroundStyle(.secondary)
            }.padding(36).frame(maxWidth:950,alignment:.leading)
        }.background(Color.blue.opacity(0.025))
    }
}
struct ProjectView: View {
    @EnvironmentObject var store: AppStore
    let project: Project
    var dataset: Dataset? { try? Dataset.parse(project.csv) }
    func edit(_ change: (inout Project)->Void) { var copy=project;change(&copy);store.save(copy) }
    var canContinue: Bool {
        guard (0..<project.step).allSatisfy({project.completed.contains($0)}), !project.notes[project.step].trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else {return false}
        if project.step==3 {return dataset != nil}
        if project.step>=4 && project.step<=6 {return dataset != nil && !project.response.isEmpty && !project.factors.isEmpty && (project.step<5 || project.modelJSON != nil)}
        return true
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:22) {
                HStack { Text(project.name).font(.title.bold());Spacer();Text("已保存到本机").font(.caption).foregroundStyle(.secondary)
                    Button("导出项目"){store.attempt{let data=try JSONEncoder().encode(project);store.export(String(decoding:data,as:UTF8.self),filename:"PEBS-project.json")}} }
                LazyVGrid(columns:[GridItem(.adaptive(minimum:135))],spacing:8) {
                    ForEach(Array(Stage.all.enumerated()),id:\.offset) { index,stage in
                        Button {edit{$0.step=index}} label:{Text("\(project.completed.contains(index) ? "✓" : String(index+1))  \(stage.title)").font(.caption).frame(maxWidth:.infinity,alignment:.leading).padding(8).background(project.step==index ? Color.blue.opacity(0.15) : Color.gray.opacity(0.06)).clipShape(RoundedRectangle(cornerRadius:7))}.buttonStyle(.plain)
                            .disabled(!(0..<index).allSatisfy{project.completed.contains($0)})
                    }
                }
                Text(String(format:"STEP %02d",project.step+1)).font(.caption.monospaced()).foregroundStyle(.blue)
                Text(Stage.all[project.step].title).font(.largeTitle.bold())
                Text(Stage.all[project.step].guidance).foregroundStyle(.secondary)
                GroupBox("本步骤记录（必填）") {
                    TextEditor(text:Binding(get:{project.notes[project.step]},set:{text in edit{$0.notes[project.step]=text;$0.invalidate(from:project.step)}})).font(.body).frame(minHeight:125).padding(6)
                }
                if project.step==2 { Text("在记录中逐行写出 Y、X、单位及测量口径。第 5 步将按实际 CSV 列选择变量。").font(.callout).foregroundStyle(.secondary) }
                if project.step==3 { dataPanel }
                if project.step==4 { methodPanel }
                if project.step==5 {
                    Button(store.busy ? "正在本地计算…" : "生成数学模型"){store.fit(project)}.buttonStyle(.borderedProminent).disabled(store.busy)
                    if project.modelJSON != nil {ResultView(json:project.modelJSON!,synthetic:project.synthetic)}
                }
                if project.step==6, let json=project.modelJSON { ResultView(json:json,synthetic:project.synthetic) }
                GroupBox("本地方法指引") {
                    VStack(alignment:.leading,spacing:10) {
                        Text("\(Stage.all[project.step].guidance)")
                        Text("导入的 Skill 可在左侧方法库检索阅读，按来源和适用条件由你判断是否采用。").font(.caption).foregroundStyle(.secondary)
                        Button("浏览 Skill 方法库"){store.selected="skills"}
                    }.frame(maxWidth:.infinity,alignment:.leading).padding(8)
                }
                Divider()
                HStack {
                    Text(canContinue ? "本步骤已满足基本输入要求；请确认记录后继续。" : "填写本步骤记录并完成数据／模型要求后才能继续。").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(project.step==9 ? "完成并保存项目" : "完成并继续") {edit{$0.completed.insert(project.step);$0.step=min(9,project.step+1)}}.buttonStyle(.borderedProminent).disabled(!canContinue || store.busy)
                }
            }.padding(30)
        }
    }
    var dataPanel: some View {
        GroupBox("数据采集与质量检查") {
            VStack(alignment:.leading,spacing:12) {
                HStack {
                    Button("下载 CSV 模板"){store.export("X1,X2,Y\n",filename:"collection-template.csv")}
                    Button("导入 CSV"){if let url=store.openFile(types:[.commaSeparatedText,.plainText]){store.attempt{let text=try String(contentsOf:url,encoding:.utf8);edit{$0.csv=text;$0.synthetic=false;$0.response="";$0.factors=[];$0.invalidate(from:3)}}}}
                    Button("载入模拟数据"){edit{$0.csv=Dataset.sample;$0.synthetic=true;$0.response="";$0.factors=[];$0.invalidate(from:3)}}
                }
                if project.synthetic {Label("模拟数据：仅供操作预览，不能作为现场改善证据",systemImage:"exclamationmark.triangle").foregroundStyle(.orange)}
                Text("支持 UTF-8 CSV，最多 20,000 行、1–6 个 X 和一个 Y；编号、日期、文本列请在导入前移除。").font(.caption).foregroundStyle(.secondary)
                TextEditor(text:Binding(get:{project.csv},set:{text in edit{$0.csv=text;$0.synthetic=false;$0.response="";$0.factors=[];$0.invalidate(from:3)}})).font(.system(.caption,design:.monospaced)).frame(height:180)
                if !project.csv.isEmpty {
                    if let dataset { Label("检查通过：\(dataset.rows.count) 行 × \(dataset.columns.count) 列",systemImage:"checkmark.circle").foregroundStyle(.blue) }
                    else {Text(validationError).font(.callout).foregroundStyle(.red).textSelection(.enabled)}
                }
                Text("可直接修正上方单元格文本或重新上传；每次修改都会重新检查，并使旧模型失效。检查通过仅表示格式有效，不保证测量可靠性或建模适用性。").font(.caption).foregroundStyle(.secondary)
            }.padding(8)
        }
    }
    var validationError: String {do{_ = try Dataset.parse(project.csv);return ""}catch{return error.localizedDescription}}
    var methodPanel: some View {
        GroupBox("模型配置") {
            VStack(alignment:.leading,spacing:14) {
                Picker("建模方法",selection:Binding(get:{project.method},set:{value in edit{$0.method=value;$0.invalidate(from:4)}})) {
                    Text("多元线性回归").tag("linear");Text("线性与交互项").tag("interaction");Text("二次响应面").tag("quadratic");Text("指数非线性回归").tag("exponential");Text("幂函数非线性回归").tag("power")
                }
                if let dataset {
                    Picker("结果变量 Y",selection:Binding(get:{project.response},set:{value in edit{$0.response=value;$0.factors.removeAll{$0==value};$0.invalidate(from:4)}})) {Text("请选择").tag("");ForEach(dataset.columns,id:\.self){Text($0).tag($0)}}
                    Text("影响因素 X（最多 6 个）").bold()
                    ForEach(dataset.columns.filter{$0 != project.response},id:\.self) { column in
                        Toggle(column,isOn:Binding(get:{project.factors.contains(column)},set:{on in edit{if on && $0.factors.count<6 {$0.factors.append(column)} else {$0.factors.removeAll{$0==column}};$0.invalidate(from:4)}}))
                    }
                    Text("训练样本须至少为参数数的 3 倍；共线、恒定因素或不满足正值条件会由引擎拒绝。").font(.caption).foregroundStyle(.secondary)
                } else {Text("请先在第 4 步导入有效数据。")}
            }.padding(8)
        }
    }
}
struct ResultView: View {
    let json: String
    let synthetic: Bool
    var result: [String:Any] { (try? JSONSerialization.jsonObject(with:Data(json.utf8))) as? [String:Any] ?? [:] }
    var points: [[String:Any]] { result["points"] as? [[String:Any]] ?? [] }
    var body: some View {
        GroupBox("模型与留出验证") {
            VStack(alignment:.leading,spacing:12) {
                if synthetic {Text("模拟数据结果 · 不可用于业务验收").foregroundStyle(.orange)}
                Text(result["method"] as? String ?? "").bold()
                Text(result["formula"] as? String ?? "").font(.system(.callout,design:.monospaced)).textSelection(.enabled)
                Text("留出 RMSE：\(number("rmse"))   基线 RMSE：\(number("baseline_rmse"))   R²：\(number("r2"))")
                Text("状态：\(result["status"] as? String ?? "")").foregroundStyle(.blue)
                if let factors=result["factors"] as? [[String:Any]] {
                    ForEach(Array(factors.enumerated()),id:\.offset) { i,f in Text("z\(i+1) = (\(f["name"] as? String ?? "") − \(String(format:"%.5g",f["center"] as? Double ?? 0))) / \(String(format:"%.5g",f["scale"] as? Double ?? 1))").font(.caption) }
                }
                Chart(Array(points.enumerated()),id:\.offset) { index, point in
                    PointMark(x:.value("预测值",point["predicted"] as? Double ?? 0),y:.value("残差",point["residual"] as? Double ?? 0)).foregroundStyle((point["holdout"] as? Bool ?? false) ? Color.orange : Color.blue)
                    RuleMark(y:.value("零残差",0)).foregroundStyle(.gray.opacity(0.3))
                }.frame(height:210).chartXAxisLabel("预测值").chartYAxisLabel("残差")
                Text("蓝色：训练集 · 橙色：留出集").font(.caption)
                Text(result["notice"] as? String ?? "").font(.caption).foregroundStyle(.secondary)
                Text("幂函数模型的 z 基于 ln(X) 标准化。留出基线 R² 不是传统的测试集均值 R²。仍需现场确认和测量可靠性检查。").font(.caption).foregroundStyle(.secondary)
            }.padding(8)
        }
    }
    func number(_ key: String)->String {guard let value=result[key] as? Double else {return "不适用"};return String(format:"%.5g",value)}
}
struct BooksView: View {
    @EnvironmentObject var store: AppStore
    @State private var selected: Book?
    var body: some View {
        VStack(alignment:.leading,spacing:18) {
            HStack {Text("书籍资料库").font(.largeTitle.bold());Spacer();Button("导入 PDF"){store.importBook()}.buttonStyle(.borderedProminent)}
            Text("PDF 保存在本机。支持目录、搜索、链接和连续滚动；当前不进行 OCR 或自动生成 Skill。").foregroundStyle(.secondary)
            List(store.books) {book in HStack {Image(systemName:"book.closed");Text(book.title);Spacer();Button("本地阅读"){selected=book}}}
        }.padding(28).sheet(item:$selected) {book in
            VStack {HStack {Text(book.title).bold();Spacer();Button("关闭"){selected=nil}}.padding();PDFReader(url:store.directory.appendingPathComponent("Books").appendingPathComponent(book.filename))}.frame(minWidth:900,minHeight:700)
        }
    }
}
struct PDFReader: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context)->PDFView {let view=PDFView();view.autoScales=true;view.displayMode = .singlePageContinuous;view.document=PDFDocument(url:url);return view}
    func updateNSView(_ nsView: PDFView,context: Context) {}
}
struct SkillsView: View {
    @EnvironmentObject var store: AppStore
    @State private var query=""
    @State private var chosen: Skill?
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            HStack {Text("Skill 方法库").font(.largeTitle.bold());Spacer();Button("导入技能包目录"){store.importSkills()}.buttonStyle(.borderedProminent)}
            Text("导入包含 SKILL.md 的目录，支持批量导入。保留章节参考文件供本地阅读。Skill 是方法文档；本版不会自动执行文档中的指令。").foregroundStyle(.secondary)
            TextField("搜索技能名称或知识点",text:$query).textFieldStyle(.roundedBorder)
            HSplitView {
                List(store.skills.filter{query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.content.localizedCaseInsensitiveContains(query)}) { skill in
                    Button{chosen=skill}label:{VStack(alignment:.leading){Text(skill.title).bold();Text("本地方法文档").font(.caption).foregroundStyle(.secondary)}.frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.plain)
                }.frame(minWidth:220)
                ScrollView {
                    if let chosen {
                        VStack(alignment:.leading,spacing:16) {
                            Text(chosen.title).font(.title2.bold())
                            HStack {Button("打开技能参考文件夹"){NSWorkspace.shared.open(store.directory.appendingPathComponent("Skills").appendingPathComponent(chosen.id))};Button("删除",role:.destructive){store.attempt{try store.database?.delete(kind:"skill",id:chosen.id);store.skills.removeAll{$0.id==chosen.id};self.chosen=nil}}}
                            Text(chosen.content).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading)
                        }.padding()
                    } else {ContentUnavailableView("选择一个 Skill",systemImage:"doc.text.magnifyingglass",description:Text("按名称或正文检索，查看适用条件和方法步骤。"))}
                }.frame(minWidth:350)
            }
            Text("共 \(store.skills.count) 个本地 Skill").font(.caption).foregroundStyle(.secondary)
        }.padding(28)
    }
}
