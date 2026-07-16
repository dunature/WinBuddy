export interface MarketplaceContentEntry { slug:string; name:string; category:string; priority:'P0'|'P1'|'P2'; benefit:string; workflow:string[]; prompts:string[] }
export const marketplaceContentCatalog:MarketplaceContentEntry[]=[
{slug:'deep-research',name:'深度研究',category:'research',priority:'P0',benefit:'把多来源材料整理成可追溯的结构化研究报告',workflow:['明确研究问题与交付标准','检索多个独立来源','交叉核验关键事实','按证据强度输出结论'],prompts:['研究一个新兴行业并标注来源','核验一项争议性市场判断','生成带风险提示的研究简报']},
{slug:'competitor-analysis',name:'竞品分析',category:'research',priority:'P0',benefit:'从能力、定位和证据中识别真实竞争差异',workflow:['定义比较维度','收集一手资料','逐项建立证据矩阵','总结机会与风险'],prompts:['比较三款开发工具','分析两个产品的定价差异','识别竞品没有覆盖的用户需求']},
{slug:'meeting-summarizer',name:'会议总结',category:'productivity',priority:'P0',benefit:'把会议原文转换为决策、行动项和责任人',workflow:['识别议题','提取确定决策','整理行动项与负责人','标记未决问题'],prompts:['整理产品评审会议','提取周会行动项','总结客户访谈结论']},
{slug:'ui-review',name:'UI 体验审查',category:'design',priority:'P0',benefit:'系统发现界面层级、可访问性和交互问题',workflow:['确认任务与用户','检查信息层级','审查状态和键盘路径','按影响排序建议'],prompts:['审查桌面设置页','检查移动端表单','评估一个管理后台']},
{slug:'csv-analysis',name:'表格数据分析',category:'data-ai',priority:'P0',benefit:'从表格中快速发现异常、趋势和可解释结论',workflow:['检查字段与质量','执行汇总统计','定位异常与变化','输出结论和限制'],prompts:['分析销售 CSV','检查运营数据异常','总结问卷结果']},
{slug:'repo-audit',name:'代码仓库审计',category:'devops',priority:'P0',benefit:'用证据识别仓库结构、依赖、测试和发布风险',workflow:['建立架构地图','检查依赖和配置','核对测试与安全边界','形成分级整改项'],prompts:['审计 TypeScript 仓库','检查发布配置','评估测试覆盖缺口']},
{slug:'technical-writer',name:'技术文档撰写',category:'writing',priority:'P0',benefit:'把实现事实转成可执行、可维护的技术文档',workflow:['确认读者与目标','读取代码和接口事实','组织任务导向结构','校验命令与示例'],prompts:['编写 API 指南','整理部署手册','更新功能 README']},
{slug:'source-fact-check',name:'来源核查',category:'research',priority:'P1',benefit:'评估来源可信度并标记无法证实的主张',workflow:['拆分主张','查找原始来源','交叉验证','标记争议与置信度'],prompts:['核查文章中的关键数字']},
{slug:'task-breakdown',name:'任务拆解',category:'productivity',priority:'P1',benefit:'把模糊目标拆成有依赖和验收条件的任务',workflow:['定义完成状态','识别依赖','切分垂直任务','补充验收条件'],prompts:['拆解一个两周产品迭代']},
{slug:'content-outline',name:'内容大纲',category:'content',priority:'P1',benefit:'围绕受众与目标生成可直接写作的结构',workflow:['确定受众','提炼中心论点','排列章节','补充证据需求'],prompts:['生成技术文章大纲']},
{slug:'social-rewriter',name:'社交内容改写',category:'content',priority:'P2',benefit:'在保留事实的前提下适配不同平台语气',workflow:['提取不变事实','确认平台限制','改写语气和长度','核查夸张表达'],prompts:['把产品公告改写为社交帖']},
{slug:'design-spec-generator',name:'设计规范生成',category:'design',priority:'P1',benefit:'从界面事实提取 token、组件和状态规范',workflow:['盘点视觉元素','归纳 token','定义组件状态','记录响应式规则'],prompts:['从设置页整理设计规范']},
{slug:'data-cleaner',name:'数据清洗',category:'data-ai',priority:'P1',benefit:'可追溯地处理缺失、重复和格式不一致',workflow:['分析质量问题','制定清洗规则','执行并保留变更记录','复核结果'],prompts:['清洗客户名单 CSV']},
{slug:'deployment-checklist',name:'部署检查清单',category:'devops',priority:'P1',benefit:'把发布前后验证与回滚条件变成清晰清单',workflow:['确认变更范围','列出前置检查','定义上线验证','准备回滚触发条件'],prompts:['生成 Web 服务发布清单']},
{slug:'knowledge-curator',name:'知识库整理',category:'writing',priority:'P1',benefit:'对知识材料归类、去重、链接并生成摘要',workflow:['盘点材料','建立分类','合并重复内容','补充链接和摘要'],prompts:['整理团队工程知识库']},
]
