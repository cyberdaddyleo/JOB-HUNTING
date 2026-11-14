# 视觉素材与图像生成记录

本轮设计使用两次内置 `image_gen` 工具生成图像，均为 `transparent_background=false`。工具没有暴露可选模型或实际模型型号，因此**不能把本轮结果宣称为 image2.5 生成**。没有使用 CLI 或自行选择其他型号。

界面初始探索名为“觅途 JobPilot”；用户随后指定最终品牌“赛博老爸·求职系统”。应用中的文字、按钮、开发者水印与交互由代码渲染，初期概念图不是最终产品截图。

## 1. 完整工作台概念

文件：`docs/design-concept.png`。

中文概述：生成完整中文求职工作台桌面概念，包括侧边导航、岗位发现标题、求职偏好、搜索筛选、职位列表，以及右侧可解释的匹配详情。采用暖白底色、浅鼠尾草绿、森林绿主色、细边框与留白。

实际提示词的关键英文片段：

> Use case: ui-mockup. Create a polished complete desktop web application screenshot for a Chinese open-source AI job seeker workbench named 觅途 JobPilot. 1536x1024 landscape composition, readable refined typography. Visual direction: calm premium editorial productivity software, warm white main canvas #fafbf8, pale sage accent #eaf2dd, forest green #294b37 primary, charcoal text, thin soft gray lines, airy spacing. Not a landing page.

后续约束指定各页面中文侧边导航、标题“找到值得奔赴的下一站。”、搜索与筛选、左侧岗位列表和右侧匹配理由。这里记录关键片段与结构概要，不将遗漏的全文重新编造成实际调用记录。片段中的初期“open-source”设计用语不改变最终项目的非商业源码公开许可证。

## 2. 上升路径视觉素材

文件：`public/career-path.png`。用于岗位发现页的背景插画。

中文概述：一条由左下向右上延伸的柔和折叠路径，以半透明鼠尾草绿、象牙绿、磨砂玻璃与纸张质感表达职业新机会。画面左侧保留空白，文字由界面另行覆盖，不把正文烘焙进图片。

实际关键英文提示词：

> Use case: stylized-concept. Asset type: wide product UI background illustration. Create a single elegant sculptural ascending ribbon or paper path for a sophisticated Chinese career productivity app. Wide horizontal 3:1 composition. A continuous broad gently curved folded ribbon moves from lower left foreground towards upper right and rises into the distance, like a path to new opportunities. Pale translucent sage green outside, soft ivory green inside, delicate edges, photorealistic frosted matte glass and paper texture, diffuse morning studio light with faint floor shadow. Minimal refined premium art direction. Background is extremely pale warm off white #fafbf8. Main sculpture occupies right 75 percent, left edge nearly empty. No text, no letters, no icons, no UI, no logos, no people, no borders. Restrained palette of sage, mint and olive, low contrast, harmonious with dark forest green typography overlaid separately. Sharp beautiful 3D rendering. Aspect landscape wide.

## 资产使用边界

以上文件在本项目内本地保存，不依赖工具的临时输出路径。源代码中的品牌、交互与筛选不是图片中的假控件。生成素材不是从智能投标参考包复制而来。后续分发时保留本记录与项目许可，不把 AI 生成图像标为真实招聘产品截图或已确认的指定型号产物。
