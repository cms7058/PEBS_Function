import Foundation
import CSQLite

public final class Database {
    private var db: OpaquePointer?
    public let directory: URL
    public init(directory: URL) throws {
        self.directory=directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard sqlite3_open(directory.appendingPathComponent("pebs.sqlite").path, &db) == SQLITE_OK else { throw LocalError.message("无法打开本地数据库") }
        try execute("PRAGMA journal_mode=WAL")
        try execute("CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(kind,id))")
    }
    deinit { sqlite3_close(db) }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure }
    }
    private var failure: LocalError { .message(String(cString:sqlite3_errmsg(db))) }
    public func save<T: Encodable>(_ value: T, kind: String, id: String) throws {
        let data=try JSONEncoder().encode(value)
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db,"INSERT OR REPLACE INTO records(kind,id,payload) VALUES (?,?,?)",-1,&stmt,nil)==SQLITE_OK else { throw failure }
        defer { sqlite3_finalize(stmt) }
        let transient=unsafeBitCast(-1, to:sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt,1,kind,-1,transient);sqlite3_bind_text(stmt,2,id,-1,transient)
        _ = data.withUnsafeBytes { sqlite3_bind_blob(stmt,3,$0.baseAddress,Int32(data.count),transient) }
        guard sqlite3_step(stmt)==SQLITE_DONE else { throw failure }
    }
    public func load<T: Decodable>(_ type: T.Type, kind: String) throws -> [T] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db,"SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC",-1,&stmt,nil)==SQLITE_OK else { throw failure }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt,1,kind,-1,unsafeBitCast(-1,to:sqlite3_destructor_type.self))
        var values=[T]()
        while true {
            let code=sqlite3_step(stmt)
            if code==SQLITE_DONE { break }
            guard code==SQLITE_ROW, let pointer=sqlite3_column_blob(stmt,0) else { throw failure }
            values.append(try JSONDecoder().decode(type,from:Data(bytes:pointer,count:Int(sqlite3_column_bytes(stmt,0)))))
        }
        return values
    }
    public func delete(kind: String, id: String) throws {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db,"DELETE FROM records WHERE kind=? AND id=?",-1,&stmt,nil)==SQLITE_OK else { throw failure }
        defer { sqlite3_finalize(stmt) }
        let transient=unsafeBitCast(-1,to:sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt,1,kind,-1,transient);sqlite3_bind_text(stmt,2,id,-1,transient)
        guard sqlite3_step(stmt)==SQLITE_DONE else { throw failure }
    }
}

public enum Engine {
    public static func run(executable: URL, project: Project) throws -> String {
        let dataset=try Dataset.parse(project.csv)
        guard let y=dataset.columns.firstIndex(of:project.response), !project.factors.isEmpty else { throw LocalError.message("请选择结果变量和影响因素") }
        let x=project.factors.compactMap { dataset.columns.firstIndex(of:$0) }
        guard x.count==project.factors.count else { throw LocalError.message("因素列不在当前数据中，请重新选择") }
        let request: [String:Any] = ["columns":dataset.columns,"rows":dataset.rows,"x":x,"y":y,"method":project.method]
        let input=try JSONSerialization.data(withJSONObject:request)
        // Temporary files avoid pipe backpressure for larger datasets/results.
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:folder) }
        let inputURL=folder.appendingPathComponent("input.json"), outputURL=folder.appendingPathComponent("output.json"), errorURL=folder.appendingPathComponent("error.txt")
        try input.write(to:inputURL);try Data().write(to:outputURL);try Data().write(to:errorURL)
        let stdin=try FileHandle(forReadingFrom:inputURL), stdout=try FileHandle(forWritingTo:outputURL), stderr=try FileHandle(forWritingTo:errorURL)
        defer { try? stdin.close();try? stdout.close();try? stderr.close() }
        let task=Process();task.executableURL=executable;task.standardInput=stdin;task.standardOutput=stdout;task.standardError=stderr
        try task.run();task.waitUntilExit()
        guard task.terminationStatus==0 else { throw LocalError.message((try? String(contentsOf:errorURL,encoding:.utf8)) ?? "计算失败") }
        let result=try String(contentsOf:outputURL,encoding:.utf8)
        _ = try JSONSerialization.jsonObject(with:Data(result.utf8))
        return result
    }
}
