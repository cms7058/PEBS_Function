import Foundation
import PEBSCore
func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else {throw LocalError.message("FAIL: "+message)}
    print("PASS: "+message)
}
func rejects(_ text: String) -> Bool {do {_ = try Dataset.parse(text);return false}catch{return true}}
do {
    let sample=try Dataset.parse(Dataset.sample)
    try check(sample.rows.count==100 && sample.columns.count==3,"模拟数据解析")
    let csv="\u{FEFF}\"X,mm\",Y\r\n"+(0..<20).map{"\($0),\($0*2)"}.joined(separator:"\r\n")+"\r\n"
    try check(try Dataset.parse(csv).columns==["X,mm","Y"],"带引号列名、BOM、CRLF")
    try check(rejects(Dataset.sample.replacingOccurrences(of:"160.0",with:"NaN")),"拒绝非有限数值")
    try check(rejects("X,X\n1,2") && rejects("\"X,Y\n1,2"),"拒绝重复列和无效引号")
    try check(rejects("X,Y\n"+(0..<20).map{"\($0),"}.joined(separator:"\n")),"缺失值不允许通过")
    let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer {try? FileManager.default.removeItem(at:dir)}
    let db=try Database(directory:dir)
    var p=Project(name:"工艺改善");p.notes[0]="目标：降低不良率";p.completed=[0,1];p.csv=Dataset.sample
    try db.save(p,kind:"project",id:p.id)
    let loaded=try Database(directory:dir).load(Project.self,kind:"project")
    try check(loaded.first?.notes[0]==p.notes[0] && loaded.first?.completed==[0,1],"SQLite 重启持久化")
    try db.delete(kind:"project",id:p.id)
    try check(try db.load(Project.self,kind:"project").isEmpty,"SQLite 删除")
    p.completed=Set(0...9);p.modelJSON="{}";p.invalidate(from:3)
    try check(p.completed==[0,1,2] && p.modelJSON==nil,"上游修改清除后续状态及模型")
    if let engine=ProcessInfo.processInfo.environment["PEBS_ENGINE"] {
        p.response="强度 MPa";p.factors=["温度 °C","压力 MPa"];p.method="quadratic"
        let output=try Engine.run(executable:URL(fileURLWithPath:engine),project:p)
        let result=try JSONSerialization.jsonObject(with:Data(output.utf8)) as! [String:Any]
        try check((result["rmse"] as? Double ?? 100)<1,"Swift→Rust 真实进程建模与结果解析")
    }
} catch {fputs(error.localizedDescription+"\n",stderr);exit(1)}
