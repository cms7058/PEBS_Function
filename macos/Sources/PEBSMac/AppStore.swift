import SwiftUI
import PEBSCore
import UniformTypeIdentifiers
import PDFKit

@MainActor final class AppStore: ObservableObject {
    @Published var projects=[Project]()
    @Published var skills=[Skill]()
    @Published var books=[Book]()
    @Published var selected: String? = nil
    @Published var error: String? = nil
    @Published var busy=false
    private(set) var database: Database? = nil
    let directory: URL
    init() {
        directory=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("PEBS")
        do {
            let db=try Database(directory:directory);database=db
            projects=try db.load(Project.self,kind:"project").sorted { $0.updated > $1.updated }
            skills=try db.load(Skill.self,kind:"skill");books=try db.load(Book.self,kind:"book")
        } catch { database=nil;self.error="本地存储初始化失败：\(error.localizedDescription)" }
    }
    func attempt(_ body: () throws -> Void) { do { try body() } catch { self.error=error.localizedDescription } }
    func save(_ project: Project) {
        attempt {
            guard let database else { throw LocalError.message("数据库不可用") }
            var value=project;value.updated=Date();try database.save(value,kind:"project",id:value.id)
            if let index=projects.firstIndex(where:{$0.id==value.id}) { projects[index]=value } else { projects.insert(value,at:0) }
        }
    }
    func create(_ name: String) {
        let value=Project(name:name.trimmingCharacters(in:.whitespacesAndNewlines));save(value);selected=value.id
    }
    func remove(_ project: Project) {
        attempt { try database?.delete(kind:"project",id:project.id);projects.removeAll{$0.id==project.id};selected=nil }
    }
    func openFile(types: [UTType], directories: Bool = false) -> URL? {
        let panel=NSOpenPanel();panel.allowedContentTypes=types;panel.canChooseDirectories=directories;panel.canChooseFiles = !directories
        return panel.runModal() == .OK ? panel.url : nil
    }
    func export(_ content: String, filename: String) {
        let panel=NSSavePanel();panel.nameFieldStringValue=filename
        if panel.runModal() == .OK, let url=panel.url { attempt { try content.write(to:url,atomically:true,encoding:.utf8) } }
    }
    func importProject() {
        guard let url=openFile(types:[.json]) else { return }
        attempt { var value=try JSONDecoder().decode(Project.self,from:Data(contentsOf:url));guard value.notes.count==10, (0..<10).contains(value.step), value.completed.allSatisfy({(0..<10).contains($0)}) else { throw LocalError.message("项目文件结构无效") };value.id=UUID().uuidString;save(value);selected=value.id }
    }
    func importBook() {
        guard let url=openFile(types:[.pdf]) else { return }
        attempt {
            guard let pdf=PDFDocument(url:url), pdf.pageCount>0 else { throw LocalError.message("PDF 无法读取或没有页面，请检查文件是否损坏或加密。") }
            let folder=directory.appendingPathComponent("Books");try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
            let book=Book(title:url.deletingPathExtension().lastPathComponent,filename:UUID().uuidString+".pdf")
            try FileManager.default.copyItem(at:url,to:folder.appendingPathComponent(book.filename))
            guard let database else { throw LocalError.message("数据库不可用") };try database.save(book,kind:"book",id:book.id);books.insert(book,at:0)
        }
    }
    func importSkills() {
        guard let folder=openFile(types:[],directories:true) else { return }
        attempt {
            guard let database else { throw LocalError.message("数据库不可用") }
            guard let enumerator=FileManager.default.enumerator(at:folder,includingPropertiesForKeys:[.isRegularFileKey],options:[.skipsHiddenFiles]) else { throw LocalError.message("无法读取目录") }
            var count=0
            for case let url as URL in enumerator where url.lastPathComponent=="SKILL.md" {
                let content=try String(contentsOf:url,encoding:.utf8)
                let title=content.components(separatedBy:.newlines).first(where:{$0.hasPrefix("# ")}).map{String($0.dropFirst(2))} ?? url.deletingLastPathComponent().lastPathComponent
                if skills.contains(where:{$0.source==url.path}) { continue }
                let skill=Skill(title:title,content:content,source:url.path)
                try database.save(skill,kind:"skill",id:skill.id)
                // Retain chapter/reference files alongside the instructions for offline reading.
                let destination=directory.appendingPathComponent("Skills").appendingPathComponent(skill.id)
                try FileManager.default.createDirectory(at:destination.deletingLastPathComponent(),withIntermediateDirectories:true)
                try FileManager.default.copyItem(at:url.deletingLastPathComponent(),to:destination)
                skills.append(skill);count += 1
            }
            if count==0 { throw LocalError.message("未找到新的 SKILL.md。请选择包含技能包的目录。") }
        }
    }
    func fit(_ project: Project) {
        guard !busy else { return };busy=true
        let executable=Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/pebs-engine")
        Task {
            do {
                let output=try await Task.detached { try Engine.run(executable:executable,project:project) }.value
                if let current=projects.first(where:{$0.id==project.id}), current.csv==project.csv, current.method==project.method, current.response==project.response, current.factors==project.factors {
                    var updated=current;updated.modelJSON=output;save(updated)
                } else { error="计算期间数据或配置已改变，请重新计算。" }
            } catch { self.error=error.localizedDescription }
            busy=false
        }
    }
}
