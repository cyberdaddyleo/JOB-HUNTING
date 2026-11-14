# 按岗位生成求职文件

在“求职材料”中选择岗位，点击“生成这份求职材料”。系统会保存一组材料，可预览并分别下载：

- **岗位简历**：岗位名称、公司、档案姓名与联系方式；按相关性排列的已有技能；原始个人简介与完整简历正文。
- **求职信**：目标岗位、档案中与岗位相关的技能，以及原始个人简介。未提供的公司经历、学校、证书和成果不予补写。
- **证据清单**：逐项列出学历、年限、技能和岗位其他要求，区分档案记录、相关线索、未知证据与明确差距。

每种材料支持真实、可编辑的 **DOCX** 文件，以及 Markdown 和打印版 HTML。打开 HTML 后使用浏览器的“打印 → 另存为 PDF”。系统不会将 HTML 或文本伪装成 PDF。Word 采用 A4 单栏、黑色标题、中文字体回退和自然段落分页，便于继续编辑。

## 真实信息的边界

简历中的简介与经历正文保留档案文字，不用模型改写。相关技能只能取自档案中已经填写的技能。系统不会把岗位要求转换为个人能力，也不会把只出现过的关键词自动认定为满足要求。缺少的学历被省略；工作年限、学历等仅按档案字段比较，并不构成背景核验。

长句或复合岗位要求始终需要人工核对。例如，“熟悉 SQL 且具有 5 年银行经验”不会因为档案列了 SQL 而判定全部满足。原文中的否定语句不会被改写为肯定事实。演示档案或演示岗位生成的每种文件均显示演示标记。

有 AI 配置时，模型只可返回已有技能与核对事项的索引顺序。服务端验证索引类型、范围、数量和完整响应结构；其他文字、额外字段、失败或超时均触发本地规则回退。AI 不生成姓名、公司履历、学历、证书、任职年限和成果。当前排序请求仅含求职方向、简介、岗位描述、相关技能和核对事项，不发送姓名或联系邮箱。API 凭据仅在服务端读取，不保存到材料或浏览器。

请先在“求职档案”中保存资料。材料保留生成时的档案版本；档案更新后，旧材料会显示提醒，可重新生成。缺少姓名、邮箱、简历正文或学历会显示补充提醒；投递前仍需审核文件中的信息。

## 服务端接口

`generateMaterials(profile, job, { env, fetchImpl, profileRevision })` 返回 JSON 材料对象：

```js
{
  id, jobId, jobTitle, company, profileRevision, createdAt,
  mode: 'local' | 'ai-assisted', modeLabel, generationNote,
  isDemo, warnings,
  resume: { name, email, role, targetRole, targetCompany, experience,
    education, portfolioUrl, summary, relevantSkills, otherSkills, sourceText },
  coverLetter,
  evidence: [{ id, requirement, evidence, status, source }],
  focusEvidenceIds,
  markdown
}
```

`renderDocument(material, kind, format)` 为异步函数，返回 `{ buffer, mime, filename }`。`kind` 为 `resume`、`cover-letter` 或 `checklist`；`format` 为 `docx`、`md` 或 `html`。文件名去除路径分隔符和控制字符；HTML 与 Markdown 中的用户文字按对应格式转义。HTML 不含脚本或外部资源。

- `POST /api/materials`，请求 `{ "jobId": "..." }`，生成并持久化材料。
- `GET /api/materials/:id/download?kind=resume&format=docx`，下载具体文件。
- `/api/bootstrap` 包含已保存的 `materials` 和当前 `profileRevision`。

生产运行只依赖 Node.js 的 `docx` 包，无需 Python、Office 或 LibreOffice。DOCX 不作为 Base64 存入状态文件，仅在下载或附件生成时输出。原始简历正文最多 40,000 字符，个人简介最多 5,000 字符。

## 验证

运行 `node --test tests/documents.test.js`。覆盖真实 DOCX ZIP 与 OOXML 结构、三类文件、已知事实保留、复合要求与否定语句、技能边界、HTML/Markdown 转义、危险文件名、AI 索引约束、失败回退、演示标记和内容长度限制。测试不会调用真实模型或发送邮件。
