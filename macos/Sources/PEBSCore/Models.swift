import Foundation

public enum LocalError: LocalizedError {
    case message(String)
    public var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
}
public struct Project: Codable, Identifiable, Sendable {
    public var id = UUID().uuidString
    public var name: String
    public var updated = Date()
    public var step = 0
    public var notes = Array(repeating: "", count: 10)
    public var completed: Set<Int> = []
    public var csv = ""
    public var synthetic = false
    public var method = "linear"
    public var response = ""
    public var factors: [String] = []
    public var modelJSON: String? = nil
    public init(name: String) { self.name = name }
    public mutating func invalidate(from stage: Int) {
        completed = completed.filter { $0 < stage }
        if stage <= 5 { modelJSON = nil }
    }
}
public struct Skill: Codable, Identifiable, Sendable {
    public var id = UUID().uuidString
    public var title: String
    public var content: String
    public var source: String
    public init(title: String, content: String, source: String) { self.title=title;self.content=content;self.source=source }
}
public struct Book: Codable, Identifiable, Sendable {
    public var id = UUID().uuidString
    public var title: String
    public var filename: String
    public init(title: String, filename: String) { self.title=title;self.filename=filename }
}
public struct Stage: Sendable {
    public let title: String
    public let guidance: String
    public static let all: [Stage] = [
        .init(title: "业务问题识别", guidance: "说明现状、目标、范围、负责人和成功标准。填写可量化的目标及验收时间。"),
        .init(title: "约束／瓶颈识别", guidance: "列出流程各环节的产能、等待与在制品。用现场证据验证瓶颈，区分假设与事实。"),
        .init(title: "变量 X／Y 定义", guidance: "定义一个结果变量 Y 与 1–6 个因素 X，记录单位、测量方式、可控范围和干扰因素。"),
        .init(title: "数据获取与质量检查", guidance: "下载 CSV 模板，采集后导入。列名必须唯一，数据必须完整且为有限数值；不自动填补缺失值。"),
        .init(title: "选择建模方法", guidance: "先建立线性基线；曲率可考虑二次响应面，因素相互影响可考虑交互项。指数模型要求 Y > 0，幂函数还要求 X > 0。"),
        .init(title: "生成数学模型", guidance: "调用本地 Rust 引擎计算。前 80% 行拟合，后 20% 行留出验证；适用于按行次序划分的验证设计。"),
        .init(title: "验证模型", guidance: "比较留出 RMSE 与训练均值基线，检查残差和适用范围。填写现场验证方案；模拟数据只能验证操作流程。"),
        .init(title: "优化与仿真", guidance: "在已验证的因素范围内比较候选方案，记录成本、收益、安全约束与不确定性。当前版本由用户填写方案。"),
        .init(title: "形成改善方案", guidance: "明确措施、负责人、资源、截止时间和验收标准。先小范围验证，再推广实施。"),
        .init(title: "实时监控与模型迭代", guidance: "填写监测频率、误差阈值、负责人和重新建模条件。当前版本手动录入监测结论。")
    ]
}
public struct Dataset: Sendable {
    public let columns: [String]
    public let rows: [[Double]]
    public static func parse(_ text: String) throws -> Dataset {
        // RFC 4180 quoting, including embedded line breaks and escaped quotes.
        let chars = Array(text.replacingOccurrences(of: "\u{FEFF}", with: "").replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n"))
        var records = [[String]](), row = [String](), field = "", quoted = false, closed = false, i = 0
        func appendField() { row.append(field.trimmingCharacters(in: .whitespacesAndNewlines));field="";closed=false }
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" {
                    if i+1 < chars.count && chars[i+1] == "\"" { field.append("\"");i += 1 }
                    else { quoted=false;closed=true }
                } else { field.append(c) }
            } else if c == "\"" {
                guard field.isEmpty && !closed else { throw LocalError.message("CSV 引号格式错误") };quoted=true
            } else if c == "," { appendField() }
            else if c == "\n" || c == "\r" {
                appendField();records.append(row);row=[]
                if c == "\r" && i+1 < chars.count && chars[i+1] == "\n" { i += 1 }
            } else {
                guard !closed || c.isWhitespace else { throw LocalError.message("CSV 引号后存在额外字符") }
                if !closed { field.append(c) }
            }
            i += 1
        }
        guard !quoted else { throw LocalError.message("CSV 存在未闭合的引号") }
        if !field.isEmpty || !row.isEmpty || closed { appendField();records.append(row) }
        guard let header=records.first, header.count >= 2, header.allSatisfy({ !$0.isEmpty }), Set(header).count == header.count else {
            throw LocalError.message("需要至少两列，列名不能为空或重复")
        }
        guard records.count-1 <= 20000 else { throw LocalError.message("最多支持 20,000 行数据") }
        var values = [[Double]](), issues = [String]()
        for (index,record) in records.dropFirst().enumerated() {
            if record.count != header.count { issues.append("第 \(index+2) 行：列数应为 \(header.count)");continue }
            var numbers = [Double]()
            for (column, value) in record.enumerated() {
                if let number=Double(value), number.isFinite, abs(number)<=1e12 { numbers.append(number) }
                else { issues.append("第 \(index+2) 行「\(header[column])」：空值、非数值或超范围") }
            }
            if numbers.count == header.count { values.append(numbers) }
        }
        if !issues.isEmpty { throw LocalError.message(issues.prefix(30).joined(separator: "\n") + (issues.count>30 ? "\n另有 \(issues.count-30) 个问题" : "")) }
        guard values.count >= 15 else { throw LocalError.message("至少需要 15 行有效数据；当前 \(values.count) 行") }
        return Dataset(columns: header, rows: values)
    }
    public static var sample: String {
        "温度 °C,压力 MPa,强度 MPa\n" + (0..<100).map { i in
            let x=160+Double(i*17 % 61), z=2+Double(i*7 % 21)/10
            let y=70+0.4*(x-190)+3*(z-3)-0.008*pow(x-190,2)+sin(Double(i)*1.7)*0.4
            return "\(x),\(z),\(y)"
        }.joined(separator:"\n")
    }
}
